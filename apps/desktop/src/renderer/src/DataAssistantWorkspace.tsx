import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FocusEvent } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatComposerInput,
  ChatMessageList,
  ChatMessageMetadata,
  ChatTokenizedText,
  ChatToolCalls,
  type ChatToolCallItem,
  type ChatComposerToken,
  type ChatComposerInputHandle,
  type ChatComposerTrigger,
} from "@astryxdesign/core/Chat";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DropdownMenu, DropdownMenuItem, type DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { Card, HStack, VStack } from "@astryxdesign/core/Layout";
import { Markdown, type MarkdownComponents } from "@astryxdesign/core/Markdown";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { Section } from "@astryxdesign/core/Section";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import type { SearchableItem, SearchSource } from "@astryxdesign/core/Typeahead";
import { CircleAlert, Clock, Copy, FileText, LoaderCircle, Maximize2, Minimize2, Pencil, Plus, RotateCcw, Sparkles, Trash2, X, type LucideIcon } from "lucide-react";
import type { AuthFailure, AuthUser } from "./auth";
import { useAppToast } from "./useAppToast";
import { workbenchApi, type ApiResult, type DataSourceSummary } from "./workbenchApi";
import {
  createEmptyChatComposerDraft,
  removeChatComposerDraft,
  type ChatComposerDraftState,
} from "./chat-composer-draft";
import {
  chatFieldMentionKey,
  createChatFieldToken,
  fieldsFromChatCsvAttachment,
  findChatFieldMention,
  insertFieldTokenText,
  selectConversationCsvFields,
  upsertFieldToken,
  type ChatFieldMention,
  type ConversationCsvField,
} from "./chat-field-selector";
import {
  buildChatToolSelectorSections,
  chatToolMentionKey,
  findChatToolMention,
  isSuppressedChatToolMention,
  removeChatToolMention,
  type ChatToolDataSourceKind,
  type ChatToolDataSourceOption,
  type ChatToolMention,
  type ChatToolSelectorItem,
} from "./chat-tool-selector";
import { VisualizationRenderer } from "./components/VisualizationRenderer";
import { ReportMarkdownViewer, toolKindLabel, toolStatusLabel } from "./components/tool-calls";
import { StreamingReportSegment } from "./components/streaming-content";
import {
  applyChatStreamEvent,
  DEFAULT_REPORT_TRANSITION_POLICY,
  reportMarkdownContentIndex,
  ReportTransitionController,
  resolveReportCardRenderTransition,
  splitReportMarkdownContent,
  StreamSegmentManager,
  type ChatStreamEvent,
  type ReportContentSegment,
  type ReportTransitionPolicy,
} from "./streaming-content";
import { parseVisualizationSpecJson } from "../../shared/visualization";
import approveIcon from "./assets/approve.svg";
import type {
  AssistantApprovalMode,
  AssistantBlock,
  AssistantConversation,
  AssistantMessage,
  AssistantMessageStatus,
  AssistantSkill,
  AssistantStreamEvent,
} from "../../main/assistantRuntime";
import type { ChatCsvAttachment, ChatCsvSelectedFieldRef } from "../../main/chatCsvTempSource";
import type { ArtifactRecord, ConversationToolState, ToolCallRecord } from "../../main/toolOrchestration";
import type { WorkflowContextSummary } from "../../main/workflowRuntime";

type RequestWithRefresh = <T extends { success: true }>(
  call: (accessToken: string) => Promise<ApiResult<T>>,
) => Promise<ApiResult<T>>;

type DataAssistantWorkspaceProps = {
  user: AuthUser | null;
  modelName: string;
  isModelConfigured: boolean;
  canReadDataSources: boolean;
  requestWithRefresh: RequestWithRefresh;
  onRequireModelConfig: () => void;
};

const approvalOptions: Array<{ label: string; value: AssistantApprovalMode }> = [
  { label: "请求批准", value: "request_approval" },
  { label: "完全访问权限", value: "full_access" },
  { label: "禁止访问权限", value: "no_access" },
];

const skillOptions: Array<{ label: string; value: AssistantSkill }> = [
  { label: "整体风险分类分布（笔数+金额）", value: "overall-risk-classification-distribution" },
];

const ARTIFACT_WINDOW_STATE_KEY = "cycle-probe:assistant:artifact-window";
const ARTIFACT_PANEL_WIDTH_KEY = "cycle-probe:assistant:artifact-panel-width";
const MAX_CONVERSATION_TITLE_LENGTH = 200;
const CHAT_CSV_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const FULL_FIELD_CONTEXT_APPROVAL_THRESHOLD = 100;
const REPORT_TRANSITION_POLICY: ReportTransitionPolicy = {
  ...DEFAULT_REPORT_TRANSITION_POLICY,
  bufferDelayMs: 1000,
};

type ArtifactWindowState = {
  messageId: string | null;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
};

type ArtifactContentState = {
  messageId: string;
  artifactId?: string;
  status: "loading" | "ready" | "error";
  markdown: string;
  error?: string;
};

type ReportCardTransitionState = {
  status: "hidden" | "buffering" | "card_ready" | "visible" | "error";
  segmentId: string;
};

type ToolSelectorTrigger = "button" | "at_symbol";

type MessageDeltaStreamEvent = Extract<AssistantStreamEvent, { type: "message-delta" }>;

type ContextTokenInput = {
  files?: string[];
  skill?: AssistantSkill | null;
  dataSourceLabel?: string | null;
};

type ContextTokenDisplay = {
  tokens: ChatComposerToken[];
  values: string[];
};

type CsvFieldSearchItem = SearchableItem<ConversationCsvField>;

type AssistantComposerDraft = ChatComposerDraftState<AssistantSkill, ChatCsvSelectedFieldRef>;

type AssistantComposerDraftSnapshot = {
  conversationId: string;
  draft: AssistantComposerDraft;
};

type FullFieldContextApprovalSource = {
  fileName: string;
  fieldCount: number;
};

type FullFieldContextApprovalRequest = {
  sources: FullFieldContextApprovalSource[];
};

const defaultArtifactWindowState: ArtifactWindowState = {
  messageId: null,
  isOpen: false,
  isMinimized: false,
  isMaximized: false,
};

function isFailure<T extends { success: true }>(result: ApiResult<T>): result is AuthFailure {
  return result.success === false;
}

function createClientRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `client-${crypto.randomUUID()}`;
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createOptimisticMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `optimistic-${crypto.randomUUID()}`;
  }
  return `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatChatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatArtifactGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dataSourceLabel(dataSource?: DataSourceSummary) {
  if (!dataSource) {
    return "未选择数据源";
  }
  return `${dataSource.name} / ${dataSource.database}`;
}

function skillLabel(skill?: AssistantSkill | null) {
  if (!skill) {
    return "";
  }
  return skillOptions.find((item) => item.value === skill)?.label ?? skill;
}

function contextTokenValue(kind: "file" | "skill" | "data_source", index: number) {
  const prefix = kind === "data_source" ? "datasource" : kind;
  return `assistant${prefix}${index}`;
}

function dataSourceTableLabel(dataSourceLabel?: string | null) {
  const trimmed = dataSourceLabel?.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.split("/")[0]?.trim() || trimmed;
}

function buildContextTokenDisplay(input: ContextTokenInput): ContextTokenDisplay {
  const tokens: ChatComposerToken[] = [];
  const values: string[] = [];
  let tokenIndex = 0;

  for (const fileName of input.files ?? []) {
    const value = contextTokenValue("file", tokenIndex++);
    values.push(value);
    tokens.push({
      value,
      label: `#${fileName}`,
      variant: "green",
    });
  }

  if (input.skill) {
    const value = contextTokenValue("skill", tokenIndex++);
    values.push(value);
    tokens.push({
      value,
      label: `@${skillLabel(input.skill)}`,
      variant: "purple",
    });
  }

  const sourceLabel = dataSourceTableLabel(input.dataSourceLabel);
  if (sourceLabel) {
    const value = contextTokenValue("data_source", tokenIndex++);
    values.push(value);
    tokens.push({
      value,
      label: `#${sourceLabel}`,
      variant: "blue",
    });
  }

  return { tokens, values };
}

function isNativeChatComposerFieldMention(value: string, mention: ChatFieldMention) {
  if (mention.start === 0) {
    return true;
  }
  const previous = value[mention.start - 1];
  return previous === " " || previous === "\n";
}

function childNodeIndex(node: ChildNode) {
  return node.parentNode ? Array.prototype.indexOf.call(node.parentNode.childNodes, node) as number : 0;
}

function serializedTokenLength(node: HTMLElement) {
  return node.getAttribute("data-astryx-token-value")?.length ?? node.textContent?.length ?? 0;
}

function findSerializedDomPosition(root: HTMLElement, targetOffset: number): { node: Node; offset: number } | null {
  let currentOffset = 0;
  let result: { node: Node; offset: number } | null = null;
  const visit = (node: Node) => {
    if (result) {
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (targetOffset <= currentOffset + length) {
        result = { node, offset: Math.max(0, targetOffset - currentOffset) };
        return;
      }
      currentOffset += length;
      return;
    }
    if (node instanceof HTMLBRElement) {
      if (targetOffset <= currentOffset + 1) {
        result = { node: node.parentNode ?? root, offset: childNodeIndex(node) };
        return;
      }
      currentOffset += 1;
      return;
    }
    if (node instanceof HTMLElement && node.hasAttribute("data-astryx-token")) {
      const length = serializedTokenLength(node);
      if (targetOffset <= currentOffset + length) {
        result = {
          node: node.parentNode ?? root,
          offset: childNodeIndex(node) + (targetOffset - currentOffset > 0 ? 1 : 0),
        };
        return;
      }
      currentOffset += length;
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
      if (result) {
        return;
      }
    }
  };
  visit(root);
  return result ?? { node: root, offset: root.childNodes.length };
}

function selectSerializedComposerRange(root: HTMLElement, start: number, end: number) {
  const startPosition = findSerializedDomPosition(root, start);
  const endPosition = findSerializedDomPosition(root, end);
  const selection = window.getSelection();
  if (!startPosition || !endPosition || !selection) {
    return false;
  }
  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function toolDataSourceKind(dataSource: DataSourceSummary): ChatToolDataSourceKind {
  return dataSource.type === "csv" ? "csv" : "database";
}

function toolDataSourceBadgeLabel(kind: ChatToolDataSourceKind) {
  if (kind === "temporary_csv") {
    return "临时 CSV";
  }
  return kind === "csv" ? "CSV" : "数据库";
}

function toolDataSourceBadgeVariant(kind: ChatToolDataSourceKind) {
  if (kind === "temporary_csv") {
    return "purple";
  }
  return kind === "csv" ? "blue" : "info";
}

function readArtifactWindowState(): ArtifactWindowState {
  if (typeof window === "undefined") {
    return defaultArtifactWindowState;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(ARTIFACT_WINDOW_STATE_KEY) ?? "null") as Partial<ArtifactWindowState> | null;
    return {
      messageId: typeof parsed?.messageId === "string" ? parsed.messageId : null,
      isOpen: parsed?.isOpen === true,
      isMinimized: false,
      isMaximized: parsed?.isMaximized === true,
    };
  } catch {
    return defaultArtifactWindowState;
  }
}

function writeArtifactWindowState(state: ArtifactWindowState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ARTIFACT_WINDOW_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore persistence failures; artifact window state still works in memory.
  }
}

function extractMarkdownTitle(content: string, fallback: string) {
  const heading = content.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading.replace(/[*_`#]+/g, "").slice(0, 80);
  }

  const firstTextLine = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[*\-\d.\s#`>]+/, "").trim())
    .find(Boolean);
  return (firstTextLine || fallback).slice(0, 80);
}

function isAssistantArtifactMessage(message: AssistantMessage, toolState?: ConversationToolState | null) {
  return (
    message.role === "assistant" &&
    message.content.trim().length > 0 &&
    message.blocks.some((block) => block.type === "markdown" && !isRenderableCodeLanguage(block.language)) &&
    !message.blocks.some((block) => block.toolCallId) &&
    Boolean(reportRecordForMessage(message, toolState))
  );
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function isPythonApprovalPrompt(value: string) {
  return /^(确认|批准|同意|执行|开始执行|确认执行)\s*(执行)?\s*python\s*$/i.test(value.trim());
}

function pendingPythonToolCallId(messages: AssistantMessage[]) {
  for (const message of messages.slice().reverse()) {
    const block = message.blocks
      .slice()
      .reverse()
      .find((item) => item.toolCallId && item.toolName === "python" && item.toolStatus === "pending_approval");
    if (block?.toolCallId) {
      return block.toolCallId;
    }
  }
  return null;
}

function formatMessageDuration(message: AssistantMessage, nowMs: number) {
  if (message.role !== "assistant" || message.status === "draft") {
    return null;
  }
  const startedAt = Date.parse(message.createdAt);
  const endedAt = message.status === "receiving" || message.status === "processing" ? nowMs : Date.parse(message.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  if (totalSeconds >= 60) {
    return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  }
  return `${totalSeconds}s`;
}

function AssistantActionIcon({ src }: { src: string }) {
  return (
    <span
      className="assistant-action-icon"
      style={{ "--assistant-action-icon-url": `url(${src})` } as CSSProperties}
      aria-hidden="true"
    />
  );
}

function MetadataIconButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} placement="above">
      <button type="button" className="assistant-message-action" onClick={onClick} aria-label={label} title={label}>
        <Icon icon={icon} size="xsm" color="inherit" />
      </button>
    </Tooltip>
  );
}

function MetadataStatusIcon({ status, isThinking }: { status: AssistantMessageStatus; isThinking: boolean }) {
  const label = statusLabel(status);
  const icon = isThinking || status === "sending" ? LoaderCircle : status === "awaiting_approval" ? Clock : CircleAlert;

  return (
    <Tooltip content={label} placement="above">
      <span className={`assistant-message-status ${status === "error" ? "failed" : ""}`} aria-label={label} title={label}>
        <Icon icon={icon} size="xsm" color="inherit" className={isThinking || status === "sending" ? "assistant-message-status-spinner" : undefined} />
      </span>
    </Tooltip>
  );
}

function AssistantLanding({ userName }: { userName: string }) {
  return (
    <div className="assistant-landing">
      <VStack gap={2} hAlign="stretch" className="assistant-landing-greeting">
        <HStack gap={2} vAlign="center">
          <Icon icon={Sparkles} size="md" color="accent" />
          <Text type="large" as="h2">
            Hi, {userName}
          </Text>
        </HStack>
        <Text type="display-2" as="h1">
          从哪里开始？
        </Text>
        <Text type="body" color="secondary">
          选择数据源、Skill 和审批权限后，输入你想分析的问题。
        </Text>
      </VStack>
    </div>
  );
}

function statusLabel(status: AssistantMessageStatus) {
  switch (status) {
    case "sending":
      return "发送中";
    case "sent":
      return "已发送";
    case "receiving":
      return "思考中";
    case "processing":
      return "思考中";
    case "awaiting_approval":
      return "等待审批";
    case "completed":
      return "已完成";
    case "stopped":
      return "已停止";
    case "error":
      return "Failed";
    default:
      return "草稿";
  }
}

