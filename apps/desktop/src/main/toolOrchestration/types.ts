import type { JsonSchema, ToolRegistry } from "../streamingModelAdapter";
import type { VisualizationSpec } from "../../shared/visualization";

export type ToolKind = "sql_query" | "python_analysis" | "chart_rendering" | "report_generation";

export type ToolCallStatus =
  | "planned"
  | "waiting_input"
  | "waiting_approval"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "rejected"
  | "cancelled"
  | "blocked";

export type ToolAction = "create" | "refine" | "rerun" | "continue" | "compare" | "view";

export type ToolCallErrorCode =
  | "TOOL_INTENT_UNKNOWN"
  | "TOOL_NOT_REGISTERED"
  | "TOOL_PLAN_INVALID"
  | "TOOL_DEPENDENCY_CYCLE"
  | "TOOL_INPUT_NOT_FOUND"
  | "TOOL_INPUT_PERMISSION_DENIED"
  | "TOOL_APPROVAL_REQUIRED"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_RESULT_NOT_FOUND"
  | "TOOL_RESULT_INCOMPATIBLE"
  | "ARTIFACT_NOT_FOUND"
  | "REPORT_CONTENT_NOT_FOUND"
  | "UNKNOWN_ERROR";

export type ToolCallError = {
  code: ToolCallErrorCode;
  message: string;
  conversationId?: string;
  planId?: string;
  toolCallId?: string;
  traceId: string;
  recoverable?: boolean;
  metadata?: Record<string, unknown>;
};

