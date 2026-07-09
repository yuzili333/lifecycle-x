import { createHash, randomUUID } from "node:crypto";
import { DefaultPythonPermissionValidator } from "./pythonPermissionValidator.js";
import { PythonResultProcessor } from "./pythonResultProcessor.js";
import { PythonRiskAssessor } from "./pythonRiskAssessor.js";
import { LocalPythonRunnerAdapter } from "./localPythonRunnerAdapter.js";
import { PythonRunnerError, sanitizeMessage } from "./pythonRunnerError.js";
import { PythonScriptValidator } from "./pythonScriptValidator.js";
import { getPythonToolDefinition } from "./pythonToolPrompt.js";
import type {
  PythonAuditEventType,
  PythonExecutionResult,
  PythonPermissionCheckResult,
  PythonRunnerModuleConfig,
  PythonScriptSafetyCheckResult,
  PythonScriptSafetyIssue,
  PythonUserPermissionContext,
  RequestPythonAnalysisExecutionInput,
  RequestPythonAnalysisExecutionOutput,
} from "./types.js";

const DEFAULT_APPROVAL_EXPIRES_IN_MS = 10 * 60 * 1000;

export class PythonRunnerModule {
  private readonly requests = new Map<string, RequestPythonAnalysisExecutionOutput>();
  private readonly requestInputs = new Map<string, RequestPythonAnalysisExecutionInput>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly activeExecutions = new Set<string>();
  private readonly executionTimestampsByUser = new Map<string, number[]>();
  private readonly scriptValidator: PythonScriptValidator;
  private readonly permissionValidator = new DefaultPythonPermissionValidator();
  private readonly riskAssessor = new PythonRiskAssessor();
  private readonly resultProcessor = new PythonResultProcessor();
  private readonly runnerAdapter;
  private failureCount = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly config: PythonRunnerModuleConfig) {
    this.scriptValidator = new PythonScriptValidator(config.allowedLibraries);
    this.runnerAdapter = config.runnerAdapter ?? new LocalPythonRunnerAdapter(config);
  }

  getToolDefinition() {
    return getPythonToolDefinition();
  }

  getExecutionRequest(requestId: string) {
    return this.requests.get(requestId) ?? null;
  }

  async createExecutionRequest(input: RequestPythonAnalysisExecutionInput, userContext: PythonUserPermissionContext) {
    const now = new Date().toISOString();
    const requestId = `py_req_${randomUUID()}`;
    const normalizedInput = this.normalizeInput(input);
    const safetyCheck = await this.validateScript(normalizedInput, userContext);
    const permissionCheck = await this.checkPermissions(normalizedInput, safetyCheck, userContext);
    const datasetExists = await this.datasetsExist(normalizedInput);
    const effectivePermissionCheck = datasetExists.ok ? permissionCheck : appendPermissionIssues(permissionCheck, datasetExists.missing);
    const riskAssessment = this.riskAssessor.assess({
      request: normalizedInput,
      safetyCheck,
      permissionCheck: effectivePermissionCheck,
      userContext,
      config: this.config,
    });
    const blocked = !safetyCheck.passed || !effectivePermissionCheck.passed || riskAssessment.riskLevel === "blocked";
    const approvalStatus = blocked
      ? "not_required"
      : this.shouldAutoApprove(riskAssessment.requiresApproval, userContext)
        ? "approved"
        : "pending";
    const status = blocked ? "blocked" : approvalStatus === "approved" ? "approved" : "pending_approval";
    const approval = {
      approvalId: `py_appr_${randomUUID()}`,
      status: approvalStatus,
      requestedBy: userContext.userId,
      reason: normalizedInput.approvalReason ?? normalizedInput.purpose,
      riskLevel: riskAssessment.riskLevel,
      createdAt: now,
      expiresAt: new Date(Date.now() + (userContext.approvalPolicy?.approvalExpiresInMs ?? DEFAULT_APPROVAL_EXPIRES_IN_MS)).toISOString(),
    } satisfies RequestPythonAnalysisExecutionOutput["approval"];
    const request: RequestPythonAnalysisExecutionOutput = {
      requestId,
      status,
      purpose: normalizedInput.purpose,
      inputDatasets: normalizedInput.inputDatasets,
      expectedOutputs: normalizedInput.expectedOutputs,
      riskAssessment,
      permissionCheck: effectivePermissionCheck,
      safetyCheck,
      approval,
      message: blocked ? "Python 请求已被安全或权限策略拦截。" : approvalStatus === "approved" ? "Python 请求已自动批准，等待执行。" : "Python 请求已创建，等待用户审批。",
      createdAt: now,
    };
    this.requests.set(requestId, request);
    this.requestInputs.set(requestId, normalizedInput);
    await this.audit("request_created", request, userContext, "success", "Python 请求已创建。");
    await this.audit(safetyCheck.passed ? "safety_passed" : "safety_failed", request, userContext, safetyCheck.passed ? "success" : "blocked", safetyCheck.passed ? "Python 脚本安全校验通过。" : "Python 脚本安全校验失败。");
    await this.audit(effectivePermissionCheck.passed ? "permission_passed" : "permission_failed", request, userContext, effectivePermissionCheck.passed ? "success" : "blocked", effectivePermissionCheck.passed ? "Python 权限校验通过。" : "Python 权限校验失败。");
    await this.audit("risk_assessed", request, userContext, riskAssessment.riskLevel === "blocked" ? "blocked" : "success", `Python 风险等级：${riskAssessment.riskLevel}。`);
    if (blocked) {
      await this.audit("script_blocked", request, userContext, "blocked", "Python 请求已拦截。");
    } else {
      await this.audit("approval_created", request, userContext, "success", `Python 审批单状态：${approvalStatus}。`);
    }
    return request;
  }

  approveExecutionRequest(requestId: string, userContext: PythonUserPermissionContext) {
    const request = this.requireRequest(requestId);
    if (request.approval.status === "expired" || isExpired(request.approval.expiresAt)) {
      return this.updateRequest(requestId, {
        status: "expired",
        approval: { ...request.approval, status: "expired", updatedAt: new Date().toISOString() },
        message: "Python 审批已过期。",
      });
    }
    const next = this.updateRequest(requestId, {
      status: "approved",
      approval: { ...request.approval, status: "approved", approvedBy: userContext.userId, updatedAt: new Date().toISOString() },
      message: "Python 请求已审批通过。",
    });
    void this.audit("approval_approved", next, userContext, "success", "用户已批准 Python 请求。");
    return next;
  }

  rejectExecutionRequest(requestId: string, userContext: PythonUserPermissionContext, reason: string) {
    const request = this.requireRequest(requestId);
    const next = this.updateRequest(requestId, {
      status: "rejected",
      approval: { ...request.approval, status: "rejected", rejectedBy: userContext.userId, reason, updatedAt: new Date().toISOString() },
      message: `Python 请求已拒绝：${reason}`,
    });
    void this.audit("approval_rejected", next, userContext, "blocked", "用户已拒绝 Python 请求。");
    return next;
  }

  cancelExecutionRequest(requestId: string, userContext: PythonUserPermissionContext) {
    const request = this.requireRequest(requestId);
    if (["blocked", "rejected", "completed", "failed", "timeout", "cancelled", "expired"].includes(request.status)) {
      return request;
    }
    const executionId = request.execution?.executionId;
    if (executionId) {
      void this.runnerAdapter.cancel?.(executionId);
    }
    this.abortControllers.get(requestId)?.abort();
    this.activeExecutions.delete(requestId);
    const next = this.updateRequest(requestId, { status: "cancelled", message: "Python 请求已取消。" });
    void this.audit("execution_cancelled", next, userContext, "blocked", "Python 请求已取消。");
    return next;
  }

  async validateScript(input: RequestPythonAnalysisExecutionInput, _userContext?: PythonUserPermissionContext) {
    return withInputValidationIssues(this.scriptValidator.validate(input.script), this.normalizeInput(input));
  }

  async assessRisk(input: RequestPythonAnalysisExecutionInput, userContext: PythonUserPermissionContext) {
    const normalizedInput = this.normalizeInput(input);
    const safetyCheck = await this.validateScript(normalizedInput, userContext);
    const permissionCheck = await this.checkPermissions(normalizedInput, safetyCheck, userContext);
    return this.riskAssessor.assess({ request: normalizedInput, safetyCheck, permissionCheck, userContext, config: this.config });
  }

  async executeApprovedRequest(requestId: string, userContext: PythonUserPermissionContext) {
    const request = this.requireRequest(requestId);
    if (request.status !== "approved") {
      throw new PythonRunnerError("PYTHON_REQUEST_NOT_APPROVED", `请求状态不是 approved：${request.status}`, { requestId });
    }
    if (request.approval.status !== "approved" || isExpired(request.approval.expiresAt)) {
      const next = this.updateRequest(requestId, { status: "expired", approval: { ...request.approval, status: "expired" }, message: "Python 审批未通过或已过期。" });
      throw new PythonRunnerError("PYTHON_APPROVAL_EXPIRED", "Python 审批未通过或已过期。", { requestId: next.requestId });
    }
    if (Date.now() < this.circuitOpenUntil) {
      const next = this.updateRequest(requestId, { status: "blocked", message: "Python Runner 熔断中，暂不执行。" });
      await this.audit("script_blocked", next, userContext, "blocked", "Python Runner 熔断中。");
      return next;
    }

    const storedInput = this.requestInputs.get(requestId);
    if (!storedInput) {
      throw new PythonRunnerError("PYTHON_APPROVAL_NOT_FOUND", "Python 请求输入不存在。", { requestId });
    }
    const replayInput = {
      ...storedInput,
      timeoutMs: request.riskAssessment.recommendedTimeoutMs,
      memoryLimitMb: request.riskAssessment.recommendedMemoryLimitMb,
    };
    const secondSafety = await this.validateScript(replayInput, userContext);
    const secondPermission = await this.checkPermissions(replayInput, secondSafety, userContext);
    if (!secondSafety.passed) {
      const next = this.updateRequest(requestId, { status: "blocked", safetyCheck: secondSafety, message: "执行前二次脚本安全校验失败。" });
      await this.audit("safety_failed", next, userContext, "blocked", "执行前二次脚本安全校验失败。");
      return next;
    }
    if (!secondPermission.passed) {
      const next = this.updateRequest(requestId, { status: "blocked", permissionCheck: secondPermission, message: "执行前二次权限校验失败。" });
      await this.audit("permission_failed", next, userContext, "blocked", "执行前二次权限校验失败。");
      return next;
    }
    if (!this.canStartExecution(userContext.userId)) {
      const next = this.updateRequest(requestId, { status: "blocked", message: "Python 执行触发并发或频率限制。" });
      await this.audit("script_blocked", next, userContext, "blocked", "Python 执行触发限流策略。");
      return next;
    }

    const executionId = `py_exec_${randomUUID()}`;
    const abortController = new AbortController();
    this.abortControllers.set(requestId, abortController);
    this.activeExecutions.add(requestId);
    this.recordExecutionTimestamp(userContext.userId);
    this.updateRequest(requestId, { status: "executing", message: "Python 正在沙箱中执行。" });
    await this.audit("execution_started", request, userContext, "success", "Python 开始执行。");
    try {
      const adapterResult = await this.runnerAdapter.execute({
        executionId,
        requestId,
        script: replayInput.script,
        input: replayInput,
        timeoutMs: request.riskAssessment.recommendedTimeoutMs,
        memoryLimitMb: request.riskAssessment.recommendedMemoryLimitMb,
        signal: abortController.signal,
      });
      const execution = this.resultProcessor.process({ executionId, requestId, request: replayInput, adapterResult });
      const status = execution.status === "success" ? "completed" : execution.status === "timeout" ? "timeout" : execution.status === "cancelled" ? "cancelled" : "failed";
      const next = this.updateRequest(requestId, { status, execution, message: status === "completed" ? "Python 执行完成。" : "Python 执行未成功完成。" });
      await this.audit(execution.status === "success" ? "execution_succeeded" : execution.status === "timeout" ? "execution_timeout" : execution.status === "cancelled" ? "execution_cancelled" : "execution_failed", next, userContext, execution.status === "success" ? "success" : "failed", `Python 执行状态：${execution.status}。`, execution);
      for (const artifact of execution.artifacts) {
        await this.audit("artifact_generated", next, userContext, "success", `Python artifact 已生成：${artifact.name}`, execution);
      }
      await this.audit("result_to_report", next, userContext, "success", "Python 结果已生成报告可视化 payload。", execution);
      await this.audit("result_to_model", next, userContext, "success", "Python 结果已生成 safeModelPayload。", execution);
      this.recordCircuitResult(execution.status === "success");
      return next;
    } catch (error) {
      this.recordCircuitResult(false);
      const execution: PythonExecutionResult = {
        executionId,
        requestId,
        status: abortController.signal.aborted ? "cancelled" : String(error).toLowerCase().includes("timeout") ? "timeout" : "failed",
        stdout: "",
        stderr: sanitizeMessage(error),
        outputs: [],
        artifacts: [],
        executionTimeMs: 0,
        warnings: [sanitizeMessage(error)],
        createdAt: new Date().toISOString(),
      };
      const next = this.updateRequest(requestId, { status: execution.status === "timeout" ? "timeout" : execution.status === "cancelled" ? "cancelled" : "failed", execution, message: "Python 执行失败。" });
      await this.audit(execution.status === "timeout" ? "execution_timeout" : execution.status === "cancelled" ? "execution_cancelled" : "execution_failed", next, userContext, "failed", sanitizeMessage(error), execution);
      return next;
    } finally {
      this.activeExecutions.delete(requestId);
      this.abortControllers.delete(requestId);
    }
  }

  processResult(result: Parameters<PythonResultProcessor["process"]>[0]) {
    return this.resultProcessor.process(result);
  }

  private normalizeInput(input: RequestPythonAnalysisExecutionInput): RequestPythonAnalysisExecutionInput {
    return {
      ...input,
      script: input.script.trim(),
      purpose: input.purpose.trim(),
      inputDatasets: input.inputDatasets.map((dataset) => ({ ...dataset, accessMode: dataset.accessMode ?? "read_only" })),
      requireApproval: input.requireApproval ?? this.config.requireApprovalByDefault,
      timeoutMs: clamp(input.timeoutMs ?? this.config.defaultTimeoutMs, 100, this.config.hardTimeoutMs),
      memoryLimitMb: clamp(input.memoryLimitMb ?? this.config.defaultMemoryLimitMb, 64, this.config.hardMemoryLimitMb),
    };
  }

  private async checkPermissions(input: RequestPythonAnalysisExecutionInput, safetyCheck: PythonScriptSafetyCheckResult, userContext: PythonUserPermissionContext): Promise<PythonPermissionCheckResult> {
    return this.config.permissionProvider?.check
      ? await this.config.permissionProvider.check({ request: input, safetyCheck, userContext })
      : this.permissionValidator.check({ request: input, safetyCheck, userContext });
  }

  private async datasetsExist(input: RequestPythonAnalysisExecutionInput) {
    const missing: string[] = [];
    for (const dataset of input.inputDatasets) {
      if (!(await this.config.datasetResolver.resolveDataset(dataset.datasetId))) {
        missing.push(dataset.datasetId);
      }
    }
    return { ok: missing.length === 0, missing };
  }

  private shouldAutoApprove(requiresApproval: boolean, userContext: PythonUserPermissionContext) {
    return !requiresApproval && this.config.allowAutoApprovalForLowRisk && userContext.allowAutoApproval;
  }

  private requireRequest(requestId: string) {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new PythonRunnerError("PYTHON_APPROVAL_NOT_FOUND", "Python 审批请求不存在。", { requestId });
    }
    return request;
  }

  private updateRequest(requestId: string, patch: Partial<RequestPythonAnalysisExecutionOutput>) {
    const current = this.requireRequest(requestId);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.requests.set(requestId, next);
    return next;
  }

  private async audit(eventType: PythonAuditEventType, request: RequestPythonAnalysisExecutionOutput, userContext: PythonUserPermissionContext, status: "success" | "failed" | "blocked", message: string, execution?: PythonExecutionResult) {
    await this.config.auditLogger?.log({
      eventType,
      requestId: request.requestId,
      executionId: execution?.executionId,
      userId: userContext.userId,
      scriptHash: hashScript(this.requestInputs.get(request.requestId)?.script ?? ""),
      riskLevel: request.riskAssessment.riskLevel,
      status,
      message,
      metadata: {
        requestStatus: request.status,
        artifactCount: execution?.artifacts.length,
        outputCount: execution?.outputs.length,
        executionStatus: execution?.status,
      },
    });
  }

  private canStartExecution(userId: string) {
    if (this.activeExecutions.size >= (this.config.maxConcurrentExecutions ?? 2)) {
      return false;
    }
    const now = Date.now();
    const recent = (this.executionTimestampsByUser.get(userId) ?? []).filter((timestamp) => now - timestamp < 60_000);
    this.executionTimestampsByUser.set(userId, recent);
    return recent.length < (this.config.maxRequestsPerMinute ?? 20);
  }

  private recordExecutionTimestamp(userId: string) {
    this.executionTimestampsByUser.set(userId, [...(this.executionTimestampsByUser.get(userId) ?? []), Date.now()]);
  }

  private recordCircuitResult(success: boolean) {
    if (success) {
      this.failureCount = 0;
      return;
    }
    const circuitBreaker = this.config.circuitBreaker;
    if (!circuitBreaker) {
      return;
    }
    this.failureCount += 1;
    if (this.failureCount >= circuitBreaker.failureThreshold) {
      this.circuitOpenUntil = Date.now() + circuitBreaker.cooldownMs;
      this.failureCount = 0;
    }
  }
}

