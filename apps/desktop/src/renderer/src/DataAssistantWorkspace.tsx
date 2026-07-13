import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatTokenizedText,
  ChatToolCalls,
  type ChatToolCallItem,
} from "@astryxdesign/core/Chat";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DropdownMenu, type DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { Card, HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Markdown, type MarkdownComponents } from "@astryxdesign/core/Markdown";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { Section } from "@astryxdesign/core/Section";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { ChevronRight, CircleAlert, Clock, Copy, FileText, LoaderCircle, Maximize2, Minimize2, Pencil, Plus, RotateCcw, Sparkles, Trash2, X, type LucideIcon } from "lucide-react";
import type { AuthFailure, AuthUser } from "./auth";
import { useAppToast } from "./useAppToast";
import { workbenchApi, type ApiResult, type DataSourceSummary } from "./workbenchApi";
import { VisualizationRenderer } from "./components/VisualizationRenderer";
import { parseVisualizationSpecJson } from "../../shared/visualization";
import approveIcon from "./assets/approve.svg";
import attachIcon from "./assets/attach.svg";
import mentionIcon from "./assets/mention.svg";
import type {
  AssistantApprovalMode,
  AssistantBlock,
  AssistantConversation,
  AssistantMessage,
  AssistantMessageStatus,
  AssistantSkill,
  AssistantStreamEvent,
} from "../../main/assistantRuntime";
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
  { label: "通用数据分析", value: "general_analysis" },
  { label: "Schema 浏览", value: "schema_explorer" },
];

const ARTIFACT_WINDOW_STATE_KEY = "cycle-probe:assistant:artifact-window";
const ARTIFACT_PANEL_WIDTH_KEY = "cycle-probe:assistant:artifact-panel-width";
const SKILL_TOKEN_PREFIX = "[skill:";
const MAX_CONVERSATION_TITLE_LENGTH = 200;