export type ToolExecutionResultRef = {
  resultId: string;
  toolKind: ToolKind;
  artifactIds: string[];
  primaryArtifactId?: string;
  summary?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type ResolvedToolInput = {
  mode: "explicit" | "latest_result" | "selected_result" | "no_input";
  sourceToolKind?: ToolKind;
  sourceToolCallId?: string;
  sourceArtifactIds?: string[];
  reason: string;
};

export type ToolCallRecord = {
  toolCallId: string;
  conversationId: string;
  messageId?: string;
  userId: string;
  toolKind: ToolKind;
  toolName: string;
  status: ToolCallStatus;
  request: Record<string, unknown>;
  resolvedInput?: ResolvedToolInput;
  result?: ToolExecutionResultRef;
  parentToolCallIds?: string[];
  sourceArtifactIds?: string[];
  outputArtifactIds?: string[];
  version: number;
  isLatestSuccessful: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: ToolCallError;
  metadata?: Record<string, unknown>;
};

export type ConversationToolState = {
  conversationId: string;
  latestSuccessfulSqlToolCallId?: string;
  latestSuccessfulSqlArtifactIds?: string[];
  latestSuccessfulPythonToolCallId?: string;
  latestSuccessfulPythonArtifactIds?: string[];
  latestSuccessfulChartToolCallId?: string;
  latestSuccessfulChartArtifactIds?: string[];
  latestSuccessfulReportToolCallId?: string;
  latestSuccessfulReportArtifactIds?: string[];
  selectedSqlToolCallId?: string;
  selectedPythonToolCallId?: string;
  selectedChartToolCallId?: string;
  selectedReportToolCallId?: string;
  toolCalls: ToolCallRecord[];
  updatedAt: string;
};

export type ToolIntentItem = {
  toolKind: ToolKind;
  action: ToolAction;
  purpose: string;
  dependsOn?: ToolKind[];
  explicitInputRefs?: string[];
  requestedChanges?: Record<string, unknown>;
  confidence: number;
};

export type ToolIntentResult = {
  conversationId: string;
  userMessage: string;
  intents: ToolIntentItem[];
  requiresClarification: boolean;
  clarificationQuestion?: string;
  confidence: number;
};

export type ToolExecutionPlanStatus = "draft" | "ready" | "executing" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type ToolInputStrategy = "explicit" | "latest_sql" | "latest_python" | "latest_chart" | "selected_artifacts" | "none";

export type ToolExecutionPlanStep = {
  stepId: string;
  toolKind: ToolKind;
  toolName: string;
  purpose: string;
  dependencies: string[];
  inputStrategy: ToolInputStrategy;
  status: ToolCallStatus;
  explicitInputRefs?: string[];
  requestedChanges?: Record<string, unknown>;
};

export type ToolExecutionPlan = {
  planId: string;
  conversationId: string;
  userMessageId?: string;
  userId: string;
  userMessage: string;
  steps: ToolExecutionPlanStep[];
  status: ToolExecutionPlanStatus;
  createdAt: string;
  updatedAt: string;
};

export type ToolExecutionEvent =
  | { type: "plan_created"; planId: string }
  | { type: "tool_call_started"; toolCallId: string; toolKind: ToolKind }
  | { type: "tool_call_waiting_approval"; toolCallId: string }
  | { type: "tool_call_completed"; toolCallId: string; artifactIds: string[] }
  | { type: "tool_call_failed"; toolCallId: string; error: ToolCallError }
  | { type: "plan_completed"; planId: string }
  | { type: "plan_failed"; planId: string };

export type SqlQueryToolInput = {
  userRequest: string;
  dataSourceId?: string;
  sql?: string;
  purpose: string;
  baseToolCallId?: string;
  baseArtifactId?: string;
  requestedChanges?: Record<string, unknown>;
  requireApproval?: boolean;
};

export type SqlQueryToolOutput = {
  toolCallId: string;
  sqlRequestId: string;
  sqlExecutionId?: string;
  status: ToolCallStatus;
  datasetArtifactId?: string;
  datasetProfileArtifactId?: string;
  rowCount?: number;
  columnCount?: number;
  summary?: string;
  version: number;
};

export type PythonAnalysisToolInput = {
  userRequest: string;
  purpose: string;
  inputArtifactIds?: string[];
  sourceSqlToolCallId?: string;
  basePythonToolCallId?: string;
  analysisRules?: string[];
  expectedOutputs?: Array<"summary" | "table" | "statistics" | "chart_data" | "artifact">;
  requireApproval?: boolean;
};

export type PythonAnalysisToolOutput = {
  toolCallId: string;
  pythonRequestId: string;
  pythonExecutionId?: string;
  status: ToolCallStatus;
  analysisArtifactIds: string[];
  chartDataArtifactIds?: string[];
  summaryArtifactId?: string;
  sourceSqlToolCallId?: string;
  version: number;
};

export type ChartRenderingToolInput = {
  userRequest: string;
  purpose: string;
  inputArtifactIds?: string[];
  sourceSqlToolCallId?: string;
  sourcePythonToolCallId?: string;
  baseChartToolCallId?: string;
  visualizationSpec?: Partial<VisualizationSpec>;
  requestedChanges?: {
    chartType?: string;
    title?: string;
    dimensions?: string[];
    measures?: string[];
    orientation?: string;
    aggregation?: string;
    themeMode?: "light" | "dark" | "auto";
    other?: Record<string, unknown>;
  };
};

export type ChartRenderingToolOutput = {
  toolCallId: string;
  status: ToolCallStatus;
  visualizationId?: string;
  visualizationSpecArtifactId?: string;
  chartArtifactIds: string[];
  previewArtifactId?: string;
  sourceSqlToolCallId?: string;
  sourcePythonToolCallId?: string;
  version: number;
};

export type ReportGenerationToolInput = {
  userRequest: string;
  purpose: string;
  title?: string;
  inputArtifactIds?: string[];
  sourceSqlToolCallId?: string;
  sourcePythonToolCallId?: string;
  sourceChartToolCallIds?: string[];
  baseReportToolCallId?: string;
  baseReportArtifactId?: string;
  reportRequirements?: {
    structure?: string[];
    tone?: "formal" | "professional" | "concise" | "detailed";
    includeExecutiveSummary?: boolean;
    includeMethodology?: boolean;
    includeDataScope?: boolean;
    includeCharts?: boolean;
    includeRiskFindings?: boolean;
    includeRecommendations?: boolean;
    includeLimitations?: boolean;
    language?: string;
  };
  requestedChanges?: Record<string, unknown>;
};

export type ReportGenerationToolOutput = {
  toolCallId: string;
  status: ToolCallStatus;
  reportId?: string;
  title: string;
  summary?: string;
  markdownArtifactId?: string;
  includedArtifactIds: string[];
  version: number;
  createdAt: string;
};

export type ToolResultLineage = {
  toolCallId: string;
  parentToolCallIds: string[];
  sourceArtifactIds: string[];
  outputArtifactIds: string[];
};

export type ArtifactDependencyRef = {
  artifactId: string;
  dependentToolCallId: string;
  dependentToolKind: ToolKind;
  dependentVersion: number;
  dependentArtifactIds: string[];
};

export type ToolResultRegistry = {
  register(record: ToolCallRecord): Promise<void>;
  update(toolCallId: string, patch: Partial<ToolCallRecord>): Promise<ToolCallRecord>;
  get(toolCallId: string): Promise<ToolCallRecord | null>;
  listByConversation(conversationId: string): Promise<ToolCallRecord[]>;
  getLatestSuccessful(conversationId: string, toolKind: ToolKind): Promise<ToolCallRecord | null>;
  markLatestSuccessful(conversationId: string, toolCallId: string): Promise<void>;
  selectResult(conversationId: string, toolKind: ToolKind, toolCallId: string): Promise<void>;
  getConversationState(conversationId: string): Promise<ConversationToolState>;
};

export type ConversationToolStateStore = ToolResultRegistry;

export type ArtifactRecord = {
  artifactId: string;
  artifactType: "dataset" | "dataset_profile" | "analysis" | "chart_data" | "chart" | "visualization_spec" | "report_markdown" | "report_summary";
  title?: string;
  contentType: "json" | "markdown" | "text" | "visualization";
  content?: unknown;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type ArtifactManager = {
  createArtifact(input: Omit<ArtifactRecord, "artifactId" | "createdAt"> & { artifactId?: string }): Promise<ArtifactRecord>;
  getArtifact(artifactId: string): Promise<ArtifactRecord | null>;
  listArtifacts?(artifactIds: string[]): Promise<ArtifactRecord[]>;
  deleteArtifact?(artifactId: string): Promise<boolean>;
};

export type ToolBridgeOutput = {
  status: ToolCallStatus;
  artifactIds: string[];
  primaryArtifactId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
};

export type SqlToolBridge = {
  name?: string;
  execute(input: SqlQueryToolInput, context: ToolBridgeContext): Promise<ToolBridgeOutput & Partial<SqlQueryToolOutput>>;
};

export type PythonToolBridge = {
  name?: string;
  execute(input: PythonAnalysisToolInput, context: ToolBridgeContext): Promise<ToolBridgeOutput & Partial<PythonAnalysisToolOutput>>;
};

export type ChartToolBridge = {
  name?: string;
  execute(input: ChartRenderingToolInput, context: ToolBridgeContext): Promise<ToolBridgeOutput & Partial<ChartRenderingToolOutput>>;
};

export type ReportToolBridge = {
  name?: string;
  execute(input: ReportGenerationToolInput, context: ToolBridgeContext): Promise<ToolBridgeOutput & Partial<ReportGenerationToolOutput>>;
};

export type ToolBridgeContext = {
  conversationId: string;
  userId: string;
  planId: string;
  stepId: string;
  toolCallId: string;
  version: number;
  resolvedInput: ResolvedToolInput;
};

export type ToolIntentModelAdapter = {
  detectIntent(input: { conversationId: string; userMessage: string; state: ConversationToolState }): Promise<ToolIntentResult>;
};

export type ToolMemoryBridge = {
  write(input: {
    conversationId: string;
    userId: string;
    type: string;
    summary: string;
    toolCallId?: string;
    artifactIds?: string[];
    version?: number;
    lineage?: ToolResultLineage;
  }): Promise<void>;
};

export type ToolOrchestrationModuleConfig = {
  toolRegistry?: ToolRegistry;
  resultRegistry: ToolResultRegistry;
  artifactManager: ArtifactManager;
  sqlBridge: SqlToolBridge;
  pythonBridge: PythonToolBridge;
  chartBridge: ChartToolBridge;
  reportBridge: ReportToolBridge;
  intentModelAdapter?: ToolIntentModelAdapter;
  stateStore?: ConversationToolStateStore;
  memoryBridge?: ToolMemoryBridge;
  enableParallelExecution?: boolean;
  enableAutoInputResolution?: boolean;
};

export type DetectIntentInput = {
  conversationId: string;
  userMessage: string;
};

export type BuildPlanInput = {
  conversationId: string;
  userId: string;
  userMessage: string;
  userMessageId?: string;
  intentResult?: ToolIntentResult;
};

export type ExecuteSingleToolInput = {
  conversationId: string;
  userId: string;
  userMessage: string;
  toolKind: ToolKind;
  purpose?: string;
  request?: Record<string, unknown>;
};

export type ResolveToolApprovalInput = {
  toolCallId: string;
  approved: boolean;
  userId?: string;
  requestPatch?: Record<string, unknown>;
};

export type ResolveToolInputArgs = {
  conversationId: string;
  toolKind: ToolKind;
  explicitInputRefs?: string[];
};

export type SelectHistoricalResultInput = {
  conversationId: string;
  toolKind: ToolKind;
  toolCallId: string;
};

export const TOOL_NAMES: Record<ToolKind, string> = {
  sql_query: "request_sql_query_execution",
  python_analysis: "request_python_analysis_execution",
  chart_rendering: "request_chart_rendering",
  report_generation: "request_markdown_report_generation",
};

export const TOOL_SCHEMAS: Record<ToolKind, JsonSchema> = {
  sql_query: {
    type: "object",
    required: ["userRequest", "purpose"],
    properties: {
      userRequest: { type: "string" },
      dataSourceId: { type: "string" },
      sql: { type: "string" },
      script: { type: "string" },
      purpose: { type: "string" },
      baseToolCallId: { type: "string" },
      baseArtifactId: { type: "string" },
      requireApproval: { type: "boolean" },
    },
  },
  python_analysis: {
    type: "object",
    required: ["userRequest", "purpose"],
    properties: {
      userRequest: { type: "string" },
      purpose: { type: "string" },
      script: { type: "string" },
      inputArtifactIds: { type: "array", items: { type: "string" } },
      sourceSqlToolCallId: { type: "string" },
      basePythonToolCallId: { type: "string" },
      requireApproval: { type: "boolean" },
    },
  },
  chart_rendering: {
    type: "object",
    required: ["userRequest", "purpose"],
    properties: {
      userRequest: { type: "string" },
      purpose: { type: "string" },
      inputArtifactIds: { type: "array", items: { type: "string" } },
      sourceSqlToolCallId: { type: "string" },
      sourcePythonToolCallId: { type: "string" },
      baseChartToolCallId: { type: "string" },
      visualizationSpec: { type: "object" },
    },
  },
  report_generation: {
    type: "object",
    required: ["userRequest", "purpose"],
    properties: {
      userRequest: { type: "string" },
      purpose: { type: "string" },
      title: { type: "string" },
      inputArtifactIds: { type: "array", items: { type: "string" } },
      sourceSqlToolCallId: { type: "string" },
      sourcePythonToolCallId: { type: "string" },
      sourceChartToolCallIds: { type: "array", items: { type: "string" } },
      baseReportToolCallId: { type: "string" },
      baseReportArtifactId: { type: "string" },
      markdown: { type: "string" },
    },
  },
};