export function createPythonRunnerModule(config: PythonRunnerModuleConfig) {
  return new PythonRunnerModule(config);
}

function withInputValidationIssues(safetyCheck: PythonScriptSafetyCheckResult, input: RequestPythonAnalysisExecutionInput): PythonScriptSafetyCheckResult {
  const issues: PythonScriptSafetyIssue[] = [...safetyCheck.issues];
  if (!input.purpose) {
    issues.push({ code: "UNSUPPORTED_SCRIPT", severity: "error", message: "Python 脚本用途不能为空。" });
  }
  if (input.inputDatasets.length === 0) {
    issues.push({ code: "UNSUPPORTED_SCRIPT", severity: "error", message: "Python 输入数据集不能为空。" });
  }
  if (input.expectedOutputs.length === 0) {
    issues.push({ code: "UNSUPPORTED_SCRIPT", severity: "error", message: "Python 预期输出不能为空。" });
  }
  if (hasSecretLikeContent(input.script) || hasSecretLikeContent(JSON.stringify(input.metadata ?? {}))) {
    issues.push({ code: "ENV_ACCESS", severity: "critical", message: "工具参数中疑似包含密钥、Token 或连接串。" });
  }
  if (issues.length === safetyCheck.issues.length) {
    return safetyCheck;
  }
  return { ...safetyCheck, passed: false, level: "blocked", issues };
}

function appendPermissionIssues(permissionCheck: PythonPermissionCheckResult, missingDatasets: string[]): PythonPermissionCheckResult {
  return {
    ...permissionCheck,
    passed: false,
    deniedDatasets: [...permissionCheck.deniedDatasets, ...missingDatasets],
    reasons: [
      ...permissionCheck.reasons,
      ...missingDatasets.map((datasetId) => ({
        code: "DATASET_ACCESS_DENIED" as const,
        severity: "error" as const,
        message: `输入数据集不存在或不可 materialize：${datasetId}`,
      })),
    ],
  };
}

function isExpired(expiresAt?: string) {
  return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function hasSecretLikeContent(value: string) {
  return /(password\s*=|api[_-]?key\s*=|token\s*=|:\/\/[^/\s:]+:[^@\s]+@)/i.test(value);
}

function hashScript(script: string) {
  return createHash("sha256").update(script).digest("hex");
}
