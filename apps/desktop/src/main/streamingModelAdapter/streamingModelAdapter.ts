import { ModelAdapterError, toModelAdapterError } from "./errors";
import { StreamingMarkdownParser } from "./markdownStreamParser";
import { OpenAICompatibleProvider, type ProviderStreamEvent } from "./openAICompatibleProvider";
import { aggregateToolCallDelta, ToolRegistry } from "./toolRegistry";
import type {
  AggregatedToolCall,
  ContentVersion,
  ConversationMessage,
  CreateVersionInput,
  ModelStreamEvent,
  StreamingModelAdapterConfig,
  StreamChatInput,
  ToolDefinition,
  ToolExecutionResult,
  UpdateVersionInput,
  VersionDiffLine,
} from "./types";
import { createId, nowIso } from "./utils";
import { InMemoryVersionManager } from "./versionManager";

export class StreamingModelAdapter {
  private readonly provider: OpenAICompatibleProvider;
  private readonly toolRegistry = new ToolRegistry();
  private readonly versionManager = new InMemoryVersionManager();
  private readonly config: StreamingModelAdapterConfig;

  constructor(config: StreamingModelAdapterConfig) {
    this.config = config;
    this.provider = new OpenAICompatibleProvider(config);
  }

  registerTool(tool: ToolDefinition) {
    this.toolRegistry.registerTool(tool);
  }

  unregisterTool(toolName: string) {
    this.toolRegistry.unregisterTool(toolName);
  }

  getTools() {
    return this.toolRegistry.getTools();
  }

  async *streamChat(input: StreamChatInput): AsyncGenerator<ModelStreamEvent> {
    const traceId = input.traceId ?? createId("trace");
    const parser = new StreamingMarkdownParser();
    let content = "";
    const versionState: { version: ContentVersion | null } = { version: null };

    yield this.event(input, "stream-start", { contentType: input.contentType ?? "markdown" }, traceId);

    try {
      const firstRound = this.streamProviderRound({
        input,
        traceId,
        messages: buildMessages(input),
        allowTools: true,
        parser,
        onContent: (delta) => {
          content += delta;
        },
        versionState,
      });
      const firstRoundToolCalls = yield* firstRound;

      if (firstRoundToolCalls.length > 0) {
        const mode = input.toolExecutionMode ?? this.config.toolExecutionMode ?? "serial";
        for (const toolCall of firstRoundToolCalls) {
          yield this.event(input, "tool-execution-start", { toolName: toolCall.name, mode }, traceId, { toolCallId: toolCall.toolCallId });
        }
        const toolResults = await this.executeTools(input, traceId, firstRoundToolCalls);
        for (const toolResult of toolResults) {
          yield this.toolResultEvent(input, toolResult, traceId);
        }

        const continuationMessages = [
          ...buildMessages(input),
          ...toolResults.map((result): ConversationMessage => ({
            id: createId("msg"),
            role: "tool",
            content: JSON.stringify(result.success ? result.output : result.error),
            toolCallId: result.toolCallId,
            toolName: result.toolName,
            createdAt: nowIso(),
          })),
        ];
        const secondRound = this.streamProviderRound({
          input,
          traceId,
          messages: continuationMessages,
          allowTools: false,
          parser,
          onContent: (delta) => {
            content += delta;
          },
          versionState,
        });
        yield* secondRound;
      }

      const flushEvents = parser.flush();
      for (const parserEvent of flushEvents) {
        yield this.markdownParserEvent(input, parserEvent, traceId);
      }

      yield this.event(input, "stream-end", { contentLength: content.length }, traceId);
    } catch (error) {
      const adapterError = toModelAdapterError("UNKNOWN_ERROR", "模型流式调用失败。", error);
      yield this.event(input, "stream-error", { error: adapterError.serialize() }, traceId);
      if (adapterError.code === "USER_ABORTED") {
        yield this.event(input, "stream-end", { aborted: true }, traceId);
      }
    }
  }

