import { createHash, randomUUID } from "node:crypto";
import { DefaultSqlPermissionValidator } from "./sqlPermissionValidator.js";
import { SqlResultProcessor } from "./sqlResultProcessor.js";
import { SqlRiskAssessor } from "./sqlRiskAssessor.js";
import { SqlSafetyValidator } from "./sqlSafetyValidator.js";
import { SqlToolError } from "./sqlToolError.js";
import { getSqlToolDefinition } from "./sqlToolPrompt.js";
import type {
  RequestSqlQueryExecutionInput,
  RequestSqlQueryExecutionOutput,
  SqlAuditEventType,
  SqlAuditLogger,
  SqlExecutionResult,
  SqlSafetyCheckResult,
  SqlSafetyIssue,
  SqlToolModuleConfig,
  SqlUserPermissionContext,
} from "./types.js";

const DEFAULT_APPROVAL_EXPIRES_IN_MS = 10 * 60 * 1000;

export class SqlToolModule {
  private readonly requests = new Map<string, RequestSqlQueryExecutionOutput>();
  private readonly activeExecutions = new Set<string>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly executionTimestampsByUser = new Map<string, number[]>();
  private readonly safetyValidator = new SqlSafetyValidator();
  private readonly permissionValidator;
  private readonly riskAssessor = new SqlRiskAssessor();
  private readonly resultProcessor = new SqlResultProcessor();

  constructor(private readonly config: SqlToolModuleConfig) {
    this.permissionValidator = config.permissionProvider ?? new DefaultSqlPermissionValidator();
  }

  getToolDefinition() {
    return getSqlToolDefinition();
  }

  getExecutionRequest(requestId: string) {
    return this.requests.get(requestId) ?? null;
  }

  async createExecutionRequest(input: RequestSqlQueryExecutionInput, userContext: SqlUserPermissionContext) {
    const now = new Date().toISOString();
    const requestId = `sql_req_${randomUUID()}`;
    const normalizedInput = this.normalizeInput(input);
    const dataSource = await this.config.dataSourceResolver.getDataSource(normalizedInput.dataSourceId);
    const safetyCheck = withInputValidationIssues(this.safetyValidator.validate(normalizedInput.sql), normalizedInput);
    const permissionCheck = await this.permissionValidator.check({
      dataSourceId: normalizedInput.dataSourceId,
      tables: safetyCheck.detectedTables ?? [],
      columns: safetyCheck.detectedColumns ?? [],
      safetyCheck,
      request: normalizedInput,
      userContext,
    });
    const riskAssessment = this.riskAssessor.assess({
      request: normalizedInput,
      safetyCheck,
      permissionCheck,
      userContext,
      config: this.config,
      dataSourceProtectionLevel: dataSource?.protectionLevel,
    });
    const blocked = !dataSource || !safetyCheck.passed || !permissionCheck.passed || riskAssessment.riskLevel === "blocked";
    const approvalStatus = blocked
      ? "not_required"
      : this.shouldAutoApprove(riskAssessment.requiresApproval, userContext)
        ? "approved"
        : "pending";
    const status = blocked ? "blocked" : approvalStatus === "approved" ? "approved" : "pending_approval";
    const approval = {
      approvalId: `sql_appr_${randomUUID()}`,
      status: approvalStatus,
      requestedBy: userContext.userId,
      reason: normalizedInput.approvalReason ?? normalizedInput.purpose,
      riskLevel: riskAssessment.riskLevel,
      createdAt: now,
      expiresAt: new Date(Date.now() + (userContext.approvalPolicy?.approvalExpiresInMs ?? DEFAULT_APPROVAL_EXPIRES_IN_MS)).toISOString(),
    } satisfies RequestSqlQueryExecutionOutput["approval"];
    const request: RequestSqlQueryExecutionOutput = {
      requestId,
      status,
      dataSourceId: normalizedInput.dataSourceId,
      normalizedSql: safetyCheck.normalizedSql ?? normalizedInput.sql.trim(),
      purpose: normalizedInput.purpose,
      expectedResultUse: normalizedInput.expectedResultUse,
      riskAssessment,
      permissionCheck,
      safetyCheck,
      approval,
      message: blocked ? "SQL 请求已被安全或权限策略拦截。" : approvalStatus === "approved" ? "SQL 请求已自动批准，等待执行。" : "SQL 请求已创建，等待用户审批。",
      createdAt: now,
    };
    this.requests.set(requestId, request);
    await this.audit("request_created", request, userContext, "success", "SQL 请求已创建。");
    await this.audit(safetyCheck.passed ? "safety_passed" : "safety_failed", request, userContext, safetyCheck.passed ? "success" : "blocked", safetyCheck.passed ? "SQL 安全校验通过。" : "SQL 安全校验失败。");
    await this.audit(permissionCheck.passed ? "permission_passed" : "permission_failed", request, userContext, permissionCheck.passed ? "success" : "blocked", permissionCheck.passed ? "SQL 权限校验通过。" : "SQL 权限校验失败。");
    await this.audit("risk_assessed", request, userContext, riskAssessment.riskLevel === "blocked" ? "blocked" : "success", `SQL 风险等级：${riskAssessment.riskLevel}。`);
    if (!blocked) {
      await this.audit("approval_created", request, userContext, "success", `SQL 审批单状态：${approvalStatus}。`);
    } else {
      await this.audit("query_blocked", request, userContext, "blocked", "SQL 请求已拦截。");
    }
    return request;
  }

