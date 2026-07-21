import type { VisualizationStreamEvent } from "../../shared/visualization";

export type ModelStreamEventType =
  | "stream-start"
  | "text-delta"
  | "markdown-delta"
  | "visualization_start"
  | "visualization_delta"
  | "visualization_complete"
  | "visualization_error"
  | "markdown-block-start"
  | "markdown-block-delta"
  | "markdown-block-end"
  | "tool-call-start"
  | "tool-call-delta"
  | "tool-call-end"
  | "tool-execution-start"
  | "tool-execution-result"
  | "tool-execution-error"
  | "model-observation"
  | "version-created"
  | "version-updated"
  | "stream-end"
  | "stream-error";

export type MarkdownBlockType =
  | "paragraph"
  | "heading"
  | "blockquote"
  | "unordered_list"
  | "ordered_list"
  | "code_block"
  | "visualization"
  | "mermaid"
  | "math_block"
  | "table"
  | "horizontal_rule"
  | "unknown";

export type ModelAdapterErrorCode =
  | "PROVIDER_REQUEST_FAILED"
  | "PROVIDER_STREAM_PARSE_FAILED"
  | "PROVIDER_TIMEOUT"
  | "USER_ABORTED"
  | "TOOL_NOT_FOUND"
  | "TOOL_INPUT_INVALID"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_EXECUTION_TIMEOUT"
  | "MARKDOWN_PARSE_FAILED"
  | "VERSION_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "UNKNOWN_ERROR";

export type ModelStreamEvent<TPayload = Record<string, unknown>> = {
  eventId: string;
  type: ModelStreamEventType;
  conversationId: string;
  messageId: string;
  createdAt: string;
  payload: TPayload;
  traceId?: string;
  parentEventId?: string;
  provider?: string;
  model?: string;
  versionId?: string;
  toolCallId?: string;
  blockId?: string;
};

export type ModelVisualizationStreamEvent = VisualizationStreamEvent;

export type ConversationMessage = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    argumentsText: string;
  }>;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  description?: string;
};

export type ToolExecutionMode = "serial" | "parallel";

export type ToolExecutionContext = {
  conversationId: string;
  messageId: string;
  toolCallId: string;
  traceId: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  riskLevel?: "low" | "medium" | "high";
  timeoutMs?: number;
  handler: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>;
};

export type ToolCallDelta = {
  toolCallId: string;
  index: number;
  name?: string;
  argumentsDelta?: string;
};

export type AggregatedToolCall = {
  toolCallId: string;
  index: number;
  name: string;
  argumentsText: string;
  input?: unknown;
};

export type ToolExecutionResult = {
  toolCallId: string;
  toolName: string;
  success: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  output?: unknown;
  error?: SerializedModelAdapterError;
};

export type ContentVersion = {
  versionId: string;
  conversationId: string;
  messageId: string;
  parentVersionId?: string;
  title?: string;
  contentType: "markdown" | "text";
  content: string;
  status: "draft" | "selected" | "archived";
  createdAt: string;
  updatedAt: string;
  createdByPrompt?: string;
  metadata?: Record<string, unknown>;
};

export type VersionDiffLine = {
  type: "added" | "removed" | "unchanged";
  line: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

export type SerializedModelAdapterError = {
  code: ModelAdapterErrorCode;
  message: string;
  cause?: string;
};

export type StreamChatInput = {
  conversationId: string;
  messageId: string;
  messages: ConversationMessage[];
  model?: string;
  systemPrompt?: string;
  traceId?: string;
  contentType?: "text" | "markdown";
  toolExecutionMode?: ToolExecutionMode;
  maxToolRounds?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
};

export type StreamingModelAdapterConfig = {
  provider?: "openai-compatible";
  providerName?: string;
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  toolExecutionMode?: ToolExecutionMode;
  maxToolRounds?: number;
};

export type CreateVersionInput = Omit<ContentVersion, "versionId" | "createdAt" | "updatedAt" | "status"> & {
  versionId?: string;
  status?: ContentVersion["status"];
};

export type UpdateVersionInput = {
  versionId: string;
  content?: string;
  title?: string;
  status?: ContentVersion["status"];
  metadata?: Record<string, unknown>;
};
