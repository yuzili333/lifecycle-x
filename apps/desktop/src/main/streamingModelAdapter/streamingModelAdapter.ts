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
import { parseVisualizationSpecJson } from "../../shared/visualization";

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
      const conversationMessages = buildMessages(input);
      const maxToolRounds = input.maxToolRounds ?? this.config.maxToolRounds ?? 4;
      let toolRound = 0;

      while (true) {
        const allowTools = toolRound < maxToolRounds;
        const round = this.streamProviderRound({
          input,
          traceId,
          messages: conversationMessages,
          allowTools,
          roundIndex: toolRound + 1,
          parser,
          onContent: (delta) => {
            content += delta;
          },
          versionState,
        });
        const toolCalls = yield* round;
        if (toolCalls.length === 0) {
          break;
        }

        toolRound += 1;
        const mode = input.toolExecutionMode ?? this.config.toolExecutionMode ?? "serial";
        for (const toolCall of toolCalls) {
          yield this.event(input, "tool-execution-start", { toolName: toolCall.name, mode, toolRound }, traceId, { toolCallId: toolCall.toolCallId });
        }
        const toolResults = await this.executeTools(input, traceId, toolCalls);
        for (const toolResult of toolResults) {
          yield this.toolResultEvent(input, toolResult, traceId);
        }

        if (input.stopAfterToolExecution) {
          break;
        }

        conversationMessages.push(toolCallsAssistantMessage(input, toolCalls));
        conversationMessages.push(...toolResults.map(toolResultMessage));

        if (toolRound >= maxToolRounds) {
          const finalRound = this.streamProviderRound({
            input,
            traceId,
            messages: conversationMessages,
            allowTools: false,
            roundIndex: toolRound + 1,
            parser,
            onContent: (delta) => {
              content += delta;
            },
            versionState,
          });
          yield* finalRound;
          break;
        }
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
    roundIndex,
    parser,
    onContent,
    versionState,
  }: {
    input: StreamChatInput;
    traceId: string;
    messages: ConversationMessage[];
    allowTools: boolean;
    roundIndex: number;
    parser: StreamingMarkdownParser;
    onContent: (delta: string) => void;
    versionState: { version: ContentVersion | null };
  }): AsyncGenerator<ModelStreamEvent, AggregatedToolCall[]> {
    const toolCalls = new Map<string, AggregatedToolCall>();
    const endedToolCalls = new Set<string>();
    const startedToolCalls = new Set<string>();
    const tools = allowTools ? this.toolRegistry.getTools() : undefined;
    const requestSummary = summarizeModelRequest(messages, tools);
    const requestedAtMs = Date.now();
    let firstModelEventMs: number | null = null;
    let firstTokenMs: number | null = null;
    let firstContentTokenMs: number | null = null;
    let firstToolCallMs: number | null = null;
    let contentDeltaChars = 0;
    let finishReason: string | undefined;

    yield this.modelObservationEvent(input, traceId, "provider-round-start", "info", "模型请求开始。", {
      roundIndex,
      allowTools,
      model: input.model ?? this.config.model,
      timeoutMs: input.timeoutMs ?? this.config.timeoutMs,
      ...requestSummary,
    });

    try {
      for await (const providerEvent of this.provider.streamChat({
        conversationId: input.conversationId,
        messageId: input.messageId,
        messages,
        model: input.model,
        tools,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
      })) {
        firstModelEventMs ??= Date.now() - requestedAtMs;
        if (providerEvent.type === "content-delta") {
          firstTokenMs ??= Date.now() - requestedAtMs;
          firstContentTokenMs ??= Date.now() - requestedAtMs;
          contentDeltaChars += providerEvent.delta.length;
          onContent(providerEvent.delta);
          yield this.event(input, input.contentType === "text" ? "text-delta" : "markdown-delta", { delta: providerEvent.delta }, traceId);
          yield this.versionDeltaEvent(input, providerEvent.delta, traceId, versionState);
          for (const parserEvent of parser.push(providerEvent.delta)) {
            yield this.markdownParserEvent(input, parserEvent, traceId);
          }
        } else if (providerEvent.type === "tool-call-delta") {
          firstTokenMs ??= Date.now() - requestedAtMs;
          firstToolCallMs ??= Date.now() - requestedAtMs;
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
        } else if (providerEvent.type === "end") {
          finishReason = providerEvent.finishReason;
        }
      }
    } catch (error) {
      const adapterError = toModelAdapterError("UNKNOWN_ERROR", "模型流式调用失败。", error);
      yield this.modelObservationEvent(input, traceId, "provider-round-error", "error", "模型请求异常。", {
        roundIndex,
        allowTools,
        ...requestSummary,
        durationMs: Date.now() - requestedAtMs,
        firstModelEventMs,
        firstTokenMs,
        firstContentTokenMs,
        firstToolCallMs,
        returnedToolCalls: toolCalls.size > 0,
        toolCallCount: toolCalls.size,
        toolCallNames: Array.from(toolCalls.values()).map((toolCall) => toolCall.name).filter(Boolean),
        contentDeltaChars,
        finishReason: finishReason ?? "error",
        error: adapterError.serialize(),
      });
      throw error;
    }

    for (const toolCall of toolCalls.values()) {
      if (!endedToolCalls.has(toolCall.toolCallId)) {
        yield this.event(input, "tool-call-end", { index: toolCall.index, toolName: toolCall.name, argumentsText: toolCall.argumentsText }, traceId, { toolCallId: toolCall.toolCallId });
      }
    }

    yield this.modelObservationEvent(input, traceId, "provider-round-complete", "success", "模型请求完成。", {
      roundIndex,
      allowTools,
      ...requestSummary,
      durationMs: Date.now() - requestedAtMs,
      firstModelEventMs,
      firstTokenMs,
      firstContentTokenMs,
      firstToolCallMs,
      returnedToolCalls: toolCalls.size > 0,
      toolCallCount: toolCalls.size,
      toolCallNames: Array.from(toolCalls.values()).map((toolCall) => toolCall.name).filter(Boolean),
      contentDeltaChars,
      finishReason: finishReason ?? "unknown",
    });

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
    if (parserEvent.block.type === "visualization") {
      return this.visualizationParserEvent(input, parserEvent, traceId);
    }
    const type =
      parserEvent.type === "start" ? "markdown-block-start" : parserEvent.type === "delta" ? "markdown-block-delta" : "markdown-block-end";
    return this.event(input, type, { block: parserEvent.block, delta: "delta" in parserEvent ? parserEvent.delta : undefined }, traceId, {
      blockId: parserEvent.block.blockId,
    });
  }

  private visualizationParserEvent(input: StreamChatInput, parserEvent: ReturnType<StreamingMarkdownParser["flush"]>[number], traceId: string) {
    const visualizationId = parserEvent.block.blockId;
    if (parserEvent.type === "start") {
      return this.event(input, "visualization_start", {
        visualizationId,
        specVersion: "1.0",
        language: parserEvent.block.language,
      }, traceId, { blockId: parserEvent.block.blockId });
    }
    if (parserEvent.type === "delta") {
      return this.event(input, "visualization_delta", {
        visualizationId,
        rawDelta: parserEvent.delta,
        sequence: parserEvent.block.content.length,
      }, traceId, { blockId: parserEvent.block.blockId });
    }
    const parsed = parseVisualizationSpecJson(parserEvent.block.content, { allowInlineData: true, inlineDataMaxRows: 200, inlineDataMaxBytes: 64 * 1024 });
    if (!parsed.success) {
      return this.event(input, "visualization_error", {
        visualizationId,
        code: parsed.error.code,
        message: parsed.error.message,
        details: parsed.error.details,
        recoverable: true,
      }, traceId, { blockId: parserEvent.block.blockId });
    }
    return this.event(input, "visualization_complete", {
      visualizationId: parsed.spec.visualizationId,
      spec: parsed.spec,
      warnings: parsed.warnings,
    }, traceId, { blockId: parserEvent.block.blockId });
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

  private modelObservationEvent(
    input: StreamChatInput,
    traceId: string,
    phase: string,
    status: "info" | "success" | "error",
    message: string,
    detail: Record<string, unknown>,
  ) {
    return this.event(input, "model-observation", { phase, status, message, detail: { ...detail, ...(input.metadata ?? {}) } }, traceId);
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

function summarizeModelRequest(messages: ConversationMessage[], tools: ToolDefinition[] | undefined) {
  const messageRoleStats = messages.reduce<Record<string, { count: number; contentChars: number }>>((stats, message) => {
    const existing = stats[message.role] ?? { count: 0, contentChars: 0 };
    existing.count += 1;
    existing.contentChars += message.content.length;
    stats[message.role] = existing;
    return stats;
  }, {});
  const messageContentChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  const maxMessageChars = messages.reduce((max, message) => Math.max(max, message.content.length), 0);
  const serializedMessages = JSON.stringify(messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.toolName ? { toolName: message.toolName } : {}),
    ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
  })));
  const serializedTools = JSON.stringify((tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })));
  const messageContextChars = serializedMessages.length;
  const toolDefinitionChars = serializedTools.length;
  const totalContextChars = messageContextChars + toolDefinitionChars;
  return {
    messageCount: messages.length,
    messageContentChars,
    messageContextChars,
    maxMessageChars,
    messageRoleStats,
    toolCount: tools?.length ?? 0,
    toolNames: tools?.map((tool) => tool.name) ?? [],
    toolDefinitionChars,
    totalContextChars,
    estimatedTokens: estimateTokens(`${serializedMessages}${serializedTools}`),
  };
}

function estimateTokens(value: string) {
  if (!value) {
    return 0;
  }
  const cjkChars = value.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g)?.length ?? 0;
  return Math.ceil(cjkChars + (value.length - cjkChars) / 4);
}

function toolCallsAssistantMessage(input: StreamChatInput, toolCalls: AggregatedToolCall[]): ConversationMessage {
  return {
    id: createId("msg"),
    role: "assistant",
    content: "",
    toolCalls: toolCalls.map((toolCall) => ({
      id: toolCall.toolCallId,
      name: toolCall.name,
      argumentsText: toolCall.argumentsText || "{}",
    })),
    createdAt: nowIso(),
    metadata: {
      source: "model-tool-calls",
      conversationId: input.conversationId,
      messageId: input.messageId,
    },
  };
}

function toolResultMessage(result: ToolExecutionResult): ConversationMessage {
  return {
    id: createId("msg"),
    role: "tool",
    content: JSON.stringify(result.success ? result.output ?? null : result.error ?? null) ?? "null",
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    createdAt: nowIso(),
  };
}

function latestUserPrompt(messages: ConversationMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content;
}

function extractContentTitle(content: string) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? content.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 48);
}