  approveExecutionRequest(requestId: string, userContext: SqlUserPermissionContext) {
    const request = this.requireRequest(requestId);
    if (request.approval.status === "expired" || isExpired(request.approval.expiresAt)) {
      return this.updateRequest(requestId, {
        status: "expired",
        approval: { ...request.approval, status: "expired", updatedAt: new Date().toISOString() },
        message: "SQL 审批已过期。",
      });
    }
    const next = this.updateRequest(requestId, {
      status: "approved",
      approval: { ...request.approval, status: "approved", approvedBy: userContext.userId, updatedAt: new Date().toISOString() },
      message: "SQL 请求已审批通过。",
    });
    void this.audit("approval_approved", next, userContext, "success", "用户已批准 SQL 请求。");
    return next;
  }

  rejectExecutionRequest(requestId: string, userContext: SqlUserPermissionContext, reason: string) {
    const request = this.requireRequest(requestId);
    const next = this.updateRequest(requestId, {
      status: "rejected",
      approval: { ...request.approval, status: "rejected", rejectedBy: userContext.userId, reason, updatedAt: new Date().toISOString() },
      message: `SQL 请求已拒绝：${reason}`,
    });
    void this.audit("approval_rejected", next, userContext, "blocked", "用户已拒绝 SQL 请求。");
    return next;
  }

  cancelExecutionRequest(requestId: string, userContext: SqlUserPermissionContext) {
    const request = this.requireRequest(requestId);
    if (["blocked", "rejected", "completed", "failed", "cancelled", "expired"].includes(request.status)) {
      return request;
    }
    this.abortControllers.get(requestId)?.abort();
    this.activeExecutions.delete(requestId);
    const next = this.updateRequest(requestId, { status: "cancelled", message: "SQL 请求已取消。" });
    void this.audit("execution_cancelled", next, userContext, "success", "SQL 请求已取消。");
    return next;
  }

  validateSql(input: RequestSqlQueryExecutionInput) {
    return withInputValidationIssues(this.safetyValidator.validate(input.sql), this.normalizeInput(input));
  }

  async assessRisk(input: RequestSqlQueryExecutionInput, userContext: SqlUserPermissionContext) {
    const safetyCheck = this.validateSql(input);
    const permissionCheck = await this.permissionValidator.check({
      dataSourceId: input.dataSourceId,
      tables: safetyCheck.detectedTables ?? [],
      columns: safetyCheck.detectedColumns ?? [],
      safetyCheck,
      request: this.normalizeInput(input),
      userContext,
    });
    const dataSource = await this.config.dataSourceResolver.getDataSource(input.dataSourceId);
    return this.riskAssessor.assess({ request: this.normalizeInput(input), safetyCheck, permissionCheck, userContext, config: this.config, dataSourceProtectionLevel: dataSource?.protectionLevel });
  }