function createOptimisticUserMessage(
  userId: string,
  conversationId: string,
  prompt: string,
  context?: AssistantMessage["context"],
): AssistantMessage {
  const createdAt = new Date().toISOString();
  return {
    id: createOptimisticMessageId(),
    conversationId,
    userId,
    role: "user",
    status: "sending",
    content: prompt,
    blocks: [{ id: createOptimisticMessageId(), type: "text", content: prompt }],
    createdAt,
    updatedAt: createdAt,
    integrityHash: "optimistic",
    context,
  };
}

function mergeConversation(conversations: AssistantConversation[], next: AssistantConversation) {
  const existingIndex = conversations.findIndex((conversation) => conversation.id === next.id);
  const merged =
    existingIndex >= 0
      ? conversations.map((conversation) => (conversation.id === next.id ? next : conversation))
      : [next, ...conversations];
  return [...merged].sort((left: AssistantConversation, right: AssistantConversation) => right.updatedAt.localeCompare(left.updatedAt));
}

function mergeMessage(messages: AssistantMessage[], next: AssistantMessage) {
  const existingIndex = messages.findIndex((message) => message.id === next.id);
  const merged =
    existingIndex >= 0
      ? messages.map((message) => (message.id === next.id ? next : message))
      : [...messages, next];
  return [...merged].sort((left: AssistantMessage, right: AssistantMessage) => left.createdAt.localeCompare(right.createdAt));
}

function renderJson(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function normalizeCodeLanguage(language?: string) {
  if (!language) {
    return "plaintext";
  }

  const normalized = language.toLowerCase();
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    mysql: "sql",
    postgres: "sql",
    postgresql: "sql",
    sh: "bash",
    shell: "bash",
    md: "markdown",
  };

  return aliases[normalized] ?? normalized;
}

function isRenderableCodeLanguage(language?: string) {
  const normalized = normalizeCodeLanguage(language);
  return normalized !== "plaintext" && normalized !== "markdown" && normalized !== "md";
}

function artifactTitle(message: AssistantMessage) {
  return extractMarkdownTitle(message.content, "数据助手生成文档");
}

function toolRecordsForMessage(message: AssistantMessage, toolState?: ConversationToolState | null) {
  return (toolState?.toolCalls ?? []).filter((record) => record.messageId === message.id);
}

