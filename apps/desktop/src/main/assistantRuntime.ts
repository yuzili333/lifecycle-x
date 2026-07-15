import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  AuditedWorkflowStateStore,
  SQLiteDatasetStateManager,
  SQLiteMaterializer,
  SQLiteWorkflowAuditLogger,
  SQLiteWorkflowMemoryBridge,
  SQLiteWorkflowStateStore,
  TempTableRegistry,
  WorkflowContextBuilder,
  type WorkflowContextSummary,
  type WorkflowDatasetRef,
  type WorkflowSession,
  type WorkflowStateStore,
} from "./workflowRuntime";
import { rewriteCompoundOrderByForSqlite } from "./sqliteSqlRewrite";
import { parseVisualizationSpecJson, type VisualizationRenderError, type VisualizationSpec } from "../shared/visualization";
import {
  SQLiteArtifactManager,
  SQLiteToolResultRegistry,
  TOOL_SCHEMAS,
  TOOL_NAMES,
  TOOL_ORCHESTRATION_SYSTEM_PROMPT,
  type ArtifactManager,
  type ConversationToolState,
  type ArtifactRecord,
  type ToolCallRecord,
  type ToolCallStatus,
  type ToolKind,
  type ToolResultRegistry,
} from "./toolOrchestration";
import { createStreamingModelAdapter, type ConversationMessage, type ToolDefinition } from "./streamingModelAdapter";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

export type AssistantApprovalMode = "full_access" | "request_approval" | "no_access";
export type AssistantSkill = string;
export type AssistantBlockType = "text" | "markdown" | "json" | "card" | "mermaid" | "visualization";
export type AssistantMessageRole = "system" | "user" | "assistant" | "tool";
export type AssistantMessageStatus =
  | "draft"
  | "sending"
  | "sent"
  | "receiving"
  | "processing"
  | "completed"
  | "awaiting_approval"
  | "stopped"
  | "error";

export type AssistantBlock = {
  id: string;
  type: AssistantBlockType;
  content: string;
  title?: string;
  language?: string;
  toolCallId?: string;
  toolStatus?: AssistantToolStatus;
  toolName?: AssistantToolKind;
  toolTarget?: string;
  toolFiles?: string[];
  toolDurationMs?: number;
  visualizationSpec?: VisualizationSpec;
  visualizationStatus?: "streaming" | "ready" | "error";
  visualizationError?: VisualizationRenderError;
};

export type AssistantMessageContext = {
  dataSourceLabel?: string | null;
  skill?: AssistantSkill | null;
};

export type AssistantConversation = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantMessage = {
  id: string;
  conversationId: string;
  userId: string;
  role: AssistantMessageRole;
  status: AssistantMessageStatus;
  content: string;
  blocks: AssistantBlock[];
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  integrityHash: string;
  previousHash?: string;
  clientRequestId?: string;
  providerTraceId?: string;
  context?: AssistantMessageContext;
};

export type AssistantToolKind = "sql" | "python";
export type AssistantToolStatus = "pending_approval" | "running" | "completed" | "declined" | "blocked" | "error";

export type AssistantToolCall = {
  id: string;
  conversationId: string;
  messageId: string;
  userId: string;
  kind: AssistantToolKind;
  status: AssistantToolStatus;
  script: string;
  result?: string;
  errorMessage?: string;
  approvalMode: AssistantApprovalMode;
  createdAt: string;
  updatedAt: string;
};

export type AssistantSendInput = {
  userId: string;
  conversationId?: string;
  clientRequestId: string;
  prompt: string;
  modelName: string;
  dataSourceId?: string | null;
  dataSourceLabel?: string | null;
  schemaContextMarkdown?: string | null;
  skill?: AssistantSkill | null;
  approvalMode: AssistantApprovalMode;
};

export type AssistantRetryInput = {
  userId: string;
  messageId: string;
  clientRequestId: string;
  modelName: string;
  dataSourceLabel?: string | null;
  schemaContextMarkdown?: string | null;
  skill?: AssistantSkill | null;
  approvalMode: AssistantApprovalMode;
};

export type AssistantStreamContentEvent =
  | {
      type: "markdown_delta" | "text_delta";
      messageId: string;
      segmentId: string;
      sequence: number;
      delta: string;
      contentRole?: "general";
    }
  | {
      type: "report_markdown_delta";
      messageId: string;
      segmentId: string;
      sequence: number;
      delta: string;
      reportId?: string;
    }
  | {
      type: "report_artifact_ready";
      messageId: string;
      segmentId: string;
      reportId: string;
      reportArtifactId: string;
      title: string;
      version: number;
      createdAt: string;
    }
  | {
      type: "message_stream_completed";
      messageId: string;
      completedAt: string;
    }
  | {
      type: "stream_error";
      messageId: string;
      segmentId?: string;
      code: string;
      message: string;
    };

export type AssistantStreamEvent =
  | { type: "conversation"; conversation: AssistantConversation }
  | { type: "message"; conversationId: string; message: AssistantMessage }
  | { type: "message-delta"; conversationId: string; messageId: string; content: string; blocks: AssistantBlock[]; status: AssistantMessageStatus }
  | { type: "stream-content"; conversationId: string; event: AssistantStreamContentEvent }
  | { type: "tool"; conversationId: string; toolCall: AssistantToolCall; message: AssistantMessage }
  | { type: "tool-state"; conversationId: string; state: ConversationToolState }
  | { type: "workflow"; conversationId: string; context: WorkflowContextSummary }
  | { type: "error"; conversationId: string; messageId?: string; message: string; traceId: string };

export type AssistantSendResult = {
  success: true;
  conversation: AssistantConversation;
  userMessage: AssistantMessage;
  assistantMessage: AssistantMessage;
};

export type AssistantRetryResult = {
  success: true;
  conversation: AssistantConversation;
  assistantMessage: AssistantMessage;
};

type AssistantRuntimeOptions = {
  dbPath: string;
  csvSqlitePath: string;
  toolLogPath: string;
  getModelApiKey: (userId: string) => Promise<string | null>;
  emit: (event: AssistantStreamEvent) => void;
};

type CsvDatasetTableRow = {
  data_source_id: string;
  table_id: string;
  sqlite_table_name: string;
  display_name: string;
  aliases_json?: string;
};

type CsvDatasetColumnRow = {
  name: string;
  sqlite_column_name: string;
  ordinal_index: number;
  source_header?: string;
  physical_name?: string;
  business_field_id?: string;
  display_name_zh?: string;
  logical_type?: string;
  mapping_status?: string;
  field_comment?: string;
  aliases_json?: string;
};

type ToolDetection = {
  kind: AssistantToolKind;
  script: string;
};

const SILICONFLOW_CHAT_COMPLETIONS_URL = "https://api.siliconflow.cn/v1/chat/completions";
const MAX_STORED_MESSAGES_FOR_CONTEXT = 12;
const MAX_STREAM_CHARS = 120_000;
const PYTHON_TIMEOUT_MS = 5_000;
const MAX_TOOL_CONTEXT_CHARS = 30_000;
const WORKFLOW_DATASET_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function selectedSkillSystemPrompt(skill: AssistantSkill | null | undefined) {
  if (skill !== "overall-risk-classification-distribution") {
    return undefined;
  }

  return [
    "你正在执行本地预置 Skill：整体风险分类分布（笔数+金额）。",
    "目标：基于用户选择的数据源，分析信贷资产五级和十二级风险分类的笔数、贷款余额、关注率、不良率、关注加不良率和正常3+关注类风险边界，并生成图表和 Markdown 报告。",
    "执行顺序：先确认数据源和字段映射；需要真实数据时调用 request_sql_query_execution；统计计算、分类标准化、占比和数据质量校验调用 request_python_analysis_execution；需要图表时调用 request_chart_rendering；完整报告调用 request_markdown_report_generation。",
    "SQL 和 Python 执行前必须遵守当前审批权限；不得绕过安全校验、权限校验或用户审批。",
    "当用户说“根据/据选择的数据源生成报告”“生成一份整体风险分类分布报告”等新建报告请求时，必须重新进行意图识别并发起 SQL 查询和 Python 分析工具调用；不得直接返回最近一次或历史版本报告。",
    "只有用户明确说“基于上一轮/刚才/已有报告/历史版本继续修改或查看”时，才允许复用最近报告 Artifact。",
    "字段契约：优先使用上传表字典的 businessFieldId 理解字段，SQL 必须使用 BusinessFieldResolver 解析出的 physicalName，报告和结论使用 displayNameZh。",
    "当前标准字典必需 businessFieldId：bf.loan_contract.contract_serial、bf.loan_contract.latest_risk、bf.loan_contract.loan_balance_10k。兼容风险字段：bf.loan_contract.latest_five_level_risk、credit.five_level_classification。可选：bf.loan_contract.latest_risk_result、bf.loan_contract.contract_amount_10k、bf.loan_contract.p_date、bf.loan_contract.branch_name、bf.loan_contract.product_name。",
    "兼容旧字段：credit.contract_id、credit.five_level_classification、credit.loan_balance、credit.twelve_level_classification、credit.contract_amount。缺少合同唯一标识或五级分类时阻止完整执行；缺少贷款余额时仅允许笔数分析；缺少十二级分类或合同金额时必须降级说明，不得伪造。",
    "SQL 查询必须保留后续报告计算所需字段，优先读取明细样本后交由 Python 统一计算；除非用户只要求 SQL 聚合结果，否则不要只返回按风险分类聚合后的少量行。",
    "口径：不良类=次级+可疑+损失；关注加不良=关注+次级+可疑+损失；风险边界默认=正常3+全部关注类。",
    "报告必须区分笔数维度和金额维度，包含五级分类表、十二级分类明细、核心指标、图表引用、数据质量说明、计算口径和 Artifact 数据血缘。",
    "禁止使用报告模板或示例中的数字作为真实分析结果；不得基于 preview rows 推断全量结论；不得将完整源表数据注入模型上下文。",
  ].join("\n");
}

function nowIso() {
  return new Date().toISOString();
}