  async executeApprovedRequest(requestId: string, userContext: SqlUserPermissionContext) {
    const request = this.requireRequest(requestId);
    if (request.status !== "approved") {
      throw new SqlToolError("SQL_REQUEST_NOT_APPROVED", `请求状态不是 approved：${request.status}`, { requestId });
    }
    if (request.approval.status !== "approved" || isExpired(request.approval.expiresAt)) {
      const next = this.updateRequest(requestId, { status: "expired", approval: { ...request.approval, status: "expired" }, message: "SQL 审批未通过或已过期。" });
      throw new SqlToolError("SQL_APPROVAL_EXPIRED", "SQL 审批未通过或已过期。", { requestId: next.requestId });
    }
    const secondSafety = this.safetyValidator.validate(request.normalizedSql);
    if (!secondSafety.passed) {
      const next = this.updateRequest(requestId, { status: "blocked", safetyCheck: secondSafety, message: "执行前二次安全校验失败。" });
      await this.audit("safety_failed", next, userContext, "blocked", "执行前二次安全校验失败。");
      return next;
    }
    const dataSource = await this.config.dataSourceResolver.getDataSource(request.dataSourceId);
    const secondPermission = dataSource
      ? await this.permissionValidator.check({
          dataSourceId: request.dataSourceId,
          tables: secondSafety.detectedTables ?? [],
          columns: secondSafety.detectedColumns ?? [],
          safetyCheck: secondSafety,
          request: {
            dataSourceId: request.dataSourceId,
            sql: request.normalizedSql,
            purpose: request.purpose,
            expectedResultUse: request.expectedResultUse,
            maxRows: request.riskAssessment.recommendedMaxRows,
            timeoutMs: request.riskAssessment.recommendedTimeoutMs,
          },
          userContext,
        })
      : { ...request.permissionCheck, passed: false, allowedDataSource: false };
    if (!secondPermission.passed || !dataSource) {
      const next = this.updateRequest(requestId, { status: "blocked", permissionCheck: secondPermission, message: "执行前二次权限校验失败。" });
      await this.audit("permission_failed", next, userContext, "blocked", "执行前二次权限校验失败。");
      return next;
    }
    if (!this.canStartExecution(userContext.userId)) {
      const next = this.updateRequest(requestId, { status: "blocked", message: "SQL 查询触发限流策略，已阻断执行。" });
      await this.audit("query_blocked", next, userContext, "blocked", "SQL 查询触发并发或频率限制。");
      return next;
    }
    const abortController = new AbortController();
    this.activeExecutions.add(requestId);
    this.abortControllers.set(requestId, abortController);
    this.recordExecutionTimestamp(userContext.userId);
    this.updateRequest(requestId, { status: "executing", message: "SQL 正在执行。" });
    await this.audit("execution_started", request, userContext, "success", "SQL 开始执行。");
    try {
      const result = await this.config.queryExecutorAdapter.executeReadOnlyQuery({
        dataSourceId: request.dataSourceId,
        sql: request.normalizedSql,
        maxRows: request.riskAssessment.recommendedMaxRows,
        timeoutMs: request.riskAssessment.recommendedTimeoutMs,
        signal: abortController.signal,
      });
      const execution = this.resultProcessor.process({
        executionId: `sql_exec_${randomUUID()}`,
        requestId,
        request: {
          dataSourceId: request.dataSourceId,
          sql: request.normalizedSql,
          purpose: request.purpose,
          expectedResultUse: request.expectedResultUse,
          maxRows: request.riskAssessment.recommendedMaxRows,
        },
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        maxRows: request.riskAssessment.recommendedMaxRows,
        executionTimeMs: result.executionTimeMs,
        sensitiveColumns: request.permissionCheck.sensitiveColumns,
        storeRawRows: this.config.storeRawRows,
      });
      const next = this.updateRequest(requestId, { status: "completed", execution, message: "SQL 执行完成。" });
      await this.audit("execution_succeeded", next, userContext, "success", "SQL 执行成功。", execution);
      if (execution.masked) {
        await this.audit("result_masked", next, userContext, "success", "SQL 结果已脱敏。", execution);
      }
      if (execution.pythonAnalysisPayload) {
        await this.audit("result_to_python", next, userContext, "success", "SQL 结果已生成 PythonAnalysisPayload。", execution);
      }
      await this.audit("result_to_model", next, userContext, "success", "SQL 结果已生成 safeModelPayload。", execution);
      return next;
    } catch (error) {
      const execution: SqlExecutionResult = {
        executionId: `sql_exec_${randomUUID()}`,
        requestId,
        status: abortController.signal.aborted ? "cancelled" : String(error).toLowerCase().includes("timeout") ? "timeout" : "failed",
        columns: [],
        summary: { rowCount: 0, columnCount: 0, columns: [], warnings: [safeErrorMessage(error)] },
        rowCount: 0,
        truncated: false,
        masked: false,
        executionTimeMs: 0,
        warnings: [safeErrorMessage(error)],
        createdAt: new Date().toISOString(),
      };
      const next = this.updateRequest(requestId, {
        status: execution.status === "cancelled" ? "cancelled" : "failed",
        execution,
        message: execution.status === "cancelled" ? "SQL 执行已取消。" : "SQL 执行失败。",
      });
      await this.audit(execution.status === "cancelled" ? "execution_cancelled" : execution.status === "timeout" ? "execution_timeout" : "execution_failed", next, userContext, execution.status === "cancelled" ? "blocked" : "failed", safeErrorMessage(error), execution);
      return next;
    } finally {
      this.activeExecutions.delete(requestId);
      this.abortControllers.delete(requestId);
    }
  }

