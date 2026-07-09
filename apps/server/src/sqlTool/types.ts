export type SqlResultUse = "model_summary" | "python_analysis" | "chart_generation" | "risk_report" | "data_preview" | "debug";
export type SqlResultConsumer = "llm" | "python_tool" | "chart_tool" | "agent_runtime" | "user_preview";
export type SqlQueryIntent =
  | "filter"
  | "aggregation"
  | "group_by"
  | "top_n"
  | "join"
  | "time_series"
  | "risk_signal_extraction"
  | "customer_profile"
  | "loan_due_diligence"
  | "data_quality_check"
  | "general_query";

export type RequestSqlQueryExecutionInput = {
  dataSourceId: string;
  sql: string;
  purpose: string;
  expectedResultUse: SqlResultUse;
  resultConsumer?: SqlResultConsumer;
  referencedTables?: string[];
  referencedColumns?: string[];
  queryIntent?: SqlQueryIntent;
  maxRows?: number;
  timeoutMs?: number;
  requireApproval?: boolean;
  approvalReason?: string;
  metadata?: Record<string, unknown>;
};

export type SqlExecutionRequestStatus = "draft" | "blocked" | "pending_approval" | "approved" | "rejected" | "executing" | "completed" | "failed" | "cancelled" | "expired";

export type SqlSafetyIssueCode =
  | "NON_SELECT_STATEMENT"
  | "MULTIPLE_STATEMENTS"
  | "FORBIDDEN_KEYWORD"
  | "DANGEROUS_FUNCTION"
  | "SYSTEM_TABLE_ACCESS"
  | "UNAUTHORIZED_SCHEMA"
  | "MISSING_LIMIT"
  | "POTENTIAL_FULL_SCAN"
  | "LARGE_TABLE_QUERY"
  | "UNSUPPORTED_SQL"
  | "PARSE_FAILED";

export type SqlSafetyIssue = {
  code: SqlSafetyIssueCode;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  location?: string;
};

export type SqlSafetyCheckResult = {
  passed: boolean;
  level: "safe" | "warning" | "blocked";
  reasons: SqlSafetyIssue[];
  normalizedSql?: string;
  detectedStatementType?: string;
  detectedTables?: string[];
  detectedColumns?: string[];
  hasLimit?: boolean;
  hasJoin?: boolean;
  hasAggregation?: boolean;
  hasSubQuery?: boolean;
  hasPotentialFullScan?: boolean;
};

export type DataSourcePermission = {
  dataSourceId: string;
  canRead: boolean;
};
export type TablePermission = {
  dataSourceId: string;
  tableName: string;
  canRead: boolean;
  isLarge?: boolean;
};
export type ColumnPermission = {
  dataSourceId: string;
  tableName?: string;
  columnName: string;
  canRead: boolean;
  sensitive?: boolean;
};

export type SqlApprovalPolicy = {
  requireApprovalByDefault?: boolean;
  approvalExpiresInMs?: number;
};

export type SqlUserPermissionContext = {
  userId: string;
  roles: string[];
  dataSourcePermissions: DataSourcePermission[];
  tablePermissions?: TablePermission[];
  columnPermissions?: ColumnPermission[];
  allowSensitiveFields?: boolean;
  allowLargeTableQuery?: boolean;
  allowJoinQuery?: boolean;
  allowAggregationQuery?: boolean;
  allowPythonAnalysisPayload?: boolean;
  allowAutoApproval?: boolean;
  approvalPolicy?: SqlApprovalPolicy;
};

export type SqlPermissionIssue = {
  code: "DATASOURCE_DENIED" | "TABLE_DENIED" | "COLUMN_DENIED" | "SENSITIVE_FIELD_DENIED" | "LARGE_TABLE_DENIED" | "JOIN_DENIED" | "AGGREGATION_DENIED" | "PYTHON_PAYLOAD_DENIED";
  message: string;
  severity: "warning" | "error";
};

export type SqlPermissionCheckResult = {
  passed: boolean;
  reasons: SqlPermissionIssue[];
  allowedDataSource: boolean;
  allowedTables: string[];
  deniedTables: string[];
  allowedColumns: string[];
  deniedColumns: string[];
  sensitiveColumns: string[];
  requiresMasking: boolean;
  requiresApproval: boolean;
};

export type SqlRiskLevel = "low" | "medium" | "high" | "blocked";
export type SqlResultMode = "summary_only" | "limited_rows" | "aggregated_result" | "python_payload" | "blocked";

export type SqlRiskAssessment = {
  riskLevel: SqlRiskLevel;
  score: number;
  reasons: string[];
  requiresApproval: boolean;
  requiresHigherPrivilege?: boolean;
  recommendedMaxRows: number;
  recommendedTimeoutMs: number;
  recommendedResultMode: SqlResultMode;
};

export type SqlApprovalState = {
  approvalId: string;
  status: "not_required" | "pending" | "approved" | "rejected" | "expired";
  requestedBy: string;
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
  riskLevel: SqlRiskLevel;
  createdAt: string;
  updatedAt?: string;
  expiresAt?: string;
};

export type SqlResultColumn = {
  name: string;
  type: string;
  nullable?: boolean;
  sensitive?: boolean;
};

export type NumericColumnSummary = { min?: number; max?: number; mean?: number; median?: number };
export type CategoricalColumnSummary = Array<{ value: unknown; count: number; ratio?: number }>;
export type TimeRangeSummary = { min?: string; max?: string };

export type SqlResultSummary = {
  rowCount: number;
  columnCount: number;
  columns: SqlResultColumn[];
  numericSummaries?: Record<string, NumericColumnSummary>;
  categoricalSummaries?: Record<string, CategoricalColumnSummary>;
  timeRangeSummaries?: Record<string, TimeRangeSummary>;
  nullCounts?: Record<string, number>;
  warnings: string[];
};