function sortedToolRecords(records: ToolCallRecord[]) {
  return [...records].sort((a, b) => b.version - a.version || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function reportRecordsForMessage(message: AssistantMessage, toolState?: ConversationToolState | null) {
  return sortedToolRecords(toolRecordsForMessage(message, toolState).filter((record) => record.toolKind === "report_generation"));
}

function reportRecordForMessage(message: AssistantMessage, toolState?: ConversationToolState | null) {
  return reportRecordsForMessage(message, toolState)[0];
}

function completedReportRecordForMessage(message: AssistantMessage, toolState?: ConversationToolState | null) {
  return reportRecordsForMessage(message, toolState).find((record) => record.status === "completed");
}

function reportArtifactIdForMessage(message: AssistantMessage, toolState?: ConversationToolState | null) {
  const reportRecord = completedReportRecordForMessage(message, toolState) ?? reportRecordForMessage(message, toolState);
  return reportRecord?.result?.primaryArtifactId ?? reportRecord?.outputArtifactIds?.find((artifactId) => artifactId.includes("report"));
}

function reportSegmentIdForMessage(message: AssistantMessage, toolState?: ConversationToolState | null) {
  const reportRecord = completedReportRecordForMessage(message, toolState);
  if (!reportRecord) {
    return null;
  }
  return `report:${message.id}:${reportRecord.toolCallId}:v${reportRecord.version}`;
}

function reportRecordsForState(toolState?: ConversationToolState | null) {
  return (toolState?.toolCalls ?? [])
    .filter((record) => record.toolKind === "report_generation" && record.status === "completed")
    .sort((a, b) => b.version - a.version || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function addArtifactLikeIds(sources: Set<string>, values?: string[]) {
  values?.forEach((value) => {
    if (/^(workflow-dataset|dataset|assistant-sql-result)[:_-]/i.test(value)) {
      sources.add(value);
    }
  });
}

function artifactChartCount(message: AssistantMessage, toolState?: ConversationToolState | null) {
  const chartIds = new Set<string>();
  message.blocks.forEach((block) => {
    if (block.type === "visualization") {
      chartIds.add(block.visualizationSpec?.visualizationId ?? block.id);
    }
  });
  for (const record of toolRecordsForMessage(message, toolState)) {
    if (record.toolKind !== "chart_rendering") {
      continue;
    }
    const artifactIds = record.outputArtifactIds ?? record.result?.artifactIds ?? [];
    if (artifactIds.length === 0) {
      chartIds.add(record.toolCallId);
      continue;
    }
    artifactIds.forEach((artifactId) => chartIds.add(artifactId));
  }
  return chartIds.size;
}

function artifactDataSourceMeta(message: AssistantMessage, toolState?: ConversationToolState | null) {
  const sources = new Map<string, string>();
  const fallbackSources = new Set<string>();
  const addSource = (key?: string, label?: string) => {
    const normalizedKey = key?.trim() || label?.trim();
    if (!normalizedKey) {
      return;
    }
    sources.set(normalizedKey, label?.trim() || normalizedKey);
  };
  for (const block of message.blocks) {
    if (block.toolTarget) {
      addSource(block.toolTarget);
    }
    block.toolFiles?.forEach((file) => addSource(file));
    const artifactMatch = block.content.match(/\b(?:artifact|dataset|workflow-dataset)[:_-][\w-]+/gi);
    artifactMatch?.forEach((artifactId) => fallbackSources.add(artifactId));
  }
  for (const record of toolRecordsForMessage(message, toolState)) {
    if (record.toolKind === "sql_query") {
      const dataSourceId = typeof record.request.dataSourceId === "string" ? record.request.dataSourceId : undefined;
      const dataSourceLabel = typeof record.request.dataSourceLabel === "string" ? record.request.dataSourceLabel : undefined;
      addSource(dataSourceId ?? dataSourceLabel ?? record.toolCallId, dataSourceLabel ?? dataSourceId ?? record.toolCallId);
    }
    addArtifactLikeIds(fallbackSources, record.sourceArtifactIds);
    addArtifactLikeIds(fallbackSources, record.outputArtifactIds ?? record.result?.artifactIds);
  }
  if (sources.size === 0 && message.context?.dataSourceLabel) {
    addSource(message.context.dataSourceLabel);
  }
  if (sources.size === 0) {
    fallbackSources.forEach((source) => addSource(source));
  }
  const labels = Array.from(sources.values());
  return { count: labels.length, labels };
}

function assistantToolStatus(status?: AssistantBlock["toolStatus"]): ChatToolCallItem["status"] {
  switch (status) {
    case "completed":
      return "complete";
    case "running":
      return "running";
    case "pending_approval":
      return "pending";
    case "blocked":
    case "declined":
    case "error":
      return "error";
    default:
      return "pending";
  }
}

function orchestrationToolStatus(status: ToolCallRecord["status"]): ChatToolCallItem["status"] {
  switch (status) {
    case "completed":
      return "complete";
    case "executing":
      return "running";
    case "failed":
    case "rejected":
    case "cancelled":
    case "blocked":
      return "error";
    default:
      return "pending";
  }
}

function extractToolName(block: AssistantBlock) {
  if (block.toolName) {
    return block.toolName;
  }
  const raw = block.title?.split(/\s+/)[0] ?? "tool";
  return raw.replace(/工具调用.*$/, "").toLowerCase();
}

function extractToolTarget(block: AssistantBlock) {
  if (block.toolTarget) {
    return block.toolTarget;
  }
  if (block.toolFiles?.length) {
    return block.toolFiles.join(", ");
  }
  const file = block.content.match(/[\w./-]+\.(?:ts|tsx|js|jsx|sql|py|json|csv|md)\b/i)?.[0];
  if (file) {
    return file;
  }
  if (block.language) {
    return block.language;
  }
  return block.content.split(/\r?\n/).find(Boolean)?.slice(0, 72) ?? block.title ?? "tool";
}

function formatToolDuration(durationMs?: number) {
  if (durationMs == null || !Number.isFinite(durationMs)) {
    return undefined;
  }
  if (durationMs < 1000) {
    return `${Math.max(0, Math.round(durationMs))}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function toolFileStats(block: AssistantBlock) {
  if (!block.toolFiles?.length) {
    return undefined;
  }
  return (
    <HStack gap={1} vAlign="center" wrap="wrap">
      {block.toolFiles.map((file) => (
        <Token key={file} label={file} size="sm" />
      ))}
    </HStack>
  );
}

function toolResultPreview(record: ToolCallRecord) {
  const preview = record.result?.metadata?.resultPreview;
  return typeof preview === "string" && preview.trim() ? preview : null;
}

function toolResultPreviewLanguage(record: ToolCallRecord) {
  return record.result?.metadata?.resultPreviewFormat === "json" ? "json" : "text";
}

function toolCallsFromMessage(message: AssistantMessage): ChatToolCallItem[] {
  return message.blocks
    .filter((block) => block.toolCallId)
    .map((block) => ({
      key: block.toolCallId,
      name: extractToolName(block),
      target: extractToolTarget(block),
      status: assistantToolStatus(block.toolStatus),
      duration: formatToolDuration(block.toolDurationMs),
      node: "local-runtime",
      stats: toolFileStats(block),
      errorMessage: block.toolStatus === "error" || block.toolStatus === "blocked" || block.toolStatus === "declined" ? block.content : undefined,
      resultDetail:
        block.type === "json" ? (
          <CodeBlock
            code={renderJson(block.content)}
            language="json"
            hasCopyButton
            hasLanguageLabel
            isWrapped
            width="100%"
            size="sm"
            className="assistant-code-block"
          />
        ) : (
          <Text type="supporting" color="secondary">
            {block.content}
          </Text>
        ),
    }));
}

function toolCallsFromToolState(
  message: AssistantMessage,
  toolState: ConversationToolState | null | undefined,
  onApprove: (toolCallId: string, approved: boolean) => void,
): ChatToolCallItem[] {
  return (toolState?.toolCalls ?? [])
    .filter((record) => record.messageId === message.id)
    .map((record) => {
      const artifactIds = record.outputArtifactIds ?? record.result?.artifactIds ?? [];
      const requestPreview = JSON.stringify(record.request ?? {}, null, 2);
      const resultPreview = toolResultPreview(record);
      const errorMessage = record.error?.message;
      return {
        key: record.toolCallId,
        name: toolKindLabel(record.toolKind),
        target: typeof record.request.purpose === "string" ? record.request.purpose : record.toolName,
        status: orchestrationToolStatus(record.status),
        node: "agent-workflow",
        stats: record.status === "waiting_approval" ? (
          <HStack gap={1} vAlign="center" wrap="wrap" onClick={(event) => event.stopPropagation()}>
            <Button label="批准" variant="primary" size="sm" onClick={() => onApprove(record.toolCallId, true)} />
            <Button label="拒绝" variant="ghost" size="sm" onClick={() => onApprove(record.toolCallId, false)} />
          </HStack>
        ) : (
          toolStatusLabel(record.status)
        ),
        errorMessage,
        resultDetail: (
          <div className="assistant-tool-call-detail">
            <Text type="supporting" color="secondary">
              {record.result?.summary ?? errorMessage ?? toolStatusLabel(record.status)}
            </Text>
            {artifactIds.length > 0 && (
              <Text type="supporting" color="secondary">
                Artifact：{artifactIds.join(", ")}
              </Text>
            )}
            {resultPreview && (
              <CodeBlock
                code={toolResultPreviewLanguage(record) === "json" ? renderJson(resultPreview) : resultPreview}
                language={toolResultPreviewLanguage(record)}
                hasCopyButton
                hasLanguageLabel
                isWrapped
                width="100%"
                size="sm"
                className="assistant-code-block"
              />
            )}
            <CodeBlock
              code={requestPreview}
              language="json"
              hasCopyButton
              hasLanguageLabel
              isWrapped
              width="100%"
              size="sm"
              className="assistant-code-block"
            />
          </div>
        ),
      };
    });
}

function shouldHideInlineToolResult(block: AssistantBlock) {
  return block.toolName === "sql" && block.toolStatus === "completed";
}

export function DataAssistantWorkspace({
  user,
  modelName,
  isModelConfigured,
  canReadDataSources,
  requestWithRefresh,
  onRequireModelConfig,
}: DataAssistantWorkspaceProps) {
  const toast = useAppToast();
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, AssistantMessage[]>>({});
  const [workflowContextByConversation, setWorkflowContextByConversation] = useState<Record<string, WorkflowContextSummary | null>>({});
  const [toolStateByConversation, setToolStateByConversation] = useState<Record<string, ConversationToolState | null>>({});
  const [chatCsvAttachmentsByConversation, setChatCsvAttachmentsByConversation] = useState<Record<string, ChatCsvAttachment[]>>({});
  const [activeConversationId, setActiveConversationId] = useState("");
  const [composerValue, setComposerValue] = useState("");
  const [dataSources, setDataSources] = useState<DataSourceSummary[]>([]);
  const [selectedDataSourceId, setSelectedDataSourceId] = useState<string | null>(null);
  const [disabledTempDataSourceIds, setDisabledTempDataSourceIds] = useState<string[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<AssistantSkill | null>(null);
  const [approvalMode, setApprovalMode] = useState<AssistantApprovalMode>("request_approval");
  const [composerDraftsByConversation, setComposerDraftsByConversation] = useState<Record<string, AssistantComposerDraft>>({});
  const [toolSelectorOpen, setToolSelectorOpen] = useState(false);
  const [toolSelectorTrigger, setToolSelectorTrigger] = useState<ToolSelectorTrigger | null>(null);
  const [toolMention, setToolMention] = useState<ChatToolMention | null>(null);
  const [suppressedToolMentionKey, setSuppressedToolMentionKey] = useState<string | null>(null);
  const [suppressedToolMentionAnchor, setSuppressedToolMentionAnchor] = useState<number | null>(null);
  const [fieldSelectorOpen, setFieldSelectorOpen] = useState(false);
  const [fieldMention, setFieldMention] = useState<ChatFieldMention | null>(null);
  const [suppressedFieldMentionKey, setSuppressedFieldMentionKey] = useState<string | null>(null);
  const [selectedFieldRefs, setSelectedFieldRefs] = useState<ChatCsvSelectedFieldRef[]>([]);
  const [recentFieldIds, setRecentFieldIds] = useState<string[]>([]);
  const [isComposerComposing, setIsComposerComposing] = useState(false);
  const [isLoadingDataSources, setIsLoadingDataSources] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [metadataNow, setMetadataNow] = useState(() => Date.now());
  const [editingConversation, setEditingConversation] = useState<AssistantConversation | null>(null);
  const [editTitleDraft, setEditTitleDraft] = useState("");
  const [deletingConversation, setDeletingConversation] = useState<AssistantConversation | null>(null);
  const [fullFieldContextApprovalRequest, setFullFieldContextApprovalRequest] = useState<FullFieldContextApprovalRequest | null>(null);
  const [isImportingChatCsv, setIsImportingChatCsv] = useState(false);
  const [artifactWindow, setArtifactWindow] = useState<ArtifactWindowState>(() => readArtifactWindowState());
  const [artifactContentByMessage, setArtifactContentByMessage] = useState<Record<string, ArtifactContentState>>({});
  const [reportCardTransitions, setReportCardTransitions] = useState<Record<string, ReportCardTransitionState>>({});
  const [reportTransitionHeights, setReportTransitionHeights] = useState<Record<string, number>>({});
  const [streamContentRevision, setStreamContentRevision] = useState(0);
  const streamSegmentManagerRef = useRef(new StreamSegmentManager());
  const chatCsvInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<ChatComposerInputHandle | null>(null);
  const composerShellRef = useRef<HTMLDivElement | null>(null);
  const composerBlurTimerRef = useRef<number | null>(null);
  const fullFieldContextApprovalResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const latestComposerDraftRef = useRef<AssistantComposerDraftSnapshot | null>(null);
  const pendingMessageDeltasRef = useRef(new Map<string, MessageDeltaStreamEvent>());
  const messageDeltaFlushTimerRef = useRef<number | null>(null);
  const reportTransitionController = useMemo(
    () =>
      new ReportTransitionController(
        REPORT_TRANSITION_POLICY,
        (segmentId) => {
          streamSegmentManagerRef.current.markReportCardReady(segmentId);
          setStreamContentRevision((current) => current + 1);
          setReportCardTransitions((current) => ({
            ...current,
            [segmentId]: { segmentId, status: "card_ready" },
          }));
        },
        (segmentId) => {
          streamSegmentManagerRef.current.showReportCard(segmentId);
          setStreamContentRevision((current) => current + 1);
          setReportCardTransitions((current) => ({
            ...current,
            [segmentId]: { segmentId, status: "visible" },
          }));
        },
        (segmentId) => {
          streamSegmentManagerRef.current.startReportBuffer(segmentId);
          setStreamContentRevision((current) => current + 1);
          setReportCardTransitions((current) => {
            const existing = current[segmentId];
            if (existing?.status === "visible") {
              return current;
            }
            return {
              ...current,
              [segmentId]: { segmentId, status: "buffering" },
            };
          });
        },
      ),
    [],
  );
  const artifactResize = useResizable({
    defaultSize: 440,
    minSizePx: 320,
    maxSizePx: 860,
    autoSaveId: ARTIFACT_PANEL_WIDTH_KEY,
  });

  const flushPendingMessageDeltas = useCallback(() => {
    if (messageDeltaFlushTimerRef.current !== null) {
      window.clearTimeout(messageDeltaFlushTimerRef.current);
      messageDeltaFlushTimerRef.current = null;
    }
    const pending = Array.from(pendingMessageDeltasRef.current.values());
    pendingMessageDeltasRef.current.clear();
    if (pending.length === 0) {
      return;
    }
    setMessagesByConversation((current) => {
      const next = { ...current };
      for (const event of pending) {
        const messages = next[event.conversationId] ?? [];
        next[event.conversationId] = messages.map((message) =>
          message.id === event.messageId
            ? { ...message, content: event.content, blocks: event.blocks, status: event.status, updatedAt: new Date().toISOString() }
            : message,
        );
      }
      return next;
    });
  }, []);

  const queueMessageDelta = useCallback(
    (event: MessageDeltaStreamEvent) => {
      pendingMessageDeltasRef.current.set(event.messageId, event);
      if (messageDeltaFlushTimerRef.current !== null) {
        return;
      }
      messageDeltaFlushTimerRef.current = window.setTimeout(flushPendingMessageDeltas, 48);
    },
    [flushPendingMessageDeltas],
  );

  useEffect(() => () => {
    if (composerBlurTimerRef.current !== null) {
      window.clearTimeout(composerBlurTimerRef.current);
      composerBlurTimerRef.current = null;
    }
    fullFieldContextApprovalResolverRef.current?.(false);
    fullFieldContextApprovalResolverRef.current = null;
  }, []);

  const measureReportTransitionHeight = useCallback((segmentId: string, node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }
    const height = Math.ceil(node.getBoundingClientRect().height);
    if (height <= 0) {
      return;
    }
    setReportTransitionHeights((current) => current[segmentId] === height ? current : { ...current, [segmentId]: height });
  }, []);

  const releaseReportTransitionHeight = useCallback((segmentId: string) => {
    setReportTransitionHeights((current) => {
      if (!(segmentId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[segmentId];
      return next;
    });
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations],
  );
  const activeConversationDraftId = activeConversation?.id ?? "";
  const buildCurrentComposerDraft = useCallback(
    (updatedAt = new Date().toISOString()): AssistantComposerDraft => ({
      value: composerValue,
      selectedSkill,
      selectedDataSourceId,
      disabledTempDataSourceIds,
      selectedFieldRefs,
      updatedAt,
    }),
    [composerValue, disabledTempDataSourceIds, selectedDataSourceId, selectedFieldRefs, selectedSkill],
  );

  useEffect(() => {
    const previousSnapshot = latestComposerDraftRef.current;
    if (previousSnapshot?.conversationId && previousSnapshot.conversationId !== activeConversationDraftId) {
      setComposerDraftsByConversation((current) => ({
        ...current,
        [previousSnapshot.conversationId]: previousSnapshot.draft,
      }));
    }

    const nextDraft = activeConversationDraftId
      ? composerDraftsByConversation[activeConversationDraftId] ?? createEmptyChatComposerDraft<AssistantSkill, ChatCsvSelectedFieldRef>()
      : createEmptyChatComposerDraft<AssistantSkill, ChatCsvSelectedFieldRef>();
    setComposerValue(nextDraft.value);
    setSelectedSkill(nextDraft.selectedSkill);
    setSelectedDataSourceId(nextDraft.selectedDataSourceId);
    setDisabledTempDataSourceIds(nextDraft.disabledTempDataSourceIds);
    setSelectedFieldRefs(nextDraft.selectedFieldRefs);
    setToolSelectorOpen(false);
    setToolSelectorTrigger(null);
    setToolMention(null);
    setFieldSelectorOpen(false);
    setFieldMention(null);
    setSuppressedToolMentionKey(null);
    setSuppressedToolMentionAnchor(null);
    setSuppressedFieldMentionKey(null);
    latestComposerDraftRef.current = {
      conversationId: activeConversationDraftId,
      draft: nextDraft,
    };
    // Draft restoration intentionally runs only when the active conversation changes.
    // composerDraftsByConversation is read from the switching render and should not
    // retrigger restoration on every keystroke or token edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationDraftId]);

  useEffect(() => {
    if (!activeConversationDraftId) {
      latestComposerDraftRef.current = null;
      return;
    }
    latestComposerDraftRef.current = {
      conversationId: activeConversationDraftId,
      draft: buildCurrentComposerDraft(),
    };
  }, [activeConversationDraftId, buildCurrentComposerDraft]);

  const activeMessages = activeConversation ? messagesByConversation[activeConversation.id] ?? [] : [];
  const activeToolState = activeConversation ? toolStateByConversation[activeConversation.id] ?? null : null;
  const activePendingPythonToolCallId = useMemo(() => pendingPythonToolCallId(activeMessages), [activeMessages]);
  const landingUserName = user?.displayName?.trim() || user?.username || "Yuzili";
  const activeArtifactMessage = useMemo(
    () =>
      artifactWindow.isOpen && artifactWindow.messageId
        ? activeMessages.find((message) => message.id === artifactWindow.messageId && isAssistantArtifactMessage(message, activeToolState)) ?? null
        : null,
    [activeMessages, activeToolState, artifactWindow.isOpen, artifactWindow.messageId],
  );
  const activeArtifactContent = activeArtifactMessage ? artifactContentByMessage[activeArtifactMessage.id] : undefined;
  const activeReportRecords = useMemo(() => reportRecordsForState(activeToolState), [activeToolState]);
  const activeArtifactReportRecord = activeArtifactMessage ? reportRecordForMessage(activeArtifactMessage, activeToolState) : undefined;
  const isStreaming = activeMessages.some((message) => message.role === "assistant" && (message.status === "receiving" || message.status === "processing"));
  const activeStreamingMessageId = activeMessages.find((message) => message.role === "assistant" && (message.status === "receiving" || message.status === "processing"))?.id;
  const activeChatCsvAttachments = activeConversation ? chatCsvAttachmentsByConversation[activeConversation.id] ?? [] : [];
  const readyChatCsvAttachments = activeChatCsvAttachments.filter((attachment) => attachment.status === "ready" && attachment.tempDataSourceId);
  const activeTempDataSourceIds = readyChatCsvAttachments.map((attachment) => attachment.tempDataSourceId as string);
  const selectedTempDataSourceIds = activeTempDataSourceIds.filter((tempDataSourceId) => !disabledTempDataSourceIds.includes(tempDataSourceId));

  const connectedDataSources = useMemo(
    () => dataSources.filter((dataSource) => dataSource.status === "online"),
    [dataSources],
  );

  const selectedDataSource = useMemo(
    () => connectedDataSources.find((dataSource) => dataSource.id === selectedDataSourceId),
    [connectedDataSources, selectedDataSourceId],
  );
  const messageTempDataSourceIds = selectedDataSource ? [] : selectedTempDataSourceIds;
  const messageTempDataSourceLabels = selectedDataSource
    ? []
    : readyChatCsvAttachments
        .filter((attachment) => attachment.tempDataSourceId && selectedTempDataSourceIds.includes(attachment.tempDataSourceId))
        .map((attachment) => attachment.fileName);
  const activeFieldCsvAttachment = useMemo(
    () => readyChatCsvAttachments.find((attachment) => attachment.tempDataSourceId && selectedTempDataSourceIds.includes(attachment.tempDataSourceId)),
    [readyChatCsvAttachments, selectedTempDataSourceIds],
  );
  const activeCsvFields = useMemo(
    () => fieldsFromChatCsvAttachment(activeFieldCsvAttachment),
    [activeFieldCsvAttachment],
  );
  const fieldSelectorQuery = fieldMention?.query ?? "";
  const selectedFieldIds = useMemo(
    () => new Set(selectedFieldRefs.filter((field) => field.status === "valid").map((field) => field.fieldId)),
    [selectedFieldRefs],
  );
  const filteredCsvFields = useMemo(
    () =>
      selectConversationCsvFields({
        fields: activeCsvFields,
        query: fieldSelectorQuery,
        selectedFieldIds,
        recentFieldIds,
      }),
    [activeCsvFields, fieldSelectorQuery, recentFieldIds, selectedFieldIds],
  );
  const csvFieldSearchSource = useMemo<SearchSource<CsvFieldSearchItem>>(() => {
    const fieldItems = (query: string) =>
      selectConversationCsvFields({
        fields: activeCsvFields,
        query,
        selectedFieldIds,
        recentFieldIds,
      })
        .map((field) => ({
          id: field.fieldId,
          label: field.displayName,
          auxiliaryData: field,
        }));
    return {
      bootstrap: () => fieldItems(""),
      search: (query: string) => fieldItems(query),
    };
  }, [activeCsvFields, recentFieldIds, selectedFieldIds]);
  const fieldComposerTriggers = useMemo<ChatComposerTrigger[]>(
    () =>
      activeCsvFields.length > 0 && !isComposerComposing
        ? [
            {
              character: "#",
              searchSource: csvFieldSearchSource,
              menuLabel: "选择 CSV 字段",
              emptySearchResultsText: "未找到匹配字段",
              loadingText: "正在查找字段...",
              renderItem: (item) => {
                const field = item.auxiliaryData as ConversationCsvField | undefined;
                return (
                  <span className="assistant-tool-selector-item-label">
                    <span className="assistant-tool-selector-item-title">
                      {field && selectedFieldIds.has(field.fieldId) ? "✓ " : ""}
                      {item.label}
                    </span>
                    {field && <Badge label={field.sqliteType} variant="neutral" />}
                  </span>
                );
              },
              onSelect: (item) => {
                const field = item.auxiliaryData as ConversationCsvField | undefined;
                if (!field) {
                  return item.label;
                }
                const valueBeforeInsert = composerInputRef.current?.getValue() ?? composerValue;
                const mention = findChatFieldMention(valueBeforeInsert) ?? {
                  start: valueBeforeInsert.length,
                  end: valueBeforeInsert.length,
                  query: "",
                };
                const fieldToken = createChatFieldToken(field, mention);
                setSelectedFieldRefs((current) => upsertFieldToken(current, fieldToken));
                setRecentFieldIds((current) => [field.fieldId, ...current.filter((fieldId) => fieldId !== field.fieldId)].slice(0, 20));
                setSuppressedFieldMentionKey(null);
                setFieldSelectorOpen(false);
                setFieldMention(null);
                return {
                  value: fieldToken.rawText,
                  label: fieldToken.rawText,
                  variant: "teal",
                };
              },
            },
          ]
        : [],
    [activeCsvFields.length, composerValue, csvFieldSearchSource, isComposerComposing, selectedFieldIds],
  );
  const composerContextTokenDisplay = useMemo(
    () =>
      buildContextTokenDisplay({
        files: messageTempDataSourceLabels,
        skill: selectedSkill,
        dataSourceLabel: selectedDataSource ? dataSourceLabel(selectedDataSource) : null,
      }),
    [messageTempDataSourceLabels, selectedDataSource, selectedSkill],
  );
  const toolSelectorQuery = toolSelectorTrigger === "at_symbol" && toolMention ? toolMention.query : "";
  const toolDataSources = useMemo<ChatToolDataSourceOption[]>(
    () => [
      ...connectedDataSources.map((dataSource) => ({
        id: dataSource.id,
        label: dataSource.type === "csv" ? dataSource.name : dataSourceLabel(dataSource),
        description: dataSource.type === "csv" ? dataSource.database : `${dataSource.host}:${dataSource.port}`,
        kind: toolDataSourceKind(dataSource),
        isSelected: selectedDataSourceId === dataSource.id,
      })),
      ...readyChatCsvAttachments.map((attachment) => ({
        id: `temp:${attachment.tempDataSourceId}`,
        label: attachment.fileName,
        description: `${attachment.rowCount ?? 0} 行 · ${attachment.columnCount ?? 0} 列`,
        kind: "temporary_csv" as const,
        isSelected: Boolean(attachment.tempDataSourceId && selectedTempDataSourceIds.includes(attachment.tempDataSourceId)),
      })),
    ],
    [connectedDataSources, readyChatCsvAttachments, selectedDataSourceId, selectedTempDataSourceIds],
  );
  const toolSelectorSections = useMemo(
    () =>
      buildChatToolSelectorSections<AssistantSkill>({
        query: toolSelectorQuery,
        skills: skillOptions,
        dataSources: toolDataSources,
        selectedSkill,
      }),
    [selectedSkill, toolDataSources, toolSelectorQuery],
  );

  const upsertMessage = useCallback((conversationId: string, message: AssistantMessage) => {
    setMessagesByConversation((current) => ({
      ...current,
      [conversationId]: mergeMessage(current[conversationId] ?? [], message),
    }));
  }, []);

  const patchMessage = useCallback(
    (conversationId: string, messageId: string, patch: Partial<AssistantMessage>) => {
      setMessagesByConversation((current) => ({
        ...current,
        [conversationId]: (current[conversationId] ?? []).map((message) =>
          message.id === messageId
            ? {
              ...message,
              ...patch,
              blocks: patch.blocks ?? message.blocks,
              updatedAt: new Date().toISOString(),
            }
            : message,
        ),
      }));
    },
    [],
  );

  const removeMessage = useCallback((conversationId: string, messageId: string) => {
    setMessagesByConversation((current) => ({
      ...current,
      [conversationId]: (current[conversationId] ?? []).filter((message) => message.id !== messageId),
    }));
  }, []);

  const loadConversationMessages = useCallback(
    async (conversationId: string) => {
      if (!user?.id || !window.lifecycleX?.assistant) {
        return;
      }
      const messages = await window.lifecycleX.assistant.listMessages(user.id, conversationId);
      setMessagesByConversation((current) => ({ ...current, [conversationId]: messages }));
      const context = await window.lifecycleX.assistant.getWorkflowContext(user.id, conversationId);
      setWorkflowContextByConversation((current) => ({ ...current, [conversationId]: context }));
      const toolState = await window.lifecycleX.assistant.getToolState(user.id, conversationId);
      setToolStateByConversation((current) => ({ ...current, [conversationId]: toolState }));
    },
    [user?.id],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadConversations() {
      if (!user?.id || !window.lifecycleX?.assistant) {
        return;
      }

      setIsLoadingConversations(true);
      try {
        const nextConversations = await window.lifecycleX.assistant.listConversations(user.id);
        if (!isMounted) {
          return;
        }
        setConversations(nextConversations);
        const nextActiveId = nextConversations[0]?.id ?? "";
        setActiveConversationId(nextActiveId);
        if (nextActiveId) {
          await loadConversationMessages(nextActiveId);
        }
      } catch (error) {
        toast({
          type: "error",
          body: error instanceof Error ? error.message : "对话记录加载失败。",
          uniqueID: "assistant-conversations-error",
          collisionBehavior: "overwrite",
        });
      } finally {
        if (isMounted) {
          setIsLoadingConversations(false);
        }
      }
    }

    void loadConversations();
    return () => {
      isMounted = false;
    };
  }, [loadConversationMessages, toast, user?.id]);

  useEffect(() => {
    const dispose = window.lifecycleX?.assistant?.onStreamEvent((event: AssistantStreamEvent) => {
      if (event.type === "conversation") {
        setConversations((current) => mergeConversation(current, event.conversation));
        return;
      }
      if (event.type === "message") {
        flushPendingMessageDeltas();
        upsertMessage(event.conversationId, event.message);
        return;
      }
      if (event.type === "message-delta") {
        queueMessageDelta(event);
        return;
      }
      if (event.type === "stream-content") {
        applyChatStreamEvent(streamSegmentManagerRef.current, event.event as ChatStreamEvent);
        setStreamContentRevision((current) => current + 1);
        return;
      }
      if (event.type === "tool") {
        flushPendingMessageDeltas();
        upsertMessage(event.conversationId, event.message);
        return;
      }
      if (event.type === "tool-state") {
        setToolStateByConversation((current) => ({ ...current, [event.conversationId]: event.state }));
        return;
      }
      if (event.type === "workflow") {
        setWorkflowContextByConversation((current) => ({ ...current, [event.conversationId]: event.context }));
        return;
      }
      if (event.type === "error") {
        toast({
          type: "error",
          body: `${event.message} Trace: ${event.traceId}`,
          uniqueID: "assistant-stream-error",
          collisionBehavior: "overwrite",
        });
      }
    });

    return () => {
      if (messageDeltaFlushTimerRef.current !== null) {
        window.clearTimeout(messageDeltaFlushTimerRef.current);
        messageDeltaFlushTimerRef.current = null;
      }
      pendingMessageDeltasRef.current.clear();
      dispose?.();
    };
  }, [flushPendingMessageDeltas, queueMessageDelta, toast, upsertMessage]);

  useEffect(() => {
    let isMounted = true;

    async function loadDataSources() {
      if (!canReadDataSources) {
        return;
      }

      setIsLoadingDataSources(true);
      const result = await requestWithRefresh(workbenchApi.dataSources);
      if (!isMounted) {
        return;
      }

      setIsLoadingDataSources(false);
      if (isFailure(result)) {
        toast({
          type: "error",
          body: `${result.error.message} Trace: ${result.error.traceId}`,
          uniqueID: "assistant-data-sources-error",
          collisionBehavior: "overwrite",
        });
        return;
      }

      setDataSources(result.dataSources);
      setSelectedDataSourceId((current) => {
        const currentConnected = result.dataSources.some(
          (dataSource) => dataSource.id === current && dataSource.status === "online",
        );
        return currentConnected ? current : null;
      });
    }

    void loadDataSources();
    return () => {
      isMounted = false;
    };
  }, [canReadDataSources, requestWithRefresh, toast]);

  useEffect(() => {
    writeArtifactWindowState(artifactWindow);
  }, [artifactWindow]);

  useEffect(() => {
    if (!user?.id || !activeConversation?.id || !window.lifecycleX?.assistant) {
      return;
    }
    let cancelled = false;
    void window.lifecycleX.assistant
      .listConversationCsvAttachments(user.id, activeConversation.id)
      .then((attachments) => {
        if (cancelled) {
          return;
        }
        setChatCsvAttachmentsByConversation((current) => ({ ...current, [activeConversation.id]: attachments }));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        toast({
          type: "error",
          body: error instanceof Error ? error.message : "会话临时 CSV 恢复失败。",
          uniqueID: "assistant-chat-csv-list-error",
          collisionBehavior: "overwrite",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeConversation?.id, toast, user?.id]);

  useEffect(() => () => reportTransitionController.dispose(), [reportTransitionController]);

  useEffect(() => {
    const activeSegmentIds = new Set<string>();
    const inactiveSegmentIds = new Set<string>();
    const immediatelyVisibleSegments = new Map<string, ReportCardTransitionState>();
    for (const message of activeMessages) {
      if (message.role !== "assistant" || message.status !== "completed") {
        continue;
      }
      const reportRecord = completedReportRecordForMessage(message, activeToolState);
      const toolSegmentId = reportSegmentIdForMessage(message, activeToolState);
      const streamSegments = streamSegmentManagerRef.current.getMessageSegments(message.id);
      const streamReportSegment = streamSegments.find((segment) => segment.type === "report" && segment.reportArtifactId);
      const segmentId = toolSegmentId ?? streamReportSegment?.segmentId;
      const reportSegment = segmentId ? streamSegmentManagerRef.current.getSegment(segmentId) : undefined;
      const artifactId = reportArtifactIdForMessage(message, activeToolState) ?? (streamReportSegment?.type === "report" ? streamReportSegment.reportArtifactId : undefined);
      const title = typeof reportRecord?.request.title === "string"
        ? reportRecord.request.title
        : streamReportSegment?.type === "report" && streamReportSegment.reportTitle
          ? streamReportSegment.reportTitle
          : artifactTitle(message);
      const isPersistedReportCard = Boolean(reportRecord && segmentId && artifactId && !streamReportSegment);
      if (isPersistedReportCard && segmentId) {
        activeSegmentIds.add(segmentId);
        if (reportCardTransitions[segmentId]?.status !== "visible") {
          immediatelyVisibleSegments.set(segmentId, { segmentId, status: "visible" });
        }
        continue;
      }
      const markdownStreamCompleted =
        !reportSegment ||
        reportSegment.type !== "report" ||
        reportSegment.status === "completed" ||
        reportSegment.status === "buffering" ||
        reportSegment.status === "card_ready" ||
        reportSegment.status === "card_visible";
      if (!segmentId || !artifactId || !markdownStreamCompleted) {
        if (segmentId && reportCardTransitions[segmentId]?.status !== "visible") {
          reportTransitionController.cancel(segmentId);
          inactiveSegmentIds.add(segmentId);
        }
        continue;
      }
      activeSegmentIds.add(segmentId);
      reportTransitionController.schedule({
        segmentId,
        markdownStreamCompleted,
        reportArtifactId: artifactId,
        reportTitle: title,
        isCardVisible: reportCardTransitions[segmentId]?.status === "visible",
      });
    }
    for (const segmentId of Object.keys(reportCardTransitions)) {
      if (!activeSegmentIds.has(segmentId) && reportCardTransitions[segmentId]?.status !== "visible") {
        reportTransitionController.cancel(segmentId);
        inactiveSegmentIds.add(segmentId);
      }
    }
    if (inactiveSegmentIds.size > 0 || immediatelyVisibleSegments.size > 0) {
      setReportCardTransitions((current) => {
        let changed = false;
        const next = { ...current };
        for (const segmentId of inactiveSegmentIds) {
          if (next[segmentId]?.status === "visible") {
            continue;
          }
          if (segmentId in next) {
            delete next[segmentId];
            changed = true;
          }
        }
        for (const [segmentId, transition] of immediatelyVisibleSegments) {
          if (next[segmentId]?.status !== "visible") {
            next[segmentId] = transition;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }
  }, [activeMessages, activeToolState, reportCardTransitions, reportTransitionController, streamContentRevision]);

  useEffect(() => {
    if (!isStreaming) {
      return undefined;
    }
    const timer = window.setInterval(() => setMetadataNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  useEffect(() => {
    const mention = findChatToolMention(composerValue);
    if (mention) {
      if (suppressedToolMentionAnchor !== null) {
        if (
          isSuppressedChatToolMention({
            value: composerValue,
            mention,
            suppressedKey: suppressedToolMentionKey,
            suppressedAnchor: suppressedToolMentionAnchor,
          })
        ) {
          return;
        }
        setSuppressedToolMentionAnchor(null);
      } else if (
        isSuppressedChatToolMention({
          value: composerValue,
          mention,
          suppressedKey: suppressedToolMentionKey,
          suppressedAnchor: suppressedToolMentionAnchor,
        })
      ) {
        return;
      }
      setToolMention(mention);
      setToolSelectorTrigger("at_symbol");
      setToolSelectorOpen(true);
      setFieldSelectorOpen(false);
      setFieldMention(null);
      return;
    }
    if (suppressedToolMentionKey) {
      setSuppressedToolMentionKey(null);
    }
    if (suppressedToolMentionAnchor !== null) {
      setSuppressedToolMentionAnchor(null);
    }
    if (toolSelectorTrigger === "at_symbol") {
      setToolMention(null);
      setToolSelectorTrigger(null);
      setToolSelectorOpen(false);
    }
  }, [composerValue, suppressedToolMentionAnchor, suppressedToolMentionKey, toolSelectorTrigger]);

  useEffect(() => {
    if (isComposerComposing) {
      if (fieldSelectorOpen) {
        setFieldSelectorOpen(false);
        setFieldMention(null);
      }
      return;
    }
    const mention = findChatFieldMention(composerValue);
    if (mention && activeCsvFields.length > 0) {
      if (isNativeChatComposerFieldMention(composerValue, mention)) {
        if (fieldSelectorOpen) {
          setFieldSelectorOpen(false);
          setFieldMention(null);
        }
        return;
      }
      if (chatFieldMentionKey(composerValue, mention) === suppressedFieldMentionKey) {
        return;
      }
      setFieldMention(mention);
      setFieldSelectorOpen(true);
      setToolSelectorOpen(false);
      setToolSelectorTrigger(null);
      setToolMention(null);
      return;
    }
    if (suppressedFieldMentionKey) {
      setSuppressedFieldMentionKey(null);
    }
    if (fieldSelectorOpen) {
      setFieldMention(null);
      setFieldSelectorOpen(false);
    }
  }, [activeCsvFields.length, composerValue, fieldSelectorOpen, isComposerComposing, suppressedFieldMentionKey]);

  useEffect(() => {
    if (selectedFieldRefs.length === 0) {
      return;
    }
    const activeFieldsById = new Map(activeCsvFields.map((field) => [field.fieldId, field]));
    setSelectedFieldRefs((current) => {
      let changed = false;
      const next = current.map((field) => {
        const status: ChatCsvSelectedFieldRef["status"] = activeFieldsById.has(field.fieldId) ? "valid" : "missing";
        if (field.status === status) {
          return field;
        }
        changed = true;
        return { ...field, status };
      });
      return changed ? next : current;
    });
  }, [activeCsvFields, selectedFieldRefs.length]);

  useEffect(() => {
    if (selectedFieldRefs.length === 0) {
      return;
    }
    setSelectedFieldRefs((current) => current.filter((field) => composerValue.includes(field.rawText)));
  }, [composerValue, selectedFieldRefs.length]);

  const startConversation = async () => {
    if (!user?.id || !window.lifecycleX?.assistant) {
      return;
    }
    if (activeStreamingMessageId) {
      await window.lifecycleX.assistant.cancelMessage(activeStreamingMessageId);
    }
    const conversation = await window.lifecycleX.assistant.createConversation(user.id);
    setConversations((current) => mergeConversation(current, conversation));
    setMessagesByConversation((current) => ({ ...current, [conversation.id]: [] }));
    setWorkflowContextByConversation((current) => ({ ...current, [conversation.id]: null }));
    setActiveConversationId(conversation.id);
    setComposerValue("");
  };

  const importChatCsvFile = useCallback(
    async (file: File) => {
      if (!user?.id || !window.lifecycleX?.assistant) {
        toast({
          type: "error",
          body: "本地对话服务不可用。",
          uniqueID: "assistant-chat-csv-ipc-unavailable",
          collisionBehavior: "overwrite",
        });
        return;
      }
      const hasCsvExtension = /\.csv$/i.test(file.name);
      const hasCsvMime = Boolean(file.type && /^(text\/csv|application\/vnd\.ms-excel)$/i.test(file.type));
      if (!hasCsvExtension && !hasCsvMime) {
        toast({
          type: "error",
          body: "仅支持上传 CSV 文件。",
          uniqueID: "assistant-chat-csv-type-error",
          collisionBehavior: "overwrite",
        });
        return;
      }
      if (file.size > CHAT_CSV_MAX_FILE_SIZE_BYTES) {
        toast({
          type: "error",
          body: "CSV 文件不能超过 10 MB。",
          uniqueID: "assistant-chat-csv-size-error",
          collisionBehavior: "overwrite",
        });
        return;
      }
      if (file.size <= 0) {
        toast({
          type: "error",
          body: "CSV 文件不能为空。",
          uniqueID: "assistant-chat-csv-empty-error",
          collisionBehavior: "overwrite",
        });
        return;
      }

      setIsImportingChatCsv(true);
      try {
        const conversation = activeConversation ?? await window.lifecycleX.assistant.createConversation(user.id, file.name.replace(/\.csv$/i, "").slice(0, 18) || "CSV 数据分析");
        setConversations((current) => mergeConversation(current, conversation));
        setMessagesByConversation((current) => ({ ...current, [conversation.id]: current[conversation.id] ?? [] }));
        setActiveConversationId(conversation.id);

        const localAttachment: ChatCsvAttachment = {
          attachmentId: `local-${Date.now()}`,
          conversationId: conversation.id,
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: "text/csv",
          status: "importing",
          createdAt: new Date().toISOString(),
        };
        setChatCsvAttachmentsByConversation((current) => ({
          ...current,
          [conversation.id]: [localAttachment, ...(current[conversation.id] ?? [])],
        }));

        const buffer = await file.arrayBuffer();
        const imported = await window.lifecycleX.assistant.importConversationCsv({
          conversationId: conversation.id,
          userId: user.id,
          fileName: file.name,
          fileSizeBytes: file.size,
          fileBuffer: new Uint8Array(buffer),
          mimeType: file.type || "text/csv",
        });
        setChatCsvAttachmentsByConversation((current) => ({
          ...current,
          [conversation.id]: [imported, ...(current[conversation.id] ?? []).filter((item) => item.attachmentId !== localAttachment.attachmentId && item.tempDataSourceId !== imported.tempDataSourceId)],
        }));
        if (imported.status === "failed") {
          toast({
            type: "error",
            body: imported.error?.message ?? "CSV 导入失败。",
            uniqueID: "assistant-chat-csv-import-error",
            collisionBehavior: "overwrite",
          });
        } else {
          setSelectedDataSourceId(null);
          if (imported.tempDataSourceId) {
            setDisabledTempDataSourceIds((current) => current.filter((id) => id !== imported.tempDataSourceId));
          }
          toast({
            type: "info",
            body: imported.warnings?.length
              ? `CSV 已导入临时表：${imported.warnings[0]}`
              : `CSV 已导入临时表：${imported.rowCount ?? 0} 行，${imported.columnCount ?? 0} 列。`,
            uniqueID: "assistant-chat-csv-import-success",
            collisionBehavior: "overwrite",
          });
        }
      } catch (error) {
        toast({
          type: "error",
          body: error instanceof Error ? error.message : "CSV 导入失败。",
          uniqueID: "assistant-chat-csv-import-exception",
          collisionBehavior: "overwrite",
        });
      } finally {
        setIsImportingChatCsv(false);
      }
    },
    [activeConversation, toast, user?.id],
  );

  const handleChatCsvFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }
      void importChatCsvFile(file);
    },
    [importChatCsvFile],
  );

  const closeToolSelector = useCallback(() => {
    setToolSelectorOpen(false);
    setToolSelectorTrigger(null);
    setToolMention(null);
  }, []);

  const closeFieldSelector = useCallback(() => {
    setFieldSelectorOpen(false);
    setFieldMention(null);
  }, []);

  const clearActiveToolMention = useCallback(() => {
    setComposerValue((current) => removeChatToolMention(current, toolMention));
  }, [toolMention]);

  const openToolSelectorByButton = useCallback(() => {
    setToolSelectorTrigger("button");
    setToolMention(null);
    setToolSelectorOpen(true);
    closeFieldSelector();
  }, [closeFieldSelector]);

  const handleToolSelectorOpenChange = useCallback((isOpen: boolean) => {
    setToolSelectorOpen(isOpen);
    if (!isOpen) {
      if (toolSelectorTrigger === "at_symbol" && toolMention) {
        setSuppressedToolMentionKey(chatToolMentionKey(composerValue, toolMention));
        setSuppressedToolMentionAnchor(toolMention.start);
      }
      setToolSelectorTrigger(null);
      setToolMention(null);
    } else if (!toolSelectorTrigger) {
      setToolSelectorTrigger("button");
    }
  }, [composerValue, toolMention, toolSelectorTrigger]);

  const handleComposerFocusCapture = useCallback(() => {
    if (composerBlurTimerRef.current !== null) {
      window.clearTimeout(composerBlurTimerRef.current);
      composerBlurTimerRef.current = null;
    }
  }, []);

  const handleComposerBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    if (composerBlurTimerRef.current !== null) {
      window.clearTimeout(composerBlurTimerRef.current);
    }
    composerBlurTimerRef.current = window.setTimeout(() => {
      composerBlurTimerRef.current = null;
      const activeElement = document.activeElement;
      if (activeElement && composerShellRef.current?.contains(activeElement)) {
        return;
      }
      if (toolSelectorTrigger !== "at_symbol") {
        return;
      }
      const activeMention = toolMention ?? findChatToolMention(composerValue);
      if (activeMention) {
        setSuppressedToolMentionKey(chatToolMentionKey(composerValue, activeMention));
        setSuppressedToolMentionAnchor(activeMention.start);
      }
      setToolSelectorOpen(false);
      setToolSelectorTrigger(null);
      setToolMention(null);
    }, 0);
  }, [composerValue, toolMention, toolSelectorTrigger]);

  const selectSkillFromToolSelector = useCallback(
    (skill: AssistantSkill) => {
      setSelectedSkill((current) => (current === skill ? null : skill));
      clearActiveToolMention();
      closeToolSelector();
    },
    [clearActiveToolMention, closeToolSelector],
  );

  const selectDataSourceFromToolSelector = useCallback(
    (item: ChatToolSelectorItem<AssistantSkill>) => {
      if (item.type !== "data_source") {
        return;
      }
      if (item.kind === "temporary_csv") {
        const tempDataSourceId = item.id.replace(/^temp:/u, "");
        setSelectedDataSourceId(null);
        setDisabledTempDataSourceIds((current) =>
          current.includes(tempDataSourceId)
            ? current.filter((id) => id !== tempDataSourceId)
            : [...current, tempDataSourceId],
        );
      } else {
        setDisabledTempDataSourceIds([]);
        setSelectedDataSourceId((current) => (current === item.id ? null : item.id));
      }
      clearActiveToolMention();
      closeToolSelector();
    },
    [clearActiveToolMention, closeToolSelector],
  );

  const selectAddCsvFromToolSelector = useCallback(() => {
    clearActiveToolMention();
    closeToolSelector();
    chatCsvInputRef.current?.click();
  }, [clearActiveToolMention, closeToolSelector]);

  const handleFieldSelectorOpenChange = useCallback((isOpen: boolean) => {
    setFieldSelectorOpen(isOpen);
    if (!isOpen) {
      if (fieldMention) {
        setSuppressedFieldMentionKey(chatFieldMentionKey(composerValue, fieldMention));
      }
      setFieldMention(null);
    }
  }, [composerValue, fieldMention]);

  const selectCsvField = useCallback(
    (field: ConversationCsvField) => {
      if (!fieldMention) {
        return;
      }
      const token = createChatFieldToken(field, fieldMention);
      const editable = composerShellRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
      const insertedInlineToken =
        Boolean(editable && selectSerializedComposerRange(editable, fieldMention.start, fieldMention.end)) &&
        Boolean(composerInputRef.current?.insertToken({
          value: token.rawText,
          label: token.rawText,
          variant: "teal",
        }));
      if (insertedInlineToken) {
        setComposerValue(composerInputRef.current?.getValue() ?? insertFieldTokenText(composerValue, fieldMention, token));
      } else {
        setComposerValue((current) => insertFieldTokenText(current, fieldMention, token));
      }
      setSelectedFieldRefs((current) => upsertFieldToken(current, token));
      setRecentFieldIds((current) => [field.fieldId, ...current.filter((fieldId) => fieldId !== field.fieldId)].slice(0, 20));
      setSuppressedFieldMentionKey(null);
      closeFieldSelector();
    },
    [closeFieldSelector, composerValue, fieldMention],
  );

  const clearComposerContextSelection = useCallback(
    (tempDataSourceIds: string[] = [], conversationId = activeConversationDraftId) => {
      setSelectedSkill(null);
      setSelectedDataSourceId(null);
      setDisabledTempDataSourceIds(tempDataSourceIds);
      setSelectedFieldRefs([]);
      if (conversationId) {
        const draft: AssistantComposerDraft = {
          ...createEmptyChatComposerDraft<AssistantSkill, ChatCsvSelectedFieldRef>(),
          disabledTempDataSourceIds: tempDataSourceIds,
        };
        latestComposerDraftRef.current = { conversationId, draft };
        setComposerDraftsByConversation((current) => ({
          ...current,
          [conversationId]: draft,
        }));
      }
    },
    [activeConversationDraftId],
  );

  const removeChatCsvAttachment = useCallback(
    async (attachment: ChatCsvAttachment) => {
      if (!user?.id || !activeConversation?.id || !window.lifecycleX?.assistant || !attachment.tempDataSourceId) {
        return;
      }
      try {
        await window.lifecycleX.assistant.removeConversationCsvAttachment(user.id, activeConversation.id, attachment.tempDataSourceId);
        setChatCsvAttachmentsByConversation((current) => ({
          ...current,
          [activeConversation.id]: (current[activeConversation.id] ?? []).filter((item) => item.attachmentId !== attachment.attachmentId),
        }));
      } catch (error) {
        toast({
          type: "error",
          body: error instanceof Error ? error.message : "临时 CSV 移除失败。",
          uniqueID: "assistant-chat-csv-remove-error",
          collisionBehavior: "overwrite",
        });
      }
    },
    [activeConversation?.id, toast, user?.id],
  );

  const openEditConversation = (conversation: AssistantConversation) => {
    setEditingConversation(conversation);
    setEditTitleDraft(conversation.title.slice(0, MAX_CONVERSATION_TITLE_LENGTH));
  };

  const closeEditConversation = () => {
    setEditingConversation(null);
    setEditTitleDraft("");
  };

  const saveConversationTitle = async () => {
    if (!user?.id || !window.lifecycleX?.assistant || !editingConversation) {
      return;
    }
    const nextTitle = editTitleDraft.trim().slice(0, MAX_CONVERSATION_TITLE_LENGTH);
    if (!nextTitle) {
      toast({
        type: "error",
        body: "记录名称不能为空。",
        uniqueID: "assistant-conversation-title-empty",
        collisionBehavior: "overwrite",
      });
      return;
    }

    try {
      const updated = await window.lifecycleX.assistant.renameConversation(user.id, editingConversation.id, nextTitle);
      setConversations((current) => mergeConversation(current, updated));
      closeEditConversation();
    } catch (error) {
      toast({
        type: "error",
        body: error instanceof Error ? error.message : "记录名称保存失败。",
        uniqueID: "assistant-conversation-rename-error",
        collisionBehavior: "overwrite",
      });
    }
  };

  const closeDeleteConversation = () => {
    setDeletingConversation(null);
  };

  const confirmDeleteConversation = async () => {
    if (!user?.id || !window.lifecycleX?.assistant || !deletingConversation) {
      return;
    }

    try {
      if (deletingConversation.id === activeConversation?.id && activeStreamingMessageId) {
        await window.lifecycleX.assistant.cancelMessage(activeStreamingMessageId);
      }
      await window.lifecycleX.assistant.deleteConversation(user.id, deletingConversation.id);
      setConversations((current) => {
        const remaining = current.filter((conversation) => conversation.id !== deletingConversation.id);
        if (activeConversation?.id === deletingConversation.id) {
          const nextActiveId = remaining[0]?.id ?? "";
          setActiveConversationId(nextActiveId);
          if (nextActiveId && !messagesByConversation[nextActiveId]) {
            void loadConversationMessages(nextActiveId);
          }
        }
        return remaining;
      });
      setMessagesByConversation((current) => {
        const next = { ...current };
        delete next[deletingConversation.id];
        return next;
      });
      setWorkflowContextByConversation((current) => {
        const next = { ...current };
        delete next[deletingConversation.id];
        return next;
      });
      setComposerDraftsByConversation((current) => removeChatComposerDraft(current, deletingConversation.id));
      if (artifactWindow.messageId && deletingConversation.id === activeConversation?.id) {
        closeArtifact();
      }
      closeDeleteConversation();
    } catch (error) {
      toast({
        type: "error",
        body: error instanceof Error ? error.message : "对话记录删除失败。",
        uniqueID: "assistant-conversation-delete-error",
        collisionBehavior: "overwrite",
      });
    }
  };

  const stopStreaming = useCallback(() => {
    if (activeStreamingMessageId) {
      void window.lifecycleX?.assistant?.cancelMessage(activeStreamingMessageId);
    }
  }, [activeStreamingMessageId]);

  const copyMessage = useCallback(
    async (message: AssistantMessage) => {
      const copyText = message.content.trim() || message.errorMessage || "";
      if (!copyText) {
        return;
      }

      try {
        await navigator.clipboard.writeText(copyText);
        toast({
          type: "info",
          body: "消息内容已复制。",
          uniqueID: `assistant-copy-${message.id}`,
          collisionBehavior: "overwrite",
        });
      } catch (error) {
        toast({
          type: "error",
          body: error instanceof Error ? error.message : "复制失败。",
          uniqueID: `assistant-copy-error-${message.id}`,
          collisionBehavior: "overwrite",
        });
      }
    },
    [toast],
  );

  const editUserMessage = useCallback((message: AssistantMessage) => {
    setComposerValue(message.content);
  }, []);

  const openArtifact = useCallback((message: AssistantMessage) => {
    setArtifactWindow({
      messageId: message.id,
      isOpen: true,
      isMinimized: false,
      isMaximized: false,
    });
    const artifactId = reportArtifactIdForMessage(message, activeToolState);
    if (!artifactId || !user?.id || !window.lifecycleX?.assistant) {
      setArtifactContentByMessage((current) => ({
        ...current,
        [message.id]: {
          messageId: message.id,
          artifactId,
          status: "ready",
          markdown: message.content,
        },
      }));
      return;
    }
    const existing = artifactContentByMessage[message.id];
    if (existing?.artifactId === artifactId && existing.status === "ready") {
      return;
    }
    setArtifactContentByMessage((current) => ({
      ...current,
      [message.id]: {
        messageId: message.id,
        artifactId,
        status: "loading",
        markdown: message.content,
      },
    }));
    void window.lifecycleX.assistant
      .getToolArtifact(user.id, message.conversationId, artifactId)
      .then((artifact: ArtifactRecord | null) => {
        if (!artifact) {
          throw new Error("报告 Artifact 不存在或无权访问。");
        }
        const markdown = typeof artifact.content === "string" ? artifact.content : JSON.stringify(artifact.content ?? "", null, 2);
        setArtifactContentByMessage((current) => ({
          ...current,
          [message.id]: {
            messageId: message.id,
            artifactId,
            status: "ready",
            markdown,
          },
        }));
      })
      .catch((error) => {
        setArtifactContentByMessage((current) => ({
          ...current,
          [message.id]: {
            messageId: message.id,
            artifactId,
            status: "error",
            markdown: message.content,
            error: error instanceof Error ? error.message : "报告 Artifact 加载失败。",
          },
        }));
      });
  }, [activeToolState, artifactContentByMessage, user?.id]);

  const closeArtifact = useCallback(() => {
    setArtifactWindow((current) => ({ ...current, isOpen: false, messageId: null }));
  }, []);

  const restoreArtifactWindowWidth = useCallback(() => {
    setArtifactWindow((current) => {
      if (!current.isMinimized && !current.isMaximized) {
        return current;
      }
      return { ...current, isMinimized: false, isMaximized: false };
    });
  }, []);

  const toggleArtifactMaximized = useCallback(() => {
    setArtifactWindow((current) => ({ ...current, isMaximized: !current.isMaximized, isMinimized: false }));
  }, []);

  const copyArtifact = useCallback(
    async (message: AssistantMessage) => {
      try {
        await navigator.clipboard.writeText(artifactContentByMessage[message.id]?.markdown ?? message.content);
        toast({
          type: "info",
          body: "文档内容已复制。",
          uniqueID: `assistant-artifact-copy-${message.id}`,
          collisionBehavior: "overwrite",
        });
      } catch (error) {
        toast({
          type: "error",
          body: error instanceof Error ? error.message : "文档复制失败。",
          uniqueID: `assistant-artifact-copy-error-${message.id}`,
          collisionBehavior: "overwrite",
        });
      }
    },
    [artifactContentByMessage, toast],
  );

  const openReportRecord = useCallback(
    (toolCallId: string) => {
      const record = activeReportRecords.find((item) => item.toolCallId === toolCallId);
      const message = record?.messageId ? activeMessages.find((item) => item.id === record.messageId && isAssistantArtifactMessage(item, activeToolState)) : undefined;
      if (!message) {
        toast({
          type: "error",
          body: "报告消息不存在，无法切换到该版本。",
          uniqueID: `assistant-report-version-missing-${toolCallId}`,
          collisionBehavior: "overwrite",
        });
        return;
      }
      openArtifact(message);
    },
    [activeMessages, activeReportRecords, activeToolState, openArtifact, toast],
  );

  const loadSchemaContextMarkdown = useCallback(
    async (
      conversationId: string,
      question: string,
      contextOverride?: { dataSource?: DataSourceSummary | null; skill?: AssistantSkill | null; maxColumnsPerTable?: number },
    ) => {
      const contextDataSource = contextOverride?.dataSource ?? selectedDataSource;
      const contextSkill = contextOverride?.skill ?? selectedSkill;
      if (!contextDataSource) {
        return null;
      }
      const isOverallRiskSkill = contextSkill === "overall-risk-classification-distribution";
      const result = await requestWithRefresh((token) =>
        workbenchApi.schemaContext(token, {
          conversationId,
          question,
          dataSourceId: contextDataSource.id,
          skill: contextSkill,
          purpose: isOverallRiskSkill ? "risk_analysis" : "data_exploration",
          maxChars: 120_000,
          maxColumnsPerTable: contextOverride?.maxColumnsPerTable ?? FULL_FIELD_CONTEXT_APPROVAL_THRESHOLD,
        }),
      );
      if (!result.success) {
        toast({
          type: "error",
          body: `数据源 Context 构建失败：${result.error.message}`,
          uniqueID: "assistant-schema-context-error",
          collisionBehavior: "overwrite",
        });
        return null;
      }
      return result.context.markdown;
    },
    [requestWithRefresh, selectedDataSource, selectedSkill, toast],
  );

  const retryAssistantMessage = useCallback(
    async (message: AssistantMessage) => {
      if (!user?.id || !window.lifecycleX?.assistant || message.role !== "assistant" || message.status !== "error") {
        return;
      }

      try {
        const schemaContextMarkdown = await loadSchemaContextMarkdown(message.conversationId, message.content);
        const result = await window.lifecycleX.assistant.retryMessage({
          userId: user.id,
          messageId: message.id,
          clientRequestId: createClientRequestId(),
          modelName,
          dataSourceLabel: selectedDataSource ? dataSourceLabel(selectedDataSource) : null,
          selectedTempDataSourceIds: messageTempDataSourceIds,
          selectedFieldRefs: message.context?.selectedFieldRefs,
          schemaContextMarkdown,
          skill: selectedSkill,
          approvalMode,
        });
        setConversations((current) => mergeConversation(current, result.conversation));
        upsertMessage(result.conversation.id, result.assistantMessage);
        setActiveConversationId(result.conversation.id);
        const toolState = await window.lifecycleX.assistant.getToolState(user.id, result.conversation.id);
        setToolStateByConversation((current) => ({ ...current, [result.conversation.id]: toolState }));
      } catch (error) {
        toast({
          type: "error",
          body: error instanceof Error ? error.message : "失败重发未成功。",
          uniqueID: `assistant-retry-error-${message.id}`,
          collisionBehavior: "overwrite",
        });
      }
    },
    [approvalMode, loadSchemaContextMarkdown, messageTempDataSourceIds, modelName, selectedDataSource, selectedSkill, toast, upsertMessage, user?.id],
  );

  const renderMessageMetadata = useCallback(
    (message: AssistantMessage) => {
      const isThinking = message.role === "assistant" && (message.status === "receiving" || message.status === "processing");
      const showFailed = message.status === "error";
      const showStatus = isThinking || showFailed || message.status === "sending" || message.status === "awaiting_approval" || message.status === "stopped";
      const showCopy = !(message.role === "assistant" && isThinking);
      const duration = formatMessageDuration(message, metadataNow);

      return (
        <ChatMessageMetadata
          timestamp={formatChatTime(message.createdAt)}
          footer={
            <div className="assistant-message-metadata-footer">
              {showStatus && (
                <MetadataStatusIcon status={message.status} isThinking={isThinking} />
              )}
              {duration && (
                <span className="assistant-message-duration" title="大模型推理耗时">
                  {duration}
                </span>
              )}
              <div className="assistant-message-actions">
                {showCopy && (
                  <MetadataIconButton label="复制" icon={Copy} onClick={() => void copyMessage(message)} />
                )}
                {message.role === "user" && (
                  <MetadataIconButton label="编辑" icon={Pencil} onClick={() => editUserMessage(message)} />
                )}
                {message.role === "assistant" && message.status === "error" && (
                  <MetadataIconButton label="失败重发" icon={RotateCcw} onClick={() => void retryAssistantMessage(message)} />
                )}
              </div>
            </div>
          }
        />
      );
    },
    [copyMessage, editUserMessage, metadataNow, retryAssistantMessage],
  );

  const approveTool = useCallback(
    async (toolCallId: string, approved: boolean) => {
      if (!user?.id || !window.lifecycleX?.assistant) {
        return;
      }
      try {
        const result = await window.lifecycleX.assistant.approveTool(user.id, toolCallId, approved);
        upsertMessage(result.message.conversationId, result.message);
        if (activeConversation?.id && window.lifecycleX.assistant) {
          const [context, toolState] = await Promise.all([
            window.lifecycleX.assistant.getWorkflowContext(user.id, activeConversation.id),
            window.lifecycleX.assistant.getToolState(user.id, activeConversation.id),
          ]);
          setWorkflowContextByConversation((current) => ({ ...current, [activeConversation.id]: context }));
          setToolStateByConversation((current) => ({ ...current, [activeConversation.id]: toolState }));
        }
      } catch (error) {
        toast({
          type: "error",
          body: error instanceof Error ? error.message : "工具审批失败。",
          uniqueID: "assistant-tool-approval-error",
          collisionBehavior: "overwrite",
        });
      }
    },
    [activeConversation?.id, toast, upsertMessage, user?.id],
  );

  const approvePendingPython = useCallback(
    async (approved: boolean) => {
      if (!activePendingPythonToolCallId) {
        toast({
          type: "error",
          body: "当前没有待审批的 Python 工具调用。",
          uniqueID: "assistant-python-approval-missing",
          collisionBehavior: "overwrite",
        });
        return;
      }
      await approveTool(activePendingPythonToolCallId, approved);
    },
    [activePendingPythonToolCallId, approveTool, toast],
  );

  const resolveFullFieldContextApproval = useCallback((approved: boolean) => {
    const resolver = fullFieldContextApprovalResolverRef.current;
    fullFieldContextApprovalResolverRef.current = null;
    setFullFieldContextApprovalRequest(null);
    resolver?.(approved);
  }, []);

  const requestFullFieldContextApproval = useCallback((sources: FullFieldContextApprovalSource[]) => {
    if (sources.length === 0) {
      return Promise.resolve(true);
    }
    fullFieldContextApprovalResolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      fullFieldContextApprovalResolverRef.current = resolve;
      setFullFieldContextApprovalRequest({ sources });
    });
  }, []);

  const resolveTempSchemaFieldLimit = useCallback(
    async (attachments: ChatCsvAttachment[]) => {
      const oversizedSources = attachments
        .map((attachment) => ({
          fileName: attachment.fileName,
          fieldCount: attachment.columns?.length ?? attachment.columnCount ?? 0,
        }))
        .filter((source) => source.fieldCount > FULL_FIELD_CONTEXT_APPROVAL_THRESHOLD);
      if (oversizedSources.length === 0) {
        return undefined;
      }
      const approved = await requestFullFieldContextApproval(oversizedSources);
      return approved ? undefined : FULL_FIELD_CONTEXT_APPROVAL_THRESHOLD;
    },
    [requestFullFieldContextApproval],
  );

  const resolveDataSourceSchemaColumnLimit = useCallback(
    async (conversationId: string, question: string, dataSource: DataSourceSummary | null, skill: AssistantSkill | null) => {
      if (!dataSource) {
        return undefined;
      }
      const result = await requestWithRefresh((token) =>
        workbenchApi.schemaContext(token, {
          conversationId,
          question,
          dataSourceId: dataSource.id,
          skill,
          purpose: skill === "overall-risk-classification-distribution" ? "risk_analysis" : "data_exploration",
          maxChars: 120_000,
          maxColumnsPerTable: FULL_FIELD_CONTEXT_APPROVAL_THRESHOLD + 1,
        }),
      );
      if (!result.success) {
        toast({
          type: "error",
          body: `数据源字段预检失败：${result.error.message}`,
          uniqueID: "assistant-schema-context-preflight-error",
          collisionBehavior: "overwrite",
        });
        return FULL_FIELD_CONTEXT_APPROVAL_THRESHOLD;
      }
      const tableSources = (result.context.dataSourceProfiles ?? []).flatMap((profile) =>
        (profile.tables ?? []).map((table) => ({
          fileName: `${profile.displayName ?? dataSourceLabel(dataSource)} / ${table.tableName}`,
          fieldCount: table.columnCount ?? table.columns?.length ?? 0,
        })),
      );
      const oversizedSources = tableSources.filter((source) => source.fieldCount > FULL_FIELD_CONTEXT_APPROVAL_THRESHOLD);
      if (oversizedSources.length === 0) {
        return FULL_FIELD_CONTEXT_APPROVAL_THRESHOLD;
      }
      const approved = await requestFullFieldContextApproval(oversizedSources);
      if (!approved) {
        return FULL_FIELD_CONTEXT_APPROVAL_THRESHOLD;
      }
      return Math.max(...oversizedSources.map((source) => source.fieldCount));
    },
    [requestFullFieldContextApproval, requestWithRefresh, toast],
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      const prompt = value.trim();
      if (!prompt || isStreaming || !user?.id) {
        return;
      }
      if (activeChatCsvAttachments.some((attachment) => attachment.status === "importing" || attachment.status === "validating" || attachment.status === "parsing")) {
        toast({
          type: "error",
          body: "CSV 正在导入，请等待完成后再发送。",
          uniqueID: "assistant-chat-csv-importing-submit",
          collisionBehavior: "overwrite",
        });
        return;
      }
      if (activePendingPythonToolCallId && isPythonApprovalPrompt(prompt)) {
        setComposerValue("");
        await approvePendingPython(true);
        return;
      }
      const invalidFieldRefs = selectedFieldRefs.filter((field) => field.status !== "valid" || !composerValue.includes(field.rawText));
      if (invalidFieldRefs.length > 0) {
        toast({
          type: "error",
          body: `字段“${invalidFieldRefs[0].displayName}”所属的临时 CSV 已失效或已从输入中删除，请重新选择字段。`,
          uniqueID: "assistant-chat-field-token-invalid",
          collisionBehavior: "overwrite",
        });
        return;
      }
      let optimisticConversationId: string | null = null;
      let optimisticMessageId: string | null = null;

      if (!isModelConfigured) {
        onRequireModelConfig();
        setComposerValue(value);
        window.setTimeout(() => setComposerValue(value), 0);
        return;
      }

      if (!window.lifecycleX?.assistant) {
        toast({
          type: "error",
          body: "本地对话服务不可用。",
          uniqueID: "assistant-ipc-unavailable",
          collisionBehavior: "overwrite",
        });
        return;
      }

      try {
        const submitDataSource = selectedDataSource ?? null;
        const submitSkill = selectedSkill;
        const submitTempDataSourceIds = messageTempDataSourceIds;
        const submitTempDataSourceLabels = messageTempDataSourceLabels;
        const submitTempAttachments = readyChatCsvAttachments.filter((attachment) =>
          attachment.tempDataSourceId && submitTempDataSourceIds.includes(attachment.tempDataSourceId),
        );
        const tempSchemaFieldLimit = await resolveTempSchemaFieldLimit(submitTempAttachments);
        const submitFieldRefs = selectedFieldRefs.filter((field) => field.status === "valid" && prompt.includes(field.rawText));
        const conversation =
          activeConversation ?? await window.lifecycleX.assistant.createConversation(user.id, prompt.slice(0, 18) || "新对话");
        setConversations((current) => mergeConversation(current, conversation));
        setMessagesByConversation((current) => ({ ...current, [conversation.id]: current[conversation.id] ?? [] }));
        const conversationId = conversation.id;
        optimisticConversationId = conversationId;
        const dataSourceSchemaColumnLimit = await resolveDataSourceSchemaColumnLimit(conversationId, prompt, submitDataSource, submitSkill);
        const optimisticContext: AssistantMessage["context"] = {
          dataSourceLabel: submitDataSource ? dataSourceLabel(submitDataSource) : null,
          skill: submitSkill,
          temporaryDataSourceIds: submitTempDataSourceIds,
          temporaryDataSourceLabels: submitTempDataSourceLabels,
          selectedFieldRefs: submitFieldRefs,
        };
        const optimisticUserMessage = createOptimisticUserMessage(user.id, conversationId, prompt, optimisticContext);
        optimisticMessageId = optimisticUserMessage.id;
        upsertMessage(conversationId, optimisticUserMessage);
        setActiveConversationId(conversationId);
        setComposerValue("");
        clearComposerContextSelection([], conversationId);
        const schemaContextMarkdown = await loadSchemaContextMarkdown(conversationId, prompt, {
          dataSource: submitDataSource,
          skill: submitSkill,
          maxColumnsPerTable: dataSourceSchemaColumnLimit,
        });
        const result = await window.lifecycleX.assistant.sendMessage({
          userId: user.id,
          conversationId,
          clientRequestId: createClientRequestId(),
          prompt,
          modelName,
          dataSourceId: submitDataSource?.id ?? null,
          dataSourceLabel: submitDataSource ? dataSourceLabel(submitDataSource) : null,
          selectedTempDataSourceIds: submitTempDataSourceIds,
          selectedFieldRefs: submitFieldRefs,
          tempSchemaFieldLimit,
          schemaContextMarkdown,
          skill: submitSkill,
          approvalMode,
        });
        setConversations((current) => mergeConversation(current, result.conversation));
        removeMessage(conversationId, optimisticUserMessage.id);
        upsertMessage(result.conversation.id, result.userMessage);
        upsertMessage(result.conversation.id, result.assistantMessage);
        setActiveConversationId(result.conversation.id);
        const toolState = await window.lifecycleX.assistant.getToolState(user.id, result.conversation.id);
        setToolStateByConversation((current) => ({ ...current, [result.conversation.id]: toolState }));
      } catch (error) {
        const failedMessage = error instanceof Error ? error.message : "消息发送失败。";
        if (optimisticConversationId && optimisticMessageId) {
          patchMessage(optimisticConversationId, optimisticMessageId, {
            status: "error",
            errorMessage: failedMessage,
          });
        }
        toast({
          type: "error",
          body: failedMessage,
          uniqueID: "assistant-send-error",
          collisionBehavior: "overwrite",
        });
      }
    },
    [
      activeConversation,
      activeChatCsvAttachments,
      activePendingPythonToolCallId,
      approvalMode,
      approvePendingPython,
      clearComposerContextSelection,
      isModelConfigured,
      isStreaming,
      loadSchemaContextMarkdown,
      messageTempDataSourceIds,
      messageTempDataSourceLabels,
      modelName,
      onRequireModelConfig,
      readyChatCsvAttachments,
      resolveDataSourceSchemaColumnLimit,
      resolveTempSchemaFieldLimit,
      selectedFieldRefs,
      selectedDataSource,
      selectedSkill,
      toast,
      patchMessage,
      removeMessage,
      upsertMessage,
      user?.id,
    ],
  );

  const markdownComponents = useMemo<MarkdownComponents>(
    () => ({
      code: ({ code, language }: { code: string; language?: string }) => {
        const normalizedLanguage = (language ?? "").toLowerCase();
        if (["visualization", "visualization-json", "viz", "chart-spec"].includes(normalizedLanguage)) {
          const parsed = parseVisualizationSpecJson(code, { allowInlineData: true, inlineDataMaxRows: 200, inlineDataMaxBytes: 64 * 1024 });
          return (
            <VisualizationRenderer
              spec={parsed.success ? parsed.spec : undefined}
              error={parsed.success ? undefined : parsed.error}
            />
          );
        }

        return (
          <CodeBlock
            code={code}
            language={normalizeCodeLanguage(language)}
            hasCopyButton
            hasLanguageLabel
            isWrapped
            width="100%"
            size="sm"
            className="assistant-code-block"
            onCopy={() =>
              toast({
                type: "info",
                body: "代码已复制。",
                uniqueID: "assistant-code-copy",
                collisionBehavior: "overwrite",
              })
            }
          />
        );
      },
    }),
    [toast],
  );

  const approvalMenuItems = useMemo<DropdownMenuOption[]>(
    () =>
      approvalOptions.map((approval) => ({
        label: `${approvalMode === approval.value ? "✓ " : ""}${approval.label}`,
        onClick: () => setApprovalMode(approval.value),
      })),
    [approvalMode],
  );

  const renderToolSelectorLabel = (item: ChatToolSelectorItem<AssistantSkill>) => (
    <span className="assistant-tool-selector-item-label">
      <span className="assistant-tool-selector-item-title">
        {item.type !== "add_csv" && item.isSelected ? "✓ " : ""}
        {item.label}
      </span>
    </span>
  );

  const renderToolSelectorEndContent = (item: ChatToolSelectorItem<AssistantSkill>) => {
    if (item.type !== "data_source") {
      return undefined;
    }
    return (
      <Badge
        label={toolDataSourceBadgeLabel(item.kind)}
        variant={toolDataSourceBadgeVariant(item.kind)}
      />
    );
  };

  const handleToolSelectorItemClick = (item: ChatToolSelectorItem<AssistantSkill>) => {
    if (item.type === "add_csv") {
      selectAddCsvFromToolSelector();
      return;
    }
    if (item.type === "skill") {
      selectSkillFromToolSelector(item.value);
      return;
    }
    selectDataSourceFromToolSelector(item);
  };

  const renderUserContextTokens = (message: AssistantMessage) => {
    const fileLabels = message.context?.temporaryDataSourceLabels ?? [];
    const skill = message.context?.skill;
    const sourceLabel = dataSourceTableLabel(message.context?.dataSourceLabel);
    if (fileLabels.length === 0 && !skill && !sourceLabel) {
      return null;
    }

    return (
      <HStack gap={1} wrap="wrap" className="assistant-user-context-tokens">
        {fileLabels.map((fileName) => (
          <Token key={`file:${fileName}`} label={`#${fileName}`} color="green" size="sm" />
        ))}
        {skill && <Token label={`@${skillLabel(skill)}`} color="purple" size="sm" />}
        {sourceLabel && <Token label={`#${sourceLabel}`} color="blue" size="sm" />}
      </HStack>
    );
  };

  const renderUserMessageBody = (message: AssistantMessage) => {
    const fieldRefs = message.context?.selectedFieldRefs?.filter((field) => field.status === "valid") ?? [];
    if (fieldRefs.length === 0) {
      return <p>{message.content}</p>;
    }
    return (
      <ChatTokenizedText
        tokens={fieldRefs.map((field) => ({
          value: field.rawText,
          label: field.rawText,
          variant: "teal",
        }))}
      >
        {message.content}
      </ChatTokenizedText>
    );
  };

  const renderReportBufferBlock = (block: AssistantBlock, role: AssistantMessage["role"], status: AssistantMessageStatus, segmentId: string) => (
    <div
      key={`${segmentId}:buffering`}
      className="assistant-message-block report-transition-buffer"
      ref={(node) => measureReportTransitionHeight(segmentId, node)}
    >
      {renderBlock(block, role, status)}
    </div>
  );

  const renderReportReplacementBlock = (message: AssistantMessage, block: AssistantBlock, status: AssistantMessageStatus, segmentId: string) => {
    const reportRecord = completedReportRecordForMessage(message, activeToolState);
    const streamReportSegment = streamSegmentManagerRef.current.getSegment(segmentId);
    const title = typeof reportRecord?.request.title === "string"
      ? reportRecord.request.title
      : streamReportSegment?.type === "report" && streamReportSegment.reportTitle
        ? streamReportSegment.reportTitle
        : artifactTitle(message);
    const { preface, reportMarkdown } = splitReportMarkdownContent(block.content, title);
    const artifactId = reportArtifactIdForMessage(message, activeToolState) ?? (streamReportSegment?.type === "report" ? streamReportSegment.reportArtifactId : undefined);
    const dataSourceMeta = artifactDataSourceMeta(message, activeToolState);
    const generatedAt = reportRecord?.completedAt ?? reportRecord?.updatedAt ?? message.createdAt;
    const reportSegment: ReportContentSegment = {
      segmentId,
      messageId: message.id,
      sequence: 0,
      createdAt: message.createdAt,
      updatedAt: reportRecord?.updatedAt ?? message.updatedAt,
      type: "report",
      markdownContent: reportMarkdown || block.content,
      status: "card_visible",
      reportArtifactId: artifactId,
      reportTitle: title,
      reportVersion: reportRecord?.version,
      streamCompletedAt: message.updatedAt,
      bufferStartedAt: reportCardTransitions[segmentId]?.status === "visible" ? reportRecord?.updatedAt : undefined,
    };
    const stableHeight = reportTransitionHeights[segmentId];
    return (
      <div
        key={`${segmentId}:visible`}
        className="assistant-message-block report-transition card-visible"
        style={stableHeight ? { minHeight: `${stableHeight}px` } : undefined}
        onAnimationEnd={() => releaseReportTransitionHeight(segmentId)}
      >
        {preface && (
          <div className="assistant-message-block markdown report-preface">
            <Markdown
              density="compact"
              headingLevelStart={3}
              contentWidth="100%"
              autolink="gfm"
              isStreaming={status === "receiving" || status === "processing"}
              components={markdownComponents}
            >
              {preface}
            </Markdown>
          </div>
        )}
        <StreamingReportSegment
          segment={reportSegment}
          markdownComponents={markdownComponents}
          chartCount={artifactChartCount(message, activeToolState)}
          dataSourceCount={dataSourceMeta.count}
          dataSourceLabels={dataSourceMeta.labels}
          generatedAt={formatArtifactGeneratedAt(generatedAt)}
          onOpen={() => openArtifact(message)}
        />
      </div>
    );
  };

  const renderAssistantMessageBlocks = (message: AssistantMessage) => {
    const toolSegmentId = reportSegmentIdForMessage(message, activeToolState);
    const streamReportSegment = streamSegmentManagerRef.current
      .getMessageSegments(message.id)
      .find((segment) => segment.type === "report" && segment.reportArtifactId);
    const segmentId = toolSegmentId ?? streamReportSegment?.segmentId;
    const reportRecord = completedReportRecordForMessage(message, activeToolState);
    const artifactId = reportArtifactIdForMessage(message, activeToolState);
    const transition = resolveReportCardRenderTransition({
      segmentId,
      messageStatus: message.status,
      hasCompletedReportRecord: Boolean(reportRecord),
      hasReportArtifact: Boolean(artifactId),
      hasStreamReportSegment: Boolean(streamReportSegment),
      storedTransition: segmentId ? reportCardTransitions[segmentId] : undefined,
    });
    const reportTitle = typeof reportRecord?.request.title === "string"
      ? reportRecord.request.title
      : streamReportSegment?.type === "report" && streamReportSegment.reportTitle
        ? streamReportSegment.reportTitle
        : artifactTitle(message);
    const isReportTransitionActive = Boolean(segmentId) && (transition?.status === "card_ready" || transition?.status === "visible");
    const shouldShowReportCard =
      Boolean(segmentId) &&
      transition?.status === "visible" &&
      message.status === "completed" &&
      Boolean(artifactId);
    const markdownBlockCandidates = isReportTransitionActive
      ? message.blocks
          .map((block, index) => ({ block, index }))
          .filter(({ block }) => block.type === "markdown" && !isRenderableCodeLanguage(block.language))
      : [];
    const reportContentIndex = reportMarkdownContentIndex(markdownBlockCandidates.map(({ block }) => block.content), reportTitle);
    const reportBlockIndex = reportContentIndex >= 0 ? markdownBlockCandidates[reportContentIndex]?.index ?? -1 : -1;

    return (
      <div className="assistant-message-blocks">
        {message.blocks.map((block, index) =>
          shouldShowReportCard && segmentId && index === reportBlockIndex
            ? renderReportReplacementBlock(message, block, message.status, segmentId)
            : transition?.status === "card_ready" && segmentId && index === reportBlockIndex
              ? renderReportBufferBlock(block, message.role, message.status, segmentId)
            : renderBlock(block, message.role, message.status),
        )}
      </div>
    );
  };

  const renderBlock = (block: AssistantBlock, role: AssistantMessage["role"], status: AssistantMessageStatus) => {
    if (role === "assistant" && shouldHideInlineToolResult(block)) {
      return null;
    }

    if (role === "assistant" && block.type === "markdown") {
      if (isRenderableCodeLanguage(block.language)) {
        return (
          <div key={block.id} className="assistant-artifact-card code">
            <CodeBlock
              code={block.content}
              language={normalizeCodeLanguage(block.language)}
              title={block.title}
              hasCopyButton
              hasLanguageLabel
              isWrapped
              width="100%"
              size="sm"
              className="assistant-code-block"
              onCopy={() =>
                toast({
                  type: "info",
                  body: "代码已复制。",
                  uniqueID: `assistant-code-copy-${block.id}`,
                  collisionBehavior: "overwrite",
                })
              }
            />
          </div>
        );
      }

      return (
        <div key={block.id} className="assistant-message-block markdown">
          {block.title && <strong>{block.title}</strong>}
          <Markdown
            density="compact"
            headingLevelStart={3}
            contentWidth="100%"
            autolink="gfm"
            isStreaming={status === "receiving" || status === "processing"}
            components={markdownComponents}
          >
            {block.content}
          </Markdown>
        </div>
      );
    }

    if (role === "assistant" && block.type === "json") {
      return (
        <div key={block.id} className="assistant-artifact-card code">
          <CodeBlock
            code={renderJson(block.content)}
            language="json"
            title={block.title ?? "JSON"}
            hasCopyButton
            hasLanguageLabel
            isWrapped
            width="100%"
            size="sm"
            className="assistant-code-block"
          />
        </div>
      );
    }

    if (role === "assistant" && block.type === "visualization") {
      return (
        <VisualizationRenderer
          key={block.id}
          spec={block.visualizationSpec}
          error={block.visualizationError}
          isStreaming={block.visualizationStatus === "streaming" || status === "processing"}
        />
      );
    }

    const body =
      block.type === "json" ? (
        <pre>{renderJson(block.content)}</pre>
      ) : block.type === "mermaid" ? (
        <pre className="assistant-mermaid-block">{block.content}</pre>
      ) : (
        <p>{block.content}</p>
      );

    return (
      <div key={block.id} className={`assistant-message-block ${block.type}`}>
        {block.title && <strong>{block.title}</strong>}
        {body}
        {block.toolCallId && block.toolStatus === "pending_approval" && (
          <div className="assistant-tool-actions">
            <Button label="批准执行" variant="primary" size="sm" onClick={() => approveTool(block.toolCallId!, true)} />
            <Button label="拒绝" variant="ghost" size="sm" onClick={() => approveTool(block.toolCallId!, false)} />
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="data-assistant-workspace" aria-label="数据助手">
      <aside className="assistant-history-panel" aria-label="对话列表">
        <div className="assistant-history-heading">
          <Button
            label="New Chat"
            variant="primary"
            size="sm"
            icon={<Icon icon={Plus} size="sm" color="inherit" />}
            isIconOnly
            isLoading={isLoadingConversations}
            onClick={startConversation}
          />
        </div>
        <div className="assistant-history-list">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={conversation.id === activeConversation?.id ? "assistant-history-item active" : "assistant-history-item"}
            >
              <button
                type="button"
                className="assistant-history-select"
                onClick={() => {
                  setActiveConversationId(conversation.id);
                  if (!messagesByConversation[conversation.id]) {
                    void loadConversationMessages(conversation.id);
                  } else if (!(conversation.id in workflowContextByConversation) && user?.id && window.lifecycleX?.assistant) {
                    void Promise.all([
                      window.lifecycleX.assistant.getWorkflowContext(user.id, conversation.id),
                      window.lifecycleX.assistant.getToolState(user.id, conversation.id),
                    ]).then(([context, toolState]) => {
                      setWorkflowContextByConversation((current) => ({ ...current, [conversation.id]: context }));
                      setToolStateByConversation((current) => ({ ...current, [conversation.id]: toolState }));
                    });
                  }
                }}
              >
                <strong>{conversation.title}</strong>
                <span>{formatChatTime(conversation.updatedAt)}</span>
              </button>
              <div className="assistant-history-actions">
                <Button
                  label="编辑记录"
                  variant="secondary"
                  size="sm"
                  icon={<Icon icon={Pencil} size="xsm" color="inherit" />}
                  isIconOnly
                  onClick={() => openEditConversation(conversation)}
                />
                <Button
                  label="删除记录"
                  variant="destructive"
                  size="sm"
                  icon={<Icon icon={Trash2} size="xsm" color="inherit" />}
                  isIconOnly
                  onClick={() => setDeletingConversation(conversation)}
                />
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className={`assistant-chat-shell ${activeArtifactMessage ? "with-artifact" : ""}`}>
        <div className="assistant-chat-main">
          <ChatLayout
            density="compact"
            className="assistant-chat-layout"
            emptyState={<AssistantLanding userName={landingUserName} />}
            composer={
              <div
                ref={composerShellRef}
                className="assistant-composer-shell"
                onBlurCapture={handleComposerBlurCapture}
                onFocusCapture={handleComposerFocusCapture}
              >
                {activeChatCsvAttachments.length > 0 && (
                  <div className="assistant-chat-csv-attachments" aria-label="会话临时 CSV">
                    {activeChatCsvAttachments.map((attachment) => (
                      <div
                        key={attachment.attachmentId}
                        className={`assistant-chat-csv-chip ${attachment.status}`}
                        title={attachment.error?.message ?? `${attachment.fileName} · ${attachment.sqliteTableName ?? "导入中"}`}
                      >
                        <span className="assistant-chat-csv-chip-main">
                          <span className="assistant-chat-csv-chip-name">{attachment.fileName}</span>
                          <span className="assistant-chat-csv-chip-meta">
                            {attachment.status === "ready"
                              ? `${attachment.rowCount ?? 0} 行 · ${attachment.columnCount ?? 0} 列`
                              : attachment.status === "failed"
                                ? attachment.error?.message ?? "导入失败"
                                : "导入中"}
                            {" · "}
                            {formatFileSize(attachment.fileSizeBytes)}
                          </span>
                        </span>
                        {attachment.status === "ready" && (
                          <button
                            type="button"
                            className="assistant-chat-csv-chip-remove"
                            aria-label={`移除 ${attachment.fileName}`}
                            onClick={() => void removeChatCsvAttachment(attachment)}
                          >
                            <Icon icon={X} size="xsm" color="inherit" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <input
                  ref={chatCsvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="assistant-chat-csv-input"
                  onChange={handleChatCsvFileSelect}
                />
                {composerContextTokenDisplay.tokens.length > 0 && (
                  <div className="assistant-composer-context-tokens" aria-label="当前已选工具上下文">
                    <ChatTokenizedText tokens={composerContextTokenDisplay.tokens}>
                      {composerContextTokenDisplay.values.join(" ")}
                    </ChatTokenizedText>
                  </div>
                )}
                <ChatComposer
                  value={composerValue}
                  onChange={setComposerValue}
                  onSubmit={handleSubmit}
                  onStop={stopStreaming}
                  isStopShown={isStreaming}
                  placeholder="问问数据助手"
                  density="compact"
                  input={
                    <ChatComposerInput
                      handleRef={composerInputRef}
                      triggers={fieldComposerTriggers}
                      debounceMs={0}
                      maxRows={8}
                      onCompositionStart={() => setIsComposerComposing(true)}
                      onCompositionEnd={() => setIsComposerComposing(false)}
                    />
                  }
                  footerActions={
                    <div className="assistant-composer-actions" aria-label="数据助手工具栏">
                      <DropdownMenu
                        hasChevron={false}
                        isMenuOpen={fieldSelectorOpen}
                        onOpenChange={handleFieldSelectorOpenChange}
                        placement="above"
                        menuWidth={340}
                        button={{
                          label: "CSV字段",
                          variant: "ghost",
                          size: "sm",
                          className: "assistant-field-selector-anchor",
                          isIconOnly: true,
                        }}
                      >
                        <div className="assistant-field-selector-menu" role="presentation">
                          <div className="assistant-field-selector-heading">
                            <strong>选择 CSV 字段</strong>
                            {activeFieldCsvAttachment?.fileName && <span>{activeFieldCsvAttachment.fileName}</span>}
                          </div>
                          {activeCsvFields.length === 0 ? (
                            <div className="assistant-tool-selector-empty">当前 CSV 文件没有可用字段</div>
                          ) : filteredCsvFields.length === 0 ? (
                            <div className="assistant-tool-selector-empty">未找到匹配字段</div>
                          ) : (
                            <div className="assistant-field-selector-results" role="listbox" aria-label="CSV 字段列表">
                              {filteredCsvFields.map((field) => (
                                <DropdownMenuItem
                                  key={field.fieldId}
                                  className="assistant-tool-selector-menu-item"
                                  label={
                                    <span className="assistant-tool-selector-item-label">
                                      <span className="assistant-tool-selector-item-title">
                                        {selectedFieldIds.has(field.fieldId) ? "✓ " : ""}
                                        {field.displayName}
                                      </span>
                                    </span>
                                  }
                                  endContent={<Badge label={field.sqliteType} variant="neutral" />}
                                  onClick={() => selectCsvField(field)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </DropdownMenu>
                      <DropdownMenu
                        hasChevron={false}
                        isMenuOpen={toolSelectorOpen}
                        onOpenChange={handleToolSelectorOpenChange}
                        onClick={openToolSelectorByButton}
                        placement="above"
                        menuWidth={340}
                        button={{
                          label: "选择工具",
                          variant: "ghost",
                          size: "sm",
                          className: "assistant-composer-action-button assistant-tool-selector-button",
                          icon: <Icon icon={Plus} size="xsm" color="inherit" />,
                          tooltip: "选择工具",
                          isIconOnly: true,
                          isLoading: isLoadingDataSources || isImportingChatCsv,
                        }}
                      >
                        {toolSelectorSections.length > 0 ? (
                          toolSelectorSections.map((section) => (
                            <div key={section.id} className="assistant-tool-selector-section" role="presentation">
                              <div className="assistant-tool-selector-section-label">{section.title}</div>
                              {section.items.map((item) => (
                                <DropdownMenuItem
                                  key={`${item.type}:${item.id}`}
                                  className="assistant-tool-selector-menu-item"
                                  label={renderToolSelectorLabel(item)}
                                  endContent={renderToolSelectorEndContent(item)}
                                  onClick={() => handleToolSelectorItemClick(item)}
                                />
                              ))}
                            </div>
                          ))
                        ) : (
                          <div className="assistant-tool-selector-empty">未找到匹配的工具、Skill 或数据源</div>
                        )}
                      </DropdownMenu>
                      <DropdownMenu
                        hasChevron={false}
                        placement="above"
                        menuWidth={190}
                        button={{
                          label: approvalOptions.find((item) => item.value === approvalMode)?.label ?? "请求批准",
                          variant: "ghost",
                          size: "sm",
                          className: "assistant-composer-action-button",
                          icon: <AssistantActionIcon src={approveIcon} />,
                          tooltip: "审批权限",
                        }}
                        items={approvalMenuItems}
                      />
                    </div>
                  }
                />
              </div>
            }
          >
            {activeMessages.length > 0 ? (
              <ChatMessageList isStreaming={isStreaming} density="compact">
                {activeMessages.map((message) => {
                  const sender = message.role === "user" ? "user" : "assistant";
                  const workflowToolCalls = sender === "assistant" ? toolCallsFromToolState(message, activeToolState, approveTool) : [];
                  const toolCalls = sender === "assistant"
                    ? workflowToolCalls.length > 0
                      ? workflowToolCalls
                      : toolCallsFromMessage(message)
                    : [];
                  return (
                    <ChatMessage
                      key={message.id}
                      sender={sender}
                      avatar={
                        sender === "user" ? (
                          <Avatar src={user?.avatarUrl} name={user?.displayName ?? "用户"} size={32} />
                        ) : (
                          <span className="assistant-bot-avatar">AI</span>
                        )
                      }
                    >
                      {sender === "user" && renderUserContextTokens(message)}
                      <ChatMessageBubble
                        variant={sender === "assistant" ? "ghost" : "filled"}
                        metadata={renderMessageMetadata(message)}
                      >
                        {sender === "user" ? (
                          renderUserMessageBody(message)
                        ) : message.blocks.length > 0 ? (
                          renderAssistantMessageBlocks(message)
                        ) : (
                          <span className="assistant-stream-cursor">
                            <Icon icon={LoaderCircle} size="xsm" color="inherit" className="assistant-message-status-spinner" />
                            <span>思考中...</span>
                          </span>
                        )}
                      </ChatMessageBubble>
                      {toolCalls.length > 0 && (
                        <ChatToolCalls
                          label={`${toolCalls.length} tool calls`}
                          calls={toolCalls}
                          className="assistant-tool-call-list"
                        />
                      )}
                    </ChatMessage>
                  );
                })}
              </ChatMessageList>
            ) : []}
          </ChatLayout>
        </div>
        {activeArtifactMessage && (
          <>
            {!artifactWindow.isMaximized && (
              <ResizeHandle
                direction="horizontal"
                resizable={artifactResize.props}
                isReversed
                pillPlacement="start"
                hasDivider
                label="调整文档窗口宽度"
                className="assistant-artifact-resize-handle"
              />
            )}
            <Card
              variant="transparent"
              height="100%"
              className={`assistant-artifact-panel ${artifactWindow.isMinimized ? "minimized" : ""} ${artifactWindow.isMaximized ? "maximized" : ""}`}
              style={{
                width: artifactWindow.isMaximized ? "100vw" : `${artifactResize.size}px`,
                height: artifactWindow.isMaximized ? "100dvh" : "100%",
              }}
            >
              <Toolbar
                label="文档窗口操作"
                size="sm"
                dividers={["bottom"]}
                className="assistant-artifact-toolbar"
                startContent={
                  <HStack gap={3} vAlign="center" className="assistant-artifact-toolbar-title">
                    <Icon icon={FileText} size="sm" color="secondary" />
                    <VStack gap={0}>
                      <Text type="label" weight="semibold">
                        {artifactTitle(activeArtifactMessage)}
                      </Text>
                      <Text type="supporting" color="secondary">
                        生成于 {formatArtifactGeneratedAt(activeArtifactMessage.createdAt)}
                      </Text>
                    </VStack>
                    {activeReportRecords.length > 1 && (
                      <DropdownMenu
                        hasChevron
                        placement="above"
                        menuWidth={260}
                        button={{
                          label: activeArtifactReportRecord?.version ? `版本 ${activeArtifactReportRecord.version}` : "报告版本",
                          variant: "secondary",
                          size: "sm",
                        }}
                        items={activeReportRecords.map((record) => ({
                          label: `${record.toolCallId === activeArtifactReportRecord?.toolCallId ? "✓ " : ""}版本 ${record.version} · ${formatArtifactGeneratedAt(record.completedAt ?? record.updatedAt)}`,
                          onClick: () => openReportRecord(record.toolCallId),
                        }))}
                      />
                    )}
                  </HStack>
                }
                endContent={
                  <HStack gap={1} vAlign="center" className="assistant-artifact-toolbar-actions">
                    <Button
                      label="复制内容"
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      icon={<Icon icon={Copy} size="sm" color="inherit" />}
                      onClick={() => void copyArtifact(activeArtifactMessage)}
                    />
                    <Button
                      label="最小化窗口"
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      icon={<Icon icon={Minimize2} size="sm" color="inherit" />}
                      onClick={restoreArtifactWindowWidth}
                    />
                    <Button
                      label={artifactWindow.isMaximized ? "还原窗口" : "最大化窗口"}
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      icon={<Icon icon={Maximize2} size="sm" color="inherit" />}
                      onClick={toggleArtifactMaximized}
                    />
                    <Button
                      label="关闭窗口"
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      icon={<Icon icon={X} size="sm" color="inherit" />}
                      onClick={closeArtifact}
                    />
                  </HStack>
                }
              />
              <Section variant="transparent" className="assistant-artifact-body">
                {activeArtifactContent?.status === "loading" ? (
                  <HStack gap={2} vAlign="center" className="assistant-artifact-loading">
                    <Icon icon={LoaderCircle} size="sm" color="secondary" className="assistant-message-status-spinner" />
                    <Text type="body" color="secondary">报告 Artifact 加载中...</Text>
                  </HStack>
                ) : activeArtifactContent?.status === "error" ? (
                  <VStack gap={2} hAlign="stretch" className="assistant-artifact-error">
                    <Text type="label" color="primary">报告 Artifact 加载失败</Text>
                    <Text type="body" color="secondary">{activeArtifactContent.error}</Text>
                    <ReportMarkdownViewer
                      markdown={activeArtifactContent.markdown}
                      components={markdownComponents}
                      className="assistant-artifact-markdown"
                    />
                  </VStack>
                ) : (
                  <ReportMarkdownViewer
                    markdown={activeArtifactContent?.markdown ?? activeArtifactMessage.content}
                    components={markdownComponents}
                    className="assistant-artifact-markdown"
                  />
                )}
              </Section>
            </Card>
          </>
        )}
      </div>

      <Dialog isOpen={fullFieldContextApprovalRequest !== null} onOpenChange={(open) => !open && resolveFullFieldContextApproval(false)} width={480} purpose="info" padding={5}>
        <VStack gap={4} hAlign="stretch">
          <div className="dialog-copy-stack">
            <Text type="display-3" as="h2" display="block">
              确认导入全表字段清单
            </Text>
            <Text type="body" color="secondary" display="block">
              当前临时 CSV 字段数超过 {FULL_FIELD_CONTEXT_APPROVAL_THRESHOLD} 个。全量导入字段清单可提升 SQL 和 Python 脚本推理准确性，但会增加本轮大模型上下文长度。
            </Text>
          </div>
          {fullFieldContextApprovalRequest?.sources.length ? (
            <VStack gap={1} hAlign="stretch" className="assistant-field-context-approval-list">
              {fullFieldContextApprovalRequest.sources.map((source) => (
                <HStack key={source.fileName} hAlign="between" gap={3}>
                  <Text type="body" display="block">{source.fileName}</Text>
                  <Badge label={`${source.fieldCount} 个字段`} variant="neutral" />
                </HStack>
              ))}
            </VStack>
          ) : null}
          <HStack hAlign="end" gap={2}>
            <Button label={`仅导入前 ${FULL_FIELD_CONTEXT_APPROVAL_THRESHOLD} 个字段`} variant="secondary" onClick={() => resolveFullFieldContextApproval(false)} />
            <Button label="导入全表字段" variant="primary" onClick={() => resolveFullFieldContextApproval(true)} />
          </HStack>
        </VStack>
      </Dialog>

      <Dialog isOpen={editingConversation !== null} onOpenChange={(open) => !open && closeEditConversation()} width={460} purpose="form" padding={5}>
        <VStack gap={4} hAlign="stretch">
          <div className="dialog-copy-stack">
            <Text type="display-3" as="h2" display="block">
              编辑记录名称
            </Text>
            <Text type="body" color="secondary" display="block">
              记录名称最多支持 {MAX_CONVERSATION_TITLE_LENGTH} 个字符。
            </Text>
          </div>
          <TextInput
            label="记录名称"
            value={editTitleDraft}
            onChange={(value) => setEditTitleDraft(value.slice(0, MAX_CONVERSATION_TITLE_LENGTH))}
            width="100%"
          />
          <HStack hAlign="end" gap={2}>
            <Button label="取消" variant="secondary" onClick={closeEditConversation} />
            <Button label="保存" variant="primary" onClick={saveConversationTitle} />
          </HStack>
        </VStack>
      </Dialog>

      <Dialog isOpen={deletingConversation !== null} onOpenChange={(open) => !open && closeDeleteConversation()} width={420} purpose="info" padding={5}>
        <VStack gap={4} hAlign="stretch">
          <div className="dialog-copy-stack">
            <Text type="display-3" as="h2" display="block">
              请确认是否删除
            </Text>
            <Text type="body" color="secondary" display="block">
              删除后对话数据将无法恢复
            </Text>
          </div>
          <HStack hAlign="end" gap={2}>
            <Button label="取消" variant="secondary" onClick={closeDeleteConversation} />
            <Button label="确认" variant="destructive" onClick={confirmDeleteConversation} />
          </HStack>
        </VStack>
      </Dialog>
    </section>
  );
}