  createVersion(input: CreateVersionInput) {
    return this.versionManager.createVersion(input);
  }

  updateVersion(input: UpdateVersionInput) {
    return this.versionManager.updateVersion(input);
  }

  listVersions(conversationId: string) {
    return this.versionManager.listVersions(conversationId);
  }

  getVersion(versionId: string): ContentVersion {
    return this.versionManager.getVersion(versionId);
  }

  setCurrentVersion(versionId: string) {
    return this.versionManager.setCurrentVersion(versionId);
  }

  setSelectedVersion(versionId: string) {
    return this.versionManager.setSelectedVersion(versionId);
  }

  compareVersions(versionAId: string, versionBId: string): VersionDiffLine[] {
    return this.versionManager.compareVersions(versionAId, versionBId);
  }

  private async *streamProviderRound({
    input,
    traceId,
    messages,
    allowTools,
    parser,
    onContent,
    versionState,
  }: {
    input: StreamChatInput;
    traceId: string;
    messages: ConversationMessage[];
    allowTools: boolean;
    parser: StreamingMarkdownParser;
    onContent: (delta: string) => void;
    versionState: { version: ContentVersion | null };
  }): AsyncGenerator<ModelStreamEvent, AggregatedToolCall[]> {
    const toolCalls = new Map<string, AggregatedToolCall>();
    const endedToolCalls = new Set<string>();
    const startedToolCalls = new Set<string>();

    for await (const providerEvent of this.provider.streamChat({
      conversationId: input.conversationId,
      messageId: input.messageId,
      messages,
      model: input.model,
      tools: allowTools ? this.toolRegistry.getTools() : undefined,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
    })) {
      if (providerEvent.type === "content-delta") {
        onContent(providerEvent.delta);
        yield this.event(input, input.contentType === "text" ? "text-delta" : "markdown-delta", { delta: providerEvent.delta }, traceId);
        yield this.versionDeltaEvent(input, providerEvent.delta, traceId, versionState);
        for (const parserEvent of parser.push(providerEvent.delta)) {
          yield this.markdownParserEvent(input, parserEvent, traceId);
        }
      } else if (providerEvent.type === "tool-call-delta") {
        const toolCall = aggregateToolCallDelta(toolCalls, providerEvent.delta);
        const isFirstDelta = !startedToolCalls.has(toolCall.toolCallId);
        startedToolCalls.add(toolCall.toolCallId);
        yield this.toolCallEvent(input, providerEvent, toolCall, traceId, isFirstDelta);
      } else if (providerEvent.type === "tool-call-end") {
        endedToolCalls.add(providerEvent.toolCallId);
        const toolCall = toolCalls.get(providerEvent.toolCallId);
        yield this.event(
          input,
          "tool-call-end",
          { index: providerEvent.index, toolName: toolCall?.name, argumentsText: toolCall?.argumentsText ?? "" },
          traceId,
          { toolCallId: providerEvent.toolCallId },
        );
      }
    }

    for (const toolCall of toolCalls.values()) {
      if (!endedToolCalls.has(toolCall.toolCallId)) {
        yield this.event(input, "tool-call-end", { index: toolCall.index, toolName: toolCall.name, argumentsText: toolCall.argumentsText }, traceId, { toolCallId: toolCall.toolCallId });
      }
    }

    return Array.from(toolCalls.values()).filter((toolCall) => toolCall.name);
  }

  private async executeTools(input: StreamChatInput, traceId: string, toolCalls: AggregatedToolCall[]) {
    const mode = input.toolExecutionMode ?? this.config.toolExecutionMode ?? "serial";
    return this.toolRegistry.executeToolCalls(toolCalls, mode, {
      conversationId: input.conversationId,
      messageId: input.messageId,
      traceId,
      signal: input.signal,
      metadata: input.metadata,
    });
  }