type ArtifactWindowState = {
  messageId: string | null;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
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
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

function skillTokenValue(skill: AssistantSkill) {
  return `${SKILL_TOKEN_PREFIX}${skill}]`;
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
      isMinimized: parsed?.isMinimized === true,
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

function isAssistantArtifactMessage(message: AssistantMessage) {
  return (
    message.role === "assistant" &&
    message.content.trim().length > 0 &&
    message.blocks.some((block) => block.type === "markdown" && !isRenderableCodeLanguage(block.language)) &&
    !message.blocks.some((block) => block.toolCallId || block.type === "visualization")
  );
}

function dataSourceButtonLabel(dataSource?: DataSourceSummary) {
  if (!dataSource) {
    return "数据源";
  }
  return dataSource.type === "csv" ? dataSource.name : dataSource.database;
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

function ArtifactSummaryCard({
  title,
  generatedAt,
  onOpen,
}: {
  title: string;
  generatedAt: string;
  onOpen: () => void;
}) {
  return (
    <ClickableCard
      label={`打开 ${title}`}
      onClick={onOpen}
      variant="muted"
      padding={3}
      maxWidth={360}
      className="assistant-artifact-summary-card"
    >
      <HStack gap={3} vAlign="center" width="100%">
        <Icon icon={FileText} size="md" color="secondary" />
        <StackItem size="fill">
          <VStack gap={0}>
            <Text type="label" weight="semibold">
              {title}
            </Text>
            <Text type="supporting" color="secondary">
              Markdown · {generatedAt}
            </Text>
          </VStack>
        </StackItem>
        <Icon icon={ChevronRight} size="sm" color="secondary" />
      </HStack>
    </ClickableCard>
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
  const [activeConversationId, setActiveConversationId] = useState("");
  const [composerValue, setComposerValue] = useState("");
  const [dataSources, setDataSources] = useState<DataSourceSummary[]>([]);
  const [selectedDataSourceId, setSelectedDataSourceId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<AssistantSkill | null>(null);
  const [approvalMode, setApprovalMode] = useState<AssistantApprovalMode>("request_approval");
  const [isLoadingDataSources, setIsLoadingDataSources] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [metadataNow, setMetadataNow] = useState(() => Date.now());
  const [editingConversation, setEditingConversation] = useState<AssistantConversation | null>(null);
  const [editTitleDraft, setEditTitleDraft] = useState("");
  const [deletingConversation, setDeletingConversation] = useState<AssistantConversation | null>(null);
  const [artifactWindow, setArtifactWindow] = useState<ArtifactWindowState>(() => readArtifactWindowState());
  const artifactResize = useResizable({
    defaultSize: 440,
    minSizePx: 320,
    maxSizePx: 860,
    autoSaveId: ARTIFACT_PANEL_WIDTH_KEY,
  });

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations],
  );

  const activeMessages = activeConversation ? messagesByConversation[activeConversation.id] ?? [] : [];
  const activePendingPythonToolCallId = useMemo(() => pendingPythonToolCallId(activeMessages), [activeMessages]);
  const landingUserName = user?.displayName?.trim() || user?.username || "Yuzili";
  const activeArtifactMessage = useMemo(
    () =>
      artifactWindow.isOpen && artifactWindow.messageId
        ? activeMessages.find((message) => message.id === artifactWindow.messageId && isAssistantArtifactMessage(message)) ?? null
        : null,
    [activeMessages, artifactWindow.isOpen, artifactWindow.messageId],
  );
  const isStreaming = activeMessages.some((message) => message.role === "assistant" && (message.status === "receiving" || message.status === "processing"));
  const activeStreamingMessageId = activeMessages.find((message) => message.role === "assistant" && (message.status === "receiving" || message.status === "processing"))?.id;

  const connectedDataSources = useMemo(
    () => dataSources.filter((dataSource) => dataSource.status === "online"),
    [dataSources],
  );

  const selectedDataSource = useMemo(
    () => connectedDataSources.find((dataSource) => dataSource.id === selectedDataSourceId),
    [connectedDataSources, selectedDataSourceId],
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
        upsertMessage(event.conversationId, event.message);
        return;
      }
      if (event.type === "message-delta") {
        setMessagesByConversation((current) => {
          const messages = current[event.conversationId] ?? [];
          return {
            ...current,
            [event.conversationId]: messages.map((message) =>
              message.id === event.messageId
                ? { ...message, content: event.content, blocks: event.blocks, status: event.status, updatedAt: new Date().toISOString() }
                : message,
            ),
          };
        });
        return;
      }
      if (event.type === "tool") {
        upsertMessage(event.conversationId, event.message);
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

    return () => dispose?.();
  }, [toast, upsertMessage]);

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
    if (!isStreaming) {
      return undefined;
    }
    const timer = window.setInterval(() => setMetadataNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

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
  }, []);

  const closeArtifact = useCallback(() => {
    setArtifactWindow((current) => ({ ...current, isOpen: false, messageId: null }));
  }, []);

  const toggleArtifactMinimized = useCallback(() => {
    setArtifactWindow((current) => ({ ...current, isMinimized: !current.isMinimized, isMaximized: false }));
  }, []);

  const toggleArtifactMaximized = useCallback(() => {
    setArtifactWindow((current) => ({ ...current, isMaximized: !current.isMaximized, isMinimized: false }));
  }, []);

  const copyArtifact = useCallback(
    async (message: AssistantMessage) => {
      try {
        await navigator.clipboard.writeText(message.content);
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
    [toast],
  );

  const loadSchemaContextMarkdown = useCallback(
    async (conversationId: string, question: string) => {
      if (!selectedDataSource) {
        return null;
      }
      const result = await requestWithRefresh((token) =>
        workbenchApi.schemaContext(token, {
          conversationId,
          question,
          dataSourceId: selectedDataSource.id,
          purpose: "data_exploration",
          maxChars: 16_000,
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
    [requestWithRefresh, selectedDataSource, toast],
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
          schemaContextMarkdown,
          skill: selectedSkill,
          approvalMode,
        });
        setConversations((current) => mergeConversation(current, result.conversation));
        upsertMessage(result.conversation.id, result.assistantMessage);
        setActiveConversationId(result.conversation.id);
      } catch (error) {
        toast({
          type: "error",
          body: error instanceof Error ? error.message : "失败重发未成功。",
          uniqueID: `assistant-retry-error-${message.id}`,
          collisionBehavior: "overwrite",
        });
      }
    },
    [approvalMode, loadSchemaContextMarkdown, modelName, selectedDataSource, selectedSkill, toast, upsertMessage, user?.id],
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
          const context = await window.lifecycleX.assistant.getWorkflowContext(user.id, activeConversation.id);
          setWorkflowContextByConversation((current) => ({ ...current, [activeConversation.id]: context }));
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

  const handleSubmit = useCallback(
    async (value: string) => {
      const prompt = value.trim();
      if (!prompt || isStreaming || !user?.id) {
        return;
      }
      if (activePendingPythonToolCallId && isPythonApprovalPrompt(prompt)) {
        setComposerValue("");
        await approvePendingPython(true);
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
        const conversation =
          activeConversation ?? await window.lifecycleX.assistant.createConversation(user.id, prompt.slice(0, 18) || "新对话");
        setConversations((current) => mergeConversation(current, conversation));
        setMessagesByConversation((current) => ({ ...current, [conversation.id]: current[conversation.id] ?? [] }));
        const conversationId = conversation.id;
        optimisticConversationId = conversationId;
        const optimisticContext: AssistantMessage["context"] = {
          dataSourceLabel: selectedDataSource ? dataSourceLabel(selectedDataSource) : null,
          skill: selectedSkill,
        };
        const optimisticUserMessage = createOptimisticUserMessage(user.id, conversationId, prompt, optimisticContext);
        optimisticMessageId = optimisticUserMessage.id;
        upsertMessage(conversationId, optimisticUserMessage);
        setActiveConversationId(conversationId);
        setComposerValue("");
        const schemaContextMarkdown = await loadSchemaContextMarkdown(conversationId, prompt);
        const result = await window.lifecycleX.assistant.sendMessage({
          userId: user.id,
          conversationId,
          clientRequestId: createClientRequestId(),
          prompt,
          modelName,
          dataSourceId: selectedDataSource?.id ?? null,
          dataSourceLabel: selectedDataSource ? dataSourceLabel(selectedDataSource) : null,
          schemaContextMarkdown,
          skill: selectedSkill,
          approvalMode,
        });
        setConversations((current) => mergeConversation(current, result.conversation));
        removeMessage(conversationId, optimisticUserMessage.id);
        upsertMessage(result.conversation.id, result.userMessage);
        upsertMessage(result.conversation.id, result.assistantMessage);
        setActiveConversationId(result.conversation.id);
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
      activePendingPythonToolCallId,
      approvalMode,
      approvePendingPython,
      isModelConfigured,
      isStreaming,
      loadSchemaContextMarkdown,
      modelName,
      onRequireModelConfig,
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

  const dataSourceMenuItems = useMemo<DropdownMenuOption[]>(
    () =>
      connectedDataSources.length > 0
        ? connectedDataSources.map((dataSource) => ({
          label: `${selectedDataSourceId === dataSource.id ? "✓ " : ""}${dataSourceLabel(dataSource)}`,
          onClick: () =>
            setSelectedDataSourceId((current) => (current === dataSource.id ? null : dataSource.id)),
        }))
        : [{ label: canReadDataSources ? "暂无已连通数据源" : "无数据源权限", isDisabled: true }],
    [canReadDataSources, connectedDataSources, selectedDataSourceId],
  );

  const skillMenuItems = useMemo<DropdownMenuOption[]>(
    () =>
      skillOptions.map((skill) => ({
        label: `${selectedSkill === skill.value ? "✓ " : ""}${skill.label}`,
        onClick: () => setSelectedSkill((current) => (current === skill.value ? null : skill.value)),
      })),
    [selectedSkill],
  );

  const approvalMenuItems = useMemo<DropdownMenuOption[]>(
    () =>
      approvalOptions.map((approval) => ({
        label: `${approvalMode === approval.value ? "✓ " : ""}${approval.label}`,
        onClick: () => setApprovalMode(approval.value),
      })),
    [approvalMode],
  );

  const renderUserContext = (message: AssistantMessage) => {
    const dataSource = message.context?.dataSourceLabel;
    if (!dataSource) {
      return null;
    }

    return (
      <HStack gap={1} wrap="wrap" className="assistant-user-context-tokens">
        <Token label={dataSource} color="blue" size="sm" />
      </HStack>
    );
  };

  const renderUserMessageBody = (message: AssistantMessage) => {
    const skill = message.context?.skill;
    if (!skill) {
      return <p>{message.content}</p>;
    }

    const value = skillTokenValue(skill);
    return (
      <ChatTokenizedText tokens={[{ value, label: skillLabel(skill), variant: "purple" }]}>
        {`${value} ${message.content}`}
      </ChatTokenizedText>
    );
  };

  const renderArtifactCard = (message: AssistantMessage) => {
    return (
      <ArtifactSummaryCard
        title={artifactTitle(message)}
        generatedAt={formatArtifactGeneratedAt(message.createdAt)}
        onOpen={() => openArtifact(message)}
      />
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
                    void window.lifecycleX.assistant.getWorkflowContext(user.id, conversation.id).then((context) => {
                      setWorkflowContextByConversation((current) => ({ ...current, [conversation.id]: context }));
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
              <div className="assistant-composer-shell">
                <ChatComposer
                  value={composerValue}
                  onChange={setComposerValue}
                  onSubmit={handleSubmit}
                  onStop={stopStreaming}
                  isStopShown={isStreaming}
                  placeholder="问问数据助手"
                  density="compact"
                  footerActions={
                    <div className="assistant-composer-actions" aria-label="数据助手工具栏">
                      <DropdownMenu
                        hasChevron={false}
                        placement="above"
                        menuWidth={240}
                        button={{
                          label: dataSourceButtonLabel(selectedDataSource),
                          variant: "ghost",
                          size: "sm",
                          className: "assistant-composer-action-button",
                          icon: <AssistantActionIcon src={attachIcon} />,
                          tooltip: "数据库",
                          isLoading: isLoadingDataSources,
                        }}
                        items={dataSourceMenuItems}
                      />
                      <DropdownMenu
                        hasChevron={false}
                        placement="above"
                        menuWidth={190}
                        button={{
                          label: skillOptions.find((item) => item.value === selectedSkill)?.label ?? "Skill",
                          variant: "ghost",
                          size: "sm",
                          className: "assistant-composer-action-button",
                          icon: <AssistantActionIcon src={mentionIcon} />,
                          tooltip: "Skill",
                        }}
                        items={skillMenuItems}
                      />
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
                  const isArtifactMessage = isAssistantArtifactMessage(message);
                  const toolCalls = sender === "assistant" ? toolCallsFromMessage(message) : [];
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
                      {sender === "user" && renderUserContext(message)}
                      <ChatMessageBubble
                        variant={sender === "assistant" ? "ghost" : "filled"}
                        metadata={renderMessageMetadata(message)}
                      >
                        {sender === "user" ? (
                          renderUserMessageBody(message)
                        ) : isArtifactMessage ? (
                          renderArtifactCard(message)
                        ) : message.blocks.length > 0 ? (
                          <div className="assistant-message-blocks">
                            {message.blocks.map((block) => renderBlock(block, message.role, message.status))}
                          </div>
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
            <ResizeHandle
              direction="horizontal"
              resizable={artifactResize.props}
              isReversed
              pillPlacement="start"
              hasDivider
              label="调整文档窗口宽度"
              className="assistant-artifact-resize-handle"
            />
            <Card
              variant="transparent"
              height="100%"
              className={`assistant-artifact-panel ${artifactWindow.isMinimized ? "minimized" : ""} ${artifactWindow.isMaximized ? "maximized" : ""}`}
              style={{
                width: artifactWindow.isMaximized ? "min(920px, 72vw)" : `${artifactResize.size}px`,
              }}
            >
              <Toolbar
                label="文档窗口操作"
                size="sm"
                dividers={["bottom"]}
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
                  </HStack>
                }
                endContent={
                  <HStack gap={1} vAlign="center">
                    <Button
                      label="复制内容"
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      icon={<Icon icon={Copy} size="sm" color="inherit" />}
                      onClick={() => void copyArtifact(activeArtifactMessage)}
                    />
                    <Button
                      label={artifactWindow.isMinimized ? "还原窗口" : "最小化窗口"}
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      icon={<Icon icon={Minimize2} size="sm" color="inherit" />}
                      onClick={toggleArtifactMinimized}
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
              {!artifactWindow.isMinimized && (
                <Section variant="transparent" className="assistant-artifact-body">
                  <Markdown
                    density="compact"
                    headingLevelStart={1}
                    contentWidth="100%"
                    autolink="gfm"
                    components={markdownComponents}
                    className="assistant-artifact-markdown"
                  >
                    {activeArtifactMessage.content}
                  </Markdown>
                </Section>
              )}
            </Card>
          </>
        )}
      </div>

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
