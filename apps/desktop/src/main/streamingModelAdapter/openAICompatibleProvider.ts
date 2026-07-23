import { ModelAdapterError } from "./errors";
import type { ConversationMessage, StreamingModelAdapterConfig, ToolCallDelta, ToolDefinition } from "./types";
import { createId, mergeAbortSignals } from "./utils";

export type ProviderChatInput = {
  conversationId: string;
  messageId: string;
  messages: ConversationMessage[];
  model?: string;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ProviderStreamEvent =
  | { type: "content-delta"; delta: string }
  | { type: "tool-call-delta"; delta: ToolCallDelta }
  | { type: "tool-call-end"; toolCallId: string; index: number }
  | { type: "end"; finishReason?: string };

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
};

export class OpenAICompatibleProvider {
  readonly providerName: string;
  private readonly config: StreamingModelAdapterConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: StreamingModelAdapterConfig) {
    this.config = config;
    this.providerName = config.providerName ?? "openai-compatible";
    this.fetchImpl = config.fetch ?? fetch;
  }

  async *streamChat(input: ProviderChatInput): AsyncGenerator<ProviderStreamEvent> {
    const timeoutController = new AbortController();
    const timeoutMs = input.timeoutMs ?? this.config.timeoutMs;
    const timeout = timeoutMs ? setTimeout(() => timeoutController.abort(), timeoutMs) : undefined;
    const signal = mergeAbortSignals([input.signal, timeoutController.signal]);
    const endpoint = `${this.config.baseURL.replace(/\/$/, "")}/chat/completions`;
    const toolIdsByIndex = new Map<number, string>();
    let streamDone = false;

    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model ?? this.config.model,
          stream: true,
          messages: input.messages.map(toProviderMessage),
          tools: input.tools?.length ? input.tools.map(toProviderTool) : undefined,
        }),
        signal,
      });

      if (!response.ok || !response.body) {
        throw new ModelAdapterError("PROVIDER_REQUEST_FAILED", `模型服务请求失败：${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) {
            continue;
          }
          const data = trimmed.slice("data:".length).trim();
          if (data === "[DONE]") {
            if (!streamDone) {
              streamDone = true;
              yield { type: "end", finishReason: "stop" };
            }
            continue;
          }
          const parsed = parseProviderChunk(data);
          const choice = parsed.choices?.[0];
          const content = choice?.delta?.content;
          if (content) {
            yield { type: "content-delta", delta: content };
          }
          for (const toolCall of choice?.delta?.tool_calls ?? []) {
            const index = toolCall.index ?? 0;
            const toolCallId = toolCall.id ?? toolIdsByIndex.get(index) ?? createId("tool");
            toolIdsByIndex.set(index, toolCallId);
            const soleAllowedToolName = input.tools?.length === 1 ? input.tools[0]?.name : undefined;
            yield {
              type: "tool-call-delta",
              delta: {
                toolCallId,
                index,
                name: toolCall.function?.name || soleAllowedToolName,
                argumentsDelta: toolCall.function?.arguments,
              },
            };
          }
          if (choice?.finish_reason) {
            for (const [index, toolCallId] of toolIdsByIndex.entries()) {
              yield { type: "tool-call-end", toolCallId, index };
            }
            if (!streamDone) {
              streamDone = true;
              yield { type: "end", finishReason: choice.finish_reason };
            }
          }
        }
      }
      if (!streamDone) {
        yield { type: "end", finishReason: "stop" };
      }
    } catch (error) {
      if (signal?.aborted) {
        throw new ModelAdapterError(timeoutController.signal.aborted ? "PROVIDER_TIMEOUT" : "USER_ABORTED", timeoutController.signal.aborted ? "模型服务请求超时。" : "用户已中止模型请求。", error);
      }
      if (error instanceof ModelAdapterError) {
        throw error;
      }
      throw new ModelAdapterError("PROVIDER_STREAM_PARSE_FAILED", "模型流解析失败。", error);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

function toProviderMessage(message: ConversationMessage) {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
      name: message.toolName,
    };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: toolCall.argumentsText,
        },
      })),
    };
  }
  return {
    role: message.role,
    content: message.content,
  };
}

function toProviderTool(tool: ToolDefinition) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function parseProviderChunk(data: string): ChatCompletionChunk {
  try {
    return JSON.parse(data) as ChatCompletionChunk;
  } catch (error) {
    throw new ModelAdapterError("PROVIDER_STREAM_PARSE_FAILED", "SSE data 不是有效 JSON。", error);
  }
}
