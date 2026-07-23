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

export type SqlFallbackQueryRequest = {
  userRequest: string;
  sql?: string;
  fullDataRange: boolean;
  reason: string;
};

export type SqlInputResolutionIssue = {
  code: "SQL_RESULT_NOT_FOUND" | "DATA_SOURCE_NOT_SELECTED" | "ACTIVE_TABLE_REQUIRED" | "DATA_SOURCE_UNAVAILABLE" | "SQL_RESULT_EXPIRED";
  message: string;
  recoverable: true;
  suggestedAction: "select_data_source" | "select_table" | "rerun_query" | "upload_csv";
};

export type SqlInputResolution = {
  status: "resolved" | "requires_sql_step" | "requires_user_input";
  source: "explicit_artifact" | "current_round" | "conversation_history" | "artifact_lineage" | "selected_data_source_fallback" | "none";
  sqlToolCallId?: string;
  datasetArtifactId?: string;
  fallbackQueryRequest?: SqlFallbackQueryRequest;
  issue?: SqlInputResolutionIssue;
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

export type AgentOutputGoal = "query" | "analysis" | "chart" | "report";

export type AgentToolIntent = {
  requestType: "single_tool" | "compound";
  goals: Record<AgentOutputGoal, boolean>;
  explicitGoals: Record<AgentOutputGoal, boolean>;
  dataRequirements: {
    requiresSqlResult: boolean;
    canReuseExistingSqlResult: boolean;
  };
  analysisGoal?: string;
  chartGoal?: string;
  reportGoal?: string;
  unresolvedInputs: string[];
};

export type ToolIntentResult = {
  conversationId: string;
  userMessage: string;
  intents: ToolIntentItem[];
  agentIntent?: AgentToolIntent;
  requiresClarification: boolean;
  clarificationQuestion?: string;
  confidence: number;
};

export type ToolExecutionPlanStatus = "draft" | "ready" | "executing" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type ToolInputStrategy = "explicit" | "latest_sql" | "latest_python" | "latest_chart" | "selected_artifacts" | "none";
export type ToolStepInputResolution = "explicit" | "current_round_result" | "conversation_history" | "artifact_lineage" | "auto_sql_fallback";

export type ToolExecutionPlanStep = {
  stepId: string;
  toolKind: ToolKind;
  toolName: string;
  purpose: string;
  dependencies: string[];
  inputStrategy: ToolInputStrategy;
  inputResolution?: ToolStepInputResolution;
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
  requestType?: "single_tool" | "compound";
  requestedOutputs?: AgentOutputGoal[];
  steps: ToolExecutionPlanStep[];
  status: ToolExecutionPlanStatus;
  metrics?: AgentPlanningMetrics;
  createdAt: string;
  updatedAt: string;
};

export type ToolPlanValidationResult = {
  valid: boolean;
  correctedPlan?: ToolExecutionPlan;
  errors: string[];
  warnings: string[];
};

export type AgentPlanningMetrics = {
  conversationId: string;
  messageId?: string;
  requestType: "single_tool" | "compound";
  requestedToolCount: number;
  plannedToolCount: number;
  promptCharacterCount: number;
  planningDurationMs: number;
  planningModelCallCount: number;
  explicitChartRequested: boolean;
  chartToolIncluded: boolean;
  sqlDependencyAutoAdded: boolean;
  reusedExistingSqlResult: boolean;
  createdAt: string;
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
  title?: string;
  chartType?: string;
  dimensionFields?: string[];
  measureFields?: string[];
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  colorBy?: string;
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
  visualizationArtifactIds?: string[];
  includeVisualizations?: boolean;
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
  selectedDataSourceAvailable?: boolean;
  activeTableCount?: number;
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
  selectedDataSourceAvailable?: boolean;
  activeTableCount?: number;
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
    required: ["userRequest", "purpose", "sql"],
    description: "从已授权数据源执行受控只读查询、筛选、字段选择、分组、聚合和排序。无筛选条件的兜底查询表示查询活动表完整数据范围，并通过 Artifact 物化结果；不得使用模拟数据。",
    properties: {
      userRequest: { type: "string", minLength: 1, description: "用户原始查询需求；保留筛选条件、字段和后续分析/绘图/报告目标。" },
      dataSourceId: { type: "string" },
      sql: { type: "string", minLength: 1, description: "必填。单条只读 SQL。需要后续统计、占比、排序、绘图或报告时，应返回后续所需的真实原始字段，避免用聚合压缩样本。" },
      script: { type: "string" },
      purpose: { type: "string", minLength: 1, description: "说明 SQL 的查询目标、字段范围和结果用途。" },
      baseToolCallId: { type: "string" },
      baseArtifactId: { type: "string" },
      requireApproval: { type: "boolean" },
    },
  },
  python_analysis: {
    type: "object",
    required: ["userRequest", "purpose", "script"],
    description: "对已有 SQL 查询结果或具备 SQL 血缘的数据集执行统计、分布、趋势、异常或其他数据分析。不得直接连接业务数据库，不得使用模拟数据。",
    properties: {
      userRequest: { type: "string", minLength: 1 },
      purpose: { type: "string", minLength: 1 },
      script: { type: "string", minLength: 1, description: "必填。只使用标准库和输入数据真实字段的受控 Python 分析脚本。" },
      inputArtifactIds: { type: "array", items: { type: "string" } },
      sourceSqlToolCallId: { type: "string" },
      basePythonToolCallId: { type: "string" },
      requireApproval: { type: "boolean" },
    },
  },
  chart_rendering: {
    type: "object",
    required: ["userRequest", "purpose"],
    anyOf: [
      {
        type: "object",
        required: ["title", "chartType"],
        anyOf: [
          {
            type: "object",
            required: ["dimensionFields"],
            properties: {
              dimensionFields: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
            },
          },
          {
            type: "object",
            required: ["measureFields"],
            properties: {
              measureFields: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
            },
          },
        ],
        properties: {
          title: { type: "string", minLength: 1 },
          chartType: { type: "string" },
        },
      },
      {
        type: "object",
        required: ["visualizationSpec"],
        properties: {
          visualizationSpec: { type: "object" },
        },
      },
    ],
    description: "受控图表生成请求。凡用户要求画图、绘图、图表、可视化、比率图、占比图、横向/纵向条形图、排名图，或要求把已有表格/分析结果变成图表时，应调用 request_chart_rendering。若当前没有可引用 SQL/Python Artifact，且用户同时要求查询/筛选/拆分/区分数据和分析/占比/比率计算，应先调用 SQL 查询和 Python 分析，最后再调用本工具。可提供完整 visualizationSpec，也可提供声明式 chartType、title、dimensionFields、measureFields 等字段，由客户端补全受控 VisualizationSpec。",
    properties: {
      userRequest: { type: "string", minLength: 1, description: "用户原始绘图/可视化需求，保留图表类型、排序、拆分、颜色分级等要求。" },
      purpose: { type: "string", minLength: 1, description: "说明本次图表要表达的分析目的，例如按某个维度展示指标排名、趋势或结构。" },
      title: { type: "string", minLength: 1, description: "必填。图表标题。" },
      chartType: {
        type: "string",
        enum: ["kpi", "line", "area", "bar", "horizontal_bar", "stacked_bar", "bar_line_combo", "scatter", "bubble", "heatmap", "histogram", "pareto", "funnel", "waterfall", "table"],
        description: "图表类型。横向条形图使用 horizontal_bar；普通条形图/柱状图使用 bar；趋势使用 line 或 area。",
      },
      dimensionFields: { type: "array", items: { type: "string", minLength: 1 }, description: "图表维度字段或分析结果中的类别列，例如分组、分类、行业、分行等。" },
      measureFields: { type: "array", items: { type: "string", minLength: 1 }, description: "图表指标字段或分析结果中的数值列，例如数量、金额、占比、比率、百分率等。" },
      sortBy: { type: "string", description: "排序字段，通常为主要指标字段。" },
      sortDirection: { type: "string", enum: ["asc", "desc"], description: "排序方向。降序使用 desc，升序使用 asc。" },
      colorBy: { type: "string", description: "颜色编码字段，可使用维度字段或指标字段。" },
      inputArtifactIds: {
        type: "array",
        items: { type: "string" },
        description: "图表输入 Artifact。优先填入最近一次成功 Python 分析结果 artifactIds；如不存在 Python 分析结果，再填入最近一次 SQL 查询结果 artifactIds。用户明确指定 artifactId 时使用用户指定值。",
      },
      sourceSqlToolCallId: { type: "string", description: "当图表直接基于 SQL 查询结果时，填入来源 SQL toolCallId。" },
      sourcePythonToolCallId: { type: "string", description: "当图表基于 Python 分析结果、汇总表或分析报告数据时，填入来源 Python toolCallId。" },
      baseChartToolCallId: { type: "string", description: "用户要求修改已有图表版本时，填入被修改的 chart_rendering toolCallId。" },
      visualizationSpec: {
        type: "object",
        description: "可选。完整或部分受控 VisualizationSpec，不是 ECharts option。完整协议包含 specVersion、visualizationId、type、title、data、dimensions/measures/encoding、provenance。横向条形图使用 type=horizontal_bar；比率、占比、百分率等字段使用 percentage measure；排序可在 dimension.sort 或 metadata.sort 中表达；颜色分级可用 encoding.colorBy 指向指标字段或 metadata.colorGrading=true 表达。数据必须通过 data.mode=artifact 引用 inputArtifactIds 中的 Artifact，或在已有小型可信聚合结果时使用 data.mode=inline trusted=true rows。",
      },
    },
  },
  report_generation: {
    type: "object",
    required: ["userRequest", "purpose", "markdown"],
    description: "基于真实 SQL、Python 和图表 Artifact 生成 Markdown 报告。用户同时要求图表和报告时，必须引用 visualizationArtifactIds 并在正文嵌入 visualization 节点。",
    properties: {
      userRequest: { type: "string", minLength: 1 },
      purpose: { type: "string", minLength: 1 },
      title: { type: "string" },
      inputArtifactIds: { type: "array", items: { type: "string" } },
      visualizationArtifactIds: { type: "array", items: { type: "string" }, description: "报告正文需要引用的图表 Artifact IDs。" },
      includeVisualizations: { type: "boolean", description: "用户同时要求图表和报告时必须为 true，并在报告正文嵌入 visualization 节点。" },
      sourceSqlToolCallId: { type: "string" },
      sourcePythonToolCallId: { type: "string" },
      sourceChartToolCallIds: { type: "array", items: { type: "string" } },
      baseReportToolCallId: { type: "string" },
      baseReportArtifactId: { type: "string" },
      markdown: { type: "string", minLength: 1, description: "必填。仅依据已授权 Artifact 结果生成的完整 Markdown 报告正文。" },
    },
  },
};