  private toolResultEvent(input: StreamChatInput, result: ToolExecutionResult, traceId: string) {
    return this.event(
      input,
      result.success ? "tool-execution-result" : "tool-execution-error",
      result.success ? { result } : { result, error: result.error ?? new ModelAdapterError("TOOL_EXECUTION_FAILED", "工具执行失败。").serialize() },
      traceId,
      { toolCallId: result.toolCallId },
    );
  }

  private versionDeltaEvent(input: StreamChatInput, delta: string, traceId: string, versionState: { version: ContentVersion | null }) {
    if (!delta) {
      return this.event(input, "version-updated", { skipped: true }, traceId);
    }
    if (!versionState.version) {
      const version = this.versionManager.createVersion({
        conversationId: input.conversationId,
        messageId: input.messageId,
        contentType: input.contentType ?? "markdown",
        content: delta,
        title: extractContentTitle(delta),
        createdByPrompt: latestUserPrompt(input.messages),
        metadata: { traceId, provider: this.provider.providerName, model: input.model ?? this.config.model },
      });
      versionState.version = version;
      return this.event(input, "version-created", { version }, traceId, { versionId: version.versionId });
    }
    const version = this.versionManager.updateVersion({
      versionId: versionState.version.versionId,
      content: `${versionState.version.content}${delta}`,
      title: versionState.version.title ?? extractContentTitle(`${versionState.version.content}${delta}`),
    });
    versionState.version = version;
    return this.event(input, "version-updated", { version }, traceId, { versionId: version.versionId });
  }

  private toolCallEvent(input: StreamChatInput, providerEvent: ProviderStreamEvent, toolCall: AggregatedToolCall, traceId: string, isFirstDelta: boolean) {
    if (providerEvent.type !== "tool-call-delta") {
      throw new ModelAdapterError("UNKNOWN_ERROR", "非法工具事件。");
    }
    return this.event(
      input,
      isFirstDelta ? "tool-call-start" : "tool-call-delta",
      { index: toolCall.index, toolName: toolCall.name, argumentsDelta: providerEvent.delta.argumentsDelta ?? "", argumentsText: toolCall.argumentsText },
      traceId,
      { toolCallId: toolCall.toolCallId },
    );
  }

  private markdownParserEvent(input: StreamChatInput, parserEvent: ReturnType<StreamingMarkdownParser["flush"]>[number], traceId: string) {
    const type =
      parserEvent.type === "start" ? "markdown-block-start" : parserEvent.type === "delta" ? "markdown-block-delta" : "markdown-block-end";
    return this.event(input, type, { block: parserEvent.block, delta: "delta" in parserEvent ? parserEvent.delta : undefined }, traceId, {
      blockId: parserEvent.block.blockId,
    });
  }

  private event(
    input: StreamChatInput,
    type: ModelStreamEvent["type"],
    payload: Record<string, unknown>,
    traceId: string,
    extra: Partial<Pick<ModelStreamEvent, "versionId" | "toolCallId" | "blockId">> = {},
  ): ModelStreamEvent {
    return {
      eventId: createId("evt"),
      type,
      conversationId: input.conversationId,
      messageId: input.messageId,
      createdAt: nowIso(),
      payload,
      traceId,
      provider: this.provider.providerName,
      model: input.model ?? this.config.model,
      ...extra,
    };
  }
}

export function createStreamingModelAdapter(config: StreamingModelAdapterConfig) {
  return new StreamingModelAdapter(config);
}

function buildMessages(input: StreamChatInput): ConversationMessage[] {
  const messages = [...input.messages];
  if (input.systemPrompt) {
    messages.unshift({
      id: createId("msg"),
      role: "system",
      content: input.systemPrompt,
      createdAt: nowIso(),
    });
  }
  return messages;
}

function latestUserPrompt(messages: ConversationMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content;
}

function extractContentTitle(content: string) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? content.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 48);
}
