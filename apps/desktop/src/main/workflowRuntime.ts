import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";

export type WorkflowType =
  | "direct_query_analysis_report"
  | "data_extraction"
  | "refine_extracted_dataset"
  | "confirm_dataset"
  | "python_analysis"
  | "report_generation"
  | "report_generation_with_refinement";

export type WorkflowStatus =
  | "draft"
  | "planning"
  | "waiting_sql_approval"
  | "executing_sql"
  | "materializing_dataset"
  | "waiting_user_confirmation"
  | "waiting_python_approval"
  | "executing_python"
  | "generating_report"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type WorkflowStepType =
  | "intent_detection"
  | "sql_request"
  | "sql_approval"
  | "sql_execution"
  | "sqlite_materialization"
  | "dataset_profile"
  | "user_confirmation"
  | "python_request"
  | "python_approval"
  | "python_execution"
  | "report_generation"
  | "memory_update";

export type WorkflowStepStatus = "pending" | "running" | "waiting" | "success" | "failed" | "skipped" | "blocked" | "cancelled";

export type WorkflowErrorCode =
  | "WORKFLOW_NOT_FOUND"
  | "WORKFLOW_INVALID_STATE"
  | "WORKFLOW_INTENT_UNKNOWN"
  | "SQL_REQUEST_FAILED"
  | "SQL_APPROVAL_REQUIRED"
  | "SQL_EXECUTION_FAILED"
  | "SQL_RESULT_EMPTY"
  | "SQLITE_MATERIALIZATION_FAILED"
  | "DATASET_NOT_FOUND"
  | "DATASET_NOT_READY"
  | "DATASET_NOT_CONFIRMED"
  | "DATASET_EXPIRED"
  | "PYTHON_REQUEST_FAILED"
  | "PYTHON_APPROVAL_REQUIRED"
  | "PYTHON_EXECUTION_FAILED"
  | "REPORT_GENERATION_FAILED"
  | "MEMORY_UPDATE_FAILED"
  | "UNKNOWN_ERROR";

export type WorkflowError = {
  code: WorkflowErrorCode;
  message: string;
  workflowId?: string;
  stepId?: string;
  traceId: string;
  recoverable?: boolean;
  metadata?: Record<string, unknown>;
};

export type WorkflowStep = {
  stepId: string;
  type: WorkflowStepType;
  status: WorkflowStepStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  error?: WorkflowError;
  metadata?: Record<string, unknown>;
};

export type WorkflowDatasetProfile = {
  datasetId: string;
  rowCount: number;
  columnCount: number;
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    sampleValues?: unknown[];
    missingRate?: number;
  }>;
  previewRows?: Record<string, unknown>[];
  warnings: string[];
  generatedAt: string;
};

export type WorkflowDatasetRef = {
  datasetId: string;
  workflowId: string;
  conversationId: string;
  name: string;
  sourceType: "sql_execution_result" | "refined_sql_result" | "python_derived_result" | "uploaded_file" | "manual";
  sqliteTableName?: string;
  sqliteDatabasePath?: string;
  parentDatasetIds?: string[];
  sourceSqlRequestId?: string;
  sourceSqlExecutionId?: string;
  sourcePythonExecutionId?: string;
  rowCount?: number;
  columnCount?: number;
  schema?: Record<string, string>;
  profile?: WorkflowDatasetProfile;
  status: "creating" | "ready" | "confirmed" | "rejected" | "expired" | "deleted" | "failed";
  canQuery: boolean;
  canAnalyze: boolean;
  canUseForReport: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
};

