import { randomUUID } from "node:crypto";
import type { ConversationToolState, ToolCallRecord, ToolKind } from "./toolOrchestration";
import type { ChatCsvSelectedFieldRef, ConversationTempCsvTable } from "./chatCsvTempSource";

export type AgentWorkflowStatus =
  | "draft"
  | "planning"
  | "ready"
  | "executing"
  | "waiting_for_user_input"
  | "waiting_for_parameters"
  | "waiting_for_field_selection"
  | "waiting_for_data_source"
  | "waiting_for_approval"
  | "recoverable_error"
  | "retrying"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type AgentWorkflowIssueCategory =
  | "intent_incomplete"
  | "data_source_missing"
  | "field_missing"
  | "field_ambiguous"
  | "parameter_missing"
  | "parameter_invalid"
  | "approval_required"
  | "approval_rejected"
  | "tool_execution_failed"
  | "tool_execution_timeout"
  | "dataset_empty"
  | "dataset_expired"
  | "permission_denied"
  | "workflow_interrupted"
  | "artifact_missing"
  | "report_input_missing"
  | "system_error";

export type IssueRecoverability =
  | "user_input_required"
  | "parameter_repair"
  | "retryable"
  | "return_to_previous_step"
  | "select_alternative"
  | "not_recoverable";

export type MissingWorkflowInput = {
  key: string;
  label: string;
  type:
    | "data_source"
    | "table"
    | "field"
    | "date_range"
    | "metric"
    | "dimension"
    | "filter"
    | "aggregation"
    | "analysis_rule"
    | "chart_type"
    | "report_requirement"
    | "approval";
  required: boolean;
  description: string;
  candidates?: MissingInputCandidate[];
};