  processResult(result: Parameters<SqlResultProcessor["process"]>[0]) {
    return this.resultProcessor.process(result);
  }

  private normalizeInput(input: RequestSqlQueryExecutionInput): RequestSqlQueryExecutionInput {
    return {
      ...input,
      dataSourceId: input.dataSourceId.trim(),
      sql: input.sql.trim(),
      purpose: input.purpose.trim(),
      requireApproval: input.requireApproval ?? this.config.requireApprovalByDefault,
      maxRows: clamp(input.maxRows ?? this.config.defaultMaxRows, 1, this.config.hardMaxRows),
      timeoutMs: clamp(input.timeoutMs ?? this.config.defaultTimeoutMs, 100, this.config.hardTimeoutMs),
    };
  }

  private shouldAutoApprove(requiresApproval: boolean, userContext: SqlUserPermissionContext) {
    return !requiresApproval && this.config.allowAutoApprovalForLowRisk && userContext.allowAutoApproval;
  }

  private requireRequest(requestId: string) {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new SqlToolError("SQL_APPROVAL_NOT_FOUND", "SQL 审批请求不存在。", { requestId });
    }
    return request;
  }

  private updateRequest(requestId: string, patch: Partial<RequestSqlQueryExecutionOutput>) {
    const current = this.requireRequest(requestId);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.requests.set(requestId, next);
    return next;
  }

  private async audit(eventType: SqlAuditEventType, request: RequestSqlQueryExecutionOutput, userContext: SqlUserPermissionContext, status: "success" | "failed" | "blocked", message: string, execution?: SqlExecutionResult) {
    await this.config.auditLogger?.log({
      eventType,
      requestId: request.requestId,
      executionId: execution?.executionId,
      userId: userContext.userId,
      dataSourceId: request.dataSourceId,
      sqlHash: hashSql(request.normalizedSql),
      riskLevel: request.riskAssessment.riskLevel,
      status,
      message,
      metadata: {
        requestStatus: request.status,
        rowCount: execution?.rowCount,
        truncated: execution?.truncated,
        masked: execution?.masked,
      },
    });
  }

  private canStartExecution(userId: string) {
    const maxConcurrent = this.config.maxConcurrentExecutions ?? 3;
    if (this.activeExecutions.size >= maxConcurrent) {
      return false;
    }
    const maxPerMinute = this.config.maxRequestsPerMinute ?? 30;
    const now = Date.now();
    const recent = (this.executionTimestampsByUser.get(userId) ?? []).filter((timestamp) => now - timestamp < 60_000);
    this.executionTimestampsByUser.set(userId, recent);
    return recent.length < maxPerMinute;
  }

  private recordExecutionTimestamp(userId: string) {
    const current = this.executionTimestampsByUser.get(userId) ?? [];
    this.executionTimestampsByUser.set(userId, [...current, Date.now()]);
  }
}

export function createSqlToolModule(config: SqlToolModuleConfig) {
  return new SqlToolModule(config);
}

function isExpired(expiresAt?: string) {
  return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
}

function withInputValidationIssues(safetyCheck: SqlSafetyCheckResult, input: RequestSqlQueryExecutionInput): SqlSafetyCheckResult {
  const reasons: SqlSafetyIssue[] = [...safetyCheck.reasons];
  if (!input.dataSourceId) {
    reasons.push({ code: "UNSUPPORTED_SQL", severity: "error", message: "dataSourceId 不能为空。" });
  }
  if (!input.purpose) {
    reasons.push({ code: "UNSUPPORTED_SQL", severity: "error", message: "SQL 查询目的不能为空。" });
  }
  if (reasons.length === safetyCheck.reasons.length) {
    return safetyCheck;
  }
  return {
    ...safetyCheck,
    passed: false,
    level: "blocked",
    reasons,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function hashSql(sql: string) {
  return createHash("sha256").update(sql).digest("hex");
}

function safeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/password|token|api[_-]?key/gi, "[REDACTED]");
}