export type SqlModelResultPayload = {
  executionId: string;
  dataSourceId: string;
  queryPurpose: string;
  resultSummary: SqlResultSummary;
  previewRows?: Record<string, unknown>[];
  importantFindings?: string[];
  limitations: string[];
  masked: boolean;
  truncated: boolean;
};

export type SqlPythonAnalysisPayload = {
  executionId: string;
  dataSourceId: string;
  queryId: string;
  columns: SqlResultColumn[];
  rowsRef?: string;
  rows?: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  masked: boolean;
  schema: Record<string, string>;
  warnings: string[];
};

export type SqlExecutionResult = {
  executionId: string;
  requestId: string;
  status: "success" | "failed" | "timeout" | "cancelled";
  columns: SqlResultColumn[];
  rows?: Record<string, unknown>[];
  summary: SqlResultSummary;
  safeModelPayload?: SqlModelResultPayload;
  pythonAnalysisPayload?: SqlPythonAnalysisPayload;
  rowCount: number;
  truncated: boolean;
  masked: boolean;
  executionTimeMs: number;
  warnings: string[];
  createdAt: string;
};

export type RequestSqlQueryExecutionOutput = {
  requestId: string;
  status: SqlExecutionRequestStatus;
  dataSourceId: string;
  normalizedSql: string;
  purpose: string;
  expectedResultUse: SqlResultUse;
  riskAssessment: SqlRiskAssessment;
  permissionCheck: SqlPermissionCheckResult;
  safetyCheck: SqlSafetyCheckResult;
  approval: SqlApprovalState;
  execution?: SqlExecutionResult;
  message: string;
  createdAt: string;
  updatedAt?: string;
};

export type SqlToolErrorCode =
  | "SQL_EMPTY"
  | "SQL_PARSE_FAILED"
  | "SQL_NOT_READ_ONLY"
  | "SQL_FORBIDDEN_KEYWORD"
  | "SQL_MULTIPLE_STATEMENTS"
  | "SQL_UNAUTHORIZED_DATASOURCE"
  | "SQL_UNAUTHORIZED_TABLE"
  | "SQL_UNAUTHORIZED_COLUMN"
  | "SQL_SENSITIVE_FIELD_DENIED"
  | "SQL_LARGE_TABLE_DENIED"
  | "SQL_APPROVAL_REQUIRED"
  | "SQL_APPROVAL_NOT_FOUND"
  | "SQL_APPROVAL_REJECTED"
  | "SQL_APPROVAL_EXPIRED"
  | "SQL_REQUEST_NOT_APPROVED"
  | "SQL_EXECUTION_FAILED"
  | "SQL_EXECUTION_TIMEOUT"
  | "SQL_RESULT_TOO_LARGE"
  | "SQL_RESULT_PROCESS_FAILED"
  | "UNKNOWN_ERROR";

export type SqlAuditEventType =
  | "request_created"
  | "safety_passed"
  | "safety_failed"
  | "permission_passed"
  | "permission_failed"
  | "risk_assessed"
  | "approval_created"
  | "approval_approved"
  | "approval_rejected"
  | "execution_started"
  | "execution_succeeded"
  | "execution_failed"
  | "execution_timeout"
  | "execution_cancelled"
  | "result_masked"
  | "result_to_python"
  | "result_to_model"
  | "query_blocked";

export type SqlAuditEvent = {
  auditId: string;
  eventType: SqlAuditEventType;
  requestId?: string;
  executionId?: string;
  userId: string;
  dataSourceId?: string;
  sqlHash?: string;
  riskLevel?: SqlRiskLevel;
  status: "success" | "failed" | "blocked";
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type QueryExecutorAdapter = {
  executeReadOnlyQuery(input: {
    dataSourceId: string;
    sql: string;
    maxRows: number;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<{
    columns: SqlResultColumn[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTimeMs: number;
  }>;
};

export type DataSourceResolver = {
  getDataSource(dataSourceId: string): Promise<{
    dataSourceId: string;
    name: string;
    type: string;
    dialect?: string;
    environment?: "dev" | "test" | "prod";
    protectionLevel?: "normal" | "sensitive" | "critical";
  } | null>;
  getTableMetadata?(dataSourceId: string, tableName: string): Promise<{ isLarge?: boolean; columns?: SqlResultColumn[] } | null>;
};

export type SqlPermissionProvider = {
  check(input: {
    dataSourceId: string;
    tables: string[];
    columns: string[];
    safetyCheck: SqlSafetyCheckResult;
    request: RequestSqlQueryExecutionInput;
    userContext: SqlUserPermissionContext;
  }): Promise<SqlPermissionCheckResult> | SqlPermissionCheckResult;
};

export type SqlAuditLogger = {
  log(event: Omit<SqlAuditEvent, "auditId" | "createdAt">): void | Promise<void>;
};

export type SqlToolModuleConfig = {
  defaultMaxRows: number;
  hardMaxRows: number;
  defaultTimeoutMs: number;
  hardTimeoutMs: number;
  requireApprovalByDefault: boolean;
  allowAutoApprovalForLowRisk?: boolean;
  storeRawRows?: boolean;
  storePlainSqlInAuditLog?: boolean;
  enableSqlParser?: boolean;
  maxConcurrentExecutions?: number;
  maxRequestsPerMinute?: number;
  dataSourceResolver: DataSourceResolver;
  queryExecutorAdapter: QueryExecutorAdapter;
  permissionProvider?: SqlPermissionProvider;
  auditLogger?: SqlAuditLogger;
};