export type MissingInputCandidate = {
  value: string;
  label: string;
  description?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

export type MissingInputDetectionResult = {
  complete: boolean;
  missingInputs: MissingWorkflowInput[];
  warnings: string[];
  nextStatus?: AgentWorkflowStatus;
};

export type InvalidToolParameter = {
  parameterName: string;
  value?: unknown;
  reason: "missing" | "invalid_type" | "out_of_range" | "not_found" | "permission_denied" | "incompatible" | "expired";
  message: string;
  candidates?: MissingInputCandidate[];
};

export type WorkflowRecoveryAction = AgentGuidanceAction;

export type AgentWorkflowIssue = {
  issueId: string;
  workflowId: string;
  conversationId: string;
  stepId?: string;
  toolCallId?: string;
  category: AgentWorkflowIssueCategory;
  recoverability: IssueRecoverability;
  code: AgentWorkflowErrorCode;
  title: string;
  message: string;
  missingInputs?: MissingWorkflowInput[];
  invalidParameters?: InvalidToolParameter[];
  candidateFields?: MissingInputCandidate[];
  availableActions: WorkflowRecoveryAction[];
  preserveCurrentState: boolean;
  userActionRequired: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type AgentGuidance = {
  guidanceId: string;
  workflowId: string;
  conversationId: string;
  type:
    | "clarification"
    | "parameter_request"
    | "field_selection"
    | "data_source_selection"
    | "error_recovery"
    | "next_action"
    | "confirmation";
  title: string;
  message: string;
  requiredInputs?: MissingWorkflowInput[];
  actions: AgentGuidanceAction[];
  blocking: boolean;
  resumeToken?: string;
  createdAt: string;
};

export type AgentGuidanceAction = {
  actionId: string;
  type:
    | "select_candidate"
    | "provide_text"
    | "retry"
    | "edit_parameters"
    | "select_data_source"
    | "select_fields"
    | "return_to_query"
    | "continue_analysis"
    | "create_chart"
    | "generate_report"
    | "cancel_workflow";
  label: string;
  description?: string;
  payload?: Record<string, unknown>;
  primary?: boolean;
  destructive?: boolean;
};

export type WorkflowCheckpoint = {
  checkpointId: string;
  workflowId: string;
  conversationId: string;
  currentStepId?: string;
  status: AgentWorkflowStatus;
  completedStepIds: string[];
  pendingStepIds: string[];
  activeDatasetIds: string[];
  latestSuccessfulToolCallIds: Record<string, string | undefined>;
  artifactIds: string[];
  pendingGuidance?: AgentGuidance;
  activeIssue?: AgentWorkflowIssue;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowResumeToken = {
  token: string;
  workflowId: string;
  conversationId: string;
  stepId: string;
  issueId: string;
  expectedInputKeys: string[];
  expiresAt?: string;
};

export type DataAccuracyPolicy = {
  allowSyntheticDataFallback: false;
  allowModelEstimatedResults: false;
  allowPreviewRowsAsFullDataset: false;
  allowMissingFieldGuessing: false;
  allowFailedToolResultFabrication: false;
  requireToolResultForNumericConclusion: true;
};

export const DEFAULT_DATA_ACCURACY_POLICY: DataAccuracyPolicy = {
  allowSyntheticDataFallback: false,
  allowModelEstimatedResults: false,
  allowPreviewRowsAsFullDataset: false,
  allowMissingFieldGuessing: false,
  allowFailedToolResultFabrication: false,
  requireToolResultForNumericConclusion: true,
};

export type AgentWorkflowErrorCode =
  | "INTENT_INCOMPLETE"
  | "DATA_SOURCE_REQUIRED"
  | "TABLE_REQUIRED"
  | "FIELD_REQUIRED"
  | "FIELD_AMBIGUOUS"
  | "METRIC_REQUIRED"
  | "FILTER_INVALID"
  | "TOOL_PARAMETER_MISSING"
  | "TOOL_PARAMETER_INVALID"
  | "TOOL_APPROVAL_REJECTED"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_EXECUTION_TIMEOUT"
  | "DATASET_EMPTY"
  | "DATASET_EXPIRED"
  | "ARTIFACT_NOT_FOUND"
  | "WORKFLOW_INTERRUPTED"
  | "WORKFLOW_RESUME_FAILED"
  | "REPORT_INPUT_MISSING"
  | "PERMISSION_DENIED"
  | "UNRECOVERABLE_SYSTEM_ERROR"
  | "UNKNOWN_ERROR";

export type MissingInputDetectorInput = {
  conversationId: string;
  workflowId?: string;
  prompt: string;
  dataSourceLabel?: string | null;
  tempSources?: ConversationTempCsvTable[];
  selectedFieldRefs?: ChatCsvSelectedFieldRef[];
  toolState?: ConversationToolState | null;
};

export type WorkflowResumeInput = {
  checkpoint: WorkflowCheckpoint;
  prompt: string;
  dataSourceLabel?: string | null;
  tempSources?: ConversationTempCsvTable[];
  selectedFieldRefs?: ChatCsvSelectedFieldRef[];
  toolState?: ConversationToolState | null;
};

type ClarificationContext = {
  dataSourceLabel?: string | null;
  tempSources?: ConversationTempCsvTable[];
  selectedFieldRefs?: ChatCsvSelectedFieldRef[];
  toolState?: ConversationToolState | null;
};

export type WorkflowResumeResult = {
  canResume: boolean;
  mergedPrompt: string;
  resolvedInputKeys: string[];
  unresolvedInputs: MissingWorkflowInput[];
};

export function nowIso() {
  return new Date().toISOString();
}

function guidanceId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export function buildCompletedToolCheckpoint(input: {
  conversationId: string;
  workflowId: string;
  currentStepId: ToolKind;
  latestSuccessfulToolCallIds: Record<string, string | undefined>;
  artifactIds: string[];
  activeDatasetIds?: string[];
}) {
  const now = nowIso();
  return {
    checkpointId: guidanceId("checkpoint"),
    workflowId: input.workflowId,
    conversationId: input.conversationId,
    currentStepId: input.currentStepId,
    status: "completed" as const,
    completedStepIds: [input.currentStepId],
    pendingStepIds: [],
    activeDatasetIds: input.activeDatasetIds ?? [],
    latestSuccessfulToolCallIds: input.latestSuccessfulToolCallIds,
    artifactIds: input.artifactIds,
    createdAt: now,
    updatedAt: now,
  } satisfies WorkflowCheckpoint;
}

export function isWorkflowCancellationPrompt(prompt: string) {
  return /^(取消|停止|放弃|不做了|结束本轮任务|不用继续了)[。！!.\s]*$/i.test(prompt.trim());
}

export function cancelWorkflowCheckpoint(input: { checkpoint: WorkflowCheckpoint; reason?: string }) {
  return {
    ...input.checkpoint,
    status: "cancelled" as const,
    pendingGuidance: undefined,
    activeIssue: undefined,
    updatedAt: nowIso(),
  } satisfies WorkflowCheckpoint;
}

function asksForDataWork(prompt: string) {
  return /(查询|查一下|统计|汇总|计数|总计|数量|笔数|条数|个数|多少\s*(例|笔|条|个)?|各有多少|共有多少|分析|分布|占比|比例|绘制|图表|可视化|报告|看看).{0,80}(数据|字段|分布|报告|图表|风险|贷款|分类)?/i.test(prompt);
}

function asksForReport(prompt: string) {
  return /(生成|输出|形成|撰写|出具).{0,20}(分析)?报告|分析报告/i.test(prompt);
}

function asksForDistribution(prompt: string) {
  return /(分布|分类|占比|比例|汇总|统计|计数|总计|数量|笔数|条数|个数|多少\s*(例|笔|条|个)?|各有多少|共有多少|风险)/i.test(prompt);
}

function asksForChart(prompt: string) {
  return /(图表|绘制|可视化|柱状图|折线图|饼图|散点图)/i.test(prompt);
}

function asksForGenericLookup(prompt: string) {
  return /^(查一下|查询|看看|看一下|分析)(这个|一下|当前|这些|所选|选择的)?(数据|表|数据源)[。！？!?\s]*$/i.test(prompt.trim());
}

function asksForTemporalScope(prompt: string) {
  return /(趋势|按(日|月|季|年)|期间|时间范围|日期范围|到期分布|期限分布)/i.test(prompt);
}

function hasExplicitDateRange(prompt: string) {
  return /(今天|昨日|昨天|本日|本周|本月|本季|今年|上月|上季|去年|近\s*\d+\s*(天|日|周|个月|月|季|年)|最近\s*\d+\s*(天|日|周|个月|月|季|年)|\d{4}[-/年]\d{1,2}|\d{4}\s*年|截至|截止|至\s*\d{4})/i.test(prompt);
}

function asksForAmountMetric(prompt: string) {
  return /(金额|余额|贷款余额|合同金额|本金|敞口|amount|balance)/i.test(prompt);
}

function asksForSpecificChartType(prompt: string) {
  return /(柱状图|条形图|折线图|趋势图|饼图|环形图|散点图|气泡图|热力图|漏斗图|瀑布图|帕累托|表格)/i.test(prompt);
}

function referencesPriorAnalysisResult(prompt: string) {
  return /(数据分析结果|分析结果|python\s*分析结果|工具分析结果|上一轮分析|最近分析|当前分析|当前结果|刚才的结果|上一轮结果)/i.test(prompt);
}

function explicitlyRequestsFreshData(prompt: string) {
  return /(重新查询|重新查|再查询|再查|重新检索|重新获取|重新读取|重新分析|重新统计|重新计算)/i.test(prompt);
}

function hasAnyDataSource(input: MissingInputDetectorInput) {
  return Boolean(input.dataSourceLabel?.trim()) || Boolean(input.tempSources?.length);
}

function hasAnalysisResult(toolState?: ConversationToolState | null) {
  return Boolean(toolState?.latestSuccessfulPythonToolCallId || toolState?.latestSuccessfulSqlToolCallId || toolState?.latestSuccessfulReportToolCallId);
}

function hasSqlOrPythonResult(toolState?: ConversationToolState | null) {
  return Boolean(toolState?.latestSuccessfulPythonToolCallId || toolState?.latestSuccessfulSqlToolCallId);
}

function hasReportInputResult(toolState?: ConversationToolState | null) {
  return Boolean(toolState?.latestSuccessfulReportToolCallId || toolState?.latestSuccessfulChartToolCallId || toolState?.latestSuccessfulPythonToolCallId || toolState?.latestSuccessfulSqlToolCallId);
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyStringArray(value: unknown) {
  return Array.isArray(value) && value.some((item) => nonEmptyString(item));
}

function isInvalidArtifactArray(value: unknown) {
  return value !== undefined && (!Array.isArray(value) || !value.every((item) => nonEmptyString(item)));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasTrustedInlineRows(visualizationSpec: unknown) {
  if (!isPlainRecord(visualizationSpec)) {
    return false;
  }
  const data = visualizationSpec.data;
  if (!isPlainRecord(data)) {
    return false;
  }
  return data.mode === "inline" && data.trusted === true && Array.isArray(data.rows) && data.rows.length > 0;
}

function hasArtifactVisualizationData(visualizationSpec: unknown) {
  if (!isPlainRecord(visualizationSpec)) {
    return false;
  }
  const data = visualizationSpec.data;
  if (!isPlainRecord(data)) {
    return false;
  }
  return data.mode === "artifact" && nonEmptyString(data.artifactId);
}

function promptMentionsCandidate(prompt: string, input: MissingWorkflowInput) {
  return Boolean(
    input.candidates?.some((candidate) =>
      prompt.includes(candidate.label) ||
      prompt.includes(candidate.value) ||
      (typeof candidate.description === "string" && prompt.includes(candidate.description)),
    ),
  );
}

function normalizeFieldReferenceText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[（(][^（）()]*[）)]/gu, "")
    .replace(/[\s"'“”‘’`.,，。；;:：!?！？、/\\|()[\]{}<>《》【】]+/gu, "");
}

function promptMentionsColumn(prompt: string, column: ConversationTempCsvTable["columns"][number]) {
  const compactPrompt = normalizeFieldReferenceText(prompt);
  return [column.displayName, column.sourceHeader, column.sqliteColumnName].some((value) => {
    const compactValue = normalizeFieldReferenceText(value ?? "");
    return compactValue.length > 0 && compactPrompt.includes(`#${compactValue}`);
  });
}

type PromptFieldReference = {
  rawText: string;
  query: string;
};

function extractPromptFieldReferences(prompt: string): PromptFieldReference[] {
  const references: PromptFieldReference[] = [];
  const seen = new Set<string>();
  const startPattern = /(^|[\s，。；;,.!?！？、（(])#/gu;
  let match: RegExpExecArray | null;
  while ((match = startPattern.exec(prompt)) !== null) {
    const hashIndex = match.index + match[1].length;
    let cursor = hashIndex + 1;
    while (cursor < prompt.length && !/[\s#，。；;,.!?！？、"'“”‘’`\n\r\t]/u.test(prompt[cursor])) {
      cursor += 1;
    }
    const query = prompt.slice(hashIndex + 1, cursor).trim();
    if (!query || /^https?:\/\//iu.test(prompt.slice(Math.max(0, hashIndex - 12), cursor))) {
      continue;
    }
    const rawText = prompt.slice(hashIndex, cursor);
    const key = normalizeFieldReferenceText(rawText);
    if (!seen.has(key)) {
      references.push({ rawText, query });
      seen.add(key);
    }
  }
  return references;
}

function columnReferenceValues(column: ConversationTempCsvTable["columns"][number]) {
  return [column.displayName, column.sourceHeader, column.sqliteColumnName].filter((value): value is string => Boolean(value?.trim()));
}

function hasExactColumnReference(reference: PromptFieldReference, column: ConversationTempCsvTable["columns"][number]) {
  const compactReference = normalizeFieldReferenceText(reference.query);
  return columnReferenceValues(column).some((value) => {
    const compactValue = normalizeFieldReferenceText(value);
    return compactValue.length > 0 && (compactReference === compactValue || compactReference.includes(compactValue));
  });
}

function characterDice(left: string, right: string) {
  const leftChars = Array.from(new Set(left));
  const rightChars = new Set(Array.from(right));
  if (leftChars.length === 0 || rightChars.size === 0) {
    return 0;
  }
  const overlap = leftChars.filter((char) => rightChars.has(char)).length;
  return (2 * overlap) / (leftChars.length + rightChars.size);
}

function fieldReferenceSimilarity(reference: string, value: string) {
  const left = normalizeFieldReferenceText(reference);
  const right = normalizeFieldReferenceText(value);
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if (left.includes(right) || right.includes(left)) {
    return 0.92 * (Math.min(left.length, right.length) / Math.max(left.length, right.length));
  }
  return characterDice(left, right);
}

function similarFieldCandidates(input: MissingInputDetectorInput, reference: PromptFieldReference) {
  const candidates = input.tempSources?.flatMap((source) =>
    source.columns.map((column) => {
      const score = Math.max(...columnReferenceValues(column).map((value) => fieldReferenceSimilarity(reference.query, value)));
      return {
        value: column.sqliteColumnName,
        label: column.displayName,
        description: `疑似匹配 ${reference.rawText} · ${source.fileName} · ${column.sqliteType}`,
        confidence: score,
        metadata: {
          tempDataSourceId: source.tempDataSourceId,
          sqliteTableName: source.sqliteTableName,
          logicalType: column.inferredLogicalType,
          sqliteType: column.sqliteType,
          rawReference: reference.rawText,
          sampleValues: column.sampleValues?.slice(0, 3),
        },
      } satisfies MissingInputCandidate;
    }),
  ) ?? [];
  return candidates
    .filter((candidate) => (candidate.confidence ?? 0) >= 0.42)
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))
    .slice(0, 5);
}

function unresolvedPromptFieldReferences(input: MissingInputDetectorInput) {
  if (!input.tempSources?.length) {
    return [];
  }
  const sourceColumns = input.tempSources.flatMap((source) => source.columns);
  return extractPromptFieldReferences(input.prompt)
    .filter((reference) => !sourceColumns.some((column) => hasExactColumnReference(reference, column)))
    .map((reference) => ({ reference, candidates: similarFieldCandidates(input, reference) }));
}

function promptMentionsAnySourceField(input: MissingInputDetectorInput) {
  return Boolean(input.tempSources?.some((source) =>
    source.columns.some((column) => promptMentionsColumn(input.prompt, column)),
  ));
}

function isMetricColumn(column: ConversationTempCsvTable["columns"][number]) {
  const text = `${column.displayName}\n${column.sourceHeader}\n${column.sqliteColumnName}\n${column.inferredLogicalType}\n${column.sqliteType}`;
  return /(金额|余额|本金|敞口|amount|balance|principal|decimal|number|integer|real|int|numeric)/i.test(text);
}

function promptMentionsMetricField(input: MissingInputDetectorInput) {
  return Boolean(input.tempSources?.some((source) =>
    source.columns.some((column) => isMetricColumn(column) && promptMentionsColumn(input.prompt, column)),
  ));
}

function fieldCandidates(input: MissingInputDetectorInput) {
  const fields = input.tempSources?.flatMap((source) =>
    source.columns.map((column) => {
      const text = `${column.displayName}\n${column.sourceHeader}\n${column.sqliteColumnName}`;
      const confidence =
        /(五级|十二级|风险|分类|等级|risk|class|level|status)/i.test(text) ? 0.9 :
          /(金额|余额|amount|balance|本金)/i.test(text) ? 0.7 :
            0.45;
      return {
        value: column.sqliteColumnName,
        label: column.displayName,
        description: `${source.fileName} · ${column.sqliteType}`,
        confidence,
        metadata: {
          tempDataSourceId: source.tempDataSourceId,
          sqliteTableName: source.sqliteTableName,
          logicalType: column.inferredLogicalType,
          sqliteType: column.sqliteType,
          sampleValues: column.sampleValues?.slice(0, 3),
        },
      } satisfies MissingInputCandidate;
    }),
  ) ?? [];
  return fields.sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0)).slice(0, 8);
}

function metricCandidates(input: MissingInputDetectorInput) {
  const fields = fieldCandidates(input);
  return fields
    .map((field) => {
      const text = `${field.label}\n${field.value}\n${field.description ?? ""}\n${String(field.metadata?.logicalType ?? "")}\n${String(field.metadata?.sqliteType ?? "")}`;
      const confidence =
        /(金额|余额|本金|敞口|amount|balance|principal)/i.test(text) ? 0.92 :
          /(decimal|number|integer|real|int|numeric)/i.test(text) ? 0.72 :
            0.35;
      return { ...field, confidence };
    })
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))
    .slice(0, 8);
}

function hasSelectedValidField(input: MissingInputDetectorInput) {
  return (input.selectedFieldRefs?.filter((field) => field.status === "valid").length ?? 0) > 0;
}

function hasSelectedMetricField(input: MissingInputDetectorInput) {
  return Boolean(input.selectedFieldRefs?.some((field) => {
    if (field.status !== "valid") {
      return false;
    }
    const text = `${field.displayName}\n${field.physicalName}\n${field.logicalType}\n${field.sqliteType}`;
    return /(金额|余额|本金|敞口|amount|balance|principal|decimal|number|integer|real|int|numeric)/i.test(text);
  })) || promptMentionsMetricField(input);
}

export class MissingInputDetector {
  detect(input: MissingInputDetectorInput): MissingInputDetectionResult {
    const prompt = input.prompt.trim();
    const missingInputs: MissingWorkflowInput[] = [];
    const warnings: string[] = [];
    const selectedFieldCount = input.selectedFieldRefs?.filter((field) => field.status === "valid").length ?? 0;
    const canUsePriorQueryForAnalysis = !explicitlyRequestsFreshData(prompt) && asksForDataWork(prompt) && !asksForChart(prompt) && !asksForReport(prompt) && hasSqlOrPythonResult(input.toolState);
    const canUsePriorAnalysisForChart = !explicitlyRequestsFreshData(prompt) && asksForChart(prompt) && hasSqlOrPythonResult(input.toolState);
    const canUsePriorArtifactsForReport = !explicitlyRequestsFreshData(prompt) && asksForReport(prompt) && hasReportInputResult(input.toolState);
    const canUsePriorResult = canUsePriorQueryForAnalysis || canUsePriorAnalysisForChart || canUsePriorArtifactsForReport || (referencesPriorAnalysisResult(prompt) && hasSqlOrPythonResult(input.toolState));
    const unresolvedFieldReferences = unresolvedPromptFieldReferences(input);
    const hasUnresolvedFieldReferences = unresolvedFieldReferences.length > 0;
    const canBuildReportFromCurrentDataRequest =
      asksForReport(prompt) &&
      hasAnyDataSource(input) &&
      asksForDataWork(prompt) &&
      (asksForDistribution(prompt) || asksForAmountMetric(prompt) || /(查询|统计|汇总|分析|占比|比例)/i.test(prompt)) &&
      (hasSelectedValidField(input) || promptMentionsAnySourceField(input)) &&
      !hasUnresolvedFieldReferences;

    if (!asksForDataWork(prompt)) {
      missingInputs.push({
        key: "analysis_goal",
        label: "分析目标",
        type: "analysis_rule",
        required: true,
        description: "请说明希望查询、统计、绘图还是生成报告。",
      });
    }

    if (asksForDataWork(prompt) && !hasAnyDataSource(input) && !canUsePriorResult) {
      missingInputs.push({
        key: "data_source",
        label: "数据源",
        type: "data_source",
        required: true,
        description: "需要选择一个可访问的数据源或上传 CSV，才能执行真实查询和分析。",
      });
    }

    for (const { reference, candidates } of unresolvedFieldReferences) {
      missingInputs.push({
        key: `field_reference:${reference.rawText}`,
        label: `字段 ${reference.rawText}`,
        type: "field",
        required: true,
        description: candidates.length > 0
          ? `当前数据源中不存在 ${reference.rawText}，请从语义相近的推荐字段中选择真实字段。`
          : `当前数据源中不存在 ${reference.rawText}，也没有找到足够相近的推荐字段，请重新输入真实字段名。`,
        candidates,
      });
    }

    if (hasAnyDataSource(input) && asksForGenericLookup(prompt) && !hasSelectedValidField(input) && !promptMentionsAnySourceField(input) && !hasUnresolvedFieldReferences) {
      const candidates = fieldCandidates(input);
      missingInputs.push({
        key: "query_target",
        label: "查询对象",
        type: "field",
        required: true,
        description: "当前只知道要查看数据，但还缺少要查看的字段、筛选条件或输出范围。请选择字段或补充查询条件。",
        candidates,
      });
      if (candidates.length === 0) {
        warnings.push("当前数据源没有可展示的候选字段，请检查数据源字段清单。");
      }
    }

    if (asksForReport(prompt) && !hasReportInputResult(input.toolState) && !canBuildReportFromCurrentDataRequest) {
      missingInputs.push({
        key: "report_input",
        label: "报告输入结果",
        type: "report_requirement",
        required: true,
        description: "当前没有已成功的 SQL/Python/图表结果，不能生成带具体结论的报告。",
      });
    }

    if (hasAnyDataSource(input) && asksForDistribution(prompt) && selectedFieldCount === 0 && !promptMentionsAnySourceField(input) && !hasUnresolvedFieldReferences && !asksForReport(prompt) && !canUsePriorResult) {
      const candidates = fieldCandidates(input);
      missingInputs.push({
        key: "classification_or_dimension_field",
        label: "分组字段",
        type: "field",
        required: true,
        description: "需要确认用于统计分布或占比的字段，系统不会自动猜测关键业务字段。",
        candidates,
      });
      if (candidates.length === 0) {
        warnings.push("当前数据源没有可展示的候选字段，请检查数据源字段清单。");
      }
    }

    if (hasAnyDataSource(input) && asksForAmountMetric(prompt) && !hasSelectedMetricField(input) && !hasUnresolvedFieldReferences && !asksForReport(prompt) && !canUsePriorResult) {
      missingInputs.push({
        key: "amount_metric_field",
        label: "金额指标字段",
        type: "metric",
        required: true,
        description: "用户要求金额或余额维度，但还未确认用于汇总的数值字段。请选择贷款余额、合同金额、本金或其他数值指标字段。",
        candidates: metricCandidates(input),
      });
    }

    if (hasAnyDataSource(input) && asksForTemporalScope(prompt) && !hasExplicitDateRange(prompt) && !canUsePriorResult) {
      missingInputs.push({
        key: "date_range",
        label: "时间范围",
        type: "date_range",
        required: true,
        description: "当前需求涉及趋势、期间或到期分布，但缺少明确时间范围。请补充起止日期、月份、季度或“近 N 个月”等范围。",
      });
    }

    if (asksForChart(prompt) && !hasSqlOrPythonResult(input.toolState)) {
      missingInputs.push({
        key: "chart_input",
        label: "图表输入数据",
        type: "report_requirement",
        required: true,
        description: "绘制图表前需要先获得真实查询或分析结果。",
      });
    }

    if (asksForChart(prompt) && !asksForSpecificChartType(prompt)) {
      missingInputs.push({
        key: "chart_type",
        label: "图表类型",
        type: "chart_type",
        required: true,
        description: "当前只表达了绘图或可视化意图，但没有明确图表类型。请说明柱状图、折线图、饼图、表格或其他图表类型。",
      });
    }

    const nextStatus = missingInputs.find((item) => item.type === "data_source")
      ? "waiting_for_data_source"
      : missingInputs.find((item) => item.type === "field")
        ? "waiting_for_field_selection"
        : missingInputs.length > 0
          ? "waiting_for_parameters"
          : undefined;

    return {
      complete: missingInputs.length === 0,
      missingInputs,
      warnings,
      nextStatus,
    };
  }
}

export class ParameterRepairEngine {
  validateToolRequest(input: { toolKind: ToolKind; request: Record<string, unknown>; toolState?: ConversationToolState | null }) {
    const invalidParameters: InvalidToolParameter[] = [];

    if (input.request.userRequest !== undefined && !nonEmptyString(input.request.userRequest)) {
      invalidParameters.push({
        parameterName: "userRequest",
        value: input.request.userRequest,
        reason: "invalid_type",
        message: "工具请求中的 userRequest 必须是非空字符串，用于保留用户原始需求。",
      });
    }

    if (input.request.purpose !== undefined && !nonEmptyString(input.request.purpose)) {
      invalidParameters.push({
        parameterName: "purpose",
        value: input.request.purpose,
        reason: "invalid_type",
        message: "工具请求中的 purpose 必须是非空字符串，用于说明本步骤目标。",
      });
    }

    if (isInvalidArtifactArray(input.request.inputArtifactIds)) {
      invalidParameters.push({
        parameterName: "inputArtifactIds",
        value: input.request.inputArtifactIds,
        reason: "invalid_type",
        message: "inputArtifactIds 必须是非空字符串数组，且每个值都引用已授权 Artifact。",
      });
    }

    if (input.toolKind === "sql_query") {
      const script = input.request.sql ?? input.request.script;
      if (script === undefined || (typeof script === "string" && script.trim().length === 0)) {
        invalidParameters.push({
          parameterName: "sql",
          reason: "missing",
          message: "SQL 查询工具缺少 sql 参数，需要提供单条只读 SQL。",
        });
      } else if (typeof script !== "string") {
        invalidParameters.push({
          parameterName: "sql",
          value: script,
          reason: "invalid_type",
          message: "SQL 查询工具的 sql 参数必须是字符串。",
        });
      }
    }

    if (input.toolKind === "python_analysis") {
      const hasInput = hasSqlOrPythonResult(input.toolState) || hasNonEmptyStringArray(input.request.inputArtifactIds);
      if (!hasInput) {
        invalidParameters.push({
          parameterName: "inputArtifactIds",
          reason: "missing",
          message: "Python 分析缺少可分析的 SQL/Python 结果或数据集。请先执行查询，或指定已授权 Artifact。",
        });
      }
      if (input.request.script !== undefined && !nonEmptyString(input.request.script)) {
        invalidParameters.push({
          parameterName: "script",
          value: input.request.script,
          reason: "invalid_type",
          message: "Python 分析脚本必须是非空字符串；如需自动分析，请先确保存在真实上游数据集。",
        });
      }
    }

    if (input.toolKind === "chart_rendering") {
      const hasInput =
        hasSqlOrPythonResult(input.toolState) ||
        hasNonEmptyStringArray(input.request.inputArtifactIds) ||
        hasArtifactVisualizationData(input.request.visualizationSpec) ||
        hasTrustedInlineRows(input.request.visualizationSpec);
      if (!hasInput) {
        invalidParameters.push({
          parameterName: "inputArtifactIds",
          reason: "missing",
          message: "图表生成缺少真实数据输入。请先完成 SQL/Python 工具，指定 Artifact，或提供可信小型 inline rows。",
        });
      }
      if (!isPlainRecord(input.request.visualizationSpec)) {
        invalidParameters.push({
          parameterName: "visualizationSpec",
          value: input.request.visualizationSpec,
          reason: "missing",
          message: "图表生成需要提供合法 visualizationSpec 对象。",
        });
      } else {
        if (!nonEmptyString(input.request.visualizationSpec.title)) {
          invalidParameters.push({
            parameterName: "visualizationSpec.title",
            value: input.request.visualizationSpec.title,
            reason: "missing",
            message: "visualizationSpec 缺少图表标题 title。",
          });
        }
        if (!nonEmptyString(input.request.visualizationSpec.type)) {
          invalidParameters.push({
            parameterName: "visualizationSpec.type",
            value: input.request.visualizationSpec.type,
            reason: "missing",
            message: "visualizationSpec 缺少图表类型 type。",
          });
        }
        const dimensions = input.request.visualizationSpec.dimensions;
        const measures = input.request.visualizationSpec.measures;
        const encoding = input.request.visualizationSpec.encoding;
        const hasEncoding = isPlainRecord(encoding) && Object.keys(encoding).length > 0;
        if ((!Array.isArray(dimensions) || dimensions.length === 0) && (!Array.isArray(measures) || measures.length === 0) && !hasEncoding) {
          invalidParameters.push({
            parameterName: "visualizationSpec.encoding",
            reason: "incompatible",
            message: "visualizationSpec 至少需要明确维度、指标或编码字段；不能让系统猜测图表字段。",
          });
        }
      }
    }

    if (input.toolKind === "report_generation") {
      const hasMarkdown = nonEmptyString(input.request.markdown);
      const hasInput = hasReportInputResult(input.toolState) || hasNonEmptyStringArray(input.request.inputArtifactIds);
      if (!hasMarkdown && !hasInput) {
        invalidParameters.push({
          parameterName: "inputArtifactIds",
          reason: "missing",
          message: "报告生成缺少真实查询、分析或图表结果。请先查询/分析数据，或指定可引用的 Artifact。",
        });
      }
      if (input.request.markdown !== undefined && !nonEmptyString(input.request.markdown)) {
        invalidParameters.push({
          parameterName: "markdown",
          value: input.request.markdown,
          reason: "missing",
          message: "markdown 字段为空，不能生成空报告或带虚构结论的报告。",
        });
      }
      if (input.request.title !== undefined && !nonEmptyString(input.request.title)) {
        invalidParameters.push({
          parameterName: "title",
          value: input.request.title,
          reason: "invalid_type",
          message: "报告标题 title 必须是非空字符串。",
        });
      }
    }
    return { valid: invalidParameters.length === 0, invalidParameters };
  }
}

export class GuidanceEngine {
  buildClarification(input: {
    conversationId: string;
    workflowId?: string;
    detection: MissingInputDetectionResult;
    prompt: string;
    context?: ClarificationContext;
  }): { guidance: AgentGuidance; issue: AgentWorkflowIssue; checkpoint: WorkflowCheckpoint } {
    const createdAt = nowIso();
    const workflowId = input.workflowId ?? guidanceId("workflow");
    const issueId = guidanceId("issue");
    const resumeToken = guidanceId("resume");
    const primaryMissing = input.detection.missingInputs[0];
    const actions = actionsForMissingInputs(input.detection.missingInputs);
    const guidance: AgentGuidance = {
      guidanceId: guidanceId("guidance"),
      workflowId,
      conversationId: input.conversationId,
      type: guidanceTypeFor(primaryMissing),
      title: titleForMissingInput(primaryMissing),
      message: buildMissingInputMessage(input.detection.missingInputs, input.detection.warnings, input.context),
      requiredInputs: input.detection.missingInputs,
      actions,
      blocking: true,
      resumeToken,
      createdAt,
    };
    const issue: AgentWorkflowIssue = {
      issueId,
      workflowId,
      conversationId: input.conversationId,
      category: categoryForMissingInput(primaryMissing),
      recoverability: "user_input_required",
      code: codeForMissingInput(primaryMissing),
      title: guidance.title,
      message: guidance.message,
      missingInputs: input.detection.missingInputs,
      candidateFields: input.detection.missingInputs.flatMap((item) => item.candidates ?? []),
      availableActions: actions,
      preserveCurrentState: true,
      userActionRequired: true,
      createdAt,
      metadata: { prompt: input.prompt },
    };
    const checkpoint: WorkflowCheckpoint = {
      checkpointId: guidanceId("checkpoint"),
      workflowId,
      conversationId: input.conversationId,
      status: input.detection.nextStatus ?? "waiting_for_user_input",
      completedStepIds: [],
      pendingStepIds: ["user_input"],
      activeDatasetIds: [],
      latestSuccessfulToolCallIds: {},
      artifactIds: [],
      pendingGuidance: guidance,
      activeIssue: issue,
      createdAt,
      updatedAt: createdAt,
    };
    return { guidance, issue, checkpoint };
  }

  buildParameterRepair(input: {
    conversationId: string;
    workflowId?: string;
    toolKind: ToolKind;
    invalidParameters: InvalidToolParameter[];
  }) {
    const createdAt = nowIso();
    const workflowId = input.workflowId ?? guidanceId("workflow");
    const issueId = guidanceId("issue");
    const hasInvalidParameter = input.invalidParameters.some((item) => item.reason !== "missing");
    const actions = [
      action("edit_parameters", "补充或修改参数", true),
      action("return_to_query", "返回上一步"),
      action("cancel_workflow", "取消本轮任务", false, true),
    ];
    const guidance: AgentGuidance = {
      guidanceId: guidanceId("guidance"),
      workflowId,
      conversationId: input.conversationId,
      type: "parameter_request",
      title: "工具参数需要修复",
      message: [
        "当前工具调用尚未执行，因为存在可修复的参数问题：",
        "",
        ...input.invalidParameters.map((item) => `- ${item.parameterName}：${item.message}`),
        "",
        "请补充上述参数，或返回上一步重新选择字段/数据源。",
      ].join("\n"),
      requiredInputs: input.invalidParameters.map((item) => ({
        key: item.parameterName,
        label: item.parameterName,
        type: "field",
        required: true,
        description: item.message,
        candidates: item.candidates,
      })),
      actions,
      blocking: true,
      resumeToken: guidanceId("resume"),
      createdAt,
    };
    const issue: AgentWorkflowIssue = {
      issueId,
      workflowId,
      conversationId: input.conversationId,
      category: hasInvalidParameter ? "parameter_invalid" : "parameter_missing",
      recoverability: "parameter_repair",
      code: hasInvalidParameter ? "TOOL_PARAMETER_INVALID" : "TOOL_PARAMETER_MISSING",
      title: guidance.title,
      message: guidance.message,
      invalidParameters: input.invalidParameters,
      availableActions: actions,
      preserveCurrentState: true,
      userActionRequired: true,
      createdAt,
      metadata: { toolKind: input.toolKind },
    };
    return { guidance, issue };
  }
}

export class WorkflowRecoveryManager {
  cancel(input: { checkpoint: WorkflowCheckpoint; reason?: string }) {
    return cancelWorkflowCheckpoint(input);
  }

  resumeWithInput(input: WorkflowResumeInput): WorkflowResumeResult {
    const guidance = input.checkpoint.pendingGuidance;
    const requiredInputs = guidance?.requiredInputs ?? input.checkpoint.activeIssue?.missingInputs ?? [];
    const prompt = input.prompt.trim();
    const resolvedInputKeys: string[] = [];
    const unresolvedInputs: MissingWorkflowInput[] = [];

    for (const required of requiredInputs) {
      const resolved = this.inputResolved(required, input, prompt);
      if (resolved) {
        resolvedInputKeys.push(required.key);
      } else {
        unresolvedInputs.push(required);
      }
    }

    const originalPrompt = typeof input.checkpoint.activeIssue?.metadata?.prompt === "string"
      ? input.checkpoint.activeIssue.metadata.prompt
      : "";
    const mergedPrompt = originalPrompt && prompt
      ? `原始需求：${originalPrompt}\n用户补充：${prompt}\n请基于原始需求和本轮补充继续工作流，不要求用户重新描述已提供的信息。`
      : prompt || originalPrompt;

    return {
      canResume: requiredInputs.length > 0 && unresolvedInputs.length === 0,
      mergedPrompt,
      resolvedInputKeys,
      unresolvedInputs,
    };
  }

  private inputResolved(required: MissingWorkflowInput, input: WorkflowResumeInput, prompt: string) {
    if (required.type === "data_source") {
      return Boolean(input.dataSourceLabel?.trim()) || Boolean(input.tempSources?.length);
    }
    if (required.type === "field" || required.type === "dimension" || required.type === "metric") {
      const selectedFieldCount = input.selectedFieldRefs?.filter((field) => field.status === "valid").length ?? 0;
      return selectedFieldCount > 0 || promptMentionsCandidate(prompt, required);
    }
    if (required.type === "report_requirement" || required.key === "chart_input") {
      return hasAnalysisResult(input.toolState) || /(先|继续|执行|查询|分析|上传|选择).{0,20}(查询|分析|数据源|CSV|数据|结果)/i.test(prompt);
    }
    if (required.type === "approval") {
      return /(同意|批准|允许|确认|继续|执行)/i.test(prompt);
    }
    return prompt.length > 0;
  }
}

export class NextActionRecommender {
  recommend(input: { conversationId: string; workflowId?: string; toolKind: ToolKind; record?: ToolCallRecord | null; rowCount?: number; columnCount?: number }) {
    void input;
    return null;
  }
}

export class ToolErrorRecoveryManager {
  handleToolError(input: { conversationId: string; workflowId?: string; toolKind: ToolKind; message: string; toolCallId?: string }) {
    const createdAt = nowIso();
    const workflowId = input.workflowId ?? guidanceId("workflow");
    const classified = classifyToolError(input.message);
    const actions = recoveryActionsFor(input.toolKind, input.message);
    const guidance: AgentGuidance = {
      guidanceId: guidanceId("guidance"),
      workflowId,
      conversationId: input.conversationId,
      type: "error_recovery",
      title: "工作流遇到可恢复问题",
      message: [
        `${toolLabel(input.toolKind)}未完成。`,
        "",
        `原因：${input.message}`,
        "",
        "可选恢复操作：",
        ...actions.map((item) => `- ${item.label}`),
      ].join("\n"),
      actions,
      blocking: true,
      resumeToken: guidanceId("resume"),
      createdAt,
    };
    const issue: AgentWorkflowIssue = {
      issueId: guidanceId("issue"),
      workflowId,
      conversationId: input.conversationId,
      toolCallId: input.toolCallId,
      category: classified.category,
      recoverability: classified.recoverability,
      code: classified.code,
      title: guidance.title,
      message: guidance.message,
      availableActions: actions,
      preserveCurrentState: true,
      userActionRequired: true,
      createdAt,
      metadata: { toolKind: input.toolKind },
    };
    return { guidance, issue };
  }

  handleApprovalRejected(input: { conversationId: string; workflowId?: string; toolKind: ToolKind; toolCallId?: string }) {
    const createdAt = nowIso();
    const workflowId = input.workflowId ?? guidanceId("workflow");
    const actions = [
      action("edit_parameters", "修改参数后重新提交", true),
      action("return_to_query", "返回修改查询条件"),
      action("select_data_source", "更换数据源"),
      action("cancel_workflow", "取消本轮任务", false, true),
    ];
    const guidance: AgentGuidance = {
      guidanceId: guidanceId("guidance"),
      workflowId,
      conversationId: input.conversationId,
      type: "error_recovery",
      title: "工具审批已拒绝，工作流已暂停",
      message: [
        `${toolLabel(input.toolKind)}未执行，因为本次工具调用审批被拒绝。`,
        "",
        "已完成的工具结果和数据集会继续保留。可以修改参数后重新提交、更换数据源，或取消本轮任务。",
      ].join("\n"),
      actions,
      blocking: true,
      resumeToken: guidanceId("resume"),
      createdAt,
    };
    const issue: AgentWorkflowIssue = {
      issueId: guidanceId("issue"),
      workflowId,
      conversationId: input.conversationId,
      toolCallId: input.toolCallId,
      category: "approval_rejected",
      recoverability: "return_to_previous_step",
      code: "TOOL_APPROVAL_REJECTED",
      title: guidance.title,
      message: guidance.message,
      availableActions: actions,
      preserveCurrentState: true,
      userActionRequired: true,
      createdAt,
      metadata: { toolKind: input.toolKind },
    };
    return { guidance, issue };
  }
}

export class SQLiteWorkflowCheckpointStore {
  constructor(private readonly db: any) {
    this.migrate();
  }

  save(checkpoint: WorkflowCheckpoint) {
    this.db
      .prepare(
        `insert into agent_workflow_checkpoints
          (checkpoint_id, workflow_id, conversation_id, status, checkpoint_json, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(checkpoint_id) do update set
           status = excluded.status,
           checkpoint_json = excluded.checkpoint_json,
           updated_at = excluded.updated_at`,
      )
      .run(checkpoint.checkpointId, checkpoint.workflowId, checkpoint.conversationId, checkpoint.status, JSON.stringify(checkpoint), checkpoint.createdAt, checkpoint.updatedAt);
    return checkpoint;
  }

  latestActive(conversationId: string): WorkflowCheckpoint | null {
    const row = this.db
      .prepare(
        `select checkpoint_json from agent_workflow_checkpoints
         where conversation_id = ?
           and status in ('waiting_for_user_input','waiting_for_parameters','waiting_for_field_selection','waiting_for_data_source','waiting_for_approval','recoverable_error','paused')
         order by updated_at desc
         limit 1`,
      )
      .get(conversationId) as { checkpoint_json?: string } | undefined;
    return row?.checkpoint_json ? JSON.parse(row.checkpoint_json) as WorkflowCheckpoint : null;
  }

  private migrate() {
    this.db.exec(`
      create table if not exists agent_workflow_checkpoints (
        checkpoint_id text primary key,
        workflow_id text not null,
        conversation_id text not null,
        status text not null,
        checkpoint_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create index if not exists idx_agent_workflow_checkpoints_conversation on agent_workflow_checkpoints(conversation_id, updated_at);
    `);
  }
}

export function createAgentGuidanceModule(config: {
  checkpointStore?: SQLiteWorkflowCheckpointStore;
  dataAccuracyPolicy?: DataAccuracyPolicy;
  enableNextActionRecommendations?: boolean;
}) {
  const missingInputDetector = new MissingInputDetector();
  const parameterRepairEngine = new ParameterRepairEngine();
  const guidanceEngine = new GuidanceEngine();
  const nextActionRecommender = new NextActionRecommender();
  const toolErrorRecoveryManager = new ToolErrorRecoveryManager();
  const workflowRecoveryManager = new WorkflowRecoveryManager();
  return {
    dataAccuracyPolicy: config.dataAccuracyPolicy ?? DEFAULT_DATA_ACCURACY_POLICY,
    detectMissingInputs: (input: MissingInputDetectorInput) => missingInputDetector.detect(input),
    buildClarification: (input: Parameters<GuidanceEngine["buildClarification"]>[0]) => guidanceEngine.buildClarification(input),
    pauseForInput: (input: Parameters<GuidanceEngine["buildClarification"]>[0]) => {
      const result = guidanceEngine.buildClarification(input);
      config.checkpointStore?.save(result.checkpoint);
      return result;
    },
    buildParameterRepair: (input: Parameters<GuidanceEngine["buildParameterRepair"]>[0]) => guidanceEngine.buildParameterRepair(input),
    recommendNextActions: (input: Parameters<NextActionRecommender["recommend"]>[0]) =>
      config.enableNextActionRecommendations === false ? null : nextActionRecommender.recommend(input),
    handleToolError: (input: Parameters<ToolErrorRecoveryManager["handleToolError"]>[0]) => toolErrorRecoveryManager.handleToolError(input),
    handleApprovalRejected: (input: Parameters<ToolErrorRecoveryManager["handleApprovalRejected"]>[0]) => toolErrorRecoveryManager.handleApprovalRejected(input),
    validateToolRequest: (input: Parameters<ParameterRepairEngine["validateToolRequest"]>[0]) => parameterRepairEngine.validateToolRequest(input),
    buildCompletedToolCheckpoint,
    createCheckpoint: (checkpoint: WorkflowCheckpoint) => config.checkpointStore?.save(checkpoint) ?? checkpoint,
    restoreFromCheckpoint: (conversationId: string) => config.checkpointStore?.latestActive(conversationId) ?? null,
    cancelWorkflow: (input: Parameters<WorkflowRecoveryManager["cancel"]>[0]) => {
      const checkpoint = workflowRecoveryManager.cancel(input);
      return config.checkpointStore?.save(checkpoint) ?? checkpoint;
    },
    resumeWithInput: (input: WorkflowResumeInput) => workflowRecoveryManager.resumeWithInput(input),
  };
}

export function renderGuidanceMarkdown(guidance: AgentGuidance) {
  return [
    `## ${guidance.title}`,
    "",
    guidance.message,
    guidance.requiredInputs?.length ? "\n### 需要补充" : "",
    ...(guidance.requiredInputs ?? []).flatMap((input) => [
      `- ${input.label}：${input.description}`,
      ...(input.candidates?.length ? input.candidates.map((candidate) => `  - ${candidate.label}${candidate.description ? `（${candidate.description}）` : ""}`) : []),
    ]),
    guidance.actions.length ? "\n### 可执行操作" : "",
    ...guidance.actions.map((item) => `- ${item.label}${item.description ? `：${item.description}` : ""}`),
    guidance.resumeToken ? `\nResume Token: ${guidance.resumeToken}` : "",
  ].filter((line) => line !== "").join("\n");
}

function action(type: AgentGuidanceAction["type"], label: string, primary = false, destructive = false): AgentGuidanceAction {
  return { actionId: guidanceId("action"), type, label, primary, destructive };
}

function actionsForMissingInputs(inputs: MissingWorkflowInput[]) {
  if (inputs.some((item) => item.key === "analysis_goal" || item.type === "analysis_rule")) {
    return [];
  }
  const actions: AgentGuidanceAction[] = [];
  if (inputs.some((item) => item.type === "data_source")) {
    actions.push(action("select_data_source", "选择数据源", true));
  }
  if (inputs.some((item) => item.type === "field")) {
    actions.push(action("select_fields", "选择字段", actions.length === 0));
  }
  if (inputs.some((item) => item.type === "metric" || item.type === "dimension")) {
    actions.push(action("select_fields", "选择指标或维度字段", actions.length === 0));
  }
  if (inputs.some((item) => item.type === "report_requirement")) {
    actions.push(action("return_to_query", "先执行查询或分析", actions.length === 0));
  }
  actions.push(action("provide_text", "直接补充说明", actions.length === 0));
  actions.push(action("cancel_workflow", "取消本轮任务", false, true));
  return actions;
}

function guidanceTypeFor(input?: MissingWorkflowInput): AgentGuidance["type"] {
  if (!input) {
    return "clarification";
  }
  if (input.type === "data_source") {
    return "data_source_selection";
  }
  if (input.type === "field") {
    return "field_selection";
  }
  return "parameter_request";
}

function categoryForMissingInput(input?: MissingWorkflowInput): AgentWorkflowIssueCategory {
  if (!input) {
    return "intent_incomplete";
  }
  if (input.type === "data_source") {
    return "data_source_missing";
  }
  if (input.type === "field") {
    return "field_missing";
  }
  if (input.type === "report_requirement") {
    return "report_input_missing";
  }
  return "parameter_missing";
}

function codeForMissingInput(input?: MissingWorkflowInput): AgentWorkflowErrorCode {
  if (!input) {
    return "INTENT_INCOMPLETE";
  }
  if (input.type === "data_source") {
    return "DATA_SOURCE_REQUIRED";
  }
  if (input.type === "field") {
    return "FIELD_REQUIRED";
  }
  if (input.type === "report_requirement") {
    return "REPORT_INPUT_MISSING";
  }
  return "TOOL_PARAMETER_MISSING";
}

function titleForMissingInput(input?: MissingWorkflowInput) {
  if (!input || input.key === "analysis_goal" || input.type === "analysis_rule") {
    return "想执行哪类数据任务？";
  }
  if (input.type === "data_source") {
    return "需要选择数据源";
  }
  if (input.type === "field") {
    return "需要确认分析字段";
  }
  if (input.type === "report_requirement") {
    return "需要真实分析结果";
  }
  return "需要补充参数";
}

function buildMissingInputMessage(inputs: MissingWorkflowInput[], warnings: string[], context?: ClarificationContext) {
  if (inputs.some((input) => input.key === "analysis_goal" || input.type === "analysis_rule")) {
    return buildTaskGoalGuidanceMessage(context, warnings);
  }
  const fieldReferenceInputs = inputs.filter((input) => input.key.startsWith("field_reference:"));
  if (fieldReferenceInputs.length > 0) {
    return [
      "我没有在当前数据源中找到这些字段引用。请从推荐字段中选择最接近的真实字段，或重新输入字段名后再提交。",
      "",
      ...fieldReferenceInputs.map((input) => {
        const candidateText = input.candidates?.length
          ? `推荐：${input.candidates.map((candidate) => candidate.label).join("、")}`
          : "未找到足够相近的推荐字段";
        return `- ${input.label}：${candidateText}`;
      }),
      ...warnings.map((warning) => `- 注意：${warning}`),
    ].join("\n");
  }
  return [
    "可以继续处理，但当前还缺少必要信息。为保证数据准确性，系统不会使用模拟数据、猜测字段或基于样例行生成结论。",
    "",
    ...inputs.map((input) => `- 缺少 ${input.label}：${input.description}`),
    ...warnings.map((warning) => `- 注意：${warning}`),
  ].join("\n");
}

function buildTaskGoalGuidanceMessage(context: ClarificationContext | undefined, warnings: string[]) {
  const sourceNames = [
    context?.dataSourceLabel,
    ...(context?.tempSources ?? []).map((source) => source.fileName),
  ]
    .filter((item): item is string => Boolean(item?.trim()))
    .slice(0, 2);
  const selectedFields = (context?.selectedFieldRefs ?? [])
    .filter((field) => field.status === "valid")
    .map((field) => field.displayName || field.sourceHeader || field.physicalName)
    .filter(Boolean)
    .slice(0, 3);
  const suggestions: string[] = [];
  const toolState = context?.toolState;

  if (toolState?.latestSuccessfulPythonToolCallId) {
    suggestions.push("根据上一轮分析结果生成报告，或绘制一张图表。");
  }
  if (toolState?.latestSuccessfulSqlToolCallId) {
    suggestions.push("基于上一轮查询结果继续统计、筛选或做占比分析。");
  }
  if (sourceNames.length > 0) {
    const sourceText = sourceNames.join("、");
    const fieldText = selectedFields.length > 0 ? `，例如 ${selectedFields.join("、")}` : "";
    suggestions.push(`查询或统计 ${sourceText} 中的字段${fieldText}。`);
  }
  if (suggestions.length === 0) {
    suggestions.push("选择或上传数据源后，描述要查询、统计、分析、绘图或生成报告的内容。");
  }

  return [
    "我还没识别出明确的数据任务目标。可以直接说明要做什么，例如：",
    "",
    ...suggestions.slice(0, 3).map((suggestion) => `- ${suggestion}`),
    ...warnings.map((warning) => `- 注意：${warning}`),
  ].join("\n");
}

function nextActionGuidance(conversationId: string, workflowId: string, title: string, message: string, actions: AgentGuidanceAction[], createdAt: string): AgentGuidance {
  return {
    guidanceId: guidanceId("guidance"),
    workflowId,
    conversationId,
    type: "next_action",
    title,
    message,
    actions,
    blocking: false,
    createdAt,
  };
}

function classifyToolError(message: string): { category: AgentWorkflowIssueCategory; code: AgentWorkflowErrorCode; recoverability: IssueRecoverability } {
  if (/(超时|timeout|timed out)/i.test(message)) {
    return { category: "tool_execution_timeout", code: "TOOL_EXECUTION_TIMEOUT", recoverability: "retryable" };
  }
  if (/(artifact|Artifact|产物).{0,20}(不存在|缺失|失效|过期|not found|missing|expired)|(?:不存在|缺失|失效|过期|not found|missing|expired).{0,20}(artifact|Artifact|产物)/i.test(message)) {
    return { category: "artifact_missing", code: "ARTIFACT_NOT_FOUND", recoverability: "return_to_previous_step" };
  }
  if (/(过期|expired|失效|临时表过期|数据集过期)/i.test(message)) {
    return { category: "dataset_expired", code: "DATASET_EXPIRED", recoverability: "return_to_previous_step" };
  }
  if (/(权限|无权|未授权|permission|forbidden|denied|unauthorized)/i.test(message)) {
    return { category: "permission_denied", code: "PERMISSION_DENIED", recoverability: "select_alternative" };
  }
  if (/(未返回数据|结果为空|查询为空|空数据|empty|no rows|0 rows|zero rows)/i.test(message)) {
    return { category: "dataset_empty", code: "DATASET_EMPTY", recoverability: "return_to_previous_step" };
  }
  if (/(参数|parameter).{0,20}(缺失|错误|invalid|missing)|(?:缺失|错误|invalid|missing).{0,20}(参数|parameter)/i.test(message)) {
    return { category: "parameter_invalid", code: "TOOL_PARAMETER_INVALID", recoverability: "parameter_repair" };
  }
  return { category: "tool_execution_failed", code: "TOOL_EXECUTION_FAILED", recoverability: "retryable" };
}

function recoveryActionsFor(toolKind: ToolKind, message: string) {
  const classified = classifyToolError(message);
  if (classified.category === "permission_denied") {
    return [action("select_data_source", "更换数据源或申请权限", true), action("return_to_query", "返回修改查询条件"), action("cancel_workflow", "取消本轮任务", false, true)];
  }
  if (classified.category === "dataset_empty") {
    return [action("return_to_query", "放宽范围或修改筛选条件", true), action("edit_parameters", "检查字段取值"), action("select_fields", "重新选择字段")];
  }
  if (classified.category === "dataset_expired" || classified.category === "artifact_missing") {
    return [action("return_to_query", "重新执行上游步骤", true), action("retry", "重试当前步骤"), action("select_data_source", "重新上传或更换数据源")];
  }
  if (classified.category === "tool_execution_timeout") {
    return [action("return_to_query", "缩小范围或简化任务", true), action("retry", "重试当前步骤"), action("edit_parameters", "调整执行参数")];
  }
  if (classified.category === "parameter_invalid") {
    return [action("edit_parameters", "修复参数后重新提交", true), action("select_fields", "重新选择字段"), action("return_to_query", "返回上一步")];
  }
  if (toolKind === "sql_query") {
    if (/字段|column|no such column/i.test(message)) {
      return [action("select_fields", "重新选择字段", true), action("edit_parameters", "修复 SQL 后重新审批"), action("return_to_query", "返回修改查询条件")];
    }
    if (/过期|expired/i.test(message)) {
      return [action("return_to_query", "重新上传或重新查询", true), action("select_data_source", "更换数据源")];
    }
    return [action("retry", "重试查询", true), action("return_to_query", "缩小范围或修改条件"), action("select_data_source", "更换数据源")];
  }
  if (toolKind === "python_analysis") {
    if (/类型|type|incompatible|无法转换/i.test(message)) {
      return [action("edit_parameters", "修改分析规则", true), action("select_fields", "选择兼容字段"), action("return_to_query", "返回查询步骤")];
    }
    return [action("select_fields", "重新选择字段", true), action("edit_parameters", "修改分析规则"), action("return_to_query", "返回查询步骤")];
  }
  if (toolKind === "chart_rendering") {
    if (/类型|文本|数值|轴|incompatible|encoding/i.test(message)) {
      return [action("edit_parameters", "修改图表类型或指标", true), action("select_fields", "选择其他字段"), action("return_to_query", "改用表格展示")];
    }
    return [action("edit_parameters", "修改图表类型或指标", true), action("retry", "重试渲染"), action("return_to_query", "重新执行上游工具")];
  }
  if (/无分析结果|没有.*结果|缺少.*结果|report input|markdown/i.test(message)) {
    return [action("continue_analysis", "先执行分析", true), action("create_chart", "重新绘图"), action("return_to_query", "重新查询数据")];
  }
  return [action("retry", "重试保存报告", true), action("continue_analysis", "重新执行分析"), action("return_to_query", "返回上游步骤")];
}

function toolLabel(toolKind: ToolKind) {
  if (toolKind === "sql_query") {
    return "SQL 查询";
  }
  if (toolKind === "python_analysis") {
    return "Python 分析";
  }
  if (toolKind === "chart_rendering") {
    return "图表生成";
  }
  return "报告生成";
}