function formatReportDateTime(value: string | Date = new Date()) {
  if (typeof value === "string") {
    const normalized = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (normalized) {
      return `${normalized[1]} ${normalized[2]}:${normalized[3]}:${normalized[4]}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      return `${value.trim()} 00:00:00`;
    }
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function isReadonlySql(sql: string) {
  const normalized = sql.trim().replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!normalized) {
    return false;
  }
  if (normalized.split(";").filter((part) => part.trim()).length > 1) {
    return false;
  }
  return /^(select|with|pragma)\b/i.test(normalized) && !/\b(insert|update|delete|drop|alter|create|attach|detach|vacuum|replace|load_extension)\b/i.test(normalized);
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeSqliteAlias(value: string) {
  return value.trim().replace(/^["'`\[]|["'`\]]$/g, "");
}

function normalizeCsvSchemaQualifiedSql(sql: string) {
  return sql.replace(/\b(from|join)\s+csv_imports\.([`"[]?[\w.-]+[`"\]]?)/gi, (_match, keyword: string, tableName: string) => {
    return `${keyword} ${tableName}`;
  });
}

function parseCsvAliasJson(value: string | undefined) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function extractFencedCode(prompt: string, language: AssistantToolKind) {
  const pattern = new RegExp("```" + language + "\\s*([\\s\\S]*?)```", "i");
  const match = prompt.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function detectTool(prompt: string): ToolDetection | null {
  const trimmed = prompt.trim();
  const slashSql = trimmed.match(/^\/sql\s+([\s\S]+)/i)?.[1]?.trim();
  if (slashSql) {
    return { kind: "sql", script: slashSql };
  }
  const fencedSql = extractFencedCode(prompt, "sql");
  if (fencedSql) {
    return { kind: "sql", script: fencedSql };
  }

  const slashPython = trimmed.match(/^\/python\s+([\s\S]+)/i)?.[1]?.trim();
  if (slashPython) {
    return { kind: "python", script: slashPython };
  }
  const fencedPython = extractFencedCode(prompt, "python");
  if (fencedPython) {
    return { kind: "python", script: fencedPython };
  }

  return null;
}

function detectToolFromAssistantOutput(content: string): ToolDetection | null {
  const fencedTool = detectTool(content);
  if (fencedTool) {
    return fencedTool;
  }

  const sqlMatch = content.match(/(?:^|\n)\s*((?:select|with|pragma)\b[\s\S]*?)(?:;|\n\s*\n|$)/i);
  const sql = sqlMatch?.[1]?.trim();
  if (sql && isReadonlySql(sql)) {
    return { kind: "sql", script: sql };
  }

  return null;
}

function replaceToolBlock(blocks: AssistantBlock[], toolBlock: AssistantBlock) {
  return [...blocks.filter((block) => block.toolCallId !== toolBlock.toolCallId), toolBlock];
}

function hasRenderableNonToolContent(message: AssistantMessage) {
  return message.blocks.some((block) => !block.toolCallId && block.content.trim().length > 0);
}

function shouldAnalyzePriorSqlResult(prompt: string) {
  return (
    /(sql\s*查询结果|查询结果数据|查询结果|上一轮|上一次|工具调用结果|结果数据)/i.test(prompt) &&
    /(统计|占比|对比|排名|前三|top\s*3|报告|分析)/i.test(prompt)
  );
}

export function shouldAutoStartPythonReport(prompt: string) {
  const asksForReport = /(输出|生成|形成|给出|撰写|渲染|绘制|展示|放入|放到).{0,24}(分析)?报告|分析报告|报告输出|报告中/i.test(prompt);
  const asksForChart = /(柱状图|条形图|折线图|饼图|图表|可视化)/i.test(prompt);
  const asksForAnalysis = /(统计|计数|总计|数量|占比|比例|分布|排序|倒序|排名|对比|分析)/i.test(prompt);
  return asksForReport || (asksForChart && asksForAnalysis) || (/分析/i.test(prompt) && /(占比|比例|分布|统计|对比)/i.test(prompt));
}

function parseSqlToolRows(result: string | undefined) {
  if (!result) {
    return [];
  }
  try {
    const parsed = JSON.parse(result) as { rows?: Array<Record<string, unknown>>; previewRows?: Array<Record<string, unknown>> };
    return Array.isArray(parsed.rows) ? parsed.rows : Array.isArray(parsed.previewRows) ? parsed.previewRows : [];
  } catch {
    return [];
  }
}

function parseSqlToolPreviewRows(result: string | undefined) {
  if (!result) {
    return [];
  }
  try {
    const parsed = JSON.parse(result) as { rows?: Array<Record<string, unknown>>; previewRows?: Array<Record<string, unknown>> };
    return Array.isArray(parsed.rows) ? parsed.rows : Array.isArray(parsed.previewRows) ? parsed.previewRows : [];
  } catch {
    return [];
  }
}

function parseSqlToolRowCount(result: string | undefined) {
  if (!result) {
    return null;
  }
  try {
    const parsed = JSON.parse(result) as { rowCount?: unknown; rows?: Array<Record<string, unknown>>; previewRows?: Array<Record<string, unknown>> };
    if (typeof parsed.rowCount === "number") {
      return parsed.rowCount;
    }
    if (Array.isArray(parsed.rows)) {
      return parsed.rows.length;
    }
    if (Array.isArray(parsed.previewRows)) {
      return parsed.previewRows.length;
    }
    return null;
  } catch {
    return null;
  }
}

function truncateText(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]` : value;
}

function extractSqlTarget(script: string) {
  const match = script.match(/\b(?:from|join|pragma)\s+([`"[\]\w.-]+)/i);
  if (!match?.[1]) {
    return "SQL 查询";
  }
  return match[1].replace(/^[`"\[]|[`"\]]$/g, "");
}

function extractScriptFiles(script: string) {
  const files = new Set<string>();
  const filePattern = /(?:^|[^\w./-])([\w./-]+\.(?:ts|tsx|js|jsx|sql|py|json|csv|md|txt|xlsx?))\b/gi;
  let match: RegExpExecArray | null;
  while ((match = filePattern.exec(script))) {
    files.add(match[1]);
  }
  return Array.from(files);
}

function toolCallDurationMs(toolCall: AssistantToolCall) {
  if (toolCall.status === "pending_approval" || toolCall.status === "running") {
    return undefined;
  }
  const startedAt = Date.parse(toolCall.createdAt);
  const endedAt = Date.parse(toolCall.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return undefined;
  }
  return endedAt - startedAt;
}

function toolTarget(toolCall: AssistantToolCall) {
  const files = extractScriptFiles(toolCall.script);
  if (files.length > 0) {
    return files.join(", ");
  }
  if (toolCall.kind === "sql") {
    return "SQL Script";
  }
  return "Python Script";
}

function assistantToolKindToOrchestrationKind(kind: AssistantToolKind): ToolKind {
  return kind === "sql" ? "sql_query" : "python_analysis";
}

function isMarkdownLikeContent(content: string) {
  return (
    /(^|\n)\s{0,3}#{1,6}\s+\S/.test(content) ||
    /(^|\n)\s{0,3}(?:[-*+]|\d+\.)\s+\S/.test(content) ||
    /(^|\n)\s{0,3}>\s+\S/.test(content) ||
    /(^|\n)\|.+\|/.test(content) ||
    /[*_`~]{1,3}[^*_`~]+[*_`~]{1,3}/.test(content) ||
    /\b(?:报告|方案|步骤|清单|结论|摘要|分析结果)\b/.test(content)
  );
}

function assistantBlockTypeForContent(content: string): AssistantBlockType {
  if (content.startsWith("{") || content.startsWith("[")) {
    return "json";
  }
  return isMarkdownLikeContent(content) ? "markdown" : "text";
}

function stableAssistantBlockId(index: number, type: AssistantBlockType, startOffset: number) {
  return `block-${index}-${type}-${startOffset}`;
}

export function generalStreamSegmentId(messageId: string) {
  return `message:${messageId}:markdown`;
}

export function generalTextStreamSegmentId(messageId: string) {
  return `message:${messageId}:text`;
}

export function reportStreamSegmentId(messageId: string, toolCallId: string, version: number) {
  return `report:${messageId}:${toolCallId}:v${version}`;
}

function parseAssistantBlocks(content: string): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  const fencePattern = /```([a-z0-9_+#.-]+)?\s*([\s\S]*?)```/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(content))) {
    const before = content.slice(cursor, match.index).trim();
    if (before) {
      const type = assistantBlockTypeForContent(before);
      blocks.push({ id: stableAssistantBlockId(blocks.length, type, cursor), type, content: before });
    }

    const language = (match[1] ?? "markdown").toLowerCase();
    const body = match[2].trim();
    if (isVisualizationLanguage(language)) {
      const parsed = parseVisualizationSpecJson(body, { allowInlineData: true, inlineDataMaxRows: 200, inlineDataMaxBytes: 64 * 1024 });
      blocks.push({
        id: stableAssistantBlockId(blocks.length, "visualization", match.index),
        type: "visualization",
        content: "",
        title: parsed.success ? parsed.spec.title : "可视化配置无法解析",
        language,
        visualizationStatus: parsed.success ? "ready" : "error",
        visualizationSpec: parsed.success ? parsed.spec : undefined,
        visualizationError: parsed.success ? undefined : parsed.error,
      });
      cursor = fencePattern.lastIndex;
      continue;
    }
    const isMarkdown = language === "markdown" || language === "md";
    const blockType = language === "json" ? "json" : language === "mermaid" ? "mermaid" : "markdown";
    blocks.push({
      id: stableAssistantBlockId(blocks.length, blockType, match.index),
      type: blockType,
      content: body,
      title: language === "json" ? "JSON" : language === "mermaid" ? "Mermaid" : isMarkdown ? undefined : language.toUpperCase(),
      language,
    });
    cursor = fencePattern.lastIndex;
  }

  const rest = content.slice(cursor).trim();
  if (rest) {
    const type = assistantBlockTypeForContent(rest);
    blocks.push({ id: stableAssistantBlockId(blocks.length, type, cursor), type, content: rest, title: type === "json" ? "JSON" : undefined });
  }

  return blocks.length > 0 ? blocks : [{ id: stableAssistantBlockId(0, "text", 0), type: "text", content: "" }];
}

function isVisualizationLanguage(language: string) {
  return ["visualization", "visualization-json", "viz", "chart-spec"].includes(language);
}

export function isReportGenerationContent(userPrompt: string, content: string) {
  const combined = `${userPrompt}\n${content}`;
  if (!/(报告|分析报告|统计分析|分析结论|风险提示|建议|总结)/i.test(combined)) {
    return false;
  }
  return isMarkdownLikeContent(content) || /^#{1,3}\s+/m.test(content) || /\|.+\|/m.test(content);
}

export function inferReportTitle(content: string) {
  const heading = content.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading.slice(0, 120);
  }
  const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine?.replace(/^#+\s*/, "").slice(0, 120);
}

function uniqueValues<T>(values: T[]) {
  return Array.from(new Set(values.filter((value): value is NonNullable<T> => value !== null && value !== undefined)));
}

function isOverallRiskSkill(skill: AssistantSkill | null | undefined) {
  return skill === "overall-risk-classification-distribution";
}

export function shouldRouteSkillThroughModel(skill: AssistantSkill | null | undefined) {
  return isOverallRiskSkill(skill);
}

export function shouldStartOverallRiskWorkflowAfterModelText(input: { skill?: AssistantSkill | null; prompt: string }, assistantContent: string) {
  if (!isOverallRiskSkill(input.skill)) {
    return false;
  }
  const combined = `${input.prompt}\n${assistantContent}`;
  const asksForNewReport =
    /(据|根据|基于|使用|利用).{0,16}(选择|所选|当前|已确认).{0,16}数据源.{0,24}(生成|输出|出具|形成|重新生成).{0,12}(整体风险分类分布)?报告/i.test(combined) ||
    /(生成|输出|出具|形成|重新生成).{0,12}(一份)?整体风险分类分布(分析)?报告/i.test(combined);
  if (!asksForNewReport) {
    return false;
  }
  const explicitlyReferencesHistory = /(上一轮|上一次|刚才|已有报告|历史报告|历史版本|报告版本|基于此版本|沿用|复用|修改)/i.test(combined);
  return !explicitlyReferencesHistory;
}

function parseAmountValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return 0;
  }
  const normalized = value.replace(/[,\s￥¥元]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function findColumnByPattern(rows: Array<Record<string, unknown>>, patterns: RegExp[]) {
  const columns = Object.keys(rows[0] ?? {});
  return columns.find((column) => patterns.some((pattern) => pattern.test(column))) ?? null;
}

function looksLikeDateColumn(column: string) {
  return /(^|[_\s.-])(date|time|dt|at)$|(^|[_\s.-])(date|time|dt|at)[_\s.-]|日期|时间|p_date|partition_date|classified_at/i.test(column);
}

function looksLikeDateValue(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}[-/]?\d{2}[-/]?\d{2}(?:\s+\d{2}:\d{2}:\d{2})?$/.test(text);
}

function findRiskClassificationColumn(rows: Array<Record<string, unknown>>) {
  const columns = Object.keys(rows[0] ?? {});
  const scored = columns
    .map((column) => {
      if (looksLikeDateColumn(column)) {
        return { column, score: 0 };
      }
      if (/^latest_risk$/i.test(column) || /bf\.loan_contract\.latest_risk/i.test(column) || /最新风险分类$/.test(column)) {
        return { column, score: 220 };
      }
      if (/^five_level_classification$/i.test(column) || /^latest_five_level_risk$/i.test(column) || /credit\.five_level_classification/i.test(column) || /五级分类/.test(column)) {
        return { column, score: 210 };
      }
      if (/risk.*class|risk_level|风险.*分类|风险等级/i.test(column)) {
        return { column, score: 100 };
      }
      return { column, score: 0 };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  for (const candidate of scored) {
    const sampleValues = rows.slice(0, 20).map((row) => row[candidate.column]).filter((value) => value !== null && value !== undefined && value !== "");
    if (sampleValues.length === 0 || sampleValues.some((value) => !looksLikeDateValue(value))) {
      return candidate.column;
    }
  }
  return null;
}

function riskBucket(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || looksLikeDateValue(text)) {
    return "未分类";
  }
  if (/正常\s*[1１]/i.test(text)) {
    return "正常1";
  }
  if (/正常\s*[2２]/i.test(text)) {
    return "正常2";
  }
  if (/正常\s*[3３]/i.test(text)) {
    return "正常3";
  }
  if (/关注\s*[1１]/i.test(text)) {
    return "关注1";
  }
  if (/关注\s*[2２]/i.test(text)) {
    return "关注2";
  }
  if (/关注\s*[3３]/i.test(text)) {
    return "关注3";
  }
  if (/正常/i.test(text)) {
    return "正常";
  }
  if (/关注/i.test(text)) {
    return "关注";
  }
  if (/次级/i.test(text)) {
    return "次级";
  }
  if (/可疑/i.test(text)) {
    return "可疑";
  }
  if (/损失/i.test(text)) {
    return "损失";
  }
  if (/不良/i.test(text)) {
    return "不良";
  }
  return text;
}

function amountText(value: number) {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function pctText(value: number, total: number) {
  return total > 0 ? `${(value * 100 / total).toFixed(2)}%` : "0.00%";
}

function reportDataSourceName(dataSourceLabel?: string | null) {
  const trimmed = dataSourceLabel?.trim();
  if (!trimmed) {
    return "未选择数据源";
  }
  return trimmed.split("/")[0]?.trim() || trimmed;
}

export function buildOverallRiskDistributionMarkdown(rows: Array<Record<string, unknown>>, context: { title?: string; dataSourceLabel?: string | null; version?: number; generatedAt?: string | Date }) {
  const totalCount = rows.length;
  const idColumn = findColumnByPattern(rows, [/^contract_id$/i, /^contract_serial$/i, /^contract_no$/i, /bf\.loan_contract\.contract_serial/i, /credit\.contract_id/i, /合同.*(号|编号|id|流水)/i, /借据/i, /loan.*id/i, /contract.*(id|serial|no)/i, /^id$/i]);
  const fiveRiskColumn = findRiskClassificationColumn(rows);
  const twelveRiskColumn = findColumnByPattern(rows, [
    /^twelve_level_classification$/i,
    /^latest_risk_result$/i,
    /bf\.loan_contract\.latest_risk_result/i,
    /credit\.twelve_level_classification/i,
    /最新风险分类结果/i,
    /当前风险分类结果/i,
    /十二级/i,
    /12\s*级/i,
    /十二.*分类/i,
    /细分.*分类/i,
    /risk.*12/i,
    /risk.*result/i,
  ]);
  const balanceColumn = findColumnByPattern(rows, [/^loan_balance$/i, /credit\.loan_balance/i, /贷款余额/i, /本金余额/i, /余额/i, /balance/i, /amount/i, /金额/i]);
  const contractAmountColumn = findColumnByPattern(rows, [/^contract_amount$/i, /credit\.contract_amount/i, /合同金额/i, /发放金额/i, /授信金额/i, /contract.*amount/i]);

  const fiveOrder = ["正常", "正常1", "正常2", "正常3", "关注", "不良", "次级", "可疑", "损失", "未分类"];
  const fiveStats = new Map<string, { count: number; amount: number }>();
  const twelveStats = new Map<string, { count: number; amount: number }>();

  for (const row of rows) {
    const five = riskBucket(fiveRiskColumn ? row[fiveRiskColumn] : undefined);
    const twelve = riskBucket(twelveRiskColumn ? row[twelveRiskColumn] : undefined);
    const amount = balanceColumn ? parseAmountValue(row[balanceColumn]) : 0;
    const fiveCurrent = fiveStats.get(five) ?? { count: 0, amount: 0 };
    fiveStats.set(five, { count: fiveCurrent.count + 1, amount: fiveCurrent.amount + amount });
    if (twelveRiskColumn) {
      const twelveCurrent = twelveStats.get(twelve) ?? { count: 0, amount: 0 };
      twelveStats.set(twelve, { count: twelveCurrent.count + 1, amount: twelveCurrent.amount + amount });
    }
  }

  const totalAmount = Array.from(fiveStats.values()).reduce((sum, item) => sum + item.amount, 0);
  const attentionCount = Array.from(fiveStats.entries()).filter(([key]) => key.includes("关注")).reduce((sum, [, item]) => sum + item.count, 0);
  const attentionAmount = Array.from(fiveStats.entries()).filter(([key]) => key.includes("关注")).reduce((sum, [, item]) => sum + item.amount, 0);
  const nonPerformingKeys = ["不良", "次级", "可疑", "损失"];
  const nonPerformingCount = Array.from(fiveStats.entries()).filter(([key]) => nonPerformingKeys.some((risk) => key.includes(risk))).reduce((sum, [, item]) => sum + item.count, 0);
  const nonPerformingAmount = Array.from(fiveStats.entries()).filter(([key]) => nonPerformingKeys.some((risk) => key.includes(risk))).reduce((sum, [, item]) => sum + item.amount, 0);
  const boundaryCount = Array.from(fiveStats.entries()).filter(([key]) => key.includes("正常3") || key.includes("关注")).reduce((sum, [, item]) => sum + item.count, 0);
  const boundaryAmount = Array.from(fiveStats.entries()).filter(([key]) => key.includes("正常3") || key.includes("关注")).reduce((sum, [, item]) => sum + item.amount, 0);
  const orderedFive = [...fiveOrder.filter((key) => fiveStats.has(key)), ...Array.from(fiveStats.keys()).filter((key) => !fiveOrder.includes(key))];
  const orderedTwelve = Array.from(twelveStats.keys()).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const normalClassKeys = ["正常1", "正常2", "正常3"];
  const normalClassCount = normalClassKeys.reduce((sum, key) => sum + (twelveStats.get(key)?.count ?? 0), 0);
  const normalClassAmount = normalClassKeys.reduce((sum, key) => sum + (twelveStats.get(key)?.amount ?? 0), 0);
  const normalClassBreakdown = normalClassKeys
    .map((key) => `${key} ${twelveStats.get(key)?.count ?? 0} 笔`)
    .join("、");
  const topFive = orderedFive
    .map((key) => ({ key, count: fiveStats.get(key)?.count ?? 0, amount: fiveStats.get(key)?.amount ?? 0 }))
    .sort((left, right) => right.count - left.count)[0];
  const topAmount = orderedFive
    .map((key) => ({ key, count: fiveStats.get(key)?.count ?? 0, amount: fiveStats.get(key)?.amount ?? 0 }))
    .sort((left, right) => right.amount - left.amount)[0];

  const qualityNotes = [
    idColumn ? `合同唯一标识字段：${idColumn}` : "未识别合同唯一标识字段，笔数按数据行数统计。",
    fiveRiskColumn ? `五级分类字段：${fiveRiskColumn}` : "未识别五级分类字段，分类统计将归入“未分类”。",
    balanceColumn ? `贷款余额(万元)字段：${balanceColumn}` : "未识别贷款余额(万元)字段，金额维度按 0 处理。",
    twelveRiskColumn ? `十二级分类字段：${twelveRiskColumn}` : "未识别十二级分类字段，十二级明细降级展示为空。",
    contractAmountColumn ? `合同金额(万元)字段：${contractAmountColumn}` : "未识别合同金额(万元)字段，报告不展示合同金额维度。",
  ];

  return [
    `# ${context.title ?? "整体风险分类分布报告"}${context.version ? ` v${context.version}` : ""}`,
    "",
    "## 一、分析范围",
    `- 数据源：${reportDataSourceName(context.dataSourceLabel)}`,
    `- 样本笔数：${totalCount}`,
    `- 贷款余额(万元)合计：${amountText(totalAmount)}`,
    `- 生成时间：${formatReportDateTime(context.generatedAt)}`,
    "",
    "## 二、整体风险分类分布（笔数+金额）",
    "| 风险分类 | 笔数 | 笔数占比 | 贷款余额(万元) | 金额占比 |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...orderedFive.map((key) => {
      const item = fiveStats.get(key) ?? { count: 0, amount: 0 };
      return `| ${key} | ${item.count} | ${pctText(item.count, totalCount)} | ${amountText(item.amount)} | ${pctText(item.amount, totalAmount)} |`;
    }),
    `| 合计 | ${totalCount} | 100.00% | ${amountText(totalAmount)} | ${totalAmount > 0 ? "100.00%" : "0.00%"} |`,
    "",
    "## 三、核心风险指标",
    `- 关注类占比：${pctText(attentionCount, totalCount)}（笔数），${pctText(attentionAmount, totalAmount)}（金额）。`,
    `- 不良率：${pctText(nonPerformingCount, totalCount)}（笔数），${pctText(nonPerformingAmount, totalAmount)}（金额）。`,
    `- 关注+不良占比：${pctText(attentionCount + nonPerformingCount, totalCount)}（笔数），${pctText(attentionAmount + nonPerformingAmount, totalAmount)}（金额）。`,
    `- 正常3+关注风险边界：${pctText(boundaryCount, totalCount)}（笔数），${pctText(boundaryAmount, totalAmount)}（金额）。`,
    "",
    "## 四、十二级分类明细",
    orderedTwelve.length > 0 ? "| 十二级分类 | 笔数 | 笔数占比 | 贷款余额(万元) | 金额占比 |\n| --- | ---: | ---: | ---: | ---: |" : "未识别十二级分类字段，本节不生成明细表。",
    ...orderedTwelve.map((key) => {
      const item = twelveStats.get(key) ?? { count: 0, amount: 0 };
      return `| ${key} | ${item.count} | ${pctText(item.count, totalCount)} | ${amountText(item.amount)} | ${pctText(item.amount, totalAmount)} |`;
    }),
    "",
    "## 五、分析结论",
    "",
    "### 5.1 【笔数维度】",
    topFive
      ? `笔数维度下，${topFive.key}分类笔数最高，为 ${topFive.count} 笔，占样本 ${pctText(topFive.count, totalCount)}；关注加不良合计 ${attentionCount + nonPerformingCount} 笔，占样本 ${pctText(attentionCount + nonPerformingCount, totalCount)}。`
      : "笔数维度暂无可用分类结论。",
    "",
    "### 5.2 【金额维度】",
    topAmount
      ? `金额维度下，${topAmount.key}分类贷款余额(万元)最高，为 ${amountText(topAmount.amount)}，占余额合计 ${pctText(topAmount.amount, totalAmount)}；不良金额率为 ${pctText(nonPerformingAmount, totalAmount)}。`
      : "金额维度暂无可用分类结论。",
    "",
    "### 5.3 【正常类维度】",
    twelveRiskColumn
      ? `正常类维度口径为十二级分类 latest_risk_result 中含“正常1”“正常2”“正常3”的数据。该口径下正常类总计 ${normalClassCount} 笔，占样本 ${pctText(normalClassCount, totalCount)}，贷款余额(万元) ${amountText(normalClassAmount)}；内部结构为 ${normalClassBreakdown}。`
      : "未识别十二级分类 latest_risk_result 字段，无法按“正常1/正常2/正常3”计算正常类维度。",
    "",
    "### 5.4 风险边界与迁徙风险",
    `风险边界口径为正常3与关注类合并观察，当前风险边界 ${boundaryCount} 笔，占样本 ${pctText(boundaryCount, totalCount)}；无历史时点数据时仅提示潜在迁徙风险，不判断已发生迁徙。`,
    "",
    "## 六、数据质量与口径说明",
    ...qualityNotes.map((note) => `- ${note}`),
    "- 不良类口径：次级、可疑、损失。",
    "- 关注加不良口径：关注、次级、可疑、损失。",
    "- 风险边界口径：正常3与关注类合并观察。",
  ].join("\n");
}

export class AssistantRuntime {
  private db: any;
  private integrityKey: string;
  private abortControllers = new Map<string, AbortController>();
  private readonly options: AssistantRuntimeOptions;
  private readonly workflowStore: WorkflowStateStore;
  private readonly datasetStateManager: SQLiteDatasetStateManager;
  private readonly tempTableRegistry = new TempTableRegistry();
  private readonly sqliteMaterializer: SQLiteMaterializer;
  private readonly workflowContextBuilder: WorkflowContextBuilder;
  private readonly workflowMemoryBridge: SQLiteWorkflowMemoryBridge;
  private readonly toolResultRegistry: ToolResultRegistry;
  private readonly toolArtifactManager: ArtifactManager;

  constructor(options: AssistantRuntimeOptions) {
    this.options = options;
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new Database(options.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.toolResultRegistry = new SQLiteToolResultRegistry(this.db);
    this.toolArtifactManager = new SQLiteArtifactManager(this.db);
    this.workflowStore = new AuditedWorkflowStateStore(new SQLiteWorkflowStateStore(this.db), new SQLiteWorkflowAuditLogger(this.db));
    this.datasetStateManager = new SQLiteDatasetStateManager(this.db, this.workflowStore);
    this.sqliteMaterializer = new SQLiteMaterializer(this.db, {
      sqliteDatabasePath: options.dbPath,
      batchSize: 500,
      maxDatabaseSizeBytes: 1024 * 1024 * 1024,
      onProgress: (progress) => {
        this.db
          .prepare(
            `insert into tool_call_logs
              (id, tool_call_id, conversation_id, user_id, kind, phase, status, message, detail_json, created_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(randomUUID(), null, progress.conversationId, null, "sql", "workflow-materialization-progress", "info", "SQL 结果物化进度更新。", JSON.stringify(progress), nowIso());
      },
    });
    this.workflowContextBuilder = new WorkflowContextBuilder(this.workflowStore, this.datasetStateManager);
    this.workflowMemoryBridge = new SQLiteWorkflowMemoryBridge(this.db);
    this.integrityKey = this.readIntegrityKey();
  }

  listConversations(userId: string): AssistantConversation[] {
    const conversations = this.db
      .prepare("select id, user_id as userId, title, created_at as createdAt, updated_at as updatedAt from conversations where user_id = ? order by updated_at desc")
      .all(userId);
    conversations.forEach((conversation: AssistantConversation) => this.verifyConversationIntegrity(conversation));
    return conversations;
  }

  getConversationMessages(userId: string, conversationId: string): AssistantMessage[] {
    return this.db
      .prepare("select * from messages where user_id = ? and conversation_id = ? order by created_at asc")
      .all(userId, conversationId)
      .map((row: Record<string, unknown>) => this.messageFromRow(row))
      .map((message: AssistantMessage) => this.verifyMessageIntegrity(message));
  }

  createConversation(userId: string, title = "新对话"): AssistantConversation {
    const createdAt = nowIso();
    const conversation: AssistantConversation = {
      id: randomUUID(),
      userId,
      title,
      createdAt,
      updatedAt: createdAt,
    };
    this.db
      .prepare("insert into conversations (id, user_id, title, created_at, updated_at, integrity_hash) values (?, ?, ?, ?, ?, ?)")
      .run(conversation.id, userId, title, createdAt, createdAt, this.hashRecord("conversation", conversation));
    return conversation;
  }

  renameConversation(userId: string, conversationId: string, title: string): AssistantConversation {
    const normalizedTitle = title.trim().slice(0, 200);
    if (!normalizedTitle) {
      throw new Error("记录名称不能为空。");
    }
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话记录不存在。");
    }
    const next: AssistantConversation = {
      ...conversation,
      title: normalizedTitle,
      updatedAt: nowIso(),
    };
    this.persistConversation(next);
    return next;
  }

  deleteConversation(userId: string, conversationId: string): { success: true; conversationId: string } {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话记录不存在。");
    }
    this.db.prepare("delete from conversations where id = ? and user_id = ?").run(conversationId, userId);
    return { success: true, conversationId };
  }

  async sendMessage(input: AssistantSendInput): Promise<AssistantSendResult> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error("消息内容不能为空。");
    }
    if (!input.modelName.trim()) {
      throw new Error("请先在用户设置中配置模型名称。");
    }

    const replay = this.db.prepare("select id from messages where client_request_id = ?").get(input.clientRequestId);
    if (replay) {
      throw new Error("检测到重复消息请求，已阻止重放。");
    }

    const conversation = input.conversationId
      ? this.findConversation(input.userId, input.conversationId) ?? this.createConversation(input.userId)
      : this.createConversation(input.userId, prompt.slice(0, 18) || "新对话");

    if (conversation.title === "新对话") {
      conversation.title = prompt.slice(0, 18) || "新对话";
      conversation.updatedAt = nowIso();
      this.persistConversation(conversation);
    }

    const userMessage = this.insertMessage({
      conversationId: conversation.id,
      userId: input.userId,
      role: "user",
      status: "sent",
      content: prompt,
      blocks: [{ id: randomUUID(), type: "text", content: prompt }],
      clientRequestId: input.clientRequestId,
      context: {
        dataSourceLabel: input.dataSourceLabel ?? null,
        skill: input.skill ?? null,
      },
    });
    const assistantMessage = this.insertMessage({
      conversationId: conversation.id,
      userId: input.userId,
      role: "assistant",
      status: "receiving",
      content: "",
      blocks: [{ id: randomUUID(), type: "text", content: "" }],
    });

    this.options.emit({ type: "conversation", conversation });
    this.options.emit({ type: "message", conversationId: conversation.id, message: userMessage });
    this.options.emit({ type: "message", conversationId: conversation.id, message: assistantMessage });

    const tool = detectTool(prompt);
    if (!shouldRouteSkillThroughModel(input.skill) && await this.routeOverallRiskSkillWorkflow(input, conversation, assistantMessage)) {
      // Routed to the governed multi-step skill workflow.
    } else if (tool) {
      void this.handleToolCall(input, conversation, assistantMessage, tool);
    } else if (await this.routePriorSqlAnalysis(input, conversation, assistantMessage)) {
      // Routed to a governed Python tool call.
    } else {
      void this.streamModelResponse(input, conversation, assistantMessage);
    }

    return { success: true, conversation, userMessage, assistantMessage };
  }

  async approveTool(userId: string, toolCallId: string, approved: boolean) {
    const row = this.db.prepare("select * from tool_calls where id = ? and user_id = ?").get(toolCallId, userId);
    if (!row) {
      const orchestrationRecord = await this.toolResultRegistry.get(toolCallId);
      if (orchestrationRecord) {
        return this.approveOrchestrationTool(userId, orchestrationRecord, approved);
      }
      throw new Error("工具调用不存在。");
    }
    const toolCall = this.toolCallFromRow(row);
    if (toolCall.status !== "pending_approval") {
      throw new Error("工具调用状态已变更，无法重复审批。");
    }

    if (!approved) {
      const next = this.updateToolCall(toolCall.id, "declined", undefined, "用户已拒绝执行该工具调用。");
      const message = this.updateMessage(toolCall.messageId, {
        status: "stopped",
        content: "用户已拒绝执行该工具调用。",
        blocks: [this.toolBlock(next, "用户已拒绝执行该工具调用。")],
        errorMessage: "用户拒绝",
      });
      this.options.emit({ type: "tool", conversationId: toolCall.conversationId, toolCall: next, message });
      return { success: true as const, toolCall: next, message };
    }

    return this.executeToolCall(toolCall);
  }

  async getWorkflowContext(userId: string, conversationId: string) {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }
    await this.cleanupExpiredWorkflowDatasets(conversationId);
    return this.workflowContextBuilder.build(conversationId);
  }

  async getConversationToolState(userId: string, conversationId: string) {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }
    return this.toolResultRegistry.getConversationState(conversation.id);
  }

  async listConversationToolCalls(userId: string, conversationId: string) {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }
    return this.toolResultRegistry.listByConversation(conversation.id);
  }

  async getLatestConversationToolResult(userId: string, conversationId: string, toolKind: ToolKind) {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }
    return this.toolResultRegistry.getLatestSuccessful(conversation.id, toolKind);
  }

  async selectConversationToolResult(userId: string, conversationId: string, toolKind: ToolKind, toolCallId: string) {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }
    await this.toolResultRegistry.selectResult(conversation.id, toolKind, toolCallId);
    const record = await this.toolResultRegistry.get(toolCallId);
    if (record) {
      await this.workflowMemoryBridge.writeWorkflowMemory({
        conversationId: conversation.id,
        userId,
        type: `${toolKind}_selected`,
        summary: `用户已选择 ${TOOL_NAMES[toolKind]} v${record.version} 作为后续默认输入。`,
        payload: {
          toolCallId,
          toolKind,
          version: record.version,
          artifactIds: record.outputArtifactIds ?? record.result?.artifactIds ?? [],
          parentToolCallIds: record.parentToolCallIds ?? [],
          sourceArtifactIds: record.sourceArtifactIds ?? [],
        },
      });
    }
    const state = await this.toolResultRegistry.getConversationState(conversation.id);
    this.options.emit({
      type: "tool-state",
      conversationId: conversation.id,
      state,
    });
    return state;
  }

  async getConversationToolArtifact(userId: string, conversationId: string, artifactId: string): Promise<ArtifactRecord | null> {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }
    const normalizedArtifactId = artifactId.trim();
    if (!normalizedArtifactId) {
      throw new Error("Artifact ID 不能为空。");
    }
    const toolCalls = await this.toolResultRegistry.listByConversation(conversation.id);
    const isConversationArtifact = toolCalls.some((toolCall) =>
      [...(toolCall.outputArtifactIds ?? []), ...(toolCall.result?.artifactIds ?? [])].includes(normalizedArtifactId),
    );
    if (!isConversationArtifact) {
      return null;
    }
    return this.toolArtifactManager.getArtifact(normalizedArtifactId);
  }

  async confirmWorkflowDataset(userId: string, conversationId: string, datasetId?: string) {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }
    const dataset = datasetId ? await this.datasetStateManager.getDataset(datasetId) : await this.datasetStateManager.getActiveDataset(conversationId);
    if (!dataset) {
      throw new Error("当前没有可确认的数据集。");
    }
    const confirmed = await this.datasetStateManager.confirmDataset(dataset.datasetId);
    await this.workflowMemoryBridge.writeWorkflowMemory({
      conversationId,
      userId,
      type: "dataset_confirmed",
      summary: `数据集 ${confirmed.name} 已确认，可用于 Python 分析和报告生成。`,
      payload: {
        datasetId: confirmed.datasetId,
        rowCount: confirmed.rowCount,
        columnCount: confirmed.columnCount,
        sqliteTableName: confirmed.sqliteTableName,
      },
    });
    const workflow = await this.workflowStore.get(confirmed.workflowId);
    if (workflow) {
      await this.workflowStore.update(workflow.workflowId, {
        status: "waiting_python_approval",
        activeDatasetId: confirmed.datasetId,
        confirmedDatasetId: confirmed.datasetId,
        steps: [
          ...workflow.steps,
          {
            stepId: randomUUID(),
            type: "user_confirmation",
            status: "success",
            input: { datasetId: confirmed.datasetId },
            output: { canAnalyze: true, canUseForReport: true },
            completedAt: nowIso(),
          },
        ],
      });
      await this.workflowStore.appendEvent(workflow.workflowId, {
        eventId: randomUUID(),
        workflowId: workflow.workflowId,
        conversationId,
        type: "dataset_confirmed",
        message: "用户已确认工作流数据集。",
        payload: { datasetId: confirmed.datasetId },
        createdAt: nowIso(),
      });
    }
    const context = await this.workflowContextBuilder.build(conversationId);
    this.options.emit({ type: "workflow", conversationId, context });
    return { success: true as const, dataset: confirmed, context };
  }

  async rejectWorkflowDataset(userId: string, conversationId: string, datasetId: string, reason?: string) {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }
    const workflow = await this.workflowStore.getActiveByConversation(conversationId);
    if (!workflow) {
      throw new Error("当前没有可拒绝的数据集。");
    }
    const rejected = await this.datasetStateManager.rejectDataset(datasetId, reason);
    await this.workflowMemoryBridge.writeWorkflowMemory({
      conversationId,
      userId,
      type: "dataset_rejected",
      summary: `数据集 ${rejected.name} 已被拒绝，后续分析不会使用该数据集。`,
      payload: {
        datasetId: rejected.datasetId,
        reason,
      },
    });
    await this.workflowStore.update(workflow.workflowId, {
      status: "waiting_user_confirmation",
      activeDatasetId: workflow.activeDatasetId === rejected.datasetId ? undefined : workflow.activeDatasetId,
      latestSqlDatasetId: workflow.latestSqlDatasetId === rejected.datasetId ? undefined : workflow.latestSqlDatasetId,
      confirmedDatasetId: workflow.confirmedDatasetId === rejected.datasetId ? undefined : workflow.confirmedDatasetId,
      steps: [
        ...workflow.steps,
        {
          stepId: randomUUID(),
          type: "user_confirmation",
          status: "failed",
          input: { datasetId: rejected.datasetId, reason },
          completedAt: nowIso(),
        },
      ],
    });
    await this.workflowStore.appendEvent(workflow.workflowId, {
      eventId: randomUUID(),
      workflowId: workflow.workflowId,
      conversationId,
      type: "dataset_rejected",
      message: "用户已拒绝工作流数据集。",
      payload: { datasetId: rejected.datasetId, reason },
      createdAt: nowIso(),
    });
    const context = await this.workflowContextBuilder.build(conversationId);
    this.options.emit({ type: "workflow", conversationId, context });
    return { success: true as const, dataset: rejected, context };
  }

  cancelMessage(messageId: string) {
    const controller = this.abortControllers.get(messageId);
    controller?.abort();
    this.abortControllers.delete(messageId);
  }

  async retryAssistantMessage(input: AssistantRetryInput): Promise<AssistantRetryResult> {
    const modelName = input.modelName.trim();
    if (!modelName) {
      throw new Error("请先在用户设置中配置模型名称。");
    }

    const sourceMessageRow = this.db.prepare("select * from messages where id = ? and user_id = ?").get(input.messageId, input.userId);
    if (!sourceMessageRow) {
      throw new Error("待重试消息不存在。");
    }
    const sourceMessage = this.messageFromRow(sourceMessageRow);
    if (sourceMessage.role !== "assistant") {
      throw new Error("仅支持重试助手消息。");
    }
    if (sourceMessage.status !== "error") {
      throw new Error("当前消息状态不支持重试。");
    }

    const conversation = this.findConversation(input.userId, sourceMessage.conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }

    const sourceUserRow = this.db
      .prepare(
        `select *
         from messages
         where conversation_id = ?
           and user_id = ?
           and role = 'user'
           and created_at <= ?
         order by created_at desc
         limit 1`,
      )
      .get(sourceMessage.conversationId, input.userId, sourceMessage.createdAt);
    if (!sourceUserRow) {
      throw new Error("未找到可重试的用户问题。");
    }

    const sourceUserMessage = this.messageFromRow(sourceUserRow);
    const assistantMessage = this.insertMessage({
      conversationId: conversation.id,
      userId: input.userId,
      role: "assistant",
      status: "receiving",
      content: "",
      blocks: [{ id: randomUUID(), type: "text", content: "" }],
      clientRequestId: input.clientRequestId,
    });

    const nextConversation = this.findConversation(input.userId, conversation.id) ?? conversation;
    this.options.emit({ type: "conversation", conversation: nextConversation });
    this.options.emit({ type: "message", conversationId: conversation.id, message: assistantMessage });

    const retryInput = {
      userId: input.userId,
      conversationId: conversation.id,
      clientRequestId: input.clientRequestId,
      prompt: sourceUserMessage.content,
      modelName,
      dataSourceLabel: input.dataSourceLabel,
      schemaContextMarkdown: input.schemaContextMarkdown,
      skill: input.skill,
      approvalMode: input.approvalMode,
    };

    if (!shouldRouteSkillThroughModel(retryInput.skill) && await this.routeOverallRiskSkillWorkflow(retryInput, nextConversation, assistantMessage)) {
      // Routed to the governed multi-step skill workflow.
    } else if (!(await this.routePriorSqlAnalysis(retryInput, nextConversation, assistantMessage))) {
      void this.streamModelResponse(retryInput, nextConversation, assistantMessage);
    }

    return { success: true, conversation: nextConversation, assistantMessage };
  }

  private migrate() {
    this.db.exec(`
      create table if not exists metadata (
        key text primary key,
        value text not null
      );
      create table if not exists conversations (
        id text primary key,
        user_id text not null,
        title text not null,
        created_at text not null,
        updated_at text not null,
        archived_at text,
        integrity_hash text not null
      );
      create table if not exists messages (
        id text primary key,
        conversation_id text not null references conversations(id) on delete cascade,
        user_id text not null,
        role text not null,
        status text not null,
        content text not null,
        blocks_json text not null,
        created_at text not null,
        updated_at text not null,
        error_message text,
        integrity_hash text not null,
        previous_hash text,
        client_request_id text unique,
        provider_trace_id text,
        context_json text
      );
      create table if not exists tool_calls (
        id text primary key,
        conversation_id text not null,
        message_id text not null references messages(id) on delete cascade,
        user_id text not null,
        kind text not null,
        status text not null,
        script text not null,
        result_json text,
        error_message text,
        approval_mode text not null,
        created_at text not null,
        updated_at text not null,
        integrity_hash text not null
      );
      create table if not exists tool_call_logs (
        id text primary key,
        tool_call_id text,
        conversation_id text,
        user_id text,
        kind text not null,
        phase text not null,
        status text not null,
        message text not null,
        detail_json text,
        created_at text not null
      );
      create index if not exists idx_conversations_user_updated on conversations(user_id, updated_at desc);
      create index if not exists idx_messages_conversation_created on messages(conversation_id, created_at);
      create index if not exists idx_tool_call_logs_tool_created on tool_call_logs(tool_call_id, created_at);
    `);
    try {
      this.db.prepare("alter table messages add column context_json text").run();
    } catch {
      // Column already exists in migrated local databases.
    }
  }

  private readIntegrityKey() {
    const row = this.db.prepare("select value from metadata where key = 'integrity_key'").get();
    if (row?.value) {
      return row.value as string;
    }
    const key = randomBytes(32).toString("base64url");
    this.db.prepare("insert into metadata (key, value) values ('integrity_key', ?)").run(key);
    return key;
  }

  private hashRecord(scope: string, value: unknown, previousHash = "") {
    return createHmac("sha256", this.integrityKey).update(scope).update("\n").update(stableJson(value)).update("\n").update(previousHash).digest("hex");
  }

  private findConversation(userId: string, conversationId: string): AssistantConversation | null {
    const row = this.db
      .prepare("select id, user_id as userId, title, created_at as createdAt, updated_at as updatedAt from conversations where id = ? and user_id = ?")
      .get(conversationId, userId);
    if (!row) {
      return null;
    }
    return this.verifyConversationIntegrity(row as AssistantConversation);
  }

  private insertMessage(input: {
    conversationId: string;
    userId: string;
    role: AssistantMessageRole;
    status: AssistantMessageStatus;
    content: string;
    blocks: AssistantBlock[];
    clientRequestId?: string;
    errorMessage?: string;
    context?: AssistantMessageContext;
  }): AssistantMessage {
    const createdAt = nowIso();
    const previous = this.db
      .prepare("select integrity_hash from messages where conversation_id = ? order by created_at desc limit 1")
      .get(input.conversationId);
    const draft = {
      id: randomUUID(),
      conversationId: input.conversationId,
      userId: input.userId,
      role: input.role,
      status: input.status,
      content: input.content,
      blocks: input.blocks,
      createdAt,
      updatedAt: createdAt,
      errorMessage: input.errorMessage,
      previousHash: previous?.integrity_hash,
      clientRequestId: input.clientRequestId,
      context: input.context,
    };
    const integrityHash = this.hashRecord("message", draft, draft.previousHash);
    const message: AssistantMessage = { ...draft, integrityHash };
    this.db
      .prepare(
        `insert into messages
          (id, conversation_id, user_id, role, status, content, blocks_json, created_at, updated_at, error_message, integrity_hash, previous_hash, client_request_id, context_json)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.conversationId,
        message.userId,
        message.role,
        message.status,
        message.content,
        JSON.stringify(message.blocks),
        message.createdAt,
        message.updatedAt,
        message.errorMessage ?? null,
        message.integrityHash,
        message.previousHash ?? null,
        message.clientRequestId ?? null,
        message.context ? JSON.stringify(message.context) : null,
      );
    this.touchConversation(message.conversationId);
    return message;
  }

  private updateMessage(messageId: string, patch: Partial<Pick<AssistantMessage, "status" | "content" | "blocks" | "errorMessage" | "providerTraceId">>) {
    const current = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(messageId));
    const updatedAt = nowIso();
    const next: AssistantMessage = {
      ...current,
      ...patch,
      blocks: patch.blocks ?? current.blocks,
      updatedAt,
    };
    next.integrityHash = this.hashRecord("message", { ...next, integrityHash: undefined }, next.previousHash);
    this.db
      .prepare("update messages set status = ?, content = ?, blocks_json = ?, updated_at = ?, error_message = ?, provider_trace_id = ?, integrity_hash = ? where id = ?")
      .run(next.status, next.content, JSON.stringify(next.blocks), next.updatedAt, next.errorMessage ?? null, next.providerTraceId ?? null, next.integrityHash, messageId);
    this.touchConversation(next.conversationId);
    return next;
  }

  private touchConversation(conversationId: string) {
    const current = this.db
      .prepare("select id, user_id as userId, title, created_at as createdAt, updated_at as updatedAt from conversations where id = ?")
      .get(conversationId) as AssistantConversation | undefined;
    if (!current) {
      return;
    }
    current.updatedAt = nowIso();
    this.persistConversation(current);
  }

  private persistConversation(conversation: AssistantConversation) {
    const integrityHash = this.hashRecord("conversation", conversation);
    this.db
      .prepare("update conversations set title = ?, updated_at = ?, integrity_hash = ? where id = ?")
      .run(conversation.title, conversation.updatedAt, integrityHash, conversation.id);
  }

  private messageFromRow(row: Record<string, unknown>): AssistantMessage {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      userId: row.user_id as string,
      role: row.role as AssistantMessageRole,
      status: row.status as AssistantMessageStatus,
      content: row.content as string,
      blocks: JSON.parse(row.blocks_json as string) as AssistantBlock[],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      errorMessage: (row.error_message as string | null) ?? undefined,
      integrityHash: row.integrity_hash as string,
      previousHash: (row.previous_hash as string | null) ?? undefined,
      clientRequestId: (row.client_request_id as string | null) ?? undefined,
      providerTraceId: (row.provider_trace_id as string | null) ?? undefined,
      context: row.context_json ? (JSON.parse(row.context_json as string) as AssistantMessageContext) : undefined,
    };
  }

  private verifyConversationIntegrity(conversation: AssistantConversation) {
    const stored = this.db.prepare("select integrity_hash from conversations where id = ?").get(conversation.id) as { integrity_hash?: string } | undefined;
    const expected = this.hashRecord("conversation", conversation);
    if (!stored?.integrity_hash || stored.integrity_hash !== expected) {
      throw new Error(`本地会话完整性校验失败：${conversation.id}`);
    }
    return conversation;
  }

  private verifyMessageIntegrity(message: AssistantMessage) {
    const expected = this.hashRecord(
      "message",
      {
        ...message,
        integrityHash: undefined,
      },
      message.previousHash,
    );
    if (message.integrityHash !== expected) {
      throw new Error(`本地消息完整性校验失败：${message.id}`);
    }
    return message;
  }

  private toolCallFromRow(row: Record<string, unknown>): AssistantToolCall {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      messageId: row.message_id as string,
      userId: row.user_id as string,
      kind: row.kind as AssistantToolKind,
      status: row.status as AssistantToolStatus,
      script: row.script as string,
      result: (row.result_json as string | null) ?? undefined,
      errorMessage: (row.error_message as string | null) ?? undefined,
      approvalMode: row.approval_mode as AssistantApprovalMode,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private latestCompletedToolCall(userId: string, conversationId: string, kind?: AssistantToolKind) {
    const row = this.db
      .prepare(
        `select *
         from tool_calls
         where conversation_id = ?
           and user_id = ?
           and status = 'completed'
           ${kind ? "and kind = ?" : ""}
         order by updated_at desc
         limit 1`,
      )
      .get(...(kind ? [conversationId, userId, kind] : [conversationId, userId]));
    return row ? this.toolCallFromRow(row) : null;
  }

  private recentCompletedToolCalls(userId: string, conversationId: string, limit = 3) {
    return (this.db
      .prepare(
        `select *
         from tool_calls
         where conversation_id = ?
           and user_id = ?
           and status = 'completed'
         order by updated_at desc
         limit ?`,
      )
      .all(conversationId, userId, limit) as Array<Record<string, unknown>>).map((row) => this.toolCallFromRow(row));
  }

  private async latestSqlRowsForConversation(userId: string, conversationId: string) {
    const latestSqlToolCall = this.latestCompletedToolCall(userId, conversationId, "sql");
    const latestSqlDataset = await this.datasetStateManager.getLatestSqlDataset(conversationId);
    return {
      latestSqlToolCall,
      rows: this.rowsForSqlAnalysis(latestSqlToolCall ?? undefined, latestSqlDataset ?? undefined),
    };
  }

  private shouldReplacePythonScript(script: string) {
    return /\bwf_[a-z0-9_]+\b/i.test(script) || /\bsqlite3\.connect\s*\(/i.test(script) || /\bimport\s+(pandas|numpy)\b|\bfrom\s+(pandas|numpy)\b/i.test(script);
  }

  private async normalizePythonToolScript(input: { userId: string; conversationId: string; prompt?: string; script: string }) {
    if (!this.shouldReplacePythonScript(input.script)) {
      return input.script;
    }
    const { latestSqlToolCall, rows } = await this.latestSqlRowsForConversation(input.userId, input.conversationId);
    if (!latestSqlToolCall || rows.length === 0) {
      return input.script;
    }
    return this.buildPythonAnalysisScript(input.prompt || this.sourcePromptForToolCall(latestSqlToolCall) || "基于上一轮 SQL 结果输出分析报告。", latestSqlToolCall, rows);
  }

  private recentToolContext(userId: string, conversationId: string) {
    const toolCalls = this.recentCompletedToolCalls(userId, conversationId);
    if (toolCalls.length === 0) {
      return null;
    }

    return truncateText(
      [
        "最近已完成工具调用摘要（供后续自然语言分析复用，除非用户明确要求重新查询，否则不要重复发起 SQL；完整数据请通过工作流数据集或 Python 工具读取）：",
        ...toolCalls.map((toolCall, index) => {
          const rows = toolCall.kind === "sql" ? parseSqlToolPreviewRows(toolCall.result) : [];
          const rowCount = toolCall.kind === "sql" ? parseSqlToolRowCount(toolCall.result) : null;
          const columns = rows[0] ? Object.keys(rows[0]) : [];
          return [
            `## Tool Result ${index + 1}`,
            `kind: ${toolCall.kind}`,
            `updatedAt: ${toolCall.updatedAt}`,
            `rowCount: ${toolCall.kind === "sql" ? rowCount ?? "--" : "--"}`,
            `columns: ${columns.length > 0 ? columns.join(", ") : "--"}`,
            "script:",
            "```",
            toolCall.script,
            "```",
          ].join("\n");
        }),
      ].join("\n\n"),
      MAX_TOOL_CONTEXT_CHARS,
    );
  }

  private async routePriorSqlAnalysis(input: AssistantSendInput, conversation: AssistantConversation, assistantMessage: AssistantMessage) {
    if (!shouldAnalyzePriorSqlResult(input.prompt)) {
      return false;
    }

    const latestSqlToolCall = this.latestCompletedToolCall(input.userId, conversation.id, "sql");
    const latestSqlDataset = await this.datasetStateManager.getLatestSqlDataset(conversation.id);
    const rows = this.rowsForSqlAnalysis(latestSqlToolCall ?? undefined, latestSqlDataset ?? undefined);
    if (!latestSqlToolCall || rows.length === 0) {
      return false;
    }

    this.appendToolLog(
      {
        conversationId: conversation.id,
        userId: input.userId,
        kind: "python",
      },
      "workflow-routing",
      "info",
      "用户要求基于上一轮 SQL 查询结果继续分析，已路由到 Python 工具调用，避免重复生成 SQL。",
      {
        latestSqlToolCallId: latestSqlToolCall.id,
        latestSqlDatasetId: latestSqlDataset?.datasetId,
        prompt: input.prompt,
      },
    );

    void this.handleToolCall(input, conversation, assistantMessage, {
      kind: "python",
      script: this.buildPythonAnalysisScript(input.prompt, latestSqlToolCall, rows),
    });
    return true;
  }

  private rowsForSqlAnalysis(sqlToolCall?: AssistantToolCall, dataset?: WorkflowDatasetRef) {
    if (dataset?.sqliteTableName) {
      try {
        const tableName = quoteIdentifier(dataset.sqliteTableName);
        return this.db.prepare(`select * from ${tableName}`).all() as Array<Record<string, unknown>>;
      } catch {
        // Fall back to the tool-call preview rows below. Missing materialized tables should not block approval routing.
      }
    }
    return parseSqlToolRows(sqlToolCall?.result);
  }

  private buildPythonAnalysisScript(prompt: string, sqlToolCall: AssistantToolCall, rowsOverride?: Array<Record<string, unknown>>) {
    const rows = rowsOverride?.length ? rowsOverride : parseSqlToolRows(sqlToolCall.result);
    const rowsJson = JSON.stringify(rows);
    const promptJson = JSON.stringify(prompt);
    return [
      "import json, re",
      "from collections import Counter, defaultdict",
      "from datetime import datetime, timezone",
      "",
      `rows = json.loads(${JSON.stringify(rowsJson)})`,
      `question = ${promptJson}`,
      "",
      "def pct(value, total):",
      "    return round(value * 100.0 / total, 2) if total else 0.0",
      "",
      "def number(row, key):",
      "    try:",
      "        return float(row.get(key) or 0)",
      "    except (TypeError, ValueError):",
      "        return 0.0",
      "",
      "def pick_field(keys, candidates):",
      "    risk_candidates = any('risk' in candidate.lower() or '分类' in candidate for candidate in candidates)",
      "    lowered = {str(key).lower(): key for key in keys}",
      "    for candidate in candidates:",
      "        if candidate.lower() in lowered:",
      "            matched = lowered[candidate.lower()]",
      "            if not risk_candidates or not re.search(r'date|time|classified_at|日期|时间|p_date|partition_date', str(matched), re.I):",
      "                return matched",
      "    for key in keys:",
      "        text = str(key).lower()",
      "        if risk_candidates and re.search(r'date|time|classified_at|日期|时间|p_date|partition_date', str(key), re.I):",
      "            continue",
      "        if any(candidate.lower() in text for candidate in candidates):",
      "            return key",
      "    return None",
      "",
      "def five_bucket(value):",
      "    text = str(value or '').strip()",
      "    if '损失' in text:",
      "        return '损失'",
      "    if '可疑' in text:",
      "        return '可疑'",
      "    if '次级' in text:",
      "        return '次级'",
      "    if '关注' in text:",
      "        return '关注'",
      "    if '正常' in text:",
      "        return '正常'",
      "    if '不良' in text:",
      "        return '不良'",
      "    return text or '未分类'",
      "",
      "total_rows = len(rows)",
      "keys = set(rows[0].keys()) if rows else set()",
      "raw_risk_field = pick_field(keys, ['five_level_classification', 'latest_risk', 'latest_five_level_risk', 'latest_five_level_risk_class', 'risk_classification', 'risk_level', '最新风险分类', '五级分类', '最新风险五级分类'])",
      "raw_balance_field = pick_field(keys, ['loan_balance_10k', 'loan_balance', 'balance', '贷款余额(万元)', '贷款余额', '本金余额'])",
      "raw_amount_field = pick_field(keys, ['contract_amount_10k', 'contract_amount', '合同金额(万元)', '合同金额', '授信金额'])",
      "term_field = 'loan_term_type'",
      "branch_field = 'branch_name'",
      "preferred_terms = ['短期', '中期', '长期']",
      "lines = []",
      "lines.append('# SQL查询结果统计分析报告')",
      "lines.append('')",
      "lines.append(f'- 分析对象：上一轮 SQL 工具调用返回结果')",
      "lines.append(f'- 样本行数：{total_rows}')",
      "lines.append(f'- 说明：以下结论仅基于已返回的 SQL 工具结果数据，不重新查询数据源。')",
      "lines.append('')",
      "",
      "if not rows:",
      "    lines.append('## 结论')",
      "    lines.append('上一轮 SQL 工具调用未返回可分析行数据。')",
      "elif {'five_level', 'contract_count'}.issubset(set(rows[0].keys())):",
      "    def number(row, key):",
      "        try:",
      "            return float(row.get(key) or 0)",
      "        except (TypeError, ValueError):",
      "            return 0.0",
      "    total_count = sum(int(number(row, 'contract_count')) for row in rows)",
      "    total_balance = sum(number(row, 'total_balance') for row in rows)",
      "    total_amount = sum(number(row, 'total_amount') for row in rows)",
      "    lines.append('## 整体风险分类分布（笔数+金额）')",
      "    lines.append('| 风险分类 | 笔数 | 笔数占比 | 贷款余额(万元) | 余额占比 | 合同金额(万元) | 金额占比 |')",
      "    lines.append('|---|---:|---:|---:|---:|---:|---:|')",
      "    risk_order = {'正常': 1, '关注': 2, '不良': 3, '次级': 4, '可疑': 5, '损失': 6}",
      "    ordered_rows = sorted(rows, key=lambda row: risk_order.get(str(row.get('five_level') or ''), 99))",
      "    for row in ordered_rows:",
      "        count = int(number(row, 'contract_count'))",
      "        balance = number(row, 'total_balance')",
      "        amount = number(row, 'total_amount')",
      "        lines.append(f\"| {row.get('five_level') or '--'} | {count} | {pct(count, total_count)}% | {round(balance, 2)} | {pct(balance, total_balance)}% | {round(amount, 2)} | {pct(amount, total_amount)}% |\")",
      "    lines.append(f\"| 合计 | {total_count} | 100.0% | {round(total_balance, 2)} | {100.0 if total_balance else 0.0}% | {round(total_amount, 2)} | {100.0 if total_amount else 0.0}% |\")",
      "    attention_count = sum(int(number(row, 'contract_count')) for row in rows if '关注' in str(row.get('five_level') or ''))",
      "    npl_count = sum(int(number(row, 'contract_count')) for row in rows if any(key in str(row.get('five_level') or '') for key in ['不良', '次级', '可疑', '损失']))",
      "    attention_balance = sum(number(row, 'total_balance') for row in rows if '关注' in str(row.get('five_level') or ''))",
      "    npl_balance = sum(number(row, 'total_balance') for row in rows if any(key in str(row.get('five_level') or '') for key in ['不良', '次级', '可疑', '损失']))",
      "    lines.append('')",
      "    lines.append('## 核心风险指标')",
      "    lines.append(f'- 关注类占比：{pct(attention_count, total_count)}%（笔数），{pct(attention_balance, total_balance)}%（余额）。')",
      "    lines.append(f'- 不良率：{pct(npl_count, total_count)}%（笔数），{pct(npl_balance, total_balance)}%（余额）。')",
      "    lines.append(f'- 关注+不良占比：{pct(attention_count + npl_count, total_count)}%（笔数），{pct(attention_balance + npl_balance, total_balance)}%（余额）。')",
      "    lines.append('')",
      "    lines.append('## 数据质量与口径说明')",
      "    lines.append('- 本次 SQL 已返回风险分类聚合结果，报告基于聚合结果计算。')",
      "    lines.append('- 不良类口径：次级、可疑、损失；关注加不良口径：关注、次级、可疑、损失。')",
      "elif raw_risk_field and (raw_balance_field or raw_amount_field):",
      "    stats = defaultdict(lambda: {'count': 0, 'balance': 0.0, 'amount': 0.0})",
      "    for row in rows:",
      "        bucket = five_bucket(row.get(raw_risk_field))",
      "        stats[bucket]['count'] += 1",
      "        if raw_balance_field:",
      "            stats[bucket]['balance'] += number(row, raw_balance_field)",
      "        if raw_amount_field:",
      "            stats[bucket]['amount'] += number(row, raw_amount_field)",
      "    total_count = sum(item['count'] for item in stats.values())",
      "    total_balance = sum(item['balance'] for item in stats.values())",
      "    total_amount = sum(item['amount'] for item in stats.values())",
      "    risk_order = {'正常': 1, '关注': 2, '不良': 3, '次级': 4, '可疑': 5, '损失': 6, '未分类': 99}",
      "    ordered = sorted(stats.items(), key=lambda item: risk_order.get(item[0], 50))",
      "    lines.append('## 整体风险分类分布（笔数+金额）')",
      "    lines.append('| 风险分类 | 笔数 | 笔数占比 | 贷款余额(万元) | 余额占比 | 合同金额(万元) | 金额占比 |')",
      "    lines.append('|---|---:|---:|---:|---:|---:|---:|')",
      "    for bucket, item in ordered:",
      "        lines.append(f\"| {bucket} | {item['count']} | {pct(item['count'], total_count)}% | {round(item['balance'], 2)} | {pct(item['balance'], total_balance)}% | {round(item['amount'], 2)} | {pct(item['amount'], total_amount)}% |\")",
      "    lines.append(f\"| 合计 | {total_count} | 100.0% | {round(total_balance, 2)} | {100.0 if total_balance else 0.0}% | {round(total_amount, 2)} | {100.0 if total_amount else 0.0}% |\")",
      "    attention_count = stats.get('关注', {}).get('count', 0)",
      "    npl_count = sum(stats.get(key, {}).get('count', 0) for key in ['不良', '次级', '可疑', '损失'])",
      "    attention_balance = stats.get('关注', {}).get('balance', 0.0)",
      "    npl_balance = sum(stats.get(key, {}).get('balance', 0.0) for key in ['不良', '次级', '可疑', '损失'])",
      "    lines.append('')",
      "    lines.append('## 核心风险指标')",
      "    lines.append(f'- 关注类占比：{pct(attention_count, total_count)}%（笔数），{pct(attention_balance, total_balance)}%（余额）。')",
      "    lines.append(f'- 不良率：{pct(npl_count, total_count)}%（笔数），{pct(npl_balance, total_balance)}%（余额）。')",
      "    lines.append(f'- 关注+不良占比：{pct(attention_count + npl_count, total_count)}%（笔数），{pct(attention_balance + npl_balance, total_balance)}%（余额）。')",
      "    lines.append('')",
      "    lines.append('## 数据质量与口径说明')",
      "    lines.append(f'- 风险分类字段：{raw_risk_field}；贷款余额(万元)字段：{raw_balance_field or \"未提供\"}；合同金额(万元)字段：{raw_amount_field or \"未提供\"}。')",
      "    lines.append('- 不良类口径：次级、可疑、损失；关注加不良口径：关注、次级、可疑、损失。')",
      "elif 'accounting_org_name' in rows[0] and 'latest_risk_result' in rows[0] and ('柱状图' in question or '条形图' in question or '图表' in question or '可视化' in question or '报告' in question):",
      "    branch_field = 'accounting_org_name'",
      "    risk_result_field = 'latest_risk_result'",
      "    def requested_value_for(field_name):",
      "        position = question.find(field_name)",
      "        if position < 0:",
      "            return None",
      "        segment = question[position:position + 120]",
      "        quoted = re.findall(r'[“\"「『]([^”\"」』]+)[”\"」』]', segment)",
      "        for value in quoted:",
      "            if value != field_name:",
      "                return value",
      "        match = re.search(r'为\\s*([^，,。；;\\s]+)', segment)",
      "        return match.group(1) if match else None",
      "    target_value = requested_value_for(risk_result_field) or ('0300--次级' if '0300--次级' in question else None)",
      "    count_field = next((key for key in ['record_count', 'cnt', 'count', 'total_count', '总计数量'] if key in rows[0]), None)",
      "    filtered = []",
      "    for row in rows:",
      "        if target_value and str(row.get(risk_result_field) or '').strip() != target_value:",
      "            continue",
      "        filtered.append(row)",
      "    counter = Counter()",
      "    for row in filtered:",
      "        branch = row.get(branch_field) or '--'",
      "        if count_field:",
      "            try:",
      "                counter[branch] += int(float(row.get(count_field) or 0))",
      "            except (TypeError, ValueError):",
      "                counter[branch] += 0",
      "        else:",
      "            counter[branch] += 1",
      "    chart_rows = [{'accounting_org_name': branch, 'record_count': count} for branch, count in counter.most_common()]",
      "    total_count = sum(item['record_count'] for item in chart_rows)",
      "    lines.append('## 分行最近风险结果统计')",
      "    lines.append(f'- 统计口径：{risk_result_field} = {target_value or \"全部\"}')",
      "    lines.append(f'- 命中记录总数：{total_count}')",
      "    lines.append('')",
      "    lines.append('| 排名 | 分行 | 总计数量 | 占比 |')",
      "    lines.append('|---:|---|---:|---:|')",
      "    for rank, item in enumerate(chart_rows, start=1):",
      "        lines.append(f\"| {rank} | {item['accounting_org_name']} | {item['record_count']} | {pct(item['record_count'], total_count)}% |\")",
      "    lines.append('')",
      "    if chart_rows:",
      "        top_item = chart_rows[0]",
      "        lines.append('## 分析结论')",
      "        lines.append(f\"- {target_value or '目标风险结果'}记录主要集中在 {top_item['accounting_org_name']}，总计 {top_item['record_count']} 条，占比 {pct(top_item['record_count'], total_count)}%。\")",
      "        lines.append('- 建议优先复核排名靠前分行的客户结构、风险迁徙原因和贷后处置进度。')",
      "    else:",
      "        lines.append('## 分析结论')",
      "        lines.append('- 当前 SQL 结果中未命中指定风险结果，暂无可绘制的分行柱状图。')",
      "    if chart_rows:",
      "        chart_rows_for_spec = chart_rows[:200]",
      "        spec = {",
      "            'specVersion': '1.0',",
      "            'visualizationId': 'viz_latest_risk_result_by_branch',",
      "            'type': 'bar',",
      "            'title': f\"各分行{target_value or '目标风险结果'}总计数量\",",
      "            'subtitle': '基于已审批 SQL 工具调用结果生成',",
      "            'businessSemantic': 'institution_risk_comparison',",
      "            'data': {'mode': 'inline', 'rows': chart_rows_for_spec, 'rowCount': len(chart_rows_for_spec), 'trusted': True},",
      "            'dimensions': [{'field': 'accounting_org_name', 'label': '分行', 'dataType': 'category', 'role': 'x', 'sort': 'none'}],",
      "            'measures': [{'field': 'record_count', 'label': '总计数量', 'dataType': 'count', 'role': 'y', 'aggregation': 'sum', 'format': {'type': 'integer'}}],",
      "            'encoding': {'x': 'accounting_org_name', 'y': ['record_count']},",
      "            'interaction': {'tooltip': True, 'legend': False, 'exportable': True},",
      "            'display': {'height': 320, 'responsive': True, 'showDataSource': True},",
      "            'theme': {'mode': 'dark', 'palette': 'neutral'},",
      "            'provenance': {'sourceType': 'python', 'sourceExecutionId': 'local-python', 'generatedAt': datetime.now(timezone.utc).isoformat(), 'truncated': len(chart_rows_for_spec) < len(chart_rows)},",
      "        }",
      "        lines.append('')",
      "        lines.append('```visualization')",
      "        lines.append(json.dumps(spec, ensure_ascii=False, indent=2))",
      "        lines.append('```')",
      "elif {'stat_type', 'dimension', 'record_count'}.issubset(set(rows[0].keys())):",
      "    def number(row, key):",
      "        try:",
      "            return float(row.get(key) or 0)",
      "        except (TypeError, ValueError):",
      "            return 0.0",
      "    branch_rows = [row for row in rows if row.get('stat_type') in ('branch', '分行占比')]",
      "    term_business_rows = [row for row in rows if row.get('stat_type') in ('term_business', '组合分布')]",
      "    total_rows_data = [row for row in rows if row.get('stat_type') in ('total', '总计')]",
      "    total_count = int(number(total_rows_data[0], 'record_count')) if total_rows_data else int(sum(number(row, 'record_count') for row in branch_rows))",
      "    lines.append('## 总体概况')",
      "    lines.append(f'- 本次 SQL 查询结果共返回 {len(rows)} 条统计记录。')",
      "    if total_count:",
      "        lines.append(f'- 不良数据总计：{total_count}。')",
      "    lines.append('')",
      "    if branch_rows:",
      "        lines.append('## 分行占比')",
      "        lines.append('| 排名 | 分行 | 记录数 | 占比 |')",
      "        lines.append('|---:|---|---:|---:|')",
      "        for rank, row in enumerate(sorted(branch_rows, key=lambda item: number(item, 'record_count'), reverse=True), start=1):",
      "            count = int(number(row, 'record_count'))",
      "            percentage = number(row, 'percentage') or pct(count, total_count)",
      "            lines.append(f\"| {rank} | {row.get('dimension') or '--'} | {count} | {percentage}% |\")",
      "        top_branch = max(branch_rows, key=lambda item: number(item, 'record_count'))",
      "        lines.append('')",
      "        lines.append(f\"- 分行维度最高的是 {top_branch.get('dimension') or '--'}，记录数 {int(number(top_branch, 'record_count'))}，占比 {number(top_branch, 'percentage') or pct(number(top_branch, 'record_count'), total_count)}%。\")",
      "    if term_business_rows:",
      "        lines.append('')",
      "        lines.append('## 贷款类型与业务分类组合分布')",
      "        lines.append('| 排名 | 贷款类型 + 业务分类 | 记录数 | 占比 |')",
      "        lines.append('|---:|---|---:|---:|')",
      "        for rank, row in enumerate(sorted(term_business_rows, key=lambda item: number(item, 'record_count'), reverse=True), start=1):",
      "            count = int(number(row, 'record_count'))",
      "            percentage = number(row, 'percentage') or pct(count, total_count)",
      "            lines.append(f\"| {rank} | {row.get('dimension') or '--'} | {count} | {percentage}% |\")",
      "        top_combo = max(term_business_rows, key=lambda item: number(item, 'record_count'))",
      "        lines.append('')",
      "        lines.append(f\"- 组合分布最高的是 {top_combo.get('dimension') or '--'}，记录数 {int(number(top_combo, 'record_count'))}，占比 {number(top_combo, 'percentage') or pct(number(top_combo, 'record_count'), total_count)}%。\")",
      "    lines.append('')",
      "    lines.append('## 分析结论')",
      "    if branch_rows and term_business_rows:",
      "        lines.append('- 不良样本呈现出可识别的分行集中度和产品期限/业务分类结构差异，建议优先对占比最高的分行及组合维度做穿透复核。')",
      "    elif branch_rows:",
      "        lines.append('- 当前结果可支撑分行集中度判断，但缺少贷款类型与业务分类组合维度。')",
      "    else:",
      "        lines.append('- 当前结果可支撑组合分布判断，但缺少分行维度占比。')",
      "elif term_field in rows[0] and branch_field in rows[0] and 'cnt' in rows[0]:",
      "    normalized = []",
      "    for row in rows:",
      "        try:",
      "            count = int(float(row.get('cnt') or 0))",
      "        except (TypeError, ValueError):",
      "            count = 0",
      "        normalized.append({",
      "            'term': row.get(term_field) or '--',",
      "            'branch': row.get(branch_field) or '--',",
      "            'count': count,",
      "            'term_total': int(float(row.get('term_cnt') or 0)) if str(row.get('term_cnt') or '').replace('.', '', 1).isdigit() else 0,",
      "            'total': int(float(row.get('total_cnt') or 0)) if str(row.get('total_cnt') or '').replace('.', '', 1).isdigit() else 0,",
      "        })",
      "    term_counts = Counter()",
      "    branch_by_term = defaultdict(Counter)",
      "    for item in normalized:",
      "        term_counts[item['term']] += item['count']",
      "        branch_by_term[item['term']][item['branch']] += item['count']",
      "    total_rows = max([item['total'] for item in normalized] + [sum(term_counts.values())])",
      "    lines.append('## 期限类型总量')",
      "    lines.append('| 期限类型 | 总计个数 | 占样本比例 |')",
      "    lines.append('|---|---:|---:|')",
      "    for term in preferred_terms:",
      "        count = term_counts.get(term, 0)",
      "        lines.append(f'| {term} | {count} | {pct(count, total_rows)}% |')",
      "    lines.append('')",
      "    lines.append('## 各分行占比')",
      "    lines.append('| 期限类型 | 分行 | 个数 | 类型内占比 | 总样本占比 |')",
      "    lines.append('|---|---|---:|---:|---:|')",
      "    for term in preferred_terms:",
      "        term_total = term_counts.get(term, 0)",
      "        for branch, count in branch_by_term.get(term, Counter()).most_common():",
      "            lines.append(f'| {term} | {branch} | {count} | {pct(count, term_total)}% | {pct(count, total_rows)}% |')",
      "    lines.append('')",
      "    lines.append('## 中期与长期占比最高前三分行')",
      "    lines.append('| 期限类型 | 排名 | 分行 | 个数 | 类型内占比 | 总样本占比 |')",
      "    lines.append('|---|---:|---|---:|---:|---:|')",
      "    for term in ['中期', '长期']:",
      "        term_total = term_counts.get(term, 0)",
      "        for rank, (branch, count) in enumerate(branch_by_term.get(term, Counter()).most_common(3), start=1):",
      "            lines.append(f'| {term} | {rank} | {branch} | {count} | {pct(count, term_total)}% | {pct(count, total_rows)}% |')",
      "    lines.append('')",
      "    lines.append('## 分析结论')",
      "    mid_top = branch_by_term.get('中期', Counter()).most_common(1)",
      "    long_top = branch_by_term.get('长期', Counter()).most_common(1)",
      "    if mid_top:",
      "        branch, count = mid_top[0]",
      "        lines.append(f'- 中期占比最高分行为 {branch}，数量 {count}，类型内占比 {pct(count, term_counts.get(\"中期\", 0))}%。')",
      "    if long_top:",
      "        branch, count = long_top[0]",
      "        lines.append(f'- 长期占比最高分行为 {branch}，数量 {count}，类型内占比 {pct(count, term_counts.get(\"长期\", 0))}%。')",
      "    if mid_top and long_top and mid_top[0][0] == long_top[0][0]:",
      "        lines.append(f'- {mid_top[0][0]}同时位于中期和长期最高分行，建议重点复核该分行风险合同期限结构。')",
      "    else:",
      "        lines.append('- 中期与长期头部分行不同，建议分别拆解分行客户结构、授信品类与期限配置差异。')",
      "elif term_field in rows[0] and branch_field in rows[0]:",
      "    term_counts = Counter((row.get(term_field) or '--') for row in rows)",
      "    lines.append('## 期限类型总量')",
      "    lines.append('| 期限类型 | 总计个数 | 占样本比例 |')",
      "    lines.append('|---|---:|---:|')",
      "    for term in preferred_terms:",
      "        count = term_counts.get(term, 0)",
      "        lines.append(f'| {term} | {count} | {pct(count, total_rows)}% |')",
      "    other_count = sum(count for term, count in term_counts.items() if term not in preferred_terms)",
      "    if other_count:",
      "        lines.append(f'| 其他 | {other_count} | {pct(other_count, total_rows)}% |')",
      "    lines.append('')",
      "    branch_by_term = defaultdict(Counter)",
      "    for row in rows:",
      "        term = row.get(term_field) or '--'",
      "        branch = row.get(branch_field) or '--'",
      "        branch_by_term[term][branch] += 1",
      "    lines.append('## 各分行占比')",
      "    lines.append('| 期限类型 | 分行 | 个数 | 类型内占比 | 总样本占比 |')",
      "    lines.append('|---|---|---:|---:|---:|')",
      "    for term in preferred_terms:",
      "        term_total = term_counts.get(term, 0)",
      "        for branch, count in branch_by_term.get(term, Counter()).most_common():",
      "            lines.append(f'| {term} | {branch} | {count} | {pct(count, term_total)}% | {pct(count, total_rows)}% |')",
      "    lines.append('')",
      "    lines.append('## 中期与长期占比最高前三分行')",
      "    lines.append('| 期限类型 | 排名 | 分行 | 个数 | 类型内占比 | 总样本占比 |')",
      "    lines.append('|---|---:|---|---:|---:|---:|')",
      "    for term in ['中期', '长期']:",
      "        term_total = term_counts.get(term, 0)",
      "        for rank, (branch, count) in enumerate(branch_by_term.get(term, Counter()).most_common(3), start=1):",
      "            lines.append(f'| {term} | {rank} | {branch} | {count} | {pct(count, term_total)}% | {pct(count, total_rows)}% |')",
      "    lines.append('')",
      "    lines.append('## 分析结论')",
      "    mid_top = branch_by_term.get('中期', Counter()).most_common(1)",
      "    long_top = branch_by_term.get('长期', Counter()).most_common(1)",
      "    if mid_top:",
      "        branch, count = mid_top[0]",
      "        lines.append(f'- 中期样本中，{branch}数量最高，为 {count} 笔，占中期样本 {pct(count, term_counts.get(\"中期\", 0))}%。')",
      "    if long_top:",
      "        branch, count = long_top[0]",
      "        lines.append(f'- 长期样本中，{branch}数量最高，为 {count} 笔，占长期样本 {pct(count, term_counts.get(\"长期\", 0))}%。')",
      "    if mid_top and long_top and mid_top[0][0] == long_top[0][0]:",
      "        lines.append(f'- {mid_top[0][0]}同时位于中期和长期最高分行，建议优先复核该分行相关合同风险迁徙原因。')",
      "    else:",
      "        lines.append('- 中期与长期高占比分行存在差异，建议分别从区域行业集中度、客户结构和授信期限配置进行对比复核。')",
      "else:",
      "    lines.append('## 数据概览')",
      "    lines.append('上一轮 SQL 工具结果未识别到整体风险分类分布所需字段组合，无法直接生成笔数与金额分布。请确认 SQL 至少返回风险分类字段以及 loan_balance_10k 或 contract_amount_10k。')",
      "    lines.append('')",
      "    lines.append('| 字段 | 非空样本数 | 去重值数量 |')",
      "    lines.append('|---|---:|---:|')",
      "    keys = list(rows[0].keys()) if rows else []",
      "    for key in keys:",
      "        values = [row.get(key) for row in rows if row.get(key) not in (None, '')]",
      "        lines.append(f'| {key} | {len(values)} | {len(set(map(str, values)))} |')",
      "",
      "print('\\n'.join(lines))",
    ].join("\n");
  }

  private insertToolCall(input: {
    conversationId: string;
    messageId: string;
    userId: string;
    kind: AssistantToolKind;
    script: string;
    approvalMode: AssistantApprovalMode;
    status: AssistantToolStatus;
    errorMessage?: string;
  }): AssistantToolCall {
    const createdAt = nowIso();
    const toolCall: AssistantToolCall = {
      id: randomUUID(),
      conversationId: input.conversationId,
      messageId: input.messageId,
      userId: input.userId,
      kind: input.kind,
      status: input.status,
      script: input.script,
      approvalMode: input.approvalMode,
      errorMessage: input.errorMessage,
      createdAt,
      updatedAt: createdAt,
    };
    const integrityHash = this.hashRecord("tool_call", toolCall);
    this.db
      .prepare(
        `insert into tool_calls
          (id, conversation_id, message_id, user_id, kind, status, script, result_json, error_message, approval_mode, created_at, updated_at, integrity_hash)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        toolCall.id,
        toolCall.conversationId,
        toolCall.messageId,
        toolCall.userId,
        toolCall.kind,
        toolCall.status,
        toolCall.script,
        null,
        toolCall.errorMessage ?? null,
        toolCall.approvalMode,
        toolCall.createdAt,
        toolCall.updatedAt,
        integrityHash,
      );
    return toolCall;
  }

  private updateToolCall(toolCallId: string, status: AssistantToolStatus, result?: string, errorMessage?: string): AssistantToolCall {
    const current = this.toolCallFromRow(this.db.prepare("select * from tool_calls where id = ?").get(toolCallId));
    const updatedAt = nowIso();
    const next: AssistantToolCall = { ...current, status, result, errorMessage, updatedAt };
    const integrityHash = this.hashRecord("tool_call", next);
    this.db
      .prepare("update tool_calls set status = ?, result_json = ?, error_message = ?, updated_at = ?, integrity_hash = ? where id = ?")
      .run(next.status, next.result ?? null, next.errorMessage ?? null, next.updatedAt, integrityHash, toolCallId);
    return next;
  }

  private updateToolCallScript(toolCallId: string, script: string): AssistantToolCall {
    const current = this.toolCallFromRow(this.db.prepare("select * from tool_calls where id = ?").get(toolCallId));
    if (current.script === script) {
      return current;
    }
    const updatedAt = nowIso();
    const next: AssistantToolCall = { ...current, script, updatedAt };
    const integrityHash = this.hashRecord("tool_call", next);
    this.db
      .prepare("update tool_calls set script = ?, updated_at = ?, integrity_hash = ? where id = ?")
      .run(next.script, next.updatedAt, integrityHash, toolCallId);
    return next;
  }

  private appendToolLog(
    toolCall: AssistantToolCall | (Pick<AssistantToolCall, "conversationId" | "userId" | "kind"> & { id?: string | null }),
    phase: string,
    status: "info" | "success" | "error",
    message: string,
    detail?: Record<string, unknown>,
  ) {
    const log = {
      id: randomUUID(),
      toolCallId: toolCall.id ?? null,
      conversationId: toolCall.conversationId,
      userId: toolCall.userId,
      kind: toolCall.kind,
      phase,
      status,
      message,
      detail,
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `insert into tool_call_logs
          (id, tool_call_id, conversation_id, user_id, kind, phase, status, message, detail_json, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        log.id,
        log.toolCallId,
        log.conversationId,
        log.userId,
        log.kind,
        log.phase,
        log.status,
        log.message,
        log.detail ? JSON.stringify(log.detail) : null,
        log.createdAt,
      );

    try {
      mkdirSync(dirname(this.options.toolLogPath), { recursive: true });
      appendFileSync(this.options.toolLogPath, `${JSON.stringify(log)}\n`, "utf8");
    } catch {
      // SQLite logs remain available if file logging is temporarily unavailable.
    }
  }

  private prepareCsvSqlViews(toolCall: AssistantToolCall) {
    if (!existsSync(this.options.csvSqlitePath)) {
      this.appendToolLog(toolCall, "sql-csv-views", "info", "CSV SQLite 数据库不存在，跳过 CSV 表视图挂载。", {
        csvSqlitePath: this.options.csvSqlitePath,
      });
      return [];
    }

    const alias = "csvdata";
    const databases = this.db.prepare("pragma database_list").all() as Array<{ name: string; file: string }>;
    const attached = databases.some((database) => database.name === alias);
    if (!attached) {
      this.db.prepare(`attach database ? as ${quoteIdentifier(alias)}`).run(this.options.csvSqlitePath);
    }
    const tableColumns = this.db
      .prepare(`pragma ${alias}.table_info(csv_dataset_tables)`)
      .all() as Array<{ name: string }>;
    const hasAliasesJson = tableColumns.some((column) => column.name === "aliases_json");
    const datasets = this.db
      .prepare(
        `select data_source_id, table_id, sqlite_table_name, display_name${hasAliasesJson ? ", aliases_json" : ""}
         from ${quoteIdentifier(alias)}.csv_dataset_tables
         order by updated_at desc`,
      )
      .all() as CsvDatasetTableRow[];
    const preparedViews: string[] = [];

    for (const dataset of datasets) {
      const datasetColumnInfo = this.db
        .prepare(`pragma ${alias}.table_info(csv_dataset_columns)`)
        .all() as Array<{ name: string }>;
      const hasColumnMeta = (name: string) => datasetColumnInfo.some((column) => column.name === name);
      const columns = this.db
        .prepare(
          `select name, sqlite_column_name, ordinal_index${hasColumnMeta("physical_name") ? ", physical_name" : ""}${hasColumnMeta("business_field_id") ? ", business_field_id" : ""}${hasColumnMeta("display_name_zh") ? ", display_name_zh" : ""}
           from ${quoteIdentifier(alias)}.csv_dataset_columns
           where data_source_id = ?
           order by ordinal_index`,
        )
        .all(dataset.data_source_id) as CsvDatasetColumnRow[];
      const selectList =
        columns.length > 0
          ? columns
            .map((column) => `${quoteIdentifier(column.sqlite_column_name)} as ${quoteIdentifier(column.name)}`)
            .join(", ")
          : "*";
      const viewNames = Array.from(
        new Set(
          [dataset.display_name, ...parseCsvAliasJson(dataset.aliases_json), dataset.table_id, dataset.sqlite_table_name]
            .map(normalizeSqliteAlias)
            .filter((name) => name.length > 0),
        ),
      );
      for (const viewName of viewNames) {
        this.dropTempViewIfExists(viewName, toolCall);
        this.db
          .prepare(
            `create temp view ${quoteIdentifier(viewName)} as select ${selectList} from ${quoteIdentifier(alias)}.${quoteIdentifier(dataset.sqlite_table_name)}`,
          )
          .run();
        preparedViews.push(viewName);
      }
    }

    this.appendToolLog(toolCall, "sql-csv-views", "success", "CSV SQLite 表视图已挂载到 SQL 工具执行上下文。", {
      csvSqlitePath: this.options.csvSqlitePath,
      views: preparedViews,
    });
    return preparedViews;
  }

  private dropTempViewIfExists(viewName: string, toolCall: AssistantToolCall) {
    const existing = this.db.prepare("select type from sqlite_temp_master where name = ?").get(viewName) as
      | { type?: string }
      | undefined;
    if (!existing) {
      return;
    }
    if (existing.type !== "view") {
      this.appendToolLog(
        toolCall,
        "sql-csv-views",
        "error",
        "临时对象名称被非视图对象占用，无法重建 CSV 查询视图。",
        { viewName, existingType: existing.type },
      );
      throw new Error(`临时 SQL 对象名称冲突：${viewName}`);
    }
    this.db.prepare(`drop view if exists temp.${quoteIdentifier(viewName)}`).run();
  }

  private toolBlock(toolCall: AssistantToolCall, body: string): AssistantBlock {
    const files = extractScriptFiles(toolCall.script);
    const isMarkdownResult = toolCall.status === "completed" && toolCall.kind === "python" && isMarkdownLikeContent(body);
    return {
      id: randomUUID(),
      type: isMarkdownResult ? "markdown" : toolCall.status === "completed" ? "json" : "card",
      title: `${toolCall.kind.toUpperCase()} 工具调用：${toolCall.status}`,
      content: body,
      toolCallId: toolCall.id,
      toolStatus: toolCall.status,
      toolName: toolCall.kind,
      toolTarget: toolTarget(toolCall),
      toolFiles: files.length > 0 ? files : undefined,
      toolDurationMs: toolCallDurationMs(toolCall),
    };
  }

  private async handleToolCall(input: AssistantSendInput, conversation: AssistantConversation, message: AssistantMessage, tool: ToolDetection, options: { appendToMessage?: boolean } = {}) {
    const normalizedTool: ToolDetection =
      tool.kind === "python"
        ? {
            ...tool,
            script: await this.normalizePythonToolScript({
              userId: input.userId,
              conversationId: conversation.id,
              prompt: input.prompt,
              script: tool.script,
            }),
          }
        : tool;

    if (normalizedTool.kind === "sql" && !isReadonlySql(normalizedTool.script)) {
      const toolCall = this.insertToolCall({
        conversationId: conversation.id,
        messageId: message.id,
        userId: input.userId,
        kind: normalizedTool.kind,
        script: normalizedTool.script,
        approvalMode: input.approvalMode,
        status: "blocked",
        errorMessage: "SQL 安全校验未通过。",
      });
      this.appendToolLog(toolCall, "safety-check", "error", "SQL 安全校验未通过。", { script: normalizedTool.script });
      const toolBlock = this.toolBlock(toolCall, "SQL 安全校验未通过：仅允许单条只读 SELECT / WITH / PRAGMA 查询。");
      const current = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(message.id));
      const keepContent = options.appendToMessage && current.content.trim();
      const updated = this.updateMessage(message.id, {
        status: "error",
        content: keepContent ? current.content : "SQL 安全校验未通过。",
        blocks: options.appendToMessage ? replaceToolBlock(current.blocks, toolBlock) : [toolBlock],
        errorMessage: "SQL 安全校验未通过。",
      });
      this.options.emit({ type: "tool", conversationId: conversation.id, toolCall, message: updated });
      return;
    }

    if (input.approvalMode === "no_access") {
      const toolCall = this.insertToolCall({
        conversationId: conversation.id,
        messageId: message.id,
        userId: input.userId,
        kind: normalizedTool.kind,
        script: normalizedTool.script,
        approvalMode: input.approvalMode,
        status: "blocked",
        errorMessage: "当前审批权限禁止执行脚本工具。",
      });
      this.appendToolLog(toolCall, "permission-check", "error", "审批权限禁止执行脚本工具。", { approvalMode: input.approvalMode });
      const toolBlock = this.toolBlock(toolCall, "当前审批权限为“禁止访问权限”，工具调用已被拦截。");
      const current = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(message.id));
      const keepContent = options.appendToMessage && current.content.trim();
      const updated = this.updateMessage(message.id, {
        status: "error",
        content: keepContent ? current.content : "当前审批权限禁止执行脚本工具。",
        blocks: options.appendToMessage ? replaceToolBlock(current.blocks, toolBlock) : [toolBlock],
        errorMessage: "工具调用被权限策略拦截。",
      });
      this.options.emit({ type: "tool", conversationId: conversation.id, toolCall, message: updated });
      return;
    }

    const status: AssistantToolStatus = input.approvalMode === "request_approval" ? "pending_approval" : "running";
    const toolCall = this.insertToolCall({
      conversationId: conversation.id,
      messageId: message.id,
      userId: input.userId,
      kind: normalizedTool.kind,
      script: normalizedTool.script,
      approvalMode: input.approvalMode,
      status,
    });

    if (input.approvalMode === "request_approval") {
      this.appendToolLog(toolCall, "approval", "info", "工具调用已创建，等待用户审批。", {
        approvalMode: input.approvalMode,
        script: normalizedTool.script,
        originalScript: normalizedTool.script === tool.script ? undefined : tool.script,
      });
      const toolBlock = this.toolBlock(
        toolCall,
        normalizedTool.kind === "sql"
          ? "SQL 安全校验通过，已创建审批单。审批通过后执行查询。"
          : `检测到 ${normalizedTool.kind.toUpperCase()} 脚本调用。审批通过后执行。`,
      );
      const current = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(message.id));
      const keepContent = options.appendToMessage && current.content.trim();
      const updated = this.updateMessage(message.id, {
        status: "awaiting_approval",
        content: keepContent ? current.content : "工具调用等待审批。",
        blocks: options.appendToMessage ? replaceToolBlock(current.blocks, toolBlock) : [toolBlock],
      });
      this.options.emit({ type: "tool", conversationId: conversation.id, toolCall, message: updated });
      return;
    }

    await this.executeToolCall(toolCall);
  }

  private async executeToolCall(toolCall: AssistantToolCall) {
    const normalizedScript =
      toolCall.kind === "python"
        ? await this.normalizePythonToolScript({
            userId: toolCall.userId,
            conversationId: toolCall.conversationId,
            prompt: this.sourcePromptForToolCall(toolCall),
            script: toolCall.script,
          })
        : toolCall.script;
    const executableToolCall = normalizedScript === toolCall.script ? toolCall : this.updateToolCallScript(toolCall.id, normalizedScript);
    if (executableToolCall.script !== toolCall.script) {
      this.appendToolLog(executableToolCall, "python-script-normalize", "info", "Python 工具脚本已替换为基于 SQL 结果快照的标准库脚本。", {
        originalScript: toolCall.script,
        normalizedScript,
      });
    }
    const running = this.updateToolCall(executableToolCall.id, "running");
    this.appendToolLog(running, "execution-start", "info", "工具调用开始执行。", { script: running.script });
    const currentBeforeRun = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(executableToolCall.messageId));
    const preserveContent = hasRenderableNonToolContent(currentBeforeRun);
    const runningBlock = this.toolBlock(running, executableToolCall.kind === "sql" ? "SQL 已通过审批，正在执行受控只读查询。" : "工具调用执行中，请稍候。");
    let runningMessage = this.updateMessage(executableToolCall.messageId, {
      status: "processing",
      content: preserveContent ? currentBeforeRun.content : "工具调用执行中。",
      blocks: preserveContent ? replaceToolBlock(currentBeforeRun.blocks, runningBlock) : [runningBlock],
    });
    this.options.emit({ type: "tool", conversationId: executableToolCall.conversationId, toolCall: running, message: runningMessage });

    try {
      const sqlExecution = executableToolCall.kind === "sql" ? this.executeReadonlySql(executableToolCall.script, running) : null;
      const result = sqlExecution ? sqlExecution.result : await this.executePython(running.script);
      const completed = this.updateToolCall(toolCall.id, "completed", result);
      const sqlDataset = completed.kind === "sql" ? await this.registerSqlToolResultDataset(completed, sqlExecution?.rows) : null;
      this.appendToolLog(completed, "execution-complete", "success", "工具调用执行完成。", {
        resultPreview: result.slice(0, 2_000),
      });
      const currentBeforeComplete = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(toolCall.messageId));
      const completedBlock = this.toolBlock(completed, result);
      const message = this.updateMessage(toolCall.messageId, {
        status: "completed",
        content: preserveContent ? currentBeforeComplete.content : result,
        blocks: preserveContent ? replaceToolBlock(currentBeforeComplete.blocks, completedBlock) : [completedBlock],
      });
      this.options.emit({ type: "tool", conversationId: toolCall.conversationId, toolCall: completed, message });
      await this.registerAssistantToolResult(completed, {
        result,
        sqlDataset: sqlDataset ?? undefined,
      });
      if (completed.kind === "sql") {
        await this.maybeCreateAutoPythonReportApproval(completed, message, sqlExecution?.rows);
      }
      return { success: true as const, toolCall: completed, message };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "工具调用失败。";
      const failed = this.updateToolCall(toolCall.id, "error", undefined, messageText);
      this.appendToolLog(failed, "execution-error", "error", messageText, {
        script: failed.script,
        stack: error instanceof Error ? error.stack : undefined,
      });
      const currentBeforeFailure = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(toolCall.messageId));
      const failedBlock = this.toolBlock(failed, messageText);
      runningMessage = this.updateMessage(toolCall.messageId, {
        status: "error",
        content: preserveContent ? currentBeforeFailure.content : messageText,
        blocks: preserveContent ? replaceToolBlock(currentBeforeFailure.blocks, failedBlock) : [failedBlock],
        errorMessage: messageText,
      });
      this.options.emit({ type: "tool", conversationId: toolCall.conversationId, toolCall: failed, message: runningMessage });
      return { success: true as const, toolCall: failed, message: runningMessage };
    }
  }

  private sourcePromptForToolCall(toolCall: AssistantToolCall) {
    const messageRow = this.db.prepare("select created_at from messages where id = ?").get(toolCall.messageId) as { created_at?: string } | undefined;
    const row = this.db
      .prepare(
        `select content
         from messages
         where conversation_id = ?
           and user_id = ?
           and role = 'user'
           and created_at <= ?
         order by created_at desc
         limit 1`,
      )
      .get(toolCall.conversationId, toolCall.userId, messageRow?.created_at ?? toolCall.createdAt) as { content?: string } | undefined;
    return row?.content?.trim() ?? "";
  }

  private async maybeCreateAutoPythonReportApproval(toolCall: AssistantToolCall, message: AssistantMessage, rows?: Array<Record<string, unknown>>) {
    if (toolCall.approvalMode === "no_access") {
      return;
    }
    const sourcePrompt = this.sourcePromptForToolCall(toolCall);
    if (!sourcePrompt || !shouldAutoStartPythonReport(sourcePrompt)) {
      return;
    }
    const existingPendingPython = this.db
      .prepare(
        `select id
         from tool_calls
         where conversation_id = ?
           and user_id = ?
           and kind = 'python'
           and status in ('pending_approval', 'running')
         order by created_at desc
         limit 1`,
      )
      .get(toolCall.conversationId, toolCall.userId);
    if (existingPendingPython) {
      return;
    }
    const conversation = this.findConversation(toolCall.userId, toolCall.conversationId);
    if (!conversation) {
      return;
    }
    const analysisRows = rows?.length ? rows : parseSqlToolRows(toolCall.result);
    this.appendToolLog(toolCall, "workflow-routing", "info", "SQL 查询完成后根据用户报告需求自动创建 Python 分析审批。", {
      sourcePrompt,
      rowCount: analysisRows.length,
    });
    await this.handleToolCall(
      {
        userId: toolCall.userId,
        conversationId: toolCall.conversationId,
        clientRequestId: `auto-python-${toolCall.id}`,
        prompt: sourcePrompt,
        modelName: "local-workflow",
        approvalMode: toolCall.approvalMode,
      },
      conversation,
      message,
      {
        kind: "python",
        script: this.buildPythonAnalysisScript(sourcePrompt, toolCall, analysisRows),
      },
      { appendToMessage: true },
    );
  }

  private async routeOverallRiskSkillWorkflow(input: AssistantSendInput, conversation: AssistantConversation, assistantMessage: AssistantMessage) {
    if (!isOverallRiskSkill(input.skill)) {
      return false;
    }

    const planId = `skill_${randomUUID()}`;
    const sql = this.defaultSqlForSkillWorkflow(input);
    const existingContent = assistantMessage.content.trim();
    const planContent = [
      "已识别 Skill 工作流：整体风险分类分布（笔数+金额）。",
      "",
      "执行计划：",
      "1. 查询用户选择数据源，获取风险分类分析样本。",
      "2. 计算五级/十二级分类笔数、金额及核心风险指标。",
      "3. 按模板生成完整 Markdown 报告，并登记报告版本。",
    ].join("\n");
    const planBlocksContent = [
      existingContent,
      "## 智能体工作流",
      "",
      "- 状态：已完成意图识别，正在创建工具执行计划。",
      "- 计划：SQL 查询 -> Python 分析 -> Markdown 报告生成。",
      `- 审批模式：${input.approvalMode}`,
    ].filter(Boolean).join("\n\n");
    const started = this.updateMessage(assistantMessage.id, {
      status: "processing",
      content: [existingContent, planContent].filter(Boolean).join("\n\n"),
      blocks: parseAssistantBlocks(planBlocksContent),
    });
    this.options.emit({ type: "message", conversationId: conversation.id, message: started });

    const sqlStatus: ToolCallStatus = input.approvalMode === "no_access" ? "blocked" : input.approvalMode === "request_approval" ? "waiting_approval" : "planned";
    const pythonStatus: ToolCallStatus = input.approvalMode === "no_access" ? "blocked" : "planned";
    const reportStatus: ToolCallStatus = input.approvalMode === "no_access" ? "blocked" : "planned";

    const sqlRecord = await this.registerSkillWorkflowRecord({
      planId,
      conversation,
      message: assistantMessage,
      toolKind: "sql_query",
      status: sqlStatus,
      request: {
        userRequest: input.prompt,
        purpose: "读取用户选择数据源，准备整体风险分类分布分析样本。",
        dataSourceId: input.dataSourceId ?? undefined,
        dataSourceLabel: input.dataSourceLabel ?? undefined,
        sql,
        approvalMode: input.approvalMode,
      },
      errorMessage: input.approvalMode === "no_access" ? "当前审批权限禁止访问数据源工具。" : undefined,
    });
    const pythonRecord = await this.registerSkillWorkflowRecord({
      planId,
      conversation,
      message: assistantMessage,
      toolKind: "python_analysis",
      status: pythonStatus,
      request: {
        userRequest: input.prompt,
        purpose: "计算整体风险分类分布、核心指标与数据质量说明。",
        dataSourceId: input.dataSourceId ?? undefined,
        dataSourceLabel: input.dataSourceLabel ?? undefined,
        approvalMode: input.approvalMode,
      },
      parentToolCallIds: [sqlRecord.toolCallId],
      errorMessage: input.approvalMode === "no_access" ? "当前审批权限禁止执行分析工具。" : undefined,
    });
    await this.registerSkillWorkflowRecord({
      planId,
      conversation,
      message: assistantMessage,
      toolKind: "report_generation",
      status: reportStatus,
      request: {
        userRequest: input.prompt,
        purpose: "根据整体风险分类分布模板生成完整报告。",
        title: "整体风险分类分布报告",
        dataSourceId: input.dataSourceId ?? undefined,
        dataSourceLabel: input.dataSourceLabel ?? undefined,
        approvalMode: input.approvalMode,
      },
      parentToolCallIds: [pythonRecord.toolCallId],
      errorMessage: input.approvalMode === "no_access" ? "当前审批权限禁止生成工具报告。" : undefined,
    });
    await this.emitToolState(conversation.id);

    if (input.approvalMode === "no_access") {
      const blockedContent = "当前审批权限为“禁止访问权限”，整体风险分类分布工作流已被拦截。";
      const blockedBlocksContent = [
        existingContent,
        "## 工作流已阻断",
        "",
        "当前审批权限禁止执行数据查询和分析工具。",
      ].filter(Boolean).join("\n\n");
      const blocked = this.updateMessage(assistantMessage.id, {
        status: "error",
        content: [existingContent, blockedContent].filter(Boolean).join("\n\n"),
        blocks: parseAssistantBlocks(blockedBlocksContent),
        errorMessage: "工具调用被权限策略拦截。",
      });
      this.options.emit({ type: "message", conversationId: conversation.id, message: blocked });
      return true;
    }

    if (input.approvalMode === "request_approval") {
      const waitingContent = "整体风险分类分布工作流已创建，SQL 查询等待审批。";
      const waitingBlocksContent = [
        existingContent,
        "## 工作流等待审批",
        "",
        "已创建 SQL 查询、Python 分析、报告生成三步工具计划。请先批准 SQL 查询。",
      ].filter(Boolean).join("\n\n");
      const waiting = this.updateMessage(assistantMessage.id, {
        status: "awaiting_approval",
        content: [existingContent, waitingContent].filter(Boolean).join("\n\n"),
        blocks: parseAssistantBlocks(waitingBlocksContent),
      });
      this.options.emit({ type: "message", conversationId: conversation.id, message: waiting });
      return true;
    }

    void this.executeOverallRiskWorkflowFromSql(sqlRecord);
    return true;
  }

  private async registerSkillWorkflowRecord(input: {
    planId: string;
    conversation: AssistantConversation;
    message: AssistantMessage;
    toolKind: ToolKind;
    status: ToolCallStatus;
    request: Record<string, unknown>;
    parentToolCallIds?: string[];
    errorMessage?: string;
  }) {
    const createdAt = nowIso();
    const version = (await this.toolResultRegistry.listByConversation(input.conversation.id)).filter((record) => record.toolKind === input.toolKind).length + 1;
    const record: ToolCallRecord = {
      toolCallId: `${input.toolKind.split("_")[0]}_${randomUUID()}`,
      conversationId: input.conversation.id,
      messageId: input.message.id,
      userId: input.conversation.userId,
      toolKind: input.toolKind,
      toolName: TOOL_NAMES[input.toolKind],
      status: input.status,
      request: input.request,
      resolvedInput: { mode: "no_input", reason: "整体风险分类分布 Skill 工作流初始化。" },
      parentToolCallIds: input.parentToolCallIds ?? [],
      sourceArtifactIds: [],
      outputArtifactIds: [],
      version,
      isLatestSuccessful: false,
      createdAt,
      updatedAt: createdAt,
      error: input.errorMessage
        ? {
            code: input.status === "blocked" ? "TOOL_INPUT_PERMISSION_DENIED" : "TOOL_EXECUTION_FAILED",
            message: input.errorMessage,
            conversationId: input.conversation.id,
            traceId: `trace_${randomUUID()}`,
          }
        : undefined,
      metadata: {
        workflowKind: "overall-risk-classification-distribution",
        planId: input.planId,
        assistantMessageId: input.message.id,
      },
    };
    await this.toolResultRegistry.register(record);
    return record;
  }

  private async approveOrchestrationTool(userId: string, record: ToolCallRecord, approved: boolean) {
    if (record.userId !== userId) {
      throw new Error("当前用户无权审批该工具调用。");
    }
    if (record.status !== "waiting_approval") {
      throw new Error("工具调用状态已变更，无法重复审批。");
    }
    if (!approved) {
      const rejected = await this.toolResultRegistry.update(record.toolCallId, {
        status: "rejected",
        completedAt: nowIso(),
        error: {
          code: "TOOL_APPROVAL_REQUIRED",
          message: "用户拒绝执行该工具调用。",
          conversationId: record.conversationId,
          toolCallId: record.toolCallId,
          traceId: `trace_${randomUUID()}`,
          recoverable: false,
        },
      });
      const message = record.messageId
        ? this.updateMessage(record.messageId, {
            status: "stopped",
            content: "用户已拒绝执行工具调用，工作流已停止。",
            blocks: parseAssistantBlocks("## 工作流已停止\n\n用户拒绝执行待审批工具调用。"),
            errorMessage: "用户拒绝",
          })
        : this.latestAssistantMessageForConversation(record.conversationId, userId);
      await this.emitToolState(record.conversationId);
      if (message) {
        this.options.emit({ type: "message", conversationId: record.conversationId, message });
      }
      return { success: true as const, toolCall: rejected, message: message ?? this.fallbackAssistantMessage(record, "用户已拒绝执行工具调用。") };
    }

    if (record.toolKind === "sql_query") {
      const completed = await this.executeOverallRiskSql(record);
      const python = await this.nextSkillWorkflowRecord(record, "python_analysis");
      let message = this.latestAssistantMessageForConversation(record.conversationId, userId) ?? this.fallbackAssistantMessage(record, "SQL 查询已完成。");
      if (python) {
        await this.toolResultRegistry.update(python.toolCallId, { status: "waiting_approval", resolvedInput: {
          mode: "latest_result",
          sourceToolKind: "sql_query",
          sourceToolCallId: completed.toolCallId,
          sourceArtifactIds: completed.outputArtifactIds,
          reason: "SQL 查询完成后，Python 分析等待用户审批。",
        } });
        message = this.updateMessage(record.messageId ?? message.id, {
          status: "awaiting_approval",
          content: "SQL 查询已完成，Python 分析等待审批。",
          blocks: parseAssistantBlocks("## 工作流等待审批\n\nSQL 查询已完成并生成数据集。请批准 Python 分析以继续生成报告。"),
        });
        this.options.emit({ type: "message", conversationId: record.conversationId, message });
      }
      await this.emitToolState(record.conversationId);
      return { success: true as const, toolCall: completed, message };
    }

    if (record.toolKind === "python_analysis") {
      const completed = await this.executeOverallRiskPython(record);
      const report = await this.nextSkillWorkflowRecord(record, "report_generation");
      let message = this.latestAssistantMessageForConversation(record.conversationId, userId) ?? this.fallbackAssistantMessage(record, "Python 分析已完成。");
      if (report) {
        message = await this.executeOverallRiskReport(report);
      }
      await this.emitToolState(record.conversationId);
      return { success: true as const, toolCall: completed, message };
    }

    const completed = await this.executeOverallRiskReport(record);
    return { success: true as const, toolCall: await this.toolResultRegistry.get(record.toolCallId), message: completed };
  }

  private async executeOverallRiskWorkflowFromSql(sqlRecord: ToolCallRecord) {
    try {
      await this.executeOverallRiskSql(sqlRecord);
      const python = await this.nextSkillWorkflowRecord(sqlRecord, "python_analysis");
      if (!python) {
        return;
      }
      await this.executeOverallRiskPython(python);
      const report = await this.nextSkillWorkflowRecord(sqlRecord, "report_generation");
      if (report) {
        await this.executeOverallRiskReport(report);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "整体风险分类分布工作流执行失败。";
      if (sqlRecord.messageId) {
        const failed = this.updateMessage(sqlRecord.messageId, {
          status: "error",
          content: messageText,
          blocks: parseAssistantBlocks(`## 工作流执行失败\n\n${messageText}`),
          errorMessage: messageText,
        });
        this.options.emit({ type: "message", conversationId: sqlRecord.conversationId, message: failed });
      }
      await this.emitToolState(sqlRecord.conversationId);
    }
  }

  private async executeOverallRiskSql(record: ToolCallRecord) {
    const sql = typeof record.request.sql === "string" ? record.request.sql : this.defaultSqlForSkillWorkflow({
      dataSourceId: typeof record.request.dataSourceId === "string" ? record.request.dataSourceId : null,
      dataSourceLabel: typeof record.request.dataSourceLabel === "string" ? record.request.dataSourceLabel : null,
    });
    const executing = await this.toolResultRegistry.update(record.toolCallId, { status: "executing" });
    await this.emitToolState(record.conversationId);
    const toolCall = this.orchestrationRecordAsAssistantTool(executing, "sql", sql, "running");
    try {
      const sqlExecution = this.executeReadonlySql(sql, toolCall);
      const completedToolCall = { ...toolCall, status: "completed" as const, result: sqlExecution.result, updatedAt: nowIso() };
      const dataset = await this.registerSqlToolResultDataset(completedToolCall, sqlExecution.rows);
      const artifactIds = dataset ? [`workflow-dataset:${dataset.datasetId}`] : [`assistant-sql-result:${record.toolCallId}`];
      if (!dataset) {
        await this.toolArtifactManager.createArtifact({
          artifactId: artifactIds[0],
          artifactType: "dataset_profile",
          title: "SQL 查询结果摘要",
          contentType: "json",
          content: sqlExecution.result,
          metadata: { toolCallId: record.toolCallId },
        });
      }
      const completed = await this.toolResultRegistry.update(record.toolCallId, {
        status: "completed",
        result: {
          resultId: `result_${record.toolCallId}`,
          toolKind: "sql_query",
          artifactIds,
          primaryArtifactId: artifactIds[0],
          summary: `SQL 查询已完成，返回 ${sqlExecution.rows.length} 行。`,
          createdAt: nowIso(),
          metadata: { rowCount: sqlExecution.rows.length, sql },
        },
        outputArtifactIds: artifactIds,
        completedAt: nowIso(),
      });
      await this.workflowMemoryBridge.writeWorkflowMemory({
        conversationId: record.conversationId,
        userId: record.userId,
        type: "sql_query_completed",
        summary: completed.result?.summary ?? "SQL 查询已完成。",
        payload: { toolCallId: record.toolCallId, artifactIds },
      });
      await this.emitToolState(record.conversationId);
      return completed;
    } catch (error) {
      const failed = await this.toolResultRegistry.update(record.toolCallId, {
        status: "failed",
        completedAt: nowIso(),
        error: {
          code: "TOOL_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : "SQL 查询执行失败。",
          conversationId: record.conversationId,
          toolCallId: record.toolCallId,
          traceId: `trace_${randomUUID()}`,
        },
      });
      await this.emitToolState(record.conversationId);
      throw new Error(failed.error?.message ?? "SQL 查询执行失败。");
    }
  }

  private async executeOverallRiskPython(record: ToolCallRecord) {
    const executing = await this.toolResultRegistry.update(record.toolCallId, { status: "executing" });
    await this.emitToolState(record.conversationId);
    try {
      const rows = await this.rowsForLatestSkillSqlRecord(executing.conversationId);
      const sourceSql = await this.toolResultRegistry.getLatestSuccessful(executing.conversationId, "sql_query");
      const dataSourceLabel = typeof executing.request.dataSourceLabel === "string"
        ? executing.request.dataSourceLabel
        : typeof sourceSql?.request.dataSourceLabel === "string"
          ? sourceSql.request.dataSourceLabel
          : undefined;
      const markdown = buildOverallRiskDistributionMarkdown(rows, {
        title: "整体风险分类分布分析结果",
        dataSourceLabel,
        version: executing.version,
      });
      const artifact = await this.toolArtifactManager.createArtifact({
        artifactId: `assistant-risk-analysis:${executing.toolCallId}`,
        artifactType: "analysis",
        title: "整体风险分类分布分析结果",
        contentType: "markdown",
        content: markdown,
        metadata: { toolCallId: executing.toolCallId, rowCount: rows.length },
      });
      const completed = await this.toolResultRegistry.update(executing.toolCallId, {
        status: "completed",
        result: {
          resultId: `result_${executing.toolCallId}`,
          toolKind: "python_analysis",
          artifactIds: [artifact.artifactId],
          primaryArtifactId: artifact.artifactId,
          summary: `Python 分析已完成，样本 ${rows.length} 行。`,
          createdAt: nowIso(),
          metadata: { rowCount: rows.length },
        },
        parentToolCallIds: sourceSql ? [sourceSql.toolCallId] : executing.parentToolCallIds,
        sourceArtifactIds: sourceSql?.outputArtifactIds ?? executing.sourceArtifactIds,
        outputArtifactIds: [artifact.artifactId],
        completedAt: nowIso(),
      });
      await this.workflowMemoryBridge.writeWorkflowMemory({
        conversationId: executing.conversationId,
        userId: executing.userId,
        type: "python_analysis_completed",
        summary: completed.result?.summary ?? "Python 分析已完成。",
        payload: { toolCallId: completed.toolCallId, artifactIds: [artifact.artifactId] },
      });
      await this.emitToolState(executing.conversationId);
      return completed;
    } catch (error) {
      const failed = await this.toolResultRegistry.update(executing.toolCallId, {
        status: "failed",
        completedAt: nowIso(),
        error: {
          code: "TOOL_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : "Python 分析执行失败。",
          conversationId: executing.conversationId,
          toolCallId: executing.toolCallId,
          traceId: `trace_${randomUUID()}`,
        },
      });
      await this.emitToolState(executing.conversationId);
      throw new Error(failed.error?.message ?? "Python 分析执行失败。");
    }
  }

  private async executeOverallRiskReport(record: ToolCallRecord) {
    const executing = await this.toolResultRegistry.update(record.toolCallId, { status: "executing" });
    await this.emitToolState(record.conversationId);
    const analysis = await this.toolResultRegistry.getLatestSuccessful(executing.conversationId, "python_analysis");
    const sourceSql = await this.toolResultRegistry.getLatestSuccessful(executing.conversationId, "sql_query");
    const dataSourceLabel = typeof executing.request.dataSourceLabel === "string"
      ? executing.request.dataSourceLabel
      : typeof sourceSql?.request.dataSourceLabel === "string"
        ? sourceSql.request.dataSourceLabel
        : undefined;
    const analysisArtifactId = analysis?.result?.primaryArtifactId ?? analysis?.outputArtifactIds?.[0];
    const analysisArtifact = analysisArtifactId ? await this.toolArtifactManager.getArtifact(analysisArtifactId) : null;
    const markdown = typeof analysisArtifact?.content === "string"
      ? analysisArtifact.content.replace(/^# .+$/m, `# 整体风险分类分布报告 v${executing.version}`)
      : buildOverallRiskDistributionMarkdown(await this.rowsForLatestSkillSqlRecord(executing.conversationId), {
          title: "整体风险分类分布报告",
          dataSourceLabel,
          version: executing.version,
        });
    const artifact = await this.toolArtifactManager.createArtifact({
      artifactId: `assistant-report-markdown:${executing.toolCallId}`,
      artifactType: "report_markdown",
      title: `整体风险分类分布报告 v${executing.version}`,
      contentType: "markdown",
      content: markdown,
      metadata: { toolCallId: executing.toolCallId, sourceAnalysisArtifactId: analysisArtifactId },
    });
    const completed = await this.toolResultRegistry.update(executing.toolCallId, {
      status: "completed",
      result: {
        resultId: `result_${executing.toolCallId}`,
        toolKind: "report_generation",
        artifactIds: [artifact.artifactId],
        primaryArtifactId: artifact.artifactId,
        summary: `整体风险分类分布报告 v${executing.version} 已生成。`,
        createdAt: nowIso(),
      },
      parentToolCallIds: analysis ? [analysis.toolCallId] : executing.parentToolCallIds,
      sourceArtifactIds: analysis?.outputArtifactIds ?? executing.sourceArtifactIds,
      outputArtifactIds: [artifact.artifactId],
      completedAt: nowIso(),
    });
    await this.workflowMemoryBridge.writeWorkflowMemory({
      conversationId: executing.conversationId,
      userId: executing.userId,
      type: "report_generation_completed",
      summary: completed.result?.summary ?? "报告已生成。",
      payload: { toolCallId: completed.toolCallId, artifactIds: [artifact.artifactId], version: completed.version },
    });
    const message = executing.messageId
      ? this.updateMessage(executing.messageId, {
          status: "completed",
          content: markdown,
          blocks: parseAssistantBlocks(markdown),
        })
      : this.fallbackAssistantMessage(executing, markdown);
    this.options.emit({ type: "message", conversationId: executing.conversationId, message });
    this.emitReportContentReady({
      conversationId: executing.conversationId,
      messageId: message.id,
      toolCallId: completed.toolCallId,
      version: completed.version,
      artifactId: artifact.artifactId,
      title: artifact.title ?? `整体风险分类分布报告 v${completed.version}`,
      createdAt: artifact.createdAt,
      completedAt: message.updatedAt,
      markdown,
    });
    await this.emitToolState(executing.conversationId);
    return message;
  }

  private async nextSkillWorkflowRecord(record: ToolCallRecord, toolKind: ToolKind) {
    const planId = record.metadata?.planId;
    const records = await this.toolResultRegistry.listByConversation(record.conversationId);
    return records.find((item) => item.toolKind === toolKind && item.metadata?.planId === planId) ?? null;
  }

  private emitReportContentReady(input: {
    conversationId: string;
    messageId: string;
    toolCallId: string;
    version: number;
    artifactId: string;
    title: string;
    createdAt: string;
    completedAt: string;
    markdown: string;
  }) {
    const segmentId = reportStreamSegmentId(input.messageId, input.toolCallId, input.version);
    if (input.markdown.trim()) {
      this.options.emit({
        type: "stream-content",
        conversationId: input.conversationId,
        event: {
          type: "report_markdown_delta",
          messageId: input.messageId,
          segmentId,
          sequence: 1,
          delta: input.markdown,
          reportId: input.toolCallId,
        },
      });
    }
    this.options.emit({
      type: "stream-content",
      conversationId: input.conversationId,
      event: {
        type: "report_artifact_ready",
        messageId: input.messageId,
        segmentId,
        reportId: input.toolCallId,
        reportArtifactId: input.artifactId,
        title: input.title,
        version: input.version,
        createdAt: input.createdAt,
      },
    });
    this.options.emit({
      type: "stream-content",
      conversationId: input.conversationId,
      event: {
        type: "message_stream_completed",
        messageId: input.messageId,
        completedAt: input.completedAt,
      },
    });
  }

  private orchestrationRecordAsAssistantTool(record: ToolCallRecord, kind: AssistantToolKind, script: string, status: AssistantToolStatus): AssistantToolCall {
    return {
      id: record.toolCallId,
      conversationId: record.conversationId,
      messageId: record.messageId ?? record.toolCallId,
      userId: record.userId,
      kind,
      status,
      script,
      approvalMode: typeof record.request.approvalMode === "string" ? record.request.approvalMode as AssistantApprovalMode : "full_access",
      createdAt: record.createdAt,
      updatedAt: nowIso(),
    };
  }

  private defaultSqlForSkillWorkflow(input: Pick<AssistantSendInput, "dataSourceId" | "dataSourceLabel">) {
    const csvViewName = input.dataSourceId ? this.csvViewNameForDataSource(input.dataSourceId) : null;
    if (csvViewName) {
      const resolved = input.dataSourceId ? this.resolveOverallRiskCsvFields(input.dataSourceId) : null;
      if (resolved?.ready && resolved.fields.length > 0) {
        const selectList = resolved.fields
          .map((field) => `${quoteIdentifier(field.physicalName)} as ${quoteIdentifier(field.aliasName)}`)
          .join(", ");
        return `select ${selectList} from ${quoteIdentifier(csvViewName)}`;
      }
      const missingText = resolved?.missingRequiredFields.length
        ? resolved.missingRequiredFields.map((field) => `${field.displayNameZh}(${field.businessFieldId})`).join(", ")
        : "业务字段映射";
      return `select * from ${quoteIdentifier(csvViewName)} /* BusinessFieldResolver 未就绪：缺少 ${missingText}。请检查表字典 business_field_id 映射。 */`;
    }
    const labelName = input.dataSourceLabel?.split("/")[0]?.trim();
    return `select * from ${quoteIdentifier(labelName || "数据源")}`;
  }

  private resolveOverallRiskCsvFields(dataSourceId: string) {
    const fields = [
      { semantic: "contract_id", displayNameZh: "合同流水号", aliasName: "contract_id", required: true },
      { semantic: "five_level_classification", displayNameZh: "最新风险分类", aliasName: "five_level_classification", required: true },
      { semantic: "twelve_level_classification", displayNameZh: "最新风险分类结果", aliasName: "twelve_level_classification", required: false },
      { semantic: "loan_balance", displayNameZh: "贷款余额(万元)", aliasName: "loan_balance", required: true },
      { semantic: "contract_amount", displayNameZh: "合同金额(万元)", aliasName: "contract_amount", required: false },
    ];
    const columns = this.csvSemanticColumnsForDataSource(dataSourceId);
    const resolvedFields: Array<(typeof fields)[number] & { physicalName: string }> = [];
    const missingRequiredFields: Array<{ businessFieldId: string; displayNameZh: string }> = [];
    const ambiguousFields: Array<{ businessFieldId: string; count: number }> = [];
    for (const field of fields) {
      const scoredCandidates = columns
        .map((column) => ({ column, score: this.scoreOverallRiskColumn(column, field.semantic) }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score);
      const bestScore = scoredCandidates[0]?.score ?? 0;
      const candidates = scoredCandidates.filter((candidate) => candidate.score === bestScore);
      if (candidates.length > 0) {
        const exactPrimary = candidates.find((candidate) => candidate.column.business_field_id === this.primaryOverallRiskBusinessFieldId(field.semantic));
        const column = exactPrimary?.column ?? candidates[0].column;
        resolvedFields.push({ ...field, physicalName: column.physical_name || column.name });
      } else if (field.required) {
        missingRequiredFields.push({ businessFieldId: field.semantic, displayNameZh: field.displayNameZh });
      }
    }
    return {
      ready: missingRequiredFields.length === 0 && ambiguousFields.length === 0,
      fields: resolvedFields,
      missingRequiredFields,
      ambiguousFields,
    };
  }

  private primaryOverallRiskBusinessFieldId(semantic: string) {
    switch (semantic) {
      case "contract_id":
        return "bf.loan_contract.contract_serial";
      case "five_level_classification":
        return "bf.loan_contract.latest_risk";
      case "twelve_level_classification":
        return "bf.loan_contract.latest_risk_result";
      case "loan_balance":
        return "bf.loan_contract.loan_balance_10k";
      case "contract_amount":
        return "bf.loan_contract.contract_amount_10k";
      default:
        return "";
    }
  }

  private scoreOverallRiskColumn(column: CsvDatasetColumnRow, semantic: string) {
    const text = [
      column.business_field_id,
      column.name,
      column.physical_name,
      column.display_name_zh,
      column.source_header,
      column.field_comment,
      ...parseCsvAliasJson(column.aliases_json),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    const has = (...patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));
    const businessFieldId = (column.business_field_id ?? "").trim();
    if (
      ["date", "datetime", "timestamp"].includes(String(column.logical_type ?? "").toLowerCase()) ||
      looksLikeDateColumn(column.business_field_id ?? "") ||
      looksLikeDateColumn(column.name) ||
      looksLikeDateColumn(column.physical_name ?? "") ||
      looksLikeDateColumn(column.display_name_zh ?? "")
    ) {
      return 0;
    }
    if (semantic === "contract_id") {
      if (businessFieldId === "bf.loan_contract.contract_serial") {
        return 230;
      }
      if (businessFieldId === "bf.loan_contract.contract_no") {
        return 220;
      }
      if (businessFieldId === "credit.contract_id") {
        return 210;
      }
      if (has(/customer[_\s-]*id|客户/)) {
        return 0;
      }
      if (has(/contract[_\s-]*(serial|id|no|number)|loan[_\s-]*contract|借据|合同.*(流水|编号|号)|业务编号/)) {
        return 100;
      }
      return 0;
    }
    if (semantic === "five_level_classification") {
      if (businessFieldId === "bf.loan_contract.latest_risk") {
        return 230;
      }
      if (businessFieldId === "bf.loan_contract.latest_five_level_risk") {
        return 220;
      }
      if (businessFieldId === "credit.five_level_classification") {
        return 210;
      }
      if (has(/twelve|12[_\s-]*level|sub[_\s-]*risk|risk[_\s-]*sub|十二|细分|分类结果/)) {
        return 0;
      }
      if (has(/^latest[_\s-]*risk$|最新风险分类$/)) {
        return 120;
      }
      if (has(/five[_\s-]*level|5[_\s-]*level|risk[_\s-]*class(?!ified)|latest[_\s-]*risk[_\s-]*class(?!ified)|五级|风险分类(?!时间)|风险等级/)) {
        return 100;
      }
      return 0;
    }
    if (semantic === "twelve_level_classification") {
      if (businessFieldId === "bf.loan_contract.latest_risk_result") {
        return 230;
      }
      if (businessFieldId === "bf.loan_contract.year_start_risk_detail") {
        return 220;
      }
      if (businessFieldId === "credit.twelve_level_classification") {
        return 210;
      }
      if (has(/twelve|12[_\s-]*level|sub[_\s-]*risk|risk[_\s-]*sub|latest[_\s-]*risk[_\s-]*result|十二|细分|分类结果/)) {
        return 100;
      }
      return 0;
    }
    if (semantic === "loan_balance") {
      if (businessFieldId === "bf.loan_contract.loan_balance_10k" || businessFieldId === "credit.loan_balance") {
        return 200;
      }
      if (has(/contract[_\s-]*amount|loan[_\s-]*amount|合同金额|授信金额|借款金额/)) {
        return 0;
      }
      if (has(/loan[_\s-]*balance|outstanding[_\s-]*balance|current[_\s-]*balance|本金余额|贷款余额|当前余额|未偿余额/)) {
        return 100;
      }
      return 0;
    }
    if (semantic === "contract_amount") {
      if (businessFieldId === "bf.loan_contract.contract_amount_10k" || businessFieldId === "credit.contract_amount") {
        return 200;
      }
      if (has(/balance|余额/)) {
        return 0;
      }
      if (has(/contract[_\s-]*amount|loan[_\s-]*amount|合同金额|授信金额|借款金额/)) {
        return 100;
      }
      return 0;
    }
    return 0;
  }

  private csvSemanticColumnsForDataSource(dataSourceId: string) {
    if (!existsSync(this.options.csvSqlitePath)) {
      return [] as CsvDatasetColumnRow[];
    }
    const alias = "csvdata";
    const databases = this.db.prepare("pragma database_list").all() as Array<{ name: string; file: string }>;
    if (!databases.some((database) => database.name === alias)) {
      this.db.prepare(`attach database ? as ${quoteIdentifier(alias)}`).run(this.options.csvSqlitePath);
    }
    const columnsInfo = this.db.prepare(`pragma ${alias}.table_info(csv_dataset_columns)`).all() as Array<{ name: string }>;
    const hasColumn = (name: string) => columnsInfo.some((column) => column.name === name);
    return this.db
      .prepare(
        `select name, sqlite_column_name, ordinal_index${hasColumn("source_header") ? ", source_header" : ""}${hasColumn("physical_name") ? ", physical_name" : ""}${hasColumn("business_field_id") ? ", business_field_id" : ""}${hasColumn("display_name_zh") ? ", display_name_zh" : ""}${hasColumn("logical_type") ? ", logical_type" : ""}${hasColumn("mapping_status") ? ", mapping_status" : ""}${hasColumn("field_comment") ? ", field_comment" : ""}${hasColumn("aliases_json") ? ", aliases_json" : ""}
         from ${quoteIdentifier(alias)}.csv_dataset_columns
         where data_source_id = ?
         order by ordinal_index`,
      )
      .all(dataSourceId) as CsvDatasetColumnRow[];
  }

  private csvViewNameForDataSource(dataSourceId: string) {
    if (!existsSync(this.options.csvSqlitePath)) {
      return null;
    }
    const alias = "csvdata";
    const databases = this.db.prepare("pragma database_list").all() as Array<{ name: string; file: string }>;
    if (!databases.some((database) => database.name === alias)) {
      this.db.prepare(`attach database ? as ${quoteIdentifier(alias)}`).run(this.options.csvSqlitePath);
    }
    const row = this.db
      .prepare(
        `select display_name, table_id, sqlite_table_name
         from ${quoteIdentifier(alias)}.csv_dataset_tables
         where data_source_id = ?
         order by updated_at desc
         limit 1`,
      )
      .get(dataSourceId) as { display_name?: string; table_id?: string; sqlite_table_name?: string } | undefined;
    return normalizeSqliteAlias(row?.display_name ?? row?.table_id ?? row?.sqlite_table_name ?? "");
  }

  private async rowsForLatestSkillSqlRecord(conversationId: string) {
    const latestSql = await this.toolResultRegistry.getLatestSuccessful(conversationId, "sql_query");
    const datasetId = latestSql?.outputArtifactIds?.find((artifactId) => artifactId.startsWith("workflow-dataset:"))?.split(":")[1];
    const dataset = datasetId ? await this.datasetStateManager.getDataset(datasetId) : null;
    if (dataset?.sqliteTableName) {
      return this.db.prepare(`select * from ${quoteIdentifier(dataset.sqliteTableName)}`).all() as Array<Record<string, unknown>>;
    }
    return [];
  }

  private latestAssistantMessageForConversation(conversationId: string, userId: string) {
    const row = this.db
      .prepare("select * from messages where conversation_id = ? and user_id = ? and role = 'assistant' order by created_at desc limit 1")
      .get(conversationId, userId);
    return row ? this.messageFromRow(row) : null;
  }

  private fallbackAssistantMessage(record: ToolCallRecord, content: string): AssistantMessage {
    return {
      id: record.messageId ?? record.toolCallId,
      conversationId: record.conversationId,
      userId: record.userId,
      role: "assistant",
      status: "completed",
      content,
      blocks: parseAssistantBlocks(content),
      createdAt: record.createdAt,
      updatedAt: nowIso(),
      integrityHash: "",
    };
  }

  private async registerAssistantToolResult(
    toolCall: AssistantToolCall,
    input: { result: string; sqlDataset?: WorkflowDatasetRef },
  ) {
    const toolKind = assistantToolKindToOrchestrationKind(toolCall.kind);
    const existing = await this.toolResultRegistry.get(toolCall.id);
    if (existing?.status === "completed") {
      return existing;
    }
    const artifactIds = await this.createAssistantToolArtifacts(toolCall, toolKind, input);
    const parent = toolKind === "python_analysis"
      ? await this.toolResultRegistry.getLatestSuccessful(toolCall.conversationId, "sql_query")
      : null;
    const version = (await this.toolResultRegistry.listByConversation(toolCall.conversationId)).filter((record) => record.toolKind === toolKind).length + 1;
    const createdAt = toolCall.createdAt;
    const completedAt = toolCall.updatedAt;
    const record: ToolCallRecord = {
      toolCallId: toolCall.id,
      conversationId: toolCall.conversationId,
      messageId: toolCall.messageId,
      userId: toolCall.userId,
      toolKind,
      toolName: TOOL_NAMES[toolKind],
      status: "completed",
      request: {
        userRequest: this.sourcePromptForToolCall(toolCall),
        script: toolCall.script,
        approvalMode: toolCall.approvalMode,
      },
      resolvedInput: parent
        ? {
            mode: "latest_result",
            sourceToolKind: parent.toolKind,
            sourceToolCallId: parent.toolCallId,
            sourceArtifactIds: parent.outputArtifactIds ?? parent.result?.artifactIds,
            reason: "AssistantRuntime 实际工具执行结果登记时自动关联最近成功 SQL 结果。",
          }
        : { mode: "no_input", reason: `${TOOL_NAMES[toolKind]} 使用当前工具请求自身输入。` },
      result: {
        resultId: `result_${toolCall.id}`,
        toolKind,
        artifactIds,
        primaryArtifactId: artifactIds[0],
        summary: this.assistantToolSummary(toolCall, input, artifactIds),
        createdAt: completedAt,
        metadata: {
          assistantToolKind: toolCall.kind,
          approvalMode: toolCall.approvalMode,
        },
      },
      parentToolCallIds: parent ? [parent.toolCallId] : [],
      sourceArtifactIds: parent?.outputArtifactIds ?? parent?.result?.artifactIds ?? [],
      outputArtifactIds: artifactIds,
      version,
      isLatestSuccessful: false,
      createdAt,
      updatedAt: completedAt,
      completedAt,
      metadata: {
        source: "assistant-runtime",
        toolDurationMs: toolCallDurationMs(toolCall),
      },
    };
    await this.toolResultRegistry.register(record);
    await this.toolResultRegistry.markLatestSuccessful(toolCall.conversationId, toolCall.id);
    await this.workflowMemoryBridge.writeWorkflowMemory({
      conversationId: toolCall.conversationId,
      userId: toolCall.userId,
      type: `${toolKind}_completed`,
      summary: record.result?.summary ?? `${TOOL_NAMES[toolKind]} v${version} 已完成。`,
      payload: {
        toolCallId: toolCall.id,
        toolKind,
        version,
        artifactIds,
        parentToolCallIds: record.parentToolCallIds,
        sourceArtifactIds: record.sourceArtifactIds,
      },
    });
    this.appendToolLog(toolCall, "tool-orchestration", "success", "Assistant 工具结果已登记到会话级工具编排状态。", {
      toolKind,
      version,
      artifactIds,
      parentToolCallIds: record.parentToolCallIds,
      sourceArtifactIds: record.sourceArtifactIds,
    });
    this.options.emit({
      type: "tool-state",
      conversationId: toolCall.conversationId,
      state: await this.toolResultRegistry.getConversationState(toolCall.conversationId),
    });
    return (await this.toolResultRegistry.get(toolCall.id)) ?? record;
  }

  private async createAssistantToolArtifacts(
    toolCall: AssistantToolCall,
    toolKind: ToolKind,
    input: { result: string; sqlDataset?: WorkflowDatasetRef },
  ) {
    if (toolKind === "sql_query") {
      const artifactIds = input.sqlDataset
        ? [`workflow-dataset:${input.sqlDataset.datasetId}`]
        : [`assistant-sql-result:${toolCall.id}`];
      if (!input.sqlDataset) {
        await this.toolArtifactManager.createArtifact({
          artifactId: artifactIds[0],
          artifactType: "dataset_profile",
          title: "SQL 查询结果摘要",
          contentType: "json",
          content: input.result,
          metadata: { toolCallId: toolCall.id },
        });
      }
      return artifactIds;
    }
    const artifact = await this.toolArtifactManager.createArtifact({
      artifactId: `assistant-python-analysis:${toolCall.id}`,
      artifactType: isMarkdownLikeContent(input.result) ? "analysis" : "report_summary",
      title: "Python 分析结果",
      contentType: isMarkdownLikeContent(input.result) ? "markdown" : "json",
      content: input.result,
      metadata: { toolCallId: toolCall.id },
    });
    return [artifact.artifactId];
  }

  private assistantToolSummary(
    toolCall: AssistantToolCall,
    input: { result: string; sqlDataset?: WorkflowDatasetRef },
    artifactIds: string[],
  ) {
    if (toolCall.kind === "sql") {
      const rowCount = input.sqlDataset?.rowCount ?? parseSqlToolRowCount(input.result) ?? 0;
      const columnCount = input.sqlDataset?.columnCount ?? 0;
      return `SQL 查询已完成，输出 ${rowCount} 行、${columnCount} 列，Artifact：${artifactIds.join(", ")}。`;
    }
    return `Python 分析已完成，结果已保存为 Artifact：${artifactIds.join(", ")}。`;
  }

  private async registerAssistantGeneratedArtifacts(input: AssistantSendInput, message: AssistantMessage) {
    const createdRecords: ToolCallRecord[] = [];
    for (const block of message.blocks) {
      if (block.type !== "visualization" || block.visualizationStatus !== "ready" || !block.visualizationSpec) {
        continue;
      }
      const record = await this.registerGeneratedToolRecord({
        toolKind: "chart_rendering",
        toolCallId: `chart_${message.id}_${block.id}`,
        message,
        userRequest: input.prompt,
        title: block.visualizationSpec.title,
        summary: `图表「${block.visualizationSpec.title}」已生成。`,
        artifact: {
          artifactId: `assistant-chart-spec:${message.id}:${block.id}`,
          artifactType: "visualization_spec",
          title: block.visualizationSpec.title,
          contentType: "visualization",
          content: block.visualizationSpec,
          metadata: {
            messageId: message.id,
            blockId: block.id,
            visualizationId: block.visualizationSpec.visualizationId,
          },
        },
        parentKinds: ["python_analysis", "sql_query"],
      });
      if (record) {
        createdRecords.push(record);
      }
    }

    if (isReportGenerationContent(input.prompt, message.content)) {
      const title = inferReportTitle(message.content) ?? "分析报告";
      const record = await this.registerGeneratedToolRecord({
        toolKind: "report_generation",
        toolCallId: `report_${message.id}`,
        message,
        userRequest: input.prompt,
        title,
        summary: `Markdown 报告「${title}」已生成。`,
        artifact: {
          artifactId: `assistant-report-markdown:${message.id}`,
          artifactType: "report_markdown",
          title,
          contentType: "markdown",
          content: message.content,
          metadata: {
            messageId: message.id,
            providerTraceId: message.providerTraceId,
          },
        },
        parentKinds: ["chart_rendering", "python_analysis", "sql_query"],
      });
      if (record) {
        createdRecords.push(record);
      }
    }

    if (createdRecords.length > 0) {
      const state = await this.toolResultRegistry.getConversationState(message.conversationId);
      this.options.emit({ type: "tool-state", conversationId: message.conversationId, state });
    }
  }

  private async registerGeneratedToolRecord(input: {
    toolKind: ToolKind;
    toolCallId: string;
    message: AssistantMessage;
    userRequest: string;
    title: string;
    summary: string;
    artifact: Parameters<ArtifactManager["createArtifact"]>[0];
    parentKinds: ToolKind[];
  }) {
    const existing = await this.toolResultRegistry.get(input.toolCallId);
    if (existing?.status === "completed") {
      return null;
    }
    const parents = (await Promise.all(input.parentKinds.map((toolKind) => this.toolResultRegistry.getLatestSuccessful(input.message.conversationId, toolKind))))
      .filter((record): record is ToolCallRecord => Boolean(record));
    const sourceArtifactIds = uniqueValues(parents.flatMap((record) => record.outputArtifactIds ?? record.result?.artifactIds ?? []));
    const parentToolCallIds = uniqueValues(parents.map((record) => record.toolCallId));
    const primaryParent = parents[0];
    const artifact = await this.toolArtifactManager.createArtifact(input.artifact);
    const version = (await this.toolResultRegistry.listByConversation(input.message.conversationId)).filter((record) => record.toolKind === input.toolKind).length + 1;
    const record: ToolCallRecord = {
      toolCallId: input.toolCallId,
      conversationId: input.message.conversationId,
      messageId: input.message.id,
      userId: input.message.userId,
      toolKind: input.toolKind,
      toolName: TOOL_NAMES[input.toolKind],
      status: "completed",
      request: {
        userRequest: input.userRequest,
        title: input.title,
        source: "assistant-generated-message",
      },
      resolvedInput: primaryParent
        ? {
            mode: "latest_result",
            sourceToolKind: primaryParent.toolKind,
            sourceToolCallId: primaryParent.toolCallId,
            sourceArtifactIds,
            reason: `${TOOL_NAMES[input.toolKind]} 使用会话最近成功工具结果作为默认输入。`,
          }
        : {
            mode: "no_input",
            reason: `${TOOL_NAMES[input.toolKind]} 基于当前模型响应内容生成。`,
          },
      result: {
        resultId: `result_${input.toolCallId}`,
        toolKind: input.toolKind,
        artifactIds: [artifact.artifactId],
        primaryArtifactId: artifact.artifactId,
        summary: input.summary,
        createdAt: input.message.updatedAt,
        metadata: {
          messageId: input.message.id,
          artifactType: artifact.artifactType,
        },
      },
      parentToolCallIds,
      sourceArtifactIds,
      outputArtifactIds: [artifact.artifactId],
      version,
      isLatestSuccessful: false,
      createdAt: input.message.createdAt,
      updatedAt: input.message.updatedAt,
      completedAt: input.message.updatedAt,
      metadata: {
        source: "assistant-generated-message",
        title: input.title,
      },
    };
    await this.toolResultRegistry.register(record);
    await this.toolResultRegistry.markLatestSuccessful(input.message.conversationId, input.toolCallId);
    await this.workflowMemoryBridge.writeWorkflowMemory({
      conversationId: input.message.conversationId,
      userId: input.message.userId,
      type: `${input.toolKind}_completed`,
      summary: input.summary,
      payload: {
        toolCallId: input.toolCallId,
        toolKind: input.toolKind,
        version,
        artifactIds: [artifact.artifactId],
        parentToolCallIds,
        sourceArtifactIds,
      },
    });
    return (await this.toolResultRegistry.get(input.toolCallId)) ?? record;
  }

  private async emitToolState(conversationId: string) {
    this.options.emit({
      type: "tool-state",
      conversationId,
      state: await this.toolResultRegistry.getConversationState(conversationId),
    });
  }

  private async registerSqlToolResultDataset(toolCall: AssistantToolCall, materializationRows?: Array<Record<string, unknown>>) {
    const rows = materializationRows ?? parseSqlToolRows(toolCall.result);
    const existing = (await this.datasetStateManager.listDatasets(toolCall.conversationId)).find((dataset) => dataset.sourceSqlExecutionId === toolCall.id);
    if (existing) {
      this.appendToolLog(toolCall, "workflow-materialization", "info", "SQL 工具结果已存在对应工作流数据集，跳过重复物化。", {
        datasetId: existing.datasetId,
      });
      return existing;
    }

    const workflow = await this.ensureWorkflowForToolCall(toolCall);
    const activeDataset = await this.datasetStateManager.getActiveDataset(toolCall.conversationId);
    const parentDataset = activeDataset && this.referencesDatasetTable(toolCall.script, activeDataset) ? activeDataset : null;
    const resultColumns = this.inferResultColumns(rows);
    if (resultColumns.length === 0) {
      this.appendToolLog(toolCall, "workflow-materialization", "info", "SQL 工具结果为空，未创建工作流数据集。", {
        workflowId: workflow.workflowId,
      });
      await this.workflowStore.update(workflow.workflowId, {
        status: "waiting_user_confirmation",
        steps: [
          ...workflow.steps,
          {
            stepId: randomUUID(),
            type: "sqlite_materialization",
            status: "skipped",
            input: { toolCallId: toolCall.id },
            output: { reason: "empty_result" },
            completedAt: nowIso(),
          },
        ],
      });
      return null;
    }

    const materialized = await this.sqliteMaterializer.materializeSqlResult({
      workflowId: workflow.workflowId,
      conversationId: toolCall.conversationId,
      sqlRequestId: toolCall.id,
      sqlExecutionId: toolCall.id,
      sourceDataSourceId: toolCall.conversationId,
      resultColumns,
      rows,
      targetTableName: `wf_${toolCall.id.replaceAll("-", "_")}`,
      parentDatasetIds: parentDataset ? [parentDataset.datasetId] : undefined,
      metadata: {
        sourceToolCallId: toolCall.id,
        sourceScript: toolCall.script,
      },
    });
    this.tempTableRegistry.register(materialized);
    const datasetCreatedAt = materialized.createdAt;
    const dataset: WorkflowDatasetRef = {
      datasetId: materialized.datasetId,
      workflowId: workflow.workflowId,
      conversationId: toolCall.conversationId,
      name: `${toolTarget(toolCall)} 结果集`,
      sourceType: parentDataset ? "refined_sql_result" : "sql_execution_result",
      sqliteTableName: materialized.sqliteTableName,
      sqliteDatabasePath: materialized.sqliteDatabasePath,
      parentDatasetIds: parentDataset ? [parentDataset.datasetId] : undefined,
      sourceSqlRequestId: toolCall.id,
      sourceSqlExecutionId: toolCall.id,
      rowCount: materialized.rowCount,
      columnCount: materialized.columnCount,
      schema: materialized.schema,
      status: "ready",
      canQuery: true,
      canAnalyze: true,
      canUseForReport: true,
      createdAt: datasetCreatedAt,
      updatedAt: datasetCreatedAt,
      expiresAt: new Date(Date.parse(datasetCreatedAt) + WORKFLOW_DATASET_TTL_MS).toISOString(),
      metadata: {
        sourceToolCallId: toolCall.id,
        sourceScriptHash: sha256(toolCall.script),
        userId: toolCall.userId,
      },
    };
    dataset.profile = this.sqliteMaterializer.profileDataset(dataset);
    await this.datasetStateManager.registerDataset(dataset);
    const latestWorkflow = (await this.workflowStore.get(workflow.workflowId)) ?? workflow;
    const updated = await this.workflowStore.update(workflow.workflowId, {
      status: "waiting_user_confirmation",
      activeDatasetId: dataset.datasetId,
      latestSqlDatasetId: dataset.datasetId,
      steps: [
        ...latestWorkflow.steps,
        {
          stepId: randomUUID(),
          type: "sql_execution",
          status: "success",
          input: { toolCallId: toolCall.id, script: toolCall.script },
          output: { rowCount: dataset.rowCount, columnCount: dataset.columnCount },
          startedAt: toolCall.createdAt,
          completedAt: toolCall.updatedAt,
        },
        {
          stepId: randomUUID(),
          type: "sqlite_materialization",
          status: "success",
          input: { toolCallId: toolCall.id },
          output: { datasetId: dataset.datasetId, sqliteTableName: dataset.sqliteTableName },
          startedAt: materialized.createdAt,
          completedAt: nowIso(),
        },
        {
          stepId: randomUUID(),
          type: "dataset_profile",
          status: "success",
          input: { datasetId: dataset.datasetId },
          output: {
            rowCount: dataset.profile.rowCount,
            columnCount: dataset.profile.columnCount,
            previewRows: Math.min(dataset.profile.previewRows?.length ?? 0, 20),
          },
          completedAt: dataset.profile.generatedAt,
        },
      ],
    });
    await this.workflowStore.appendEvent(updated.workflowId, {
      eventId: randomUUID(),
      workflowId: updated.workflowId,
      conversationId: toolCall.conversationId,
      type: parentDataset ? "dataset_refined" : "dataset_materialized",
      message: "SQL 查询结果已物化为 SQLite 工作流数据集。",
      payload: {
        datasetId: dataset.datasetId,
        sqliteTableName: dataset.sqliteTableName,
        rowCount: dataset.rowCount,
        columnCount: dataset.columnCount,
        parentDatasetIds: dataset.parentDatasetIds,
      },
      createdAt: nowIso(),
    });
    await this.workflowMemoryBridge.writeWorkflowMemory({
      conversationId: toolCall.conversationId,
      userId: toolCall.userId,
      type: "dataset_materialized",
      summary: `SQL 查询结果已物化为数据集 ${dataset.datasetId}，共 ${dataset.rowCount ?? 0} 行、${dataset.columnCount ?? 0} 列。`,
      payload: {
        workflowId: workflow.workflowId,
        datasetId: dataset.datasetId,
        sqliteTableName: dataset.sqliteTableName,
        rowCount: dataset.rowCount,
        columnCount: dataset.columnCount,
        parentDatasetIds: dataset.parentDatasetIds,
      },
    });
    this.appendToolLog(toolCall, "workflow-materialization", "success", "SQL 查询结果已物化为工作流数据集。", {
      workflowId: workflow.workflowId,
      datasetId: dataset.datasetId,
      sqliteTableName: dataset.sqliteTableName,
      rowCount: dataset.rowCount,
      columnCount: dataset.columnCount,
      parentDatasetIds: dataset.parentDatasetIds,
    });
    this.options.emit({ type: "workflow", conversationId: toolCall.conversationId, context: await this.workflowContextBuilder.build(toolCall.conversationId) });
    return dataset;
  }

  private async cleanupExpiredWorkflowDatasets(conversationId: string) {
    const nowTime = Date.now();
    const datasets = await this.datasetStateManager.listDatasets(conversationId);
    const expiredDatasetIds: string[] = [];
    for (const dataset of datasets) {
      if (!dataset.expiresAt || Date.parse(dataset.expiresAt) > nowTime || dataset.status === "expired") {
        continue;
      }
      if (dataset.sqliteTableName) {
        this.sqliteMaterializer.dropTable(dataset.sqliteTableName);
      }
      this.tempTableRegistry.unregister(dataset.datasetId);
      await this.datasetStateManager.expireDataset(dataset.datasetId);
      expiredDatasetIds.push(dataset.datasetId);
      await this.workflowMemoryBridge.writeWorkflowMemory({
        conversationId,
        userId: dataset.metadata?.userId as string || "system",
        type: "dataset_expired",
        summary: `工作流数据集 ${dataset.datasetId} 已按 TTL 过期清理。`,
        payload: {
          workflowId: dataset.workflowId,
          datasetId: dataset.datasetId,
          sqliteTableName: dataset.sqliteTableName,
        },
      });
    }
    if (expiredDatasetIds.length === 0) {
      return;
    }
    const workflow = await this.workflowStore.getActiveByConversation(conversationId);
    if (!workflow) {
      return;
    }
    await this.workflowStore.update(workflow.workflowId, {
      activeDatasetId: expiredDatasetIds.includes(workflow.activeDatasetId ?? "") ? undefined : workflow.activeDatasetId,
      latestSqlDatasetId: expiredDatasetIds.includes(workflow.latestSqlDatasetId ?? "") ? undefined : workflow.latestSqlDatasetId,
      confirmedDatasetId: expiredDatasetIds.includes(workflow.confirmedDatasetId ?? "") ? undefined : workflow.confirmedDatasetId,
    });
  }

  private async ensureWorkflowForToolCall(toolCall: AssistantToolCall): Promise<WorkflowSession> {
    const active = await this.workflowStore.getActiveByConversation(toolCall.conversationId);
    if (active) {
      return active;
    }
    const createdAt = nowIso();
    const workflow: WorkflowSession = {
      workflowId: randomUUID(),
      conversationId: toolCall.conversationId,
      userId: toolCall.userId,
      type: "data_extraction",
      status: "materializing_dataset",
      title: toolTarget(toolCall),
      userGoal: toolCall.script,
      steps: [
        {
          stepId: randomUUID(),
          type: "sql_request",
          status: "success",
          input: { toolCallId: toolCall.id, script: toolCall.script },
          output: { toolCallId: toolCall.id },
          startedAt: toolCall.createdAt,
          completedAt: toolCall.createdAt,
        },
      ],
      datasets: [],
      events: [
        {
          eventId: randomUUID(),
          workflowId: randomUUID(),
          conversationId: toolCall.conversationId,
          type: "workflow_created",
          message: "从已审批 SQL 工具调用创建工作流。",
          payload: { toolCallId: toolCall.id },
          createdAt,
        },
      ],
      createdAt,
      updatedAt: createdAt,
    };
    workflow.events = workflow.events.map((item) => ({ ...item, workflowId: workflow.workflowId }));
    return this.workflowStore.create(workflow);
  }

  private inferResultColumns(rows: Array<Record<string, unknown>>) {
    const first = rows[0];
    if (!first) {
      return [];
    }
    return Object.keys(first).map((name) => {
      const value = first[name];
      let type = "text";
      if (typeof value === "number") {
        type = Number.isInteger(value) ? "integer" : "real";
      } else if (typeof value === "boolean") {
        type = "integer";
      }
      return { name, type };
    });
  }

  private referencesDatasetTable(script: string, dataset: WorkflowDatasetRef) {
    if (!dataset.sqliteTableName) {
      return false;
    }
    const escaped = dataset.sqliteTableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\w])["'\`]?${escaped}["'\`]?(?=$|[^\\w])`, "i").test(script);
  }

  private executeReadonlySql(script: string, toolCall: AssistantToolCall) {
    if (!isReadonlySql(script)) {
      throw new Error("SQL 安全网已拦截：仅允许单条只读 SELECT / WITH / PRAGMA 查询。");
    }
    const views = this.prepareCsvSqlViews(toolCall);
    let executableScript = normalizeCsvSchemaQualifiedSql(script);
    this.appendToolLog(toolCall, "sql-execute", "info", "开始执行只读 SQL。", {
      script,
      executableScript,
      mountedCsvViews: views,
    });
    let rows: Array<Record<string, unknown>>;
    try {
      rows = this.db.prepare(executableScript).all() as Array<Record<string, unknown>>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rewrittenScript = /ORDER BY term does not match any column in the result set/i.test(message)
        ? rewriteCompoundOrderByForSqlite(executableScript)
        : null;
      if (!rewrittenScript) {
        throw error;
      }
      this.appendToolLog(toolCall, "sql-rewrite", "info", "已兼容 SQLite 复合查询 ORDER BY 规则并重试执行。", {
        reason: message,
        executableScript,
        rewrittenScript,
      });
      executableScript = rewrittenScript;
      rows = this.db.prepare(executableScript).all() as Array<Record<string, unknown>>;
    }
    const previewRows = rows.slice(0, 20);
    this.appendToolLog(toolCall, "sql-execute", "success", "只读 SQL 执行完成。", {
      rowCount: rows.length,
      rowLimit: null,
      previewRowCount: previewRows.length,
    });
    return {
      rows,
      result: JSON.stringify(
        {
          rowCount: rows.length,
          previewRows,
          previewRowLimit: 20,
          rowLimit: null,
          materialization: "SQL 查询结果将物化为本地 SQLite 工作流数据集，后续分析应读取 workflow dataset，而不是重复查询数据源。",
        },
        null,
        2,
      ),
    };
  }

  private executePython(script: string) {
    return new Promise<string>((resolve, reject) => {
      const workingDirectory = join(tmpdir(), "cycle-probe-python-sandbox");
      mkdirSync(workingDirectory, { recursive: true });
      const child = spawn("python3", ["-I", "-S", "-c", script], {
        cwd: workingDirectory,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Python 执行超时，已终止。"));
      }, PYTHON_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Python 退出码 ${code}`));
          return;
        }
        const normalizedStdout = stdout.trim();
        if (normalizedStdout && isMarkdownLikeContent(normalizedStdout)) {
          resolve(normalizedStdout);
          return;
        }
        resolve(JSON.stringify({ stdout: normalizedStdout, stderr: stderr.trim() || null }, null, 2));
      });
    });
  }

  private async streamModelResponse(input: AssistantSendInput, conversation: AssistantConversation, assistantMessage: AssistantMessage) {
    const apiKey = await this.options.getModelApiKey(input.userId);
    if (!apiKey) {
      const message = this.updateMessage(assistantMessage.id, {
        status: "error",
        content: "模型 API Key 未配置。",
        blocks: [{ id: randomUUID(), type: "card", title: "配置缺失", content: "请先在用户设置中保存模型 API Key。" }],
        errorMessage: "模型 API Key 未配置。",
      });
      this.options.emit({ type: "message", conversationId: conversation.id, message });
      return;
    }

    const controller = new AbortController();
    this.abortControllers.set(assistantMessage.id, controller);
	    let content = "";
	    let providerTraceId = `trace_${assistantMessage.id}`;
	    let providerToolActivity = false;
	    let streamSequence = 0;

    try {
      const adapter = createStreamingModelAdapter({
        providerName: "siliconflow",
        baseURL: "https://api.siliconflow.cn/v1",
        apiKey,
        model: input.modelName,
        toolExecutionMode: "serial",
      });
      for (const tool of this.createAssistantRuntimeToolDefinitions(input, conversation, assistantMessage, () => {
        providerToolActivity = true;
      })) {
        adapter.registerTool(tool);
      }
      const providerMessages = await this.buildProviderMessages(input.userId, conversation.id, input.prompt, input.dataSourceLabel, input.schemaContextMarkdown, input.skill, input.approvalMode);
      const messages = providerMessages.map((message, index): ConversationMessage => ({
        id: `provider-${assistantMessage.id}-${index}`,
        role: message.role as ConversationMessage["role"],
        content: message.content,
        createdAt: assistantMessage.createdAt,
      }));

      for await (const event of adapter.streamChat({
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        messages,
        model: input.modelName,
        contentType: "markdown",
        signal: controller.signal,
      })) {
        providerTraceId = event.traceId ?? providerTraceId;
        if (event.type === "markdown-delta" || event.type === "text-delta") {
          const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
          if (!delta) {
            continue;
          }
          content = `${content}${delta}`;
          if (content.length > MAX_STREAM_CHARS) {
            throw new Error("模型输出超过本地安全限制，已终止。");
          }
          const blocks = parseAssistantBlocks(content);
          const updated = this.updateMessage(assistantMessage.id, {
            status: "receiving",
            content,
            blocks,
            providerTraceId,
          });
          this.options.emit({
            type: "stream-content",
            conversationId: conversation.id,
            event: {
              type: event.type === "text-delta" ? "text_delta" : "markdown_delta",
              messageId: assistantMessage.id,
              segmentId: event.type === "text-delta" ? generalTextStreamSegmentId(assistantMessage.id) : generalStreamSegmentId(assistantMessage.id),
              sequence: ++streamSequence,
              delta,
              contentRole: "general",
            },
          });
          this.options.emit({ type: "message-delta", conversationId: conversation.id, messageId: assistantMessage.id, content, blocks: updated.blocks, status: updated.status });
          continue;
        }
        if (event.type === "tool-call-start" || event.type === "tool-execution-start") {
          providerToolActivity = true;
          const current = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(assistantMessage.id));
          const updated = this.updateMessage(assistantMessage.id, {
            status: "processing",
            content: current.content,
            blocks: current.blocks,
            providerTraceId,
          });
          this.options.emit({ type: "message", conversationId: conversation.id, message: updated });
          continue;
        }
        if (event.type === "stream-error") {
          const serialized = event.payload.error as { message?: string } | undefined;
          throw new Error(serialized?.message ?? "模型流式调用失败。");
        }
      }

      const completed = this.updateMessage(assistantMessage.id, {
        status: "completed",
        content,
        blocks: parseAssistantBlocks(content),
        providerTraceId,
      });
      this.options.emit({ type: "message", conversationId: conversation.id, message: completed });
      this.options.emit({
        type: "stream-content",
        conversationId: conversation.id,
        event: {
          type: "message_stream_completed",
          messageId: assistantMessage.id,
          completedAt: completed.updatedAt,
        },
      });

      const tool = detectToolFromAssistantOutput(content);
      const shouldStartSkillWorkflow = !providerToolActivity && shouldStartOverallRiskWorkflowAfterModelText(input, content);
      if (!shouldStartSkillWorkflow) {
        await this.registerAssistantGeneratedArtifacts(input, completed);
      }
      if (tool && !shouldStartSkillWorkflow) {
        await this.handleToolCall(input, conversation, completed, tool, { appendToMessage: true });
      } else if (shouldStartSkillWorkflow) {
        await this.routeOverallRiskSkillWorkflow(input, conversation, completed);
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      const messageText = aborted ? "用户已停止生成。" : error instanceof Error ? error.message : "消息接收失败。";
      const failed = this.updateMessage(assistantMessage.id, {
        status: aborted ? "stopped" : "error",
        content: content || messageText,
        blocks: content ? parseAssistantBlocks(content) : [{ id: randomUUID(), type: "card", title: "消息异常", content: messageText }],
        errorMessage: aborted ? undefined : messageText,
        providerTraceId,
      });
      this.options.emit({ type: "message", conversationId: conversation.id, message: failed });
      this.options.emit({
        type: "stream-content",
        conversationId: conversation.id,
        event: {
          type: "stream_error",
          messageId: assistantMessage.id,
          segmentId: generalStreamSegmentId(assistantMessage.id),
          code: aborted ? "REPORT_TRANSITION_CANCELLED" : "UNKNOWN_ERROR",
          message: messageText,
        },
      });
      if (!aborted) {
        this.options.emit({ type: "error", conversationId: conversation.id, messageId: assistantMessage.id, message: messageText, traceId: providerTraceId ?? sha256(messageText).slice(0, 12) });
      }
    } finally {
      this.abortControllers.delete(assistantMessage.id);
    }
  }

  private createAssistantRuntimeToolDefinitions(input: AssistantSendInput, conversation: AssistantConversation, assistantMessage: AssistantMessage, markProviderToolActivity: () => void): ToolDefinition[] {
    if (isOverallRiskSkill(input.skill)) {
      return [];
    }
    return [
      {
        name: TOOL_NAMES.sql_query,
        description: "请求执行受控只读 SQL 查询。必须提供只读 SQL 候选语句，系统会进行安全校验并按用户审批权限处理。",
        inputSchema: TOOL_SCHEMAS.sql_query,
        riskLevel: "high",
        handler: async (request, context) => {
          markProviderToolActivity();
          return this.handleModelSqlTool(request as Record<string, unknown>, input, conversation, assistantMessage, context.toolCallId);
        },
      },
      {
        name: TOOL_NAMES.python_analysis,
        description: "请求执行受控 Python 数据分析。优先使用会话最新 SQL/Workflow 数据集作为输入；如提供 script，系统会按用户审批权限处理。",
        inputSchema: TOOL_SCHEMAS.python_analysis,
        riskLevel: "high",
        handler: async (request, context) => {
          markProviderToolActivity();
          return this.handleModelPythonTool(request as Record<string, unknown>, input, conversation, assistantMessage, context.toolCallId);
        },
      },
      {
        name: TOOL_NAMES.chart_rendering,
        description: "请求登记受控 VisualizationSpec 图表 Artifact。图表数据必须来自已授权结果或可信小型 inline rows。",
        inputSchema: TOOL_SCHEMAS.chart_rendering,
        riskLevel: "medium",
        handler: async (request, context) => {
          markProviderToolActivity();
          return this.handleModelChartTool(request as Record<string, unknown>, input, assistantMessage, context.toolCallId);
        },
      },
      {
        name: TOOL_NAMES.report_generation,
        description: "请求登记 Markdown 报告 Artifact。报告必须基于会话工具结果和 Artifact 摘要，不得伪造数据。",
        inputSchema: TOOL_SCHEMAS.report_generation,
        riskLevel: "low",
        handler: async (request, context) => {
          markProviderToolActivity();
          return this.handleModelReportTool(request as Record<string, unknown>, input, assistantMessage, context.toolCallId);
        },
      },
    ];
  }

  private async handleModelSqlTool(
    request: Record<string, unknown>,
    input: AssistantSendInput,
    conversation: AssistantConversation,
    assistantMessage: AssistantMessage,
    modelToolCallId: string,
  ) {
    const script = typeof request.sql === "string" ? request.sql : typeof request.script === "string" ? request.script : "";
    if (!script.trim()) {
      return {
        status: "waiting_input",
        toolCallId: modelToolCallId,
        message: "request_sql_query_execution 需要提供 sql 字段，且必须是单条只读 SQL。",
      };
    }
    const currentMessage = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(assistantMessage.id));
    await this.handleToolCall(
      {
        ...input,
        prompt: typeof request.userRequest === "string" ? request.userRequest : input.prompt,
      },
      conversation,
      currentMessage,
      { kind: "sql", script },
      { appendToMessage: true },
    );
    return {
      status: input.approvalMode === "request_approval" ? "waiting_approval" : "submitted",
      toolCallId: modelToolCallId,
      message: "SQL 工具请求已进入本地安全校验和审批执行流程。",
    };
  }

  private async handleModelPythonTool(
    request: Record<string, unknown>,
    input: AssistantSendInput,
    conversation: AssistantConversation,
    assistantMessage: AssistantMessage,
    modelToolCallId: string,
  ) {
    const script = typeof request.script === "string" ? request.script : "";
    if (!script.trim()) {
      const state = await this.toolResultRegistry.getConversationState(conversation.id);
      return {
        status: "waiting_input",
        toolCallId: modelToolCallId,
        latestSqlToolCallId: state.latestSuccessfulSqlToolCallId,
        latestSqlArtifactIds: state.latestSuccessfulSqlArtifactIds,
        message: "request_python_analysis_execution 需要提供 script 字段，或先完成可分析 SQL/Workflow 数据集。",
      };
    }
    const currentMessage = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(assistantMessage.id));
    await this.handleToolCall(
      {
        ...input,
        prompt: typeof request.userRequest === "string" ? request.userRequest : input.prompt,
      },
      conversation,
      currentMessage,
      { kind: "python", script },
      { appendToMessage: true },
    );
    return {
      status: input.approvalMode === "request_approval" ? "waiting_approval" : "submitted",
      toolCallId: modelToolCallId,
      message: "Python 工具请求已进入本地审批和沙箱执行流程。",
    };
  }

  private async handleModelChartTool(
    request: Record<string, unknown>,
    input: AssistantSendInput,
    assistantMessage: AssistantMessage,
    modelToolCallId: string,
  ) {
    const parsed = parseVisualizationSpecJson(JSON.stringify(request.visualizationSpec ?? {}), {
      allowInlineData: true,
      inlineDataMaxRows: 200,
      inlineDataMaxBytes: 64 * 1024,
    });
    if (!parsed.success) {
      return {
        status: "waiting_input",
        toolCallId: modelToolCallId,
        message: `request_chart_rendering 需要提供合法 visualizationSpec：${parsed.error.message}`,
      };
    }
    const record = await this.registerGeneratedToolRecord({
      toolKind: "chart_rendering",
      toolCallId: `chart_${modelToolCallId}`,
      message: this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(assistantMessage.id)),
      userRequest: typeof request.userRequest === "string" ? request.userRequest : input.prompt,
      title: parsed.spec.title,
      summary: `图表「${parsed.spec.title}」已通过 request_chart_rendering 生成。`,
      artifact: {
        artifactId: `assistant-chart-spec:${modelToolCallId}`,
        artifactType: "visualization_spec",
        title: parsed.spec.title,
        contentType: "visualization",
        content: parsed.spec,
        metadata: {
          modelToolCallId,
          visualizationId: parsed.spec.visualizationId,
          warnings: parsed.warnings,
        },
      },
	      parentKinds: ["python_analysis", "sql_query"],
	    });
	    await this.emitToolState(assistantMessage.conversationId);
	    return {
      status: "completed",
      toolCallId: modelToolCallId,
      artifactIds: record?.outputArtifactIds ?? [],
      summary: record?.result?.summary,
    };
  }

  private async handleModelReportTool(
    request: Record<string, unknown>,
    input: AssistantSendInput,
    assistantMessage: AssistantMessage,
    modelToolCallId: string,
  ) {
    const markdown = typeof request.markdown === "string" ? request.markdown.trim() : "";
    if (!markdown) {
      const state = await this.toolResultRegistry.getConversationState(assistantMessage.conversationId);
      return {
        status: "waiting_input",
        toolCallId: modelToolCallId,
        latestSqlToolCallId: state.latestSuccessfulSqlToolCallId,
        latestPythonToolCallId: state.latestSuccessfulPythonToolCallId,
        latestChartToolCallId: state.latestSuccessfulChartToolCallId,
        message: "request_markdown_report_generation 需要提供 markdown 字段，或先完成报告内容生成。",
      };
    }
    const title = typeof request.title === "string" && request.title.trim() ? request.title.trim().slice(0, 120) : inferReportTitle(markdown) ?? "分析报告";
    const record = await this.registerGeneratedToolRecord({
      toolKind: "report_generation",
      toolCallId: `report_${modelToolCallId}`,
      message: this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(assistantMessage.id)),
      userRequest: typeof request.userRequest === "string" ? request.userRequest : input.prompt,
      title,
      summary: `Markdown 报告「${title}」已通过 request_markdown_report_generation 生成。`,
      artifact: {
        artifactId: `assistant-report-markdown:${modelToolCallId}`,
        artifactType: "report_markdown",
        title,
        contentType: "markdown",
        content: markdown,
        metadata: {
          modelToolCallId,
        },
      },
      parentKinds: ["chart_rendering", "python_analysis", "sql_query"],
	    });
	    if (record) {
	      const artifactId = record.result?.primaryArtifactId ?? record.outputArtifactIds?.[0] ?? `assistant-report-markdown:${modelToolCallId}`;
	      this.emitReportContentReady({
	        conversationId: assistantMessage.conversationId,
	        messageId: assistantMessage.id,
	        toolCallId: record.toolCallId,
	        version: record.version,
	        artifactId,
	        title,
	        createdAt: record.completedAt ?? record.updatedAt,
	        completedAt: record.completedAt ?? record.updatedAt,
	        markdown,
	      });
	    }
	    await this.emitToolState(assistantMessage.conversationId);
    return {
      status: "completed",
      toolCallId: modelToolCallId,
      artifactIds: record?.outputArtifactIds ?? [],
      summary: record?.result?.summary,
    };
  }

  private async buildProviderMessages(
    userId: string,
    conversationId: string,
    prompt: string,
    dataSourceLabel: string | null | undefined,
    schemaContextMarkdown: string | null | undefined,
    skill: AssistantSkill | null | undefined,
    approvalMode: AssistantApprovalMode,
  ) {
    const recentToolContext = this.recentToolContext(userId, conversationId);
    const workflowContext = await this.workflowContextBuilder.buildMarkdown(conversationId);
    const history = this.getConversationMessages(userId, conversationId)
      .filter((message) => (message.role === "user" || message.role === "assistant") && message.status === "completed" && message.content.trim())
      .slice(-MAX_STORED_MESSAGES_FOR_CONTEXT)
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      }));

    return [
      {
        role: "system",
        content: [
          "你是 Cycle Probe 的数据助手。请用中文回答。",
          "所有模型回复必须流式输出。默认普通问答、说明和简短结论使用流式 text；只有报告、方案、结构化分析、代码块、SQL 候选语句、工具调用执行结果和需要长期查看的产物使用流式 markdown。",
          "不要编造数据库结果；需要查询数据源时，应优先使用 request_sql_query_execution 语义生成候选只读 SQL、查询目的和结果用途，SQL 必须先经过安全校验、权限校验、风险评估和用户审批。",
          "当用户要求统计、筛选或读取数据源内容时，必须输出单个 ```sql 代码块承载候选只读 SQL；客户端会自动捕获该 SQL 并进入安全校验、审批和工具执行流程。",
          "当 Workflow Context 中存在 activeDataset 且用户提到上一轮、当前结果、这批数据或刚才的数据时，候选 SQL 必须优先查询 activeDataset 的 sqliteTableName；不要重新访问原始业务表，除非用户明确要求重新查询原始数据源。",
          "如果用户明确要求“根据 SQL 查询结果/上一轮查询结果/工具调用结果”继续统计、对比或生成报告，必须复用最近工具结果，不得重新生成 SQL；需要计算时输出单个 ```python 代码块，报告正文必须为 Markdown。",
          "Python 工具运行在受限本地沙箱中，只能使用 Python 标准库；不得 import pandas、numpy、openpyxl、matplotlib 或任何第三方库。需要读取工作流数据集时使用 sqlite3 连接 Workflow Context 中的 sqliteDatabasePath，并读取 activeDataset.sqliteTableName。",
          "当用户需要图表或可视化时，只能生成受控 VisualizationSpec；不得生成完整 ECharts option、vis-network 配置、vis-timeline 配置、JavaScript、React、HTML、SVG 或 formatter 函数。",
          "VisualizationSpec 只描述业务语义、图表类型、字段映射、指标格式、交互需求和数据来源。图表数据必须优先引用 SQL/Python/Workflow Artifact；只有系统已给出小型聚合结果且可信时，才允许 inline rows。",
          "当前客户端把受控 VisualizationSpec 作为内部 visualization 节点处理。确需输出图表时，请使用单个 ```visualization JSON 代码块承载 VisualizationSpec；客户端会将其转换为内部图表节点，不会把协议作为普通 Markdown 展示。",
          "VisualizationSpec 中不要指定 rendererId、rendererClass、dynamicImport、importPath、任意颜色、原始 HTML、本地文件路径或可执行代码。系统会根据业务语义和图表类型自动路由 renderer。",
          TOOL_ORCHESTRATION_SYSTEM_PROMPT,
          "仅在本地脚本调试场景才输出 /sql 或 /python 代码块，客户端会按审批权限处理。",
          `当前数据源：${dataSourceLabel || "未选择"}`,
          `当前 Skill：${skill || "未选择"}`,
          selectedSkillSystemPrompt(skill),
          `审批权限：${approvalMode}`,
          schemaContextMarkdown ? `\n以下是已授权数据源 Schema Context。请遵守其中 Usage Policy、安全约束和工具调用要求，不要基于样例行推断全量结论。\n${schemaContextMarkdown}` : undefined,
          workflowContext ? `\n${workflowContext}` : undefined,
          recentToolContext ? `\n${recentToolContext}` : undefined,
        ].filter(Boolean).join("\n"),
      },
      ...history,
      { role: "user", content: prompt },
    ];
  }

  private readSiliconFlowDelta(payload: string) {
    try {
      const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
      return parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? "";
    } catch {
      return "";
    }
  }
}
