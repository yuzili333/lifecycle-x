import { describe, expect, it, vi } from "vitest";
import {
  InMemorySqlAuditLogger,
  SQL_TOOL_NAME,
  SqlSafetyValidator,
  createSqlToolModule,
  getSqlToolDefinition,
  type QueryExecutorAdapter,
  type SqlToolModuleConfig,
  type SqlUserPermissionContext,
} from "./sqlTool/index.js";

const userContext: SqlUserPermissionContext = {
  userId: "usr_admin",
  roles: ["analyst"],
  dataSourcePermissions: [{ dataSourceId: "ds_1", canRead: true }],
  tablePermissions: [
    { dataSourceId: "ds_1", tableName: "loan_customers", canRead: true, isLarge: false },
    { dataSourceId: "ds_1", tableName: "repayment_plans", canRead: true, isLarge: true },
  ],
  columnPermissions: [
    { dataSourceId: "ds_1", tableName: "loan_customers", columnName: "customer_id", canRead: true },
    { dataSourceId: "ds_1", tableName: "loan_customers", columnName: "risk_level", canRead: true },
    { dataSourceId: "ds_1", tableName: "loan_customers", columnName: "customer_name", canRead: true, sensitive: true },
    { dataSourceId: "ds_1", tableName: "repayment_plans", columnName: "due_amount", canRead: true },
  ],
  allowSensitiveFields: true,
  allowLargeTableQuery: false,
  allowJoinQuery: true,
  allowAggregationQuery: true,
  allowPythonAnalysisPayload: true,
  approvalPolicy: { requireApprovalByDefault: true },
};

function createModule(adapter?: QueryExecutorAdapter, auditLogger = new InMemorySqlAuditLogger(), overrides: Partial<SqlToolModuleConfig> = {}) {
  const queryExecutorAdapter =
    adapter ??
    ({
      executeReadOnlyQuery: vi.fn(async () => ({
        columns: [
          { name: "customer_id", type: "varchar" },
          { name: "customer_name", type: "varchar", sensitive: true },
          { name: "risk_level", type: "varchar" },
        ],
        rows: [
          { customer_id: "C01", customer_name: "北京启明制造有限公司", risk_level: "关注" },
          { customer_id: "C02", customer_name: "上海景程贸易有限公司", risk_level: "正常" },
        ],
        rowCount: 2,
        executionTimeMs: 18,
      })),
    } satisfies QueryExecutorAdapter);
  const config: SqlToolModuleConfig = {
    defaultMaxRows: 20,
    hardMaxRows: 100,
    defaultTimeoutMs: 5_000,
    hardTimeoutMs: 10_000,
    requireApprovalByDefault: true,
    storeRawRows: true,
    dataSourceResolver: {
      async getDataSource(dataSourceId) {
        return dataSourceId === "ds_1" ? { dataSourceId, name: "测试库", type: "mysql", environment: "prod", protectionLevel: "sensitive" } : null;
      },
    },
    queryExecutorAdapter,
    auditLogger,
    ...overrides,
  };
  return { module: createSqlToolModule(config), auditLogger, queryExecutorAdapter };
}

describe("SqlSafetyValidator", () => {
  const validator = new SqlSafetyValidator();

  it("allows SELECT and WITH SELECT while detecting query traits", () => {
    const select = validator.validate("select customer_id, risk_level from loan_customers where risk_level = '关注' limit 10");
    expect(select.passed).toBe(true);
    expect(select.detectedTables).toEqual(["loan_customers"]);
    expect(select.detectedColumns).toEqual(["customer_id", "risk_level"]);
    expect(select.hasLimit).toBe(true);

    const withSelect = validator.validate("with t as (select customer_id from loan_customers limit 10) select count(*) from t limit 1");
    expect(withSelect.passed).toBe(true);
    expect(withSelect.hasAggregation).toBe(true);
    expect(withSelect.hasSubQuery).toBe(true);
  });

  it("rejects mutating, dangerous and multiple statements", () => {
    for (const sql of [
      "insert into t values (1)",
      "update t set a = 1",
      "delete from t",
      "drop table t",
      "alter table t add column a int",
      "truncate table t",
      "create table t(id int)",
      "grant select on t to u",
      "revoke select on t from u",
      "call dangerous_proc()",
      "exec xp_cmdshell('ls')",
      "lock table t",
      "copy t to '/tmp/a'",
      "load data infile '/tmp/a' into table t",
      "select * from t into outfile '/tmp/a'",
      "select * from t; select * from u",
      "select * from t for update",
      "select * from information_schema.tables",
    ]) {
      expect(validator.validate(sql).passed, sql).toBe(false);
    }
  });

  it("warns for missing limit and potential full scan", () => {
    const result = validator.validate("select customer_id from loan_customers");
    expect(result.passed).toBe(true);
    expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(["MISSING_LIMIT", "POTENTIAL_FULL_SCAN"]));
  });
});