export type WorkflowEvent = {
  eventId: string;
  workflowId: string;
  conversationId: string;
  type:
    | "workflow_created"
    | "workflow_planned"
    | "sql_request_created"
    | "sql_approved"
    | "sql_executed"
    | "dataset_materialized"
    | "dataset_confirmed"
    | "dataset_rejected"
    | "dataset_refined"
    | "python_request_created"
    | "python_approved"
    | "python_executed"
    | "report_generated"
    | "workflow_completed"
    | "workflow_failed"
    | "workflow_cancelled";
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type WorkflowSession = {
  workflowId: string;
  conversationId: string;
  projectId?: string;
  userId: string;
  type: WorkflowType;
  status: WorkflowStatus;
  title?: string;
  userGoal: string;
  activeDatasetId?: string;
  latestSqlDatasetId?: string;
  confirmedDatasetId?: string;
  latestPythonExecutionId?: string;
  latestReportVersionId?: string;
  steps: WorkflowStep[];
  datasets: WorkflowDatasetRef[];
  events: WorkflowEvent[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type WorkflowIntent =
  | "query_only"
  | "extract_data"
  | "refine_previous_dataset"
  | "confirm_dataset"
  | "analyze_confirmed_dataset"
  | "query_analyze_report"
  | "generate_report"
  | "generate_report_with_more_query"
  | "unknown";

export type WorkflowStateStore = {
  create(session: WorkflowSession): Promise<WorkflowSession>;
  update(workflowId: string, patch: Partial<WorkflowSession>): Promise<WorkflowSession>;
  get(workflowId: string): Promise<WorkflowSession | null>;
  listByConversation(conversationId: string): Promise<WorkflowSession[]>;
  getActiveByConversation(conversationId: string): Promise<WorkflowSession | null>;
  appendEvent(workflowId: string, event: WorkflowEvent): Promise<void>;
};

export type DatasetStateManager = {
  registerDataset(input: WorkflowDatasetRef): Promise<WorkflowDatasetRef>;
  getDataset(datasetId: string): Promise<WorkflowDatasetRef | null>;
  getActiveDataset(conversationId: string): Promise<WorkflowDatasetRef | null>;
  getLatestSqlDataset(conversationId: string): Promise<WorkflowDatasetRef | null>;
  getConfirmedDataset(conversationId: string): Promise<WorkflowDatasetRef | null>;
  listDatasets(conversationId: string): Promise<WorkflowDatasetRef[]>;
  confirmDataset(datasetId: string): Promise<WorkflowDatasetRef>;
  rejectDataset(datasetId: string, reason?: string): Promise<WorkflowDatasetRef>;
  expireDataset(datasetId: string): Promise<WorkflowDatasetRef>;
  deleteDataset(datasetId: string): Promise<void>;
};

export type MaterializeSqlResultInput = {
  workflowId: string;
  conversationId: string;
  sqlRequestId: string;
  sqlExecutionId: string;
  sourceDataSourceId: string;
  resultColumns: Array<{ name: string; type: string }>;
  rows?: Record<string, unknown>[];
  rowsStream?: AsyncIterable<Record<string, unknown>>;
  targetTableName?: string;
  parentDatasetIds?: string[];
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type MaterializeSqlResultOutput = {
  datasetId: string;
  sqliteDatabasePath: string;
  sqliteTableName: string;
  rowCount: number;
  columnCount: number;
  schema: Record<string, string>;
  createdAt: string;
};

export type SqlWorkflowBridge = {
  createSqlRequest(input: {
    conversationId: string;
    userId: string;
    userRequest: string;
    sqlPurpose: string;
    sourceDatasetId?: string;
    sourceSqliteTableName?: string;
    useLocalSqlite?: boolean;
  }): Promise<{ sqlRequestId: string; status: "pending_approval" | "blocked" | "completed" | "failed" }>;
  executeApprovedSqlRequest(sqlRequestId: string, options?: { signal?: AbortSignal }): Promise<{
    sqlExecutionId: string;
    columns: Array<{ name: string; type: string }>;
    rows?: Record<string, unknown>[];
    rowsStream?: AsyncIterable<Record<string, unknown>>;
  }>;
};

export type PythonWorkflowBridge = {
  createPythonRequest(input: {
    conversationId: string;
    userId: string;
    analysisGoal: string;
    inputDataset: WorkflowDatasetRef;
    expectedOutputs?: string[];
  }): Promise<{ pythonRequestId: string; status: "pending_approval" | "blocked" | "completed" | "failed" }>;
  executeApprovedPythonRequest(pythonRequestId: string): Promise<{
    pythonExecutionId: string;
    summary: string;
    artifacts: Array<{ artifactId: string; type: string; description?: string }>;
    safeModelPayload?: Record<string, unknown>;
    reportVisualizationPayload?: Record<string, unknown>;
  }>;
};

export type MemoryWorkflowBridge = {
  writeWorkflowMemory(input: {
    conversationId: string;
    userId: string;
    type: string;
    summary: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
};

export type WorkflowAuditLogEntry = {
  auditId: string;
  workflowId: string;
  conversationId: string;
  eventType: WorkflowEvent["type"];
  level: "info" | "warning" | "error";
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type WorkflowAuditLogger = {
  writeWorkflowAudit(input: Omit<WorkflowAuditLogEntry, "auditId" | "createdAt">): Promise<void>;
};

export type ReportWorkflowBridge = {
  generateReport(input: {
    conversationId: string;
    userId: string;
    reportGoal: string;
    dataset: WorkflowDatasetRef;
    pythonExecutionId?: string;
  }): Promise<{ reportVersionId: string; summary: string; markdown: string }>;
};

export type WorkflowMemoryEntry = {
  memoryId: string;
  conversationId: string;
  userId: string;
  type: string;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type WorkflowModuleConfig = {
  stateStore: WorkflowStateStore;
  sqlToolBridge: SqlWorkflowBridge;
  pythonBridge: PythonWorkflowBridge;
  reportBridge?: ReportWorkflowBridge;
  memoryBridge?: MemoryWorkflowBridge;
  auditLogger?: WorkflowAuditLogger;
  datasetStateManager: DatasetStateManager;
  tempTableRegistry: TempTableRegistry;
  sqliteMaterializer: SQLiteMaterializer;
  defaultDatasetTtlMs?: number;
  maxTempDatabaseSizeBytes?: number;
  enableAutoMemoryUpdate?: boolean;
};

export type StartWorkflowInput = {
  conversationId: string;
  userId: string;
  userRequest: string;
  projectId?: string;
};

export type StartPythonAnalysisInput = {
  conversationId: string;
  workflowId?: string;
  userId: string;
  userRequest: string;
  datasetId?: string;
  analysisGoal: string;
  expectedOutputs?: Array<"summary" | "chart" | "table" | "json" | "report_section">;
};

export type GenerateWorkflowReportInput = {
  conversationId: string;
  workflowId?: string;
  userId: string;
  reportGoal: string;
  datasetId?: string;
  pythonExecutionId?: string;
  allowRefineBeforeReport?: boolean;
};

export type ExecuteApprovedSqlWorkflowInput = {
  conversationId: string;
  workflowId?: string;
  userId: string;
  sqlRequestId: string;
  sourceDataSourceId: string;
  signal?: AbortSignal;
};

export type ExecuteApprovedPythonWorkflowInput = {
  conversationId: string;
  workflowId?: string;
  userId: string;
  pythonRequestId: string;
};

export type ReuseWorkflowDatasetInput = {
  sourceDatasetId: string;
  targetConversationId: string;
  userId: string;
  workflowId?: string;
  name?: string;
};

export type RecoverStaleWorkflowsInput = {
  conversationId: string;
  olderThanMs: number;
  now?: string;
};

export type WorkflowDatasetSummary = Pick<
  WorkflowDatasetRef,
  | "datasetId"
  | "name"
  | "sourceType"
  | "sqliteTableName"
  | "rowCount"
  | "columnCount"
  | "schema"
  | "status"
  | "canQuery"
  | "canAnalyze"
  | "canUseForReport"
  | "createdAt"
  | "updatedAt"
> & {
  parentDatasetIds: string[];
};

export type WorkflowContextSummary = {
  workflowId?: string;
  status?: WorkflowStatus;
  activeDataset: WorkflowDatasetSummary | null;
  latestSqlDataset: WorkflowDatasetSummary | null;
  confirmedDataset: WorkflowDatasetSummary | null;
  latestPythonAnalysis: {
    pythonExecutionId?: string;
    summary?: string;
    artifacts: Array<{ artifactId: string; type: string; description?: string }>;
  } | null;
  latestReport: {
    reportVersionId?: string;
    summary?: string;
  } | null;
  datasets: WorkflowDatasetSummary[];
  lineage: Array<{ datasetId: string; parentDatasetIds: string[] }>;
  steps: WorkflowStep[];
  pendingApprovals: WorkflowStep[];
  suggestedNextAction: string;
};

function nowIso() {
  return new Date().toISOString();
}

function traceId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function workflowError(code: WorkflowErrorCode, message: string, workflowId?: string, stepId?: string): WorkflowError {
  return { code, message, workflowId, stepId, traceId: traceId(`${code}:${message}:${workflowId ?? ""}:${stepId ?? ""}`), recoverable: true };
}

function event(workflowId: string, conversationId: string, type: WorkflowEvent["type"], message: string, payload?: Record<string, unknown>): WorkflowEvent {
  return { eventId: randomUUID(), workflowId, conversationId, type, message, payload, createdAt: nowIso() };
}

function step(type: WorkflowStepType, status: WorkflowStepStatus, input?: Record<string, unknown>, output?: Record<string, unknown>): WorkflowStep {
  const timestamp = nowIso();
  return {
    stepId: randomUUID(),
    type,
    status,
    input,
    output,
    startedAt: status === "running" || status === "success" || status === "waiting" ? timestamp : undefined,
    completedAt: status === "success" || status === "failed" || status === "skipped" || status === "blocked" ? timestamp : undefined,
  };
}

function workflowTypeForIntent(intent: WorkflowIntent): WorkflowType {
  switch (intent) {
    case "query_analyze_report":
      return "direct_query_analysis_report";
    case "extract_data":
    case "query_only":
      return "data_extraction";
    case "refine_previous_dataset":
      return "refine_extracted_dataset";
    case "confirm_dataset":
      return "confirm_dataset";
    case "analyze_confirmed_dataset":
      return "python_analysis";
    case "generate_report":
      return "report_generation";
    case "generate_report_with_more_query":
      return "report_generation_with_refinement";
    default:
      return "data_extraction";
  }
}

function inferSqliteType(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "real";
  }
  if (typeof value === "boolean") {
    return "integer";
  }
  if (value instanceof Date) {
    return "text";
  }
  return "text";
}

function normalizeSqliteType(type: string | undefined) {
  const normalized = (type ?? "").toLowerCase();
  if (/int|bool/.test(normalized)) {
    return "integer";
  }
  if (/real|float|double|decimal|numeric/.test(normalized)) {
    return "real";
  }
  if (/blob/.test(normalized)) {
    return "blob";
  }
  return "text";
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function safeTableName(value: string) {
  return value.replace(/[^\w]/g, "_").replace(/^(\d)/, "_$1").slice(0, 96) || `workflow_dataset_${randomUUID().replaceAll("-", "_")}`;
}

function sanitizeAuditPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[max-depth]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 2_000 ? `${value.slice(0, 2_000)}...[truncated ${value.length - 2_000} chars]` : value;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeAuditPayload(item, depth + 1));
  }
  const blockedKeys = new Set(["rows", "previewRows", "markdown", "stdout", "stderr", "result_json", "connectionString", "password", "apiKey"]);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = blockedKeys.has(key) ? "[redacted]" : sanitizeAuditPayload(item, depth + 1);
  }
  return result;
}

export class WorkflowIntentRouter {
  detect(userRequest: string): WorkflowIntent {
    const text = userRequest.trim().toLowerCase();
    if (!text) {
      return "unknown";
    }
    const mentionsPrevious = /(上一轮|上一次|刚才|前面|当前结果|这批数据|查询结果|工具调用结果)/.test(text);
    const wantsReport = /(报告|生成报告|分析报告|输出.*报告)/.test(text);
    const wantsAnalyze = /(分析|统计|占比|对比|图表|可视化|趋势|特征)/.test(text);
    const wantsQuery = /(查询|筛选|提取|读取|找出|检索|过滤)/.test(text);
    if (wantsReport && mentionsPrevious && wantsQuery) {
      return "generate_report_with_more_query";
    }
    if (mentionsPrevious && /(确认|无误|就用|可以|继续分析|基于这批|这批客户)/.test(text)) {
      return "confirm_dataset";
    }
    if (mentionsPrevious && wantsQuery) {
      return "refine_previous_dataset";
    }
    if (wantsReport && wantsQuery && wantsAnalyze) {
      return "query_analyze_report";
    }
    if (wantsReport) {
      return "generate_report";
    }
    if (mentionsPrevious && wantsAnalyze) {
      return "analyze_confirmed_dataset";
    }
    if (/(提取|抽取|导出|拉取)/.test(text)) {
      return "extract_data";
    }
    if (wantsQuery) {
      return "query_only";
    }
    return "unknown";
  }
}

export class InMemoryWorkflowStateStore implements WorkflowStateStore {
  private readonly sessions = new Map<string, WorkflowSession>();

  async create(session: WorkflowSession) {
    this.sessions.set(session.workflowId, structuredClone(session));
    return structuredClone(session);
  }

  async update(workflowId: string, patch: Partial<WorkflowSession>) {
    const current = this.sessions.get(workflowId);
    if (!current) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }
    const next = { ...current, ...patch, updatedAt: nowIso() };
    this.sessions.set(workflowId, structuredClone(next));
    return structuredClone(next);
  }

  async get(workflowId: string) {
    const current = this.sessions.get(workflowId);
    return current ? structuredClone(current) : null;
  }

  async listByConversation(conversationId: string) {
    return Array.from(this.sessions.values())
      .filter((session) => session.conversationId === conversationId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((session) => structuredClone(session));
  }

  async getActiveByConversation(conversationId: string) {
    return (await this.listByConversation(conversationId)).find((session) => !["completed", "failed", "cancelled"].includes(session.status)) ?? null;
  }

  async appendEvent(workflowId: string, workflowEvent: WorkflowEvent) {
    const current = this.sessions.get(workflowId);
    if (!current) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }
    await this.update(workflowId, { events: [...current.events, workflowEvent] });
  }
}

export class SQLiteWorkflowStateStore implements WorkflowStateStore {
  constructor(private readonly db: any) {
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      create table if not exists workflow_sessions (
        workflow_id text primary key,
        conversation_id text not null,
        user_id text not null,
        status text not null,
        type text not null,
        session_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists workflow_datasets (
        dataset_id text primary key,
        workflow_id text not null,
        conversation_id text not null,
        status text not null,
        source_type text not null,
        dataset_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists workflow_events (
        event_id text primary key,
        workflow_id text not null,
        conversation_id text not null,
        type text not null,
        event_json text not null,
        created_at text not null
      );
      create index if not exists idx_workflow_sessions_conversation on workflow_sessions(conversation_id, updated_at desc);
      create index if not exists idx_workflow_datasets_conversation on workflow_datasets(conversation_id, updated_at desc);
      create index if not exists idx_workflow_events_workflow on workflow_events(workflow_id, created_at);
    `);
  }

  async create(session: WorkflowSession) {
    this.db
      .prepare(
        `insert into workflow_sessions
          (workflow_id, conversation_id, user_id, status, type, session_json, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(session.workflowId, session.conversationId, session.userId, session.status, session.type, JSON.stringify(session), session.createdAt, session.updatedAt);
    return structuredClone(session);
  }

  async update(workflowId: string, patch: Partial<WorkflowSession>) {
    const current = await this.get(workflowId);
    if (!current) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }
    const next = { ...current, ...patch, updatedAt: nowIso() };
    this.db
      .prepare("update workflow_sessions set status = ?, type = ?, session_json = ?, updated_at = ? where workflow_id = ?")
      .run(next.status, next.type, JSON.stringify(next), next.updatedAt, workflowId);
    return structuredClone(next);
  }

  async get(workflowId: string) {
    const row = this.db.prepare("select session_json from workflow_sessions where workflow_id = ?").get(workflowId) as { session_json?: string } | undefined;
    return row?.session_json ? (JSON.parse(row.session_json) as WorkflowSession) : null;
  }

  async listByConversation(conversationId: string) {
    return (this.db
      .prepare("select session_json from workflow_sessions where conversation_id = ? order by updated_at desc")
      .all(conversationId) as Array<{ session_json: string }>).map((row) => JSON.parse(row.session_json) as WorkflowSession);
  }

  async getActiveByConversation(conversationId: string) {
    return (await this.listByConversation(conversationId)).find((session) => !["completed", "failed", "cancelled"].includes(session.status)) ?? null;
  }

  async appendEvent(workflowId: string, workflowEvent: WorkflowEvent) {
    const current = await this.get(workflowId);
    if (!current) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }
    this.db
      .prepare("insert into workflow_events (event_id, workflow_id, conversation_id, type, event_json, created_at) values (?, ?, ?, ?, ?, ?)")
      .run(workflowEvent.eventId, workflowEvent.workflowId, workflowEvent.conversationId, workflowEvent.type, JSON.stringify(workflowEvent), workflowEvent.createdAt);
    await this.update(workflowId, { events: [...current.events, workflowEvent] });
  }
}

export class InMemoryWorkflowAuditLogger implements WorkflowAuditLogger {
  private readonly entries: WorkflowAuditLogEntry[] = [];

  async writeWorkflowAudit(input: Omit<WorkflowAuditLogEntry, "auditId" | "createdAt">) {
    this.entries.push({
      auditId: randomUUID(),
      ...input,
      createdAt: nowIso(),
    });
  }

  list(conversationId?: string) {
    return this.entries.filter((entry) => !conversationId || entry.conversationId === conversationId).map((entry) => structuredClone(entry));
  }
}

export class SQLiteWorkflowAuditLogger implements WorkflowAuditLogger {
  constructor(private readonly db: any) {
    this.db.exec(`
      create table if not exists workflow_audit_logs (
        audit_id text primary key,
        workflow_id text not null,
        conversation_id text not null,
        event_type text not null,
        level text not null,
        message text not null,
        payload_json text,
        created_at text not null
      );
      create index if not exists idx_workflow_audit_conversation on workflow_audit_logs(conversation_id, created_at desc);
      create index if not exists idx_workflow_audit_workflow on workflow_audit_logs(workflow_id, created_at desc);
    `);
  }

  async writeWorkflowAudit(input: Omit<WorkflowAuditLogEntry, "auditId" | "createdAt">) {
    this.db
      .prepare(
        `insert into workflow_audit_logs
          (audit_id, workflow_id, conversation_id, event_type, level, message, payload_json, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), input.workflowId, input.conversationId, input.eventType, input.level, input.message, input.payload ? JSON.stringify(input.payload) : null, nowIso());
  }

  list(conversationId: string) {
    return (this.db
      .prepare("select * from workflow_audit_logs where conversation_id = ? order by created_at desc")
      .all(conversationId) as Array<Record<string, unknown>>).map((row) => ({
      auditId: row.audit_id as string,
      workflowId: row.workflow_id as string,
      conversationId: row.conversation_id as string,
      eventType: row.event_type as WorkflowEvent["type"],
      level: row.level as "info" | "warning" | "error",
      message: row.message as string,
      payload: row.payload_json ? (JSON.parse(row.payload_json as string) as Record<string, unknown>) : undefined,
      createdAt: row.created_at as string,
    }));
  }
}

export class AuditedWorkflowStateStore implements WorkflowStateStore {
  constructor(private readonly delegate: WorkflowStateStore, private readonly auditLogger: WorkflowAuditLogger) {}

  create(session: WorkflowSession) {
    return this.delegate.create(session);
  }

  update(workflowId: string, patch: Partial<WorkflowSession>) {
    return this.delegate.update(workflowId, patch);
  }

  get(workflowId: string) {
    return this.delegate.get(workflowId);
  }

  listByConversation(conversationId: string) {
    return this.delegate.listByConversation(conversationId);
  }

  getActiveByConversation(conversationId: string) {
    return this.delegate.getActiveByConversation(conversationId);
  }

  async appendEvent(workflowId: string, workflowEvent: WorkflowEvent) {
    await this.delegate.appendEvent(workflowId, workflowEvent);
    await this.auditLogger.writeWorkflowAudit({
      workflowId,
      conversationId: workflowEvent.conversationId,
      eventType: workflowEvent.type,
      level: workflowEvent.type === "workflow_failed" ? "error" : workflowEvent.type === "workflow_cancelled" ? "warning" : "info",
      message: workflowEvent.message,
      payload: sanitizeAuditPayload(workflowEvent.payload) as Record<string, unknown> | undefined,
    });
  }
}

export class SQLiteDatasetStateManager implements DatasetStateManager {
  constructor(private readonly db: any, private readonly stateStore?: WorkflowStateStore) {}

  async registerDataset(input: WorkflowDatasetRef) {
    this.db
      .prepare(
        `insert or replace into workflow_datasets
          (dataset_id, workflow_id, conversation_id, status, source_type, dataset_json, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.datasetId, input.workflowId, input.conversationId, input.status, input.sourceType, JSON.stringify(input), input.createdAt, input.updatedAt);

    if (this.stateStore) {
      const workflow = await this.stateStore.get(input.workflowId);
      if (workflow) {
        const datasets = [...workflow.datasets.filter((dataset) => dataset.datasetId !== input.datasetId), input];
        await this.stateStore.update(input.workflowId, {
          datasets,
          activeDatasetId: input.status === "ready" || input.status === "confirmed" ? input.datasetId : workflow.activeDatasetId,
          latestSqlDatasetId: input.sourceType === "sql_execution_result" || input.sourceType === "refined_sql_result" ? input.datasetId : workflow.latestSqlDatasetId,
          confirmedDatasetId: input.status === "confirmed" ? input.datasetId : workflow.confirmedDatasetId,
        });
      }
    }
    return structuredClone(input);
  }

  async getDataset(datasetId: string) {
    const row = this.db.prepare("select dataset_json from workflow_datasets where dataset_id = ?").get(datasetId) as { dataset_json?: string } | undefined;
    return row?.dataset_json ? (JSON.parse(row.dataset_json) as WorkflowDatasetRef) : null;
  }

  async getActiveDataset(conversationId: string) {
    const datasets = await this.listDatasets(conversationId);
    return datasets.find((dataset) => ["ready", "confirmed"].includes(dataset.status)) ?? null;
  }

  async getLatestSqlDataset(conversationId: string) {
    return (
      (await this.listDatasets(conversationId)).find(
        (dataset) => (dataset.sourceType === "sql_execution_result" || dataset.sourceType === "refined_sql_result") && ["ready", "confirmed"].includes(dataset.status),
      ) ?? null
    );
  }

  async getConfirmedDataset(conversationId: string) {
    return (await this.listDatasets(conversationId)).find((dataset) => dataset.status === "confirmed" && dataset.canAnalyze && dataset.canUseForReport) ?? null;
  }

  async listDatasets(conversationId: string) {
    return (this.db
      .prepare("select dataset_json from workflow_datasets where conversation_id = ? and status != 'deleted' order by updated_at desc")
      .all(conversationId) as Array<{ dataset_json: string }>).map((row) => JSON.parse(row.dataset_json) as WorkflowDatasetRef);
  }

  async confirmDataset(datasetId: string) {
    const dataset = await this.getDataset(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }
    return this.registerDataset({ ...dataset, status: "confirmed", canAnalyze: true, canUseForReport: true, updatedAt: nowIso() });
  }

  async rejectDataset(datasetId: string, reason?: string) {
    const dataset = await this.getDataset(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }
    return this.registerDataset({ ...dataset, status: "rejected", canAnalyze: false, canUseForReport: false, updatedAt: nowIso(), metadata: { ...dataset.metadata, rejectReason: reason } });
  }

  async expireDataset(datasetId: string) {
    const dataset = await this.getDataset(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }
    return this.registerDataset({ ...dataset, status: "expired", canQuery: false, canAnalyze: false, canUseForReport: false, updatedAt: nowIso() });
  }

  async deleteDataset(datasetId: string) {
    const dataset = await this.getDataset(datasetId);
    if (!dataset) {
      return;
    }
    await this.registerDataset({ ...dataset, status: "deleted", canQuery: false, canAnalyze: false, canUseForReport: false, updatedAt: nowIso() });
  }
}

export class InMemoryDatasetStateManager implements DatasetStateManager {
  private readonly datasets = new Map<string, WorkflowDatasetRef>();

  constructor(private readonly stateStore?: WorkflowStateStore) {}

  async registerDataset(input: WorkflowDatasetRef) {
    const dataset = structuredClone(input);
    this.datasets.set(dataset.datasetId, dataset);
    if (this.stateStore) {
      const workflow = await this.stateStore.get(dataset.workflowId);
      if (workflow) {
        const datasets = [...workflow.datasets.filter((item) => item.datasetId !== dataset.datasetId), dataset];
        await this.stateStore.update(dataset.workflowId, {
          datasets,
          activeDatasetId: dataset.status === "ready" || dataset.status === "confirmed" ? dataset.datasetId : workflow.activeDatasetId,
          latestSqlDatasetId: dataset.sourceType === "sql_execution_result" || dataset.sourceType === "refined_sql_result" ? dataset.datasetId : workflow.latestSqlDatasetId,
          confirmedDatasetId: dataset.status === "confirmed" ? dataset.datasetId : workflow.confirmedDatasetId,
        });
      }
    }
    return structuredClone(dataset);
  }

  async getDataset(datasetId: string) {
    const dataset = this.datasets.get(datasetId);
    return dataset ? structuredClone(dataset) : null;
  }

  async getActiveDataset(conversationId: string) {
    return (await this.listDatasets(conversationId)).find((dataset) => ["ready", "confirmed"].includes(dataset.status)) ?? null;
  }

  async getLatestSqlDataset(conversationId: string) {
    return (
      (await this.listDatasets(conversationId)).find(
        (dataset) => (dataset.sourceType === "sql_execution_result" || dataset.sourceType === "refined_sql_result") && ["ready", "confirmed"].includes(dataset.status),
      ) ?? null
    );
  }

  async getConfirmedDataset(conversationId: string) {
    return (await this.listDatasets(conversationId)).find((dataset) => dataset.status === "confirmed" && dataset.canAnalyze && dataset.canUseForReport) ?? null;
  }

  async listDatasets(conversationId: string) {
    return Array.from(this.datasets.values())
      .filter((dataset) => dataset.conversationId === conversationId && dataset.status !== "deleted")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((dataset) => structuredClone(dataset));
  }

  async confirmDataset(datasetId: string) {
    const dataset = await this.getDataset(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }
    return this.registerDataset({ ...dataset, status: "confirmed", canAnalyze: true, canUseForReport: true, updatedAt: nowIso() });
  }

  async rejectDataset(datasetId: string, reason?: string) {
    const dataset = await this.getDataset(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }
    return this.registerDataset({ ...dataset, status: "rejected", canAnalyze: false, canUseForReport: false, updatedAt: nowIso(), metadata: { ...dataset.metadata, rejectReason: reason } });
  }

  async expireDataset(datasetId: string) {
    const dataset = await this.getDataset(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }
    return this.registerDataset({ ...dataset, status: "expired", canQuery: false, canAnalyze: false, canUseForReport: false, updatedAt: nowIso() });
  }

  async deleteDataset(datasetId: string) {
    const dataset = await this.getDataset(datasetId);
    if (!dataset) {
      return;
    }
    await this.registerDataset({ ...dataset, status: "deleted", canQuery: false, canAnalyze: false, canUseForReport: false, updatedAt: nowIso() });
  }
}

export class TempTableRegistry {
  private readonly tables = new Map<string, MaterializeSqlResultOutput>();

  register(output: MaterializeSqlResultOutput) {
    this.tables.set(output.datasetId, structuredClone(output));
    return output;
  }

  get(datasetId: string) {
    const output = this.tables.get(datasetId);
    return output ? structuredClone(output) : null;
  }

  unregister(datasetId: string) {
    this.tables.delete(datasetId);
  }

  list() {
    return Array.from(this.tables.values()).map((output) => structuredClone(output));
  }
}

export class SQLiteMaterializer {
  constructor(
    private readonly db: any,
    private readonly options: {
      sqliteDatabasePath: string;
      batchSize?: number;
      maxDatabaseSizeBytes?: number;
      onProgress?: (event: { workflowId: string; conversationId: string; datasetId: string; rowsWritten: number }) => void;
    },
  ) {}

  async materializeSqlResult(input: MaterializeSqlResultInput): Promise<MaterializeSqlResultOutput> {
    this.assertNotAborted(input.signal);
    const datasetId = randomUUID();
    const tableName = this.uniqueTableName(safeTableName(input.targetTableName ?? `wf_${datasetId.replaceAll("-", "_")}`));
    const createdAt = nowIso();
    const columns = input.resultColumns.length > 0 ? input.resultColumns : this.inferColumns(input.rows ?? []);
    if (columns.length === 0) {
      throw new Error("SQLITE_MATERIALIZATION_FAILED: result columns are empty");
    }
    const schema = Object.fromEntries(columns.map((column) => [column.name, normalizeSqliteType(column.type)]));
    const columnSql = columns.map((column) => `${quoteIdentifier(column.name)} ${schema[column.name]}`).join(", ");
    const quotedTable = quoteIdentifier(tableName);

    this.db.prepare(`create table ${quotedTable} (${columnSql})`).run();

    let rowCount = 0;
    const batchSize = this.options.batchSize ?? 500;
    const insertSql = `insert into ${quotedTable} (${columns.map((column) => quoteIdentifier(column.name)).join(", ")}) values (${columns.map(() => "?").join(", ")})`;
    const insert = this.db.prepare(insertSql);
    const writeBatch = this.db.transaction((rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        insert.run(...columns.map((column) => row[column.name] ?? null));
      }
    });

    try {
      let batch: Record<string, unknown>[] = [];
      const flush = () => {
        if (batch.length === 0) {
          return;
        }
        this.assertNotAborted(input.signal);
        this.assertSizeBudget();
        writeBatch(batch);
        rowCount += batch.length;
        batch = [];
        this.options.onProgress?.({ workflowId: input.workflowId, conversationId: input.conversationId, datasetId, rowsWritten: rowCount });
      };

      if (input.rows) {
        for (const row of input.rows) {
          this.assertNotAborted(input.signal);
          batch.push(row);
          if (batch.length >= batchSize) {
            flush();
          }
        }
      }
      if (input.rowsStream) {
        for await (const row of input.rowsStream) {
          this.assertNotAborted(input.signal);
          batch.push(row);
          if (batch.length >= batchSize) {
            flush();
          }
        }
      }
      flush();
    } catch (error) {
      this.db.prepare(`drop table if exists ${quotedTable}`).run();
      throw error;
    }

    return {
      datasetId,
      sqliteDatabasePath: this.options.sqliteDatabasePath,
      sqliteTableName: tableName,
      rowCount,
      columnCount: columns.length,
      schema,
      createdAt,
    };
  }

  profileDataset(dataset: Pick<WorkflowDatasetRef, "datasetId" | "sqliteTableName" | "rowCount" | "columnCount" | "schema">): WorkflowDatasetProfile {
    if (!dataset.sqliteTableName) {
      throw new Error("Dataset has no SQLite table name");
    }
    const columns = Object.entries(dataset.schema ?? {});
    const previewRows = this.db.prepare(`select * from ${quoteIdentifier(dataset.sqliteTableName)} limit 20`).all() as Record<string, unknown>[];
    return {
      datasetId: dataset.datasetId,
      rowCount: dataset.rowCount ?? previewRows.length,
      columnCount: dataset.columnCount ?? columns.length,
      columns: columns.map(([name, type]) => ({
        name,
        type,
        sampleValues: Array.from(new Set(previewRows.map((row) => row[name]).filter((value) => value !== null && value !== undefined))).slice(0, 5),
      })),
      previewRows,
      warnings: [],
      generatedAt: nowIso(),
    };
  }

  dropTable(sqliteTableName: string) {
    this.db.prepare(`drop table if exists ${quoteIdentifier(sqliteTableName)}`).run();
  }

  private inferColumns(rows: Record<string, unknown>[]) {
    const first = rows[0] ?? {};
    return Object.keys(first).map((name) => ({ name, type: inferSqliteType(first[name]) }));
  }

  private assertSizeBudget() {
    const maxDatabaseSizeBytes = this.options.maxDatabaseSizeBytes;
    if (!maxDatabaseSizeBytes || !existsSync(this.options.sqliteDatabasePath)) {
      return;
    }
    if (statSync(this.options.sqliteDatabasePath).size > maxDatabaseSizeBytes) {
      throw new Error("SQLITE_MATERIALIZATION_FAILED: local SQLite database size budget exceeded");
    }
  }

  private assertNotAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
      throw new Error("SQLITE_MATERIALIZATION_FAILED: materialization cancelled");
    }
  }

  private uniqueTableName(baseName: string) {
    if (!this.tableExists(baseName)) {
      return baseName;
    }
    for (let index = 1; index <= 999; index += 1) {
      const suffix = `_${index}`;
      const candidate = `${baseName.slice(0, Math.max(1, 96 - suffix.length))}${suffix}`;
      if (!this.tableExists(candidate)) {
        return candidate;
      }
    }
    throw new Error("SQLITE_MATERIALIZATION_FAILED: unable to allocate unique temp table name");
  }

  private tableExists(tableName: string) {
    try {
      const row = this.db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(tableName) as { name?: string } | undefined;
      return row?.name === tableName;
    } catch {
      return false;
    }
  }
}

export class InMemoryWorkflowMemoryBridge implements MemoryWorkflowBridge {
  private readonly entries: WorkflowMemoryEntry[] = [];

  async writeWorkflowMemory(input: {
    conversationId: string;
    userId: string;
    type: string;
    summary: string;
    payload?: Record<string, unknown>;
  }) {
    this.entries.push({
      memoryId: randomUUID(),
      conversationId: input.conversationId,
      userId: input.userId,
      type: input.type,
      summary: input.summary,
      payload: input.payload,
      createdAt: nowIso(),
    });
  }

  list(conversationId?: string) {
    return this.entries.filter((entry) => !conversationId || entry.conversationId === conversationId).map((entry) => structuredClone(entry));
  }
}

export class SQLiteWorkflowMemoryBridge implements MemoryWorkflowBridge {
  constructor(private readonly db: any) {
    this.db.exec(`
      create table if not exists workflow_memory_entries (
        memory_id text primary key,
        conversation_id text not null,
        user_id text not null,
        type text not null,
        summary text not null,
        payload_json text,
        created_at text not null
      );
      create index if not exists idx_workflow_memory_conversation on workflow_memory_entries(conversation_id, created_at desc);
    `);
  }

  async writeWorkflowMemory(input: {
    conversationId: string;
    userId: string;
    type: string;
    summary: string;
    payload?: Record<string, unknown>;
  }) {
    this.db
      .prepare(
        `insert into workflow_memory_entries
          (memory_id, conversation_id, user_id, type, summary, payload_json, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), input.conversationId, input.userId, input.type, input.summary, input.payload ? JSON.stringify(input.payload) : null, nowIso());
  }

  list(conversationId: string) {
    return (this.db
      .prepare("select * from workflow_memory_entries where conversation_id = ? order by created_at desc")
      .all(conversationId) as Array<Record<string, unknown>>).map((row) => ({
      memoryId: row.memory_id as string,
      conversationId: row.conversation_id as string,
      userId: row.user_id as string,
      type: row.type as string,
      summary: row.summary as string,
      payload: row.payload_json ? (JSON.parse(row.payload_json as string) as Record<string, unknown>) : undefined,
      createdAt: row.created_at as string,
    }));
  }
}

export class MarkdownReportWorkflowBridge implements ReportWorkflowBridge {
  async generateReport(input: {
    conversationId: string;
    userId: string;
    reportGoal: string;
    dataset: WorkflowDatasetRef;
    pythonExecutionId?: string;
  }) {
    const reportVersionId = randomUUID();
    const schemaRows = Object.entries(input.dataset.schema ?? {})
      .map(([name, type]) => `| ${name} | ${type} |`)
      .join("\n");
    const markdown = [
      `# ${input.reportGoal || "工作流分析报告"}`,
      "",
      "## 数据集引用",
      `- 数据集 ID：${input.dataset.datasetId}`,
      `- 数据集名称：${input.dataset.name}`,
      `- SQLite 表：${input.dataset.sqliteTableName ?? "--"}`,
      `- 行数：${input.dataset.rowCount ?? "--"}`,
      `- 列数：${input.dataset.columnCount ?? "--"}`,
      `- Python 执行 ID：${input.pythonExecutionId ?? "--"}`,
      "",
      "## 字段 Schema",
      "| 字段 | 类型 |",
      "|---|---|",
      schemaRows || "| -- | -- |",
      "",
      "## 结论",
      "报告已基于工作流数据集引用生成。完整明细保留在本地 SQLite 受控数据集中，未注入模型上下文。",
    ].join("\n");
    return {
      reportVersionId,
      summary: `报告 ${reportVersionId} 已生成，引用数据集 ${input.dataset.datasetId}。`,
      markdown,
    };
  }
}

export class WorkflowContextBuilder {
  constructor(
    private readonly stateStore: WorkflowStateStore,
    private readonly datasetStateManager: DatasetStateManager,
    private readonly options: { maxPreviewRows?: number } = {},
  ) {}

  async build(conversationId: string): Promise<WorkflowContextSummary> {
    const workflow = (await this.stateStore.getActiveByConversation(conversationId)) ?? (await this.stateStore.listByConversation(conversationId))[0] ?? null;
    const datasets = await this.datasetStateManager.listDatasets(conversationId);
    const activeDataset = await this.datasetStateManager.getActiveDataset(conversationId);
    const latestSqlDataset = await this.datasetStateManager.getLatestSqlDataset(conversationId);
    const confirmedDataset = await this.datasetStateManager.getConfirmedDataset(conversationId);
    const latestPythonAnalysis = this.latestPythonAnalysis(workflow);
    const latestReport = this.latestReport(workflow);
    return {
      workflowId: workflow?.workflowId,
      status: workflow?.status,
      activeDataset: activeDataset ? this.safeDatasetSummary(activeDataset) : null,
      latestSqlDataset: latestSqlDataset ? this.safeDatasetSummary(latestSqlDataset) : null,
      confirmedDataset: confirmedDataset ? this.safeDatasetSummary(confirmedDataset) : null,
      latestPythonAnalysis,
      latestReport,
      datasets: datasets.map((dataset) => this.safeDatasetSummary(dataset)),
      lineage: datasets.map((dataset) => ({ datasetId: dataset.datasetId, parentDatasetIds: dataset.parentDatasetIds ?? [] })),
      steps: workflow?.steps.slice(-12) ?? [],
      pendingApprovals: workflow?.steps.filter((item) => item.status === "waiting" && /approval/.test(item.type)) ?? [],
      suggestedNextAction: this.suggestNextAction(workflow, activeDataset, confirmedDataset),
    };
  }

  async buildMarkdown(conversationId: string) {
    const context = await this.build(conversationId);
    if (!context.workflowId && context.datasets.length === 0) {
      return "";
    }
    return [
      "当前 Workflow Context（仅包含数据集引用、摘要和 lineage，不包含完整数据）：",
      `- workflowId: ${context.workflowId ?? "--"}`,
      `- status: ${context.status ?? "--"}`,
      `- activeDataset: ${context.activeDataset ? `${context.activeDataset.datasetId} / ${context.activeDataset.name}` : "--"}`,
      `- latestSqlDataset: ${context.latestSqlDataset ? context.latestSqlDataset.datasetId : "--"}`,
      `- confirmedDataset: ${context.confirmedDataset ? context.confirmedDataset.datasetId : "--"}`,
      `- latestPythonAnalysis: ${context.latestPythonAnalysis ? `${context.latestPythonAnalysis.pythonExecutionId ?? "--"} / ${context.latestPythonAnalysis.summary ?? "--"}` : "--"}`,
      `- latestReport: ${context.latestReport ? `${context.latestReport.reportVersionId ?? "--"} / ${context.latestReport.summary ?? "--"}` : "--"}`,
      "- datasets:",
      ...context.datasets.map((dataset) => {
        const schema = dataset.schema ? Object.entries(dataset.schema).map(([name, type]) => `${name}:${type}`).join(", ") : "--";
        return `  - ${dataset.datasetId}: ${dataset.name}, rows=${dataset.rowCount ?? "--"}, columns=${dataset.columnCount ?? "--"}, table=${dataset.sqliteTableName ?? "--"}, schema=${schema}`;
      }),
      `- suggestedNextAction: ${context.suggestedNextAction}`,
    ].join("\n");
  }

  private safeDatasetSummary(dataset: WorkflowDatasetRef) {
    return {
      datasetId: dataset.datasetId,
      name: dataset.name,
      sourceType: dataset.sourceType,
      sqliteTableName: dataset.sqliteTableName,
      rowCount: dataset.rowCount,
      columnCount: dataset.columnCount,
      schema: dataset.schema,
      status: dataset.status,
      canQuery: dataset.canQuery,
      canAnalyze: dataset.canAnalyze,
      canUseForReport: dataset.canUseForReport,
      parentDatasetIds: dataset.parentDatasetIds ?? [],
      createdAt: dataset.createdAt,
      updatedAt: dataset.updatedAt,
    };
  }

  private latestPythonAnalysis(workflow: WorkflowSession | null): WorkflowContextSummary["latestPythonAnalysis"] {
    const output = [...(workflow?.steps ?? [])].reverse().find((item) => item.type === "python_execution" && item.status === "success")?.output;
    if (!output) {
      return null;
    }
    return {
      pythonExecutionId: typeof output.pythonExecutionId === "string" ? output.pythonExecutionId : workflow?.latestPythonExecutionId,
      summary: typeof output.summary === "string" ? output.summary : undefined,
      artifacts: Array.isArray(output.artifacts) ? output.artifacts as Array<{ artifactId: string; type: string; description?: string }> : [],
    };
  }

  private latestReport(workflow: WorkflowSession | null): WorkflowContextSummary["latestReport"] {
    const output = [...(workflow?.steps ?? [])].reverse().find((item) => item.type === "report_generation" && item.status === "success")?.output;
    if (!output) {
      return null;
    }
    return {
      reportVersionId: typeof output.reportVersionId === "string" ? output.reportVersionId : workflow?.latestReportVersionId,
      summary: typeof output.summary === "string" ? output.summary : undefined,
    };
  }

  private suggestNextAction(workflow: WorkflowSession | null, activeDataset: WorkflowDatasetRef | null, confirmedDataset: WorkflowDatasetRef | null) {
    if (!workflow) {
      return activeDataset ? "可基于当前数据集继续筛选、确认或发起分析。" : "等待用户提出查询或数据提取需求。";
    }
    if (workflow.status === "waiting_user_confirmation" && activeDataset && !confirmedDataset) {
      return "请用户确认当前数据集，确认后可发起 Python 分析或报告生成。";
    }
    if (workflow.status === "waiting_python_approval") {
      return "等待用户审批 Python 分析脚本。";
    }
    if (confirmedDataset) {
      return "可基于已确认数据集生成分析报告。";
    }
    return "继续推进当前工作流下一步。";
  }
}

export class WorkflowRuntime {
  private readonly router = new WorkflowIntentRouter();
  private readonly config: WorkflowModuleConfig;

  constructor(config: WorkflowModuleConfig) {
    this.config = config.auditLogger
      ? {
          ...config,
          stateStore: new AuditedWorkflowStateStore(config.stateStore, config.auditLogger),
        }
      : config;
  }

  async start(input: StartWorkflowInput) {
    const intent = this.router.detect(input.userRequest);
    if (intent === "unknown") {
      throw workflowError("WORKFLOW_INTENT_UNKNOWN", "无法识别工作流意图。");
    }
    const createdAt = nowIso();
    const workflowId = randomUUID();
    const session: WorkflowSession = {
      workflowId,
      conversationId: input.conversationId,
      projectId: input.projectId,
      userId: input.userId,
      type: workflowTypeForIntent(intent),
      status: "planning",
      title: input.userRequest.slice(0, 80),
      userGoal: input.userRequest,
      steps: [step("intent_detection", "success", { userRequest: input.userRequest }, { intent })],
      datasets: [],
      events: [event(workflowId, input.conversationId, "workflow_created", "工作流已创建。", { intent })],
      createdAt,
      updatedAt: createdAt,
    };
    await this.config.stateStore.create(session);

    if (intent === "confirm_dataset") {
      return this.confirmDataset({ conversationId: input.conversationId, userId: input.userId, workflowId });
    }
    if (intent === "analyze_confirmed_dataset") {
      return this.startPythonAnalysis({
        conversationId: input.conversationId,
        workflowId,
        userId: input.userId,
        userRequest: input.userRequest,
        analysisGoal: input.userRequest,
      });
    }
    if (intent === "generate_report") {
      return this.generateReport({ conversationId: input.conversationId, workflowId, userId: input.userId, reportGoal: input.userRequest });
    }
    return this.createSqlRequest(session, input.userRequest, intent === "refine_previous_dataset");
  }

  async continue(input: StartWorkflowInput) {
    const active = await this.config.stateStore.getActiveByConversation(input.conversationId);
    if (!active) {
      return this.start(input);
    }
    const intent = this.router.detect(input.userRequest);
    if (intent === "confirm_dataset") {
      return this.confirmDataset({ conversationId: input.conversationId, userId: input.userId, workflowId: active.workflowId });
    }
    if (intent === "refine_previous_dataset") {
      return this.refineDataset({ conversationId: input.conversationId, userId: input.userId, workflowId: active.workflowId, userRequest: input.userRequest });
    }
    if (intent === "analyze_confirmed_dataset") {
      return this.startPythonAnalysis({
        conversationId: input.conversationId,
        workflowId: active.workflowId,
        userId: input.userId,
        userRequest: input.userRequest,
        analysisGoal: input.userRequest,
      });
    }
    if (intent === "generate_report" || intent === "generate_report_with_more_query") {
      return this.generateReport({ conversationId: input.conversationId, workflowId: active.workflowId, userId: input.userId, reportGoal: input.userRequest, allowRefineBeforeReport: intent === "generate_report_with_more_query" });
    }
    return this.createSqlRequest(active, input.userRequest, false);
  }

  get(workflowId: string) {
    return this.config.stateStore.get(workflowId);
  }

  listByConversation(conversationId: string) {
    return this.config.stateStore.listByConversation(conversationId);
  }

  getActiveDataset(conversationId: string) {
    return this.config.datasetStateManager.getActiveDataset(conversationId);
  }

  async reuseDataset(input: ReuseWorkflowDatasetInput) {
    const source = await this.config.datasetStateManager.getDataset(input.sourceDatasetId);
    if (!source || source.status === "deleted") {
      throw workflowError("DATASET_NOT_FOUND", "未找到可复用的数据集。");
    }
    if (source.status === "expired") {
      throw workflowError("DATASET_EXPIRED", "数据集已过期，无法复用。", source.workflowId);
    }

    const workflow = input.workflowId
      ? await this.resolveWorkflow(input.targetConversationId, input.workflowId)
      : (await this.config.stateStore.getActiveByConversation(input.targetConversationId)) ??
        (await this.createDatasetReuseWorkflow(input.targetConversationId, input.userId, source));
    const createdAt = nowIso();
    const reused: WorkflowDatasetRef = {
      ...source,
      datasetId: randomUUID(),
      workflowId: workflow!.workflowId,
      conversationId: input.targetConversationId,
      name: input.name?.trim() || `${source.name}（复用）`,
      sourceType: "manual",
      parentDatasetIds: [source.datasetId, ...(source.parentDatasetIds ?? [])],
      status: "ready",
      canQuery: source.canQuery,
      canAnalyze: source.canAnalyze,
      canUseForReport: source.canUseForReport,
      createdAt,
      updatedAt: createdAt,
      metadata: {
        ...source.metadata,
        reusedFromDatasetId: source.datasetId,
        reusedFromConversationId: source.conversationId,
      },
    };
    await this.config.datasetStateManager.registerDataset(reused);
    const latest = (await this.config.stateStore.get(workflow!.workflowId)) ?? workflow!;
    const nextWorkflow = await this.config.stateStore.update(workflow!.workflowId, {
      status: "waiting_user_confirmation",
      activeDatasetId: reused.datasetId,
      latestSqlDatasetId: reused.sourceSqlExecutionId ? reused.datasetId : latest.latestSqlDatasetId,
      steps: [
        ...latest.steps,
        step("memory_update", "success", { sourceDatasetId: source.datasetId }, { reusedDatasetId: reused.datasetId }),
      ],
    });
    await this.config.stateStore.appendEvent(
      nextWorkflow.workflowId,
      event(nextWorkflow.workflowId, input.targetConversationId, "dataset_materialized", "数据集已跨会话复用。", {
        sourceDatasetId: source.datasetId,
        reusedDatasetId: reused.datasetId,
      }),
    );
    await this.writeMemory(input.targetConversationId, input.userId, "dataset_reused", `数据集 ${source.datasetId} 已复用为 ${reused.datasetId}。`, {
      sourceDatasetId: source.datasetId,
      reusedDatasetId: reused.datasetId,
    });
    return { workflow: nextWorkflow, dataset: reused };
  }

  async executeApprovedSqlRequest(input: ExecuteApprovedSqlWorkflowInput) {
    const workflow = await this.resolveWorkflow(input.conversationId, input.workflowId);
    const approvalStep = step("sql_approval", "success", { sqlRequestId: input.sqlRequestId });
    const executing = await this.config.stateStore.update(workflow!.workflowId, {
      status: "executing_sql",
      steps: [...workflow!.steps, approvalStep, step("sql_execution", "running", { sqlRequestId: input.sqlRequestId })],
    });
    await this.config.stateStore.appendEvent(executing.workflowId, event(executing.workflowId, input.conversationId, "sql_approved", "SQL 请求已审批。", { sqlRequestId: input.sqlRequestId }));

    try {
      if (input.signal?.aborted) {
        throw new Error("SQL_EXECUTION_FAILED: query cancelled");
      }
      const execution = await this.config.sqlToolBridge.executeApprovedSqlRequest(input.sqlRequestId, { signal: input.signal });
      const materializing = await this.config.stateStore.update(workflow!.workflowId, {
        status: "materializing_dataset",
        steps: [
          ...executing.steps.filter((item) => !(item.type === "sql_execution" && item.status === "running" && item.input?.sqlRequestId === input.sqlRequestId)),
          step("sql_execution", "success", { sqlRequestId: input.sqlRequestId }, { sqlExecutionId: execution.sqlExecutionId }),
          step("sqlite_materialization", "running", { sqlExecutionId: execution.sqlExecutionId }),
        ],
      });
      await this.config.stateStore.appendEvent(materializing.workflowId, event(materializing.workflowId, input.conversationId, "sql_executed", "SQL 请求已执行，开始物化结果。", { sqlExecutionId: execution.sqlExecutionId }));
      const activeDataset = await this.config.datasetStateManager.getActiveDataset(input.conversationId);
      const materialized = await this.config.sqliteMaterializer.materializeSqlResult({
        workflowId: workflow!.workflowId,
        conversationId: input.conversationId,
        sqlRequestId: input.sqlRequestId,
        sqlExecutionId: execution.sqlExecutionId,
        sourceDataSourceId: input.sourceDataSourceId,
        resultColumns: execution.columns,
        rows: execution.rows,
        rowsStream: execution.rowsStream,
        parentDatasetIds: activeDataset ? [activeDataset.datasetId] : undefined,
        signal: input.signal,
      });
      this.assertTempDatabaseBudget(materialized);
      this.config.tempTableRegistry.register(materialized);
      const createdAt = materialized.createdAt;
      const dataset: WorkflowDatasetRef = {
        datasetId: materialized.datasetId,
        workflowId: workflow!.workflowId,
        conversationId: input.conversationId,
        name: `SQL 执行结果 ${materialized.sqliteTableName}`,
        sourceType: activeDataset ? "refined_sql_result" : "sql_execution_result",
        sqliteTableName: materialized.sqliteTableName,
        sqliteDatabasePath: materialized.sqliteDatabasePath,
        parentDatasetIds: activeDataset ? [activeDataset.datasetId] : undefined,
        sourceSqlRequestId: input.sqlRequestId,
        sourceSqlExecutionId: execution.sqlExecutionId,
        rowCount: materialized.rowCount,
        columnCount: materialized.columnCount,
        schema: materialized.schema,
        status: "ready",
        canQuery: true,
        canAnalyze: true,
        canUseForReport: true,
        createdAt,
        updatedAt: createdAt,
        expiresAt: this.config.defaultDatasetTtlMs ? new Date(Date.parse(createdAt) + this.config.defaultDatasetTtlMs).toISOString() : undefined,
      };
      dataset.profile = this.config.sqliteMaterializer.profileDataset(dataset);
      await this.config.datasetStateManager.registerDataset(dataset);
      const latest = (await this.config.stateStore.get(workflow!.workflowId)) ?? materializing;
      const shouldAutoStartPython =
        workflow!.type === "direct_query_analysis_report" ||
        workflow!.type === "report_generation" ||
        workflow!.type === "report_generation_with_refinement";
      const preparedDataset = shouldAutoStartPython
        ? await this.config.datasetStateManager.confirmDataset(dataset.datasetId)
        : dataset;
      const pythonRequest = shouldAutoStartPython
        ? await this.config.pythonBridge.createPythonRequest({
            conversationId: input.conversationId,
            userId: input.userId,
            analysisGoal: workflow!.userGoal,
            inputDataset: preparedDataset,
            expectedOutputs: ["summary", "chart", "report_section"],
          })
        : null;
      const retainedSteps = latest.steps.filter(
        (item) =>
          !(item.type === "sql_execution" && item.status === "running" && item.input?.sqlRequestId === input.sqlRequestId) &&
          !(item.type === "sqlite_materialization" && item.status === "running" && item.input?.sqlExecutionId === execution.sqlExecutionId),
      );
      const hasCompletedSqlStep = retainedSteps.some((item) => item.type === "sql_execution" && item.status === "success" && item.output?.sqlExecutionId === execution.sqlExecutionId);
      const next = await this.config.stateStore.update(workflow!.workflowId, {
        status: pythonRequest ? (pythonRequest.status === "pending_approval" ? "waiting_python_approval" : "executing_python") : "waiting_user_confirmation",
        activeDatasetId: preparedDataset.datasetId,
        latestSqlDatasetId: preparedDataset.datasetId,
        confirmedDatasetId: preparedDataset.status === "confirmed" ? preparedDataset.datasetId : latest.confirmedDatasetId,
        steps: [
          ...retainedSteps,
          ...(hasCompletedSqlStep ? [] : [step("sql_execution", "success", { sqlRequestId: input.sqlRequestId }, { sqlExecutionId: execution.sqlExecutionId, rowCount: dataset.rowCount })]),
          step("sqlite_materialization", "success", { sqlExecutionId: execution.sqlExecutionId }, { datasetId: dataset.datasetId, sqliteTableName: dataset.sqliteTableName }),
          step("dataset_profile", "success", { datasetId: dataset.datasetId }, { rowCount: dataset.rowCount, columnCount: dataset.columnCount }),
          ...(pythonRequest
            ? [
                step("user_confirmation", "skipped", { datasetId: preparedDataset.datasetId }, { reason: "direct_query_analysis_report_auto_uses_approved_sql_result" }),
                step("python_request", pythonRequest.status === "pending_approval" ? "waiting" : "success", { datasetId: preparedDataset.datasetId, analysisGoal: workflow!.userGoal }, pythonRequest),
              ]
            : []),
        ],
      });
      await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, input.conversationId, activeDataset ? "dataset_refined" : "dataset_materialized", "SQL 结果已物化为数据集。", { datasetId: dataset.datasetId }));
      if (pythonRequest) {
        await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, input.conversationId, "dataset_confirmed", "直接查询分析报告工作流已使用审批后的 SQL 结果作为分析数据集。", { datasetId: preparedDataset.datasetId }));
        await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, input.conversationId, "python_request_created", "Python 分析请求已创建。", pythonRequest));
      }
      await this.writeMemory(input.conversationId, input.userId, "dataset_materialized", `SQL 执行结果已物化为 ${dataset.datasetId}。`, {
        datasetId: dataset.datasetId,
        sqlExecutionId: execution.sqlExecutionId,
        rowCount: dataset.rowCount,
        columnCount: dataset.columnCount,
      });
      return { workflow: next, dataset: preparedDataset };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "SQL 执行失败。";
      const isMaterializationFailure = /SQLITE_MATERIALIZATION_FAILED|SQLite database size budget|local SQLite database size/i.test(errorMessage);
      const failedStep = step(isMaterializationFailure ? "sqlite_materialization" : "sql_execution", "failed", { sqlRequestId: input.sqlRequestId });
      failedStep.error = workflowError(isMaterializationFailure ? "SQLITE_MATERIALIZATION_FAILED" : "SQL_EXECUTION_FAILED", errorMessage, workflow!.workflowId, failedStep.stepId);
      const latest = (await this.config.stateStore.get(workflow!.workflowId)) ?? executing;
      const retainedSteps = latest.steps.filter(
        (item) =>
          !(item.type === "sql_execution" && item.status === "running" && item.input?.sqlRequestId === input.sqlRequestId) &&
          !(item.type === "sqlite_materialization" && item.status === "running"),
      );
      const failed = await this.config.stateStore.update(workflow!.workflowId, {
        status: "failed",
        steps: [...retainedSteps, failedStep],
      });
      await this.config.stateStore.appendEvent(failed.workflowId, event(failed.workflowId, input.conversationId, "workflow_failed", isMaterializationFailure ? "SQLite 物化失败。" : "SQL 执行失败。", { sqlRequestId: input.sqlRequestId, error: errorMessage }));
      return { workflow: failed, dataset: null };
    }
  }

  async executeApprovedPythonRequest(input: ExecuteApprovedPythonWorkflowInput) {
    const workflow = await this.resolveWorkflow(input.conversationId, input.workflowId);
    const executing = await this.config.stateStore.update(workflow!.workflowId, {
      status: "executing_python",
      steps: [...workflow!.steps, step("python_approval", "success", { pythonRequestId: input.pythonRequestId }), step("python_execution", "running", { pythonRequestId: input.pythonRequestId })],
    });
    await this.config.stateStore.appendEvent(executing.workflowId, event(executing.workflowId, input.conversationId, "python_approved", "Python 请求已审批。", { pythonRequestId: input.pythonRequestId }));
    try {
      const result = await this.config.pythonBridge.executeApprovedPythonRequest(input.pythonRequestId);
      const reportDataset =
        (await this.config.datasetStateManager.getConfirmedDataset(input.conversationId)) ??
        (await this.config.datasetStateManager.getActiveDataset(input.conversationId));
      const shouldGenerateReport =
        Boolean(this.config.reportBridge && reportDataset) &&
        ["direct_query_analysis_report", "report_generation", "report_generation_with_refinement"].includes(workflow!.type);
      const latest = (await this.config.stateStore.get(workflow!.workflowId)) ?? executing;
      const pythonCompletedSteps = [
        ...latest.steps.filter((item) => !(item.type === "python_execution" && item.status === "running" && item.input?.pythonRequestId === input.pythonRequestId)),
        step("python_execution", "success", { pythonRequestId: input.pythonRequestId }, result),
      ];
      if (shouldGenerateReport) {
        const reporting = await this.config.stateStore.update(workflow!.workflowId, {
          status: "generating_report",
          latestPythonExecutionId: result.pythonExecutionId,
          steps: [
            ...pythonCompletedSteps,
            step("report_generation", "running", { datasetId: reportDataset!.datasetId, pythonExecutionId: result.pythonExecutionId, reportGoal: workflow!.userGoal }),
          ],
        });
        await this.config.stateStore.appendEvent(reporting.workflowId, event(reporting.workflowId, input.conversationId, "python_executed", "Python 分析已执行。", { pythonExecutionId: result.pythonExecutionId, artifacts: result.artifacts }));
        await this.writeMemory(input.conversationId, input.userId, "python_executed", result.summary, { pythonExecutionId: result.pythonExecutionId, artifacts: result.artifacts });

        try {
          const report = await this.config.reportBridge!.generateReport({
            conversationId: input.conversationId,
            userId: input.userId,
            reportGoal: workflow!.userGoal,
            dataset: reportDataset!,
            pythonExecutionId: result.pythonExecutionId,
          });
          const latestReportWorkflow = (await this.config.stateStore.get(workflow!.workflowId)) ?? reporting;
          const next = await this.config.stateStore.update(workflow!.workflowId, {
            status: "completed",
            latestPythonExecutionId: result.pythonExecutionId,
            latestReportVersionId: report.reportVersionId,
            steps: [
              ...latestReportWorkflow.steps.filter((item) => !(item.type === "report_generation" && item.status === "running")),
              step("report_generation", "success", { datasetId: reportDataset!.datasetId, pythonExecutionId: result.pythonExecutionId }, report),
            ],
          });
          await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, input.conversationId, "report_generated", "报告已生成。", report));
          await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, input.conversationId, "workflow_completed", "Python 分析和报告生成已完成。", {
            pythonExecutionId: result.pythonExecutionId,
            reportVersionId: report.reportVersionId,
          }));
          await this.writeMemory(input.conversationId, input.userId, "report_generated", report.summary, {
            reportVersionId: report.reportVersionId,
            datasetId: reportDataset!.datasetId,
            pythonExecutionId: result.pythonExecutionId,
          });
          return { workflow: next, result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "报告生成失败。";
          const failedStep = step("report_generation", "failed", { datasetId: reportDataset!.datasetId, pythonExecutionId: result.pythonExecutionId });
          failedStep.error = workflowError("REPORT_GENERATION_FAILED", errorMessage, workflow!.workflowId, failedStep.stepId);
          const latestReportWorkflow = (await this.config.stateStore.get(workflow!.workflowId)) ?? reporting;
          const failed = await this.config.stateStore.update(workflow!.workflowId, {
            status: "failed",
            steps: [
              ...latestReportWorkflow.steps.filter((item) => !(item.type === "report_generation" && item.status === "running")),
              failedStep,
            ],
          });
          await this.config.stateStore.appendEvent(failed.workflowId, event(failed.workflowId, input.conversationId, "workflow_failed", "报告生成失败。", { error: errorMessage, pythonExecutionId: result.pythonExecutionId }));
          return { workflow: failed, result };
        }
      }

      const next = await this.config.stateStore.update(workflow!.workflowId, {
        status: "completed",
        latestPythonExecutionId: result.pythonExecutionId,
        steps: pythonCompletedSteps,
      });
      await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, input.conversationId, "python_executed", "Python 分析已执行。", { pythonExecutionId: result.pythonExecutionId, artifacts: result.artifacts }));
      await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, input.conversationId, "workflow_completed", "Python 分析已完成。", {
        pythonExecutionId: result.pythonExecutionId,
      }));
      await this.writeMemory(input.conversationId, input.userId, "python_executed", result.summary, { pythonExecutionId: result.pythonExecutionId, artifacts: result.artifacts });
      return { workflow: next, result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Python 执行失败。";
      const failedStep = step("python_execution", "failed", { pythonRequestId: input.pythonRequestId });
      failedStep.error = workflowError("PYTHON_EXECUTION_FAILED", errorMessage, workflow!.workflowId, failedStep.stepId);
      const latest = (await this.config.stateStore.get(workflow!.workflowId)) ?? executing;
      const failed = await this.config.stateStore.update(workflow!.workflowId, {
        status: "failed",
        steps: [
          ...latest.steps.filter((item) => !(item.type === "python_execution" && item.status === "running" && item.input?.pythonRequestId === input.pythonRequestId)),
          failedStep,
        ],
      });
      await this.config.stateStore.appendEvent(failed.workflowId, event(failed.workflowId, input.conversationId, "workflow_failed", "Python 执行失败。", { pythonRequestId: input.pythonRequestId, error: errorMessage }));
      return { workflow: failed, result: null };
    }
  }

  async confirmDataset(input: { conversationId: string; userId: string; workflowId?: string; datasetId?: string }) {
    const workflow = await this.resolveWorkflow(input.conversationId, input.workflowId);
    const dataset = input.datasetId ? await this.config.datasetStateManager.getDataset(input.datasetId) : await this.config.datasetStateManager.getActiveDataset(input.conversationId);
    if (!dataset) {
      throw workflowError("DATASET_NOT_FOUND", "未找到可确认的数据集。", workflow?.workflowId);
    }
    const confirmed = await this.config.datasetStateManager.confirmDataset(dataset.datasetId);
    const nextWorkflow = await this.config.stateStore.update(workflow!.workflowId, {
      status: "waiting_python_approval",
      activeDatasetId: confirmed.datasetId,
      confirmedDatasetId: confirmed.datasetId,
      steps: [...workflow!.steps, step("user_confirmation", "success", { datasetId: confirmed.datasetId })],
    });
    await this.config.stateStore.appendEvent(nextWorkflow.workflowId, event(nextWorkflow.workflowId, input.conversationId, "dataset_confirmed", "数据集已确认。", { datasetId: confirmed.datasetId }));
    await this.writeMemory(input.conversationId, input.userId, "dataset_confirmed", `数据集 ${confirmed.name} 已确认，可用于 Python 分析和报告生成。`, { datasetId: confirmed.datasetId });
    return nextWorkflow;
  }

  async rejectDataset(input: { conversationId: string; workflowId?: string; datasetId: string; reason?: string }) {
    const workflow = await this.resolveWorkflow(input.conversationId, input.workflowId);
    const rejected = await this.config.datasetStateManager.rejectDataset(input.datasetId, input.reason);
    const next = await this.config.stateStore.update(workflow!.workflowId, {
      status: "waiting_user_confirmation",
      activeDatasetId: workflow!.activeDatasetId === rejected.datasetId ? undefined : workflow!.activeDatasetId,
      latestSqlDatasetId: workflow!.latestSqlDatasetId === rejected.datasetId ? undefined : workflow!.latestSqlDatasetId,
      confirmedDatasetId: workflow!.confirmedDatasetId === rejected.datasetId ? undefined : workflow!.confirmedDatasetId,
      steps: [...workflow!.steps, step("user_confirmation", "failed", { datasetId: rejected.datasetId, reason: input.reason })],
    });
    await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, input.conversationId, "dataset_rejected", "数据集已被用户拒绝。", { datasetId: rejected.datasetId, reason: input.reason }));
    await this.writeMemory(input.conversationId, workflow!.userId, "dataset_rejected", `数据集 ${rejected.datasetId} 已被拒绝。`, { datasetId: rejected.datasetId, reason: input.reason });
    return next;
  }

  async refineDataset(input: { conversationId: string; userId: string; workflowId?: string; userRequest: string }) {
    const workflow = await this.resolveWorkflow(input.conversationId, input.workflowId);
    const activeDataset = await this.config.datasetStateManager.getActiveDataset(input.conversationId);
    if (!activeDataset?.sqliteTableName) {
      throw workflowError("DATASET_NOT_READY", "当前没有可继续筛选的本地 SQLite 数据集。", workflow?.workflowId);
    }
    return this.createSqlRequest(workflow!, input.userRequest, true, activeDataset);
  }

  async startPythonAnalysis(input: StartPythonAnalysisInput) {
    const workflow = await this.resolveWorkflow(input.conversationId, input.workflowId);
    const dataset =
      (input.datasetId ? await this.config.datasetStateManager.getDataset(input.datasetId) : null) ??
      (await this.config.datasetStateManager.getConfirmedDataset(input.conversationId)) ??
      (await this.config.datasetStateManager.getActiveDataset(input.conversationId));
    if (!dataset) {
      throw workflowError("DATASET_NOT_FOUND", "未找到可分析的数据集。", workflow?.workflowId);
    }
    if (dataset.status !== "confirmed") {
      await this.config.stateStore.update(workflow!.workflowId, {
        status: "waiting_user_confirmation",
        steps: [...workflow!.steps, step("user_confirmation", "waiting", { datasetId: dataset.datasetId, reason: "python_analysis_requires_confirmation" })],
      });
      throw workflowError("DATASET_NOT_CONFIRMED", "数据集尚未确认，请先确认后再发起 Python 分析。", workflow?.workflowId);
    }
    const request = await this.config.pythonBridge.createPythonRequest({
      conversationId: input.conversationId,
      userId: input.userId,
      analysisGoal: input.analysisGoal,
      inputDataset: dataset,
      expectedOutputs: input.expectedOutputs,
    });
    const next = await this.config.stateStore.update(workflow!.workflowId, {
      status: request.status === "pending_approval" ? "waiting_python_approval" : "executing_python",
      steps: [...workflow!.steps, step("python_request", request.status === "pending_approval" ? "waiting" : "success", { datasetId: dataset.datasetId, analysisGoal: input.analysisGoal }, request)],
    });
    await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, input.conversationId, "python_request_created", "Python 分析请求已创建。", request));
    return next;
  }

  async generateReport(input: GenerateWorkflowReportInput) {
    const workflow = await this.resolveWorkflow(input.conversationId, input.workflowId);
    const dataset =
      (input.datasetId ? await this.config.datasetStateManager.getDataset(input.datasetId) : null) ??
      (await this.config.datasetStateManager.getConfirmedDataset(input.conversationId)) ??
      (await this.config.datasetStateManager.getLatestSqlDataset(input.conversationId));
    if (!dataset) {
      throw workflowError("DATASET_NOT_FOUND", "未找到可用于报告生成的数据集。", workflow?.workflowId);
    }
    if (input.allowRefineBeforeReport) {
      return this.createSqlRequest(workflow!, input.reportGoal, true, dataset);
    }
    if (!input.pythonExecutionId && !workflow?.latestPythonExecutionId && dataset.status === "confirmed") {
      return this.startPythonAnalysis({
        conversationId: input.conversationId,
        workflowId: workflow!.workflowId,
        userId: input.userId,
        userRequest: input.reportGoal,
        analysisGoal: input.reportGoal,
        expectedOutputs: ["summary", "chart", "report_section"],
      });
    }
    if (!this.config.reportBridge) {
      return this.config.stateStore.update(workflow!.workflowId, {
        status: "generating_report",
        steps: [...workflow!.steps, step("report_generation", "waiting", { datasetId: dataset.datasetId, reportGoal: input.reportGoal })],
      });
    }
    const report = await this.config.reportBridge.generateReport({
      conversationId: input.conversationId,
      userId: input.userId,
      reportGoal: input.reportGoal,
      dataset,
      pythonExecutionId: input.pythonExecutionId ?? workflow?.latestPythonExecutionId,
    });
    const next = await this.config.stateStore.update(workflow!.workflowId, {
      status: "completed",
      latestReportVersionId: report.reportVersionId,
      steps: [...workflow!.steps, step("report_generation", "success", { datasetId: dataset.datasetId }, report)],
    });
    await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, input.conversationId, "report_generated", "报告已生成。", report));
    await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, input.conversationId, "workflow_completed", "报告生成工作流已完成。", {
      reportVersionId: report.reportVersionId,
      datasetId: dataset.datasetId,
      pythonExecutionId: input.pythonExecutionId ?? workflow?.latestPythonExecutionId,
    }));
    await this.writeMemory(input.conversationId, input.userId, "report_generated", report.summary, {
      reportVersionId: report.reportVersionId,
      datasetId: dataset.datasetId,
      pythonExecutionId: input.pythonExecutionId ?? workflow?.latestPythonExecutionId,
    });
    return next;
  }

  async cancel(workflowId: string) {
    const workflow = await this.config.stateStore.get(workflowId);
    if (!workflow) {
      throw workflowError("WORKFLOW_NOT_FOUND", "工作流不存在。", workflowId);
    }
    const cancellableStepStatuses: WorkflowStepStatus[] = ["pending", "running", "waiting"];
    for (const dataset of workflow.datasets) {
      if (["creating", "ready", "confirmed"].includes(dataset.status)) {
        await this.config.datasetStateManager.expireDataset(dataset.datasetId);
      }
    }
    const latest = (await this.config.stateStore.get(workflowId)) ?? workflow;
    const next = await this.config.stateStore.update(workflowId, {
      status: "cancelled",
      activeDatasetId: undefined,
      latestSqlDatasetId: undefined,
      confirmedDatasetId: undefined,
      steps: latest.steps.map((item) =>
        cancellableStepStatuses.includes(item.status)
          ? { ...item, status: "cancelled", completedAt: item.completedAt ?? nowIso() }
          : item,
      ),
    });
    await this.config.stateStore.appendEvent(workflowId, event(workflowId, workflow.conversationId, "workflow_cancelled", "工作流已取消。"));
    await this.writeMemory(workflow.conversationId, workflow.userId, "workflow_cancelled", `工作流 ${workflowId} 已取消。`, { workflowId });
    return next;
  }

  async cleanupExpiredDatasets(input: { conversationId: string; now?: string }) {
    const nowTime = Date.parse(input.now ?? nowIso());
    const datasets = await this.config.datasetStateManager.listDatasets(input.conversationId);
    const expiredDatasetIds: string[] = [];
    for (const dataset of datasets) {
      if (!dataset.expiresAt || Date.parse(dataset.expiresAt) > nowTime || dataset.status === "expired") {
        continue;
      }
      if (dataset.sqliteTableName) {
        this.config.sqliteMaterializer.dropTable(dataset.sqliteTableName);
      }
      this.config.tempTableRegistry.unregister(dataset.datasetId);
      await this.config.datasetStateManager.expireDataset(dataset.datasetId);
      expiredDatasetIds.push(dataset.datasetId);
      const workflow = await this.config.stateStore.get(dataset.workflowId);
      if (workflow) {
        await this.config.stateStore.appendEvent(
          workflow.workflowId,
          event(workflow.workflowId, input.conversationId, "workflow_failed", "工作流数据集已按 TTL 过期清理。", {
            datasetId: dataset.datasetId,
            sqliteTableName: dataset.sqliteTableName,
          }),
        );
      }
    }
    if (expiredDatasetIds.length > 0) {
      const workflow = await this.config.stateStore.getActiveByConversation(input.conversationId);
      if (workflow && [workflow.activeDatasetId, workflow.latestSqlDatasetId, workflow.confirmedDatasetId].some((id) => id && expiredDatasetIds.includes(id))) {
        await this.config.stateStore.update(workflow.workflowId, {
          activeDatasetId: expiredDatasetIds.includes(workflow.activeDatasetId ?? "") ? undefined : workflow.activeDatasetId,
          latestSqlDatasetId: expiredDatasetIds.includes(workflow.latestSqlDatasetId ?? "") ? undefined : workflow.latestSqlDatasetId,
          confirmedDatasetId: expiredDatasetIds.includes(workflow.confirmedDatasetId ?? "") ? undefined : workflow.confirmedDatasetId,
        });
      }
    }
    return { expiredDatasetIds };
  }

  async recoverStaleWorkflows(input: RecoverStaleWorkflowsInput) {
    const nowTime = Date.parse(input.now ?? nowIso());
    const staleStatuses: WorkflowStatus[] = ["executing_sql", "materializing_dataset", "executing_python", "generating_report"];
    const recoveredWorkflowIds: string[] = [];
    const workflows = await this.config.stateStore.listByConversation(input.conversationId);
    for (const workflow of workflows) {
      if (!staleStatuses.includes(workflow.status)) {
        continue;
      }
      const updatedAt = Date.parse(workflow.updatedAt);
      if (Number.isFinite(updatedAt) && nowTime - updatedAt < input.olderThanMs) {
        continue;
      }
      const blockedSteps = workflow.steps.map((item) => {
        if (!["pending", "running", "waiting"].includes(item.status)) {
          return item;
        }
        const nextStep: WorkflowStep = {
          ...item,
          status: "blocked",
          completedAt: item.completedAt ?? input.now ?? nowIso(),
        };
        nextStep.error = workflowError("WORKFLOW_INVALID_STATE", "工作流恢复审计发现该步骤长时间未完成，已转为 blocked。", workflow.workflowId, item.stepId);
        return nextStep;
      });
      await this.config.stateStore.update(workflow.workflowId, {
        status: "blocked",
        steps: blockedSteps,
        metadata: {
          ...workflow.metadata,
          recovery: {
            recoveredAt: input.now ?? nowIso(),
            previousStatus: workflow.status,
            reason: "stale_workflow",
          },
        },
      });
      await this.config.stateStore.appendEvent(
        workflow.workflowId,
        event(workflow.workflowId, input.conversationId, "workflow_failed", "工作流恢复审计发现长时间未完成的执行态任务，已转为 blocked。", {
          previousStatus: workflow.status,
          olderThanMs: input.olderThanMs,
        }),
      );
      await this.writeMemory(input.conversationId, workflow.userId, "workflow_recovered_blocked", `工作流 ${workflow.workflowId} 已由恢复审计转为 blocked。`, {
        workflowId: workflow.workflowId,
        previousStatus: workflow.status,
      });
      recoveredWorkflowIds.push(workflow.workflowId);
    }
    return { recoveredWorkflowIds };
  }

  private async createSqlRequest(workflow: WorkflowSession, userRequest: string, useLocalSqlite: boolean, sourceDataset?: WorkflowDatasetRef) {
    const sqlRequest = await this.config.sqlToolBridge.createSqlRequest({
      conversationId: workflow.conversationId,
      userId: workflow.userId,
      userRequest,
      sqlPurpose: workflow.type,
      sourceDatasetId: sourceDataset?.datasetId,
      sourceSqliteTableName: sourceDataset?.sqliteTableName,
      useLocalSqlite,
    });
    const next = await this.config.stateStore.update(workflow.workflowId, {
      status: sqlRequest.status === "pending_approval" ? "waiting_sql_approval" : sqlRequest.status === "blocked" ? "blocked" : "executing_sql",
      steps: [...workflow.steps, step("sql_request", sqlRequest.status === "pending_approval" ? "waiting" : "success", { userRequest, sourceDatasetId: sourceDataset?.datasetId, useLocalSqlite }, sqlRequest)],
    });
    await this.config.stateStore.appendEvent(next.workflowId, event(next.workflowId, workflow.conversationId, "sql_request_created", "SQL 请求已创建。", sqlRequest));
    return next;
  }

  private async createDatasetReuseWorkflow(conversationId: string, userId: string, sourceDataset: WorkflowDatasetRef) {
    const createdAt = nowIso();
    const workflowId = randomUUID();
    const session: WorkflowSession = {
      workflowId,
      conversationId,
      userId,
      type: "data_extraction",
      status: "planning",
      title: `复用数据集 ${sourceDataset.name}`,
      userGoal: `复用数据集 ${sourceDataset.datasetId}`,
      steps: [step("intent_detection", "success", { sourceDatasetId: sourceDataset.datasetId }, { intent: "reuse_dataset" })],
      datasets: [],
      events: [event(workflowId, conversationId, "workflow_created", "跨会话数据集复用工作流已创建。", { sourceDatasetId: sourceDataset.datasetId })],
      createdAt,
      updatedAt: createdAt,
    };
    return this.config.stateStore.create(session);
  }

  private async resolveWorkflow(conversationId: string, workflowId?: string) {
    const workflow = workflowId ? await this.config.stateStore.get(workflowId) : await this.config.stateStore.getActiveByConversation(conversationId);
    if (!workflow) {
      throw workflowError("WORKFLOW_NOT_FOUND", "工作流不存在。", workflowId);
    }
    return workflow;
  }

  private assertTempDatabaseBudget(materialized: MaterializeSqlResultOutput) {
    const maxTempDatabaseSizeBytes = this.config.maxTempDatabaseSizeBytes;
    if (!maxTempDatabaseSizeBytes || !existsSync(materialized.sqliteDatabasePath)) {
      return;
    }
    if (statSync(materialized.sqliteDatabasePath).size <= maxTempDatabaseSizeBytes) {
      return;
    }
    this.config.sqliteMaterializer.dropTable(materialized.sqliteTableName);
    this.config.tempTableRegistry.unregister(materialized.datasetId);
    throw new Error("SQLITE_MATERIALIZATION_FAILED: local SQLite database size budget exceeded");
  }

  private async writeMemory(conversationId: string, userId: string, type: string, summary: string, payload?: Record<string, unknown>) {
    if (!this.config.memoryBridge || this.config.enableAutoMemoryUpdate === false) {
      return;
    }
    await this.config.memoryBridge.writeWorkflowMemory({ conversationId, userId, type, summary, payload });
  }
}

export function createWorkflowModule(config: WorkflowModuleConfig) {
  return new WorkflowRuntime(config);
}
