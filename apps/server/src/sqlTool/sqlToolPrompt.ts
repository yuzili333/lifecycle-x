import type { SqlQueryIntent, SqlResultConsumer, SqlResultUse } from "./types.js";

export const SQL_TOOL_NAME = "request_sql_query_execution";

export const SQL_TOOL_DESCRIPTION_EN = [
  "request_sql_query_execution is a controlled read-only SQL query execution request tool.",
  "Use this tool only when the user asks for data retrieval, filtering, aggregation, sorting, joining, statistical preparation, report data extraction, or data exploration that requires querying configured data sources.",
  "The model must provide a read-only SQL statement and explain the purpose of the query. The SQL will not be executed immediately. It will first be validated, checked against user permissions, assessed for risk, and submitted for user approval. Only approved queries can be executed.",
  "Never use this tool for INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, CALL, EXEC, LOCK, file export, database mutation, permission changes, or any high-risk operation.",
].join("\n");

export const SQL_TOOL_DESCRIPTION_ZH = [
  "request_sql_query_execution 是一个受控的只读 SQL 查询执行请求工具。",
  "仅当用户需求需要从已配置数据源中检索、筛选、聚合、排序、关联、统计准备、报告取数或数据探索时，才使用该工具。",
  "模型需要提供只读 SQL 语句，并说明查询目的。SQL 不会被立即执行，而是先经过安全校验、用户权限校验、风险评估和用户审批。只有审批通过的查询才能执行。",
  "禁止使用该工具执行 INSERT、UPDATE、DELETE、DROP、ALTER、TRUNCATE、CREATE、GRANT、REVOKE、CALL、EXEC、LOCK、文件导出、数据库变更、权限变更或其他高风险操作。",
].join("\n");

const resultUses: SqlResultUse[] = ["model_summary", "python_analysis", "chart_generation", "risk_report", "data_preview", "debug"];
const resultConsumers: SqlResultConsumer[] = ["llm", "python_tool", "chart_tool", "agent_runtime", "user_preview"];
const queryIntents: SqlQueryIntent[] = [
  "filter",
  "aggregation",
  "group_by",
  "top_n",
  "join",
  "time_series",
  "risk_signal_extraction",
  "customer_profile",
  "loan_due_diligence",
  "data_quality_check",
  "general_query",
];

export const REQUEST_SQL_QUERY_EXECUTION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dataSourceId", "sql", "purpose", "expectedResultUse"],
  properties: {
    dataSourceId: { type: "string", minLength: 1 },
    sql: { type: "string", minLength: 1, maxLength: 20_000 },
    purpose: { type: "string", minLength: 1, maxLength: 2_000 },
    expectedResultUse: { type: "string", enum: resultUses },
    resultConsumer: { type: "string", enum: resultConsumers },
    referencedTables: { type: "array", items: { type: "string" } },
    referencedColumns: { type: "array", items: { type: "string" } },
    queryIntent: { type: "string", enum: queryIntents },
    maxRows: { type: "integer", minimum: 1, maximum: 10_000 },
    timeoutMs: { type: "integer", minimum: 100, maximum: 60_000 },
    requireApproval: { type: "boolean" },
    approvalReason: { type: "string", maxLength: 2_000 },
    metadata: { type: "object" },
  },
} as const;

export function getSqlToolDefinition() {
  return {
    name: SQL_TOOL_NAME,
    description: `${SQL_TOOL_DESCRIPTION_EN}\n\n${SQL_TOOL_DESCRIPTION_ZH}`,
    inputSchema: REQUEST_SQL_QUERY_EXECUTION_INPUT_SCHEMA,
    outputDescription: "Creates a governed SQL execution request. The request is blocked, pending approval, or completed only after approval and controlled execution.",
    riskLevel: "high" as const,
    requiresUserApproval: true,
  };
}