describe("SqlToolModule", () => {
  it("creates a pending approval request instead of executing immediately", async () => {
    const { module, queryExecutorAdapter } = createModule();

    const request = await module.createExecutionRequest(
      {
        dataSourceId: "ds_1",
        sql: "select customer_id, risk_level from loan_customers limit 10",
        purpose: "查看关注客户",
        expectedResultUse: "model_summary",
      },
      userContext,
    );

    expect(request.status).toBe("pending_approval");
    expect(request.approval.status).toBe("pending");
    expect(queryExecutorAdapter.executeReadOnlyQuery).not.toHaveBeenCalled();
  });

  it("blocks unsafe SQL and unauthorized data sources", async () => {
    const { module } = createModule();

    const unsafe = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "drop table loan_customers", purpose: "bad", expectedResultUse: "debug" },
      userContext,
    );
    expect(unsafe.status).toBe("blocked");
    expect(unsafe.safetyCheck.passed).toBe(false);

    const unauthorized = await module.createExecutionRequest(
      { dataSourceId: "ds_missing", sql: "select customer_id from loan_customers limit 1", purpose: "bad", expectedResultUse: "debug" },
      userContext,
    );
    expect(unauthorized.status).toBe("blocked");
    expect(unauthorized.permissionCheck.allowedDataSource).toBe(false);
  });

  it("blocks large table queries without permission and Python payload without permission", async () => {
    const { module } = createModule();

    const large = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select due_amount from repayment_plans limit 10", purpose: "查大表", expectedResultUse: "model_summary" },
      userContext,
    );
    expect(large.status).toBe("blocked");
    expect(large.permissionCheck.reasons.map((reason) => reason.code)).toContain("LARGE_TABLE_DENIED");

    const pythonDenied = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select customer_id from loan_customers limit 10", purpose: "分析", expectedResultUse: "python_analysis" },
      { ...userContext, allowPythonAnalysisPayload: false },
    );
    expect(pythonDenied.status).toBe("blocked");
    expect(pythonDenied.permissionCheck.reasons.map((reason) => reason.code)).toContain("PYTHON_PAYLOAD_DENIED");
  });

  it("blocks unauthorized tables, columns and sensitive fields", async () => {
    const { module } = createModule();

    const tableDenied = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select id from forbidden_table limit 10", purpose: "查未授权表", expectedResultUse: "model_summary" },
      {
        ...userContext,
        tablePermissions: [{ dataSourceId: "ds_1", tableName: "forbidden_table", canRead: false }],
      },
    );
    expect(tableDenied.status).toBe("blocked");
    expect(tableDenied.permissionCheck.reasons.map((reason) => reason.code)).toContain("TABLE_DENIED");

    const columnDenied = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select secret_score from loan_customers limit 10", purpose: "查未授权字段", expectedResultUse: "model_summary" },
      {
        ...userContext,
        columnPermissions: [{ dataSourceId: "ds_1", tableName: "loan_customers", columnName: "secret_score", canRead: false }],
      },
    );
    expect(columnDenied.status).toBe("blocked");
    expect(columnDenied.permissionCheck.reasons.map((reason) => reason.code)).toContain("COLUMN_DENIED");

    const sensitiveDenied = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select customer_name from loan_customers limit 10", purpose: "查敏感字段", expectedResultUse: "model_summary" },
      { ...userContext, allowSensitiveFields: false },
    );
    expect(sensitiveDenied.status).toBe("blocked");
    expect(sensitiveDenied.permissionCheck.reasons.map((reason) => reason.code)).toContain("SENSITIVE_FIELD_DENIED");
  });

  it("blocks invalid input and clamps execution policy values", async () => {
    const { module, queryExecutorAdapter } = createModule();
    const invalid = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select customer_id from loan_customers limit 10", purpose: "   ", expectedResultUse: "model_summary" },
      userContext,
    );
    expect(invalid.status).toBe("blocked");
    expect(invalid.safetyCheck.reasons.map((reason) => reason.message)).toContain("SQL 查询目的不能为空。");

    const request = await module.createExecutionRequest(
      {
        dataSourceId: "ds_1",
        sql: "select customer_id from loan_customers limit 10",
        purpose: "检查策略钳制",
        expectedResultUse: "model_summary",
        maxRows: 10_000,
        timeoutMs: 1,
      },
      userContext,
    );
    module.approveExecutionRequest(request.requestId, userContext);
    await module.executeApprovedRequest(request.requestId, userContext);
    expect(queryExecutorAdapter.executeReadOnlyQuery).toHaveBeenCalledWith(
      expect.objectContaining({ maxRows: 100, timeoutMs: 100 }),
    );
  });

  it("does not execute rejected or expired approvals", async () => {
    const { module } = createModule();
    const request = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select customer_id from loan_customers limit 10", purpose: "查看", expectedResultUse: "model_summary" },
      userContext,
    );

    const rejected = module.rejectExecutionRequest(request.requestId, userContext, "不需要执行");
    expect(rejected.status).toBe("rejected");
    await expect(module.executeApprovedRequest(request.requestId, userContext)).rejects.toThrow("SQL_REQUEST_NOT_APPROVED");

    const expired = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select customer_id from loan_customers limit 10", purpose: "过期审批", expectedResultUse: "model_summary" },
      { ...userContext, approvalPolicy: { requireApprovalByDefault: true, approvalExpiresInMs: -1 } },
    );
    expect(module.approveExecutionRequest(expired.requestId, userContext).status).toBe("expired");
  });

  it("executes after approval, masks sensitive fields and creates model/python payloads", async () => {
    const auditLogger = new InMemorySqlAuditLogger();
    const { module } = createModule(undefined, auditLogger);
    const request = await module.createExecutionRequest(
      {
        dataSourceId: "ds_1",
        sql: "select customer_id, customer_name, risk_level from loan_customers limit 10",
        purpose: "为 Python 风险分析准备客户风险样本",
        expectedResultUse: "python_analysis",
        resultConsumer: "python_tool",
      },
      userContext,
    );

    module.approveExecutionRequest(request.requestId, userContext);
    const completed = await module.executeApprovedRequest(request.requestId, userContext);

    expect(completed.status).toBe("completed");
    expect(completed.execution?.safeModelPayload?.previewRows?.[0]?.customer_name).toBe("北京****公司");
    expect(completed.execution?.pythonAnalysisPayload?.rows?.[0]?.customer_name).toBe("北京****公司");
    expect(completed.execution?.safeModelPayload?.limitations.join(" ")).toContain("裁剪、脱敏");
    expect(auditLogger.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["request_created", "approval_created", "approval_approved", "execution_started", "execution_succeeded", "result_masked", "result_to_python", "result_to_model"]),
    );
    expect(JSON.stringify(auditLogger.events)).not.toContain("北京启明制造有限公司");
  });

  it("rechecks permissions before execution and blocks stale approvals", async () => {
    const { module, queryExecutorAdapter } = createModule();
    const request = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select customer_id from loan_customers limit 10", purpose: "查看", expectedResultUse: "model_summary" },
      userContext,
    );
    module.approveExecutionRequest(request.requestId, userContext);

    const blocked = await module.executeApprovedRequest(request.requestId, {
      ...userContext,
      dataSourcePermissions: [{ dataSourceId: "ds_1", canRead: false }],
    });

    expect(blocked.status).toBe("blocked");
    expect(blocked.permissionCheck.passed).toBe(false);
    expect(queryExecutorAdapter.executeReadOnlyQuery).not.toHaveBeenCalled();
  });

  it("captures execution failures and timeouts as structured failed requests", async () => {
    const { module } = createModule({
      async executeReadOnlyQuery() {
        throw new Error("timeout while querying");
      },
    });
    const request = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select customer_id from loan_customers limit 10", purpose: "查看", expectedResultUse: "model_summary" },
      userContext,
    );

    module.approveExecutionRequest(request.requestId, userContext);
    const failed = await module.executeApprovedRequest(request.requestId, userContext);
    expect(failed.status).toBe("failed");
    expect(failed.execution?.status).toBe("timeout");
    expect(failed.execution?.warnings[0]).toContain("timeout");
  });

  it("cancels a running query through AbortSignal", async () => {
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const { module } = createModule({
      async executeReadOnlyQuery({ signal }) {
        markStarted();
        return await new Promise<never>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted by user")), { once: true });
        });
      },
    });
    const request = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select customer_id from loan_customers limit 10", purpose: "取消测试", expectedResultUse: "model_summary" },
      userContext,
    );
    module.approveExecutionRequest(request.requestId, userContext);
    const running = module.executeApprovedRequest(request.requestId, userContext);
    await started;
    const cancelled = module.cancelExecutionRequest(request.requestId, userContext);
    expect(cancelled.status).toBe("cancelled");
    const final = await running;
    expect(final.status).toBe("cancelled");
    expect(final.execution?.status).toBe("cancelled");
  });

  it("uses rowsRef for large Python analysis payloads", () => {
    const { module } = createModule();
    const execution = module.processResult({
      executionId: "sql_exec_large",
      requestId: "sql_req_large",
      request: {
        dataSourceId: "ds_1",
        sql: "select customer_id from loan_customers",
        purpose: "大结果 Python 分析",
        expectedResultUse: "python_analysis",
      },
      columns: [{ name: "customer_id", type: "varchar" }],
      rows: Array.from({ length: 1_001 }, (_, index) => ({ customer_id: `C${index}` })),
      rowCount: 1_001,
      maxRows: 1_001,
      executionTimeMs: 20,
      sensitiveColumns: [],
      storeRawRows: true,
    });
    expect(execution.pythonAnalysisPayload?.rows).toBeUndefined();
    expect(execution.pythonAnalysisPayload?.rowsRef).toBe("sql_rows_sql_exec_large");
    expect(execution.safeModelPayload?.previewRows?.length).toBeLessThanOrEqual(10);
  });

  it("rate limits repeated executions", async () => {
    const { module } = createModule(undefined, new InMemorySqlAuditLogger(), { maxRequestsPerMinute: 1 });
    const first = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select customer_id from loan_customers limit 10", purpose: "第一次", expectedResultUse: "model_summary" },
      userContext,
    );
    module.approveExecutionRequest(first.requestId, userContext);
    expect((await module.executeApprovedRequest(first.requestId, userContext)).status).toBe("completed");

    const second = await module.createExecutionRequest(
      { dataSourceId: "ds_1", sql: "select risk_level from loan_customers limit 10", purpose: "第二次", expectedResultUse: "model_summary" },
      userContext,
    );
    module.approveExecutionRequest(second.requestId, userContext);
    const limited = await module.executeApprovedRequest(second.requestId, userContext);
    expect(limited.status).toBe("blocked");
    expect(limited.message).toContain("限流");
  });

  it("exposes a strict tool definition", () => {
    const tool = getSqlToolDefinition();
    expect(tool.name).toBe(SQL_TOOL_NAME);
    expect(tool.description).toContain("read-only");
    expect(tool.description).toContain("审批");
    expect(tool.inputSchema.required).toEqual(["dataSourceId", "sql", "purpose", "expectedResultUse"]);
    expect(tool.inputSchema.properties.expectedResultUse.enum).toContain("python_analysis");
  });
});
