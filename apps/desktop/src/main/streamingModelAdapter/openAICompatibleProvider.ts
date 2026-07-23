import { ModelAdapterError } from "./errors";
import type { ConversationMessage, ModelRequestOptions, StreamingModelAdapterConfig, ToolCallDelta, ToolDefinition } from "./types";
import { createId, mergeAbortSignals } from "./utils";

export type ProviderChatInput = {
  conversationId: string;
  messageId: string;
  messages: ConversationMessage[];
  model?: string;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  timeoutMs?: number;
  firstEventTimeoutMs?: number;
  requestOptions?: ModelRequestOptions;
};

export type ProviderUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
};

export type ProviderStreamEvent =
  | { type: "request-retry"; attempt: number; reason: string; delayMs: number }
  | { type: "reasoning-delta"; delta: string }
  | { type: "content-delta"; delta: string }
  | { type: "tool-call-delta"; delta: ToolCallDelta }
  | { type: "tool-call-end"; toolCallId: string; index: number }
  | { type: "usage"; usage: ProviderUsage }
  | { type: "end"; finishReason?: string };

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
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
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: ChatCompletionChunk["usage"];
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
    const firstEventController = new AbortController();
    const timeoutMs = input.timeoutMs ?? this.config.timeoutMs;
    const timeout = timeoutMs ? setTimeout(() => timeoutController.abort(), timeoutMs) : undefined;
    const firstEventTimeoutMs = input.firstEventTimeoutMs;
    const firstEventTimeout = firstEventTimeoutMs ? setTimeout(() => firstEventController.abort(), firstEventTimeoutMs) : undefined;
    const signal = mergeAbortSignals([input.signal, timeoutController.signal, firstEventController.signal]);
    const endpoint = `${this.config.baseURL.replace(/\/$/, "")}/chat/completions`;
    const toolIdsByIndex = new Map<number, string>();
    let streamDone = false;
    let firstEventReceived = false;
    const markFirstEvent = () => {
      if (firstEventReceived) return;
      firstEventReceived = true;
      if (firstEventTimeout) clearTimeout(firstEventTimeout);
    };

    try {
      const requestOptions = { ...this.config.requestOptions, ...input.requestOptions };
      const stream = requestOptions.stream ?? true;
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(removeUndefined({
          model: input.model ?? this.config.model,
          stream,
          messages: input.messages.map(toProviderMessage),
          tools: input.tools?.length ? input.tools.map(toProviderTool) : undefined,
          enable_thinking: requestOptions.enableThinking,
          thinking_budget: requestOptions.enableThinking ? requestOptions.thinkingBudget : undefined,
          temperature: requestOptions.temperature,
          max_tokens: requestOptions.maxTokens,
          response_format: requestOptions.responseFormat,
          stream_options: stream ? { include_usage: true } : undefined,
        })),
        signal,
      };
      let response: Response | null = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          response = await this.fetchImpl(endpoint, requestInit);
        } catch (error) {
          if (signal?.aborted || attempt >= 2) throw error;
          const delayMs = retryDelayMs(attempt);
          yield { type: "request-retry", attempt, reason: "network_error", delayMs };
          await abortableDelay(delayMs, signal);
          continue;
        }
        if (isRetryableStatus(response.status) && attempt < 2) {
          const delayMs = retryDelayMs(attempt);
          yield { type: "request-retry", attempt, reason: `http_${response.status}`, delayMs };
          await abortableDelay(delayMs, signal);
          continue;
        }
        break;
      }

      if (!response?.ok || !response.body) {
        throw new ModelAdapterError("PROVIDER_REQUEST_FAILED", `模型服务请求失败：${response?.status ?? "unknown"}`);
      }

      if (!stream) {
        const body = await response.json() as ChatCompletionResponse;
        markFirstEvent();
        const choice = body.choices?.[0];
        const reasoning = choice?.message?.reasoning_content;
        if (reasoning) yield { type: "reasoning-delta", delta: reasoning };
        const content = choice?.message?.content;
        if (content) yield { type: "content-delta", delta: content };
        for (const [index, toolCall] of (choice?.message?.tool_calls ?? []).entries()) {
          const toolCallId = toolCall.id ?? createId("tool");
          yield {
            type: "tool-call-delta",
            delta: {
              toolCallId,
              index,
              name: toolCall.function?.name || (input.tools?.length === 1 ? input.tools[0]?.name : undefined),
              argumentsDelta: toolCall.function?.arguments ?? "",
            },
          };
          yield { type: "tool-call-end", toolCallId, index };
        }
        const usage = normalizeUsage(body.usage);
        if (usage) yield { type: "usage", usage };
        yield { type: "end", finishReason: choice?.finish_reason ?? "stop" };
        return;
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
          markFirstEvent();
          const choice = parsed.choices?.[0];
          const reasoning = choice?.delta?.reasoning_content;
          if (reasoning) {
            yield { type: "reasoning-delta", delta: reasoning };
          }
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
          const usage = normalizeUsage(parsed.usage);
          if (usage) yield { type: "usage", usage };
        }
      }
      if (!streamDone) {
        yield { type: "end", finishReason: "stop" };
      }
    } catch (error) {
      if (signal?.aborted) {
        const code = firstEventController.signal.aborted
          ? "PROVIDER_FIRST_EVENT_TIMEOUT"
          : timeoutController.signal.aborted ? "PROVIDER_TIMEOUT" : "USER_ABORTED";
        const message = code === "PROVIDER_FIRST_EVENT_TIMEOUT"
          ? "模型服务首事件等待超时。"
          : code === "PROVIDER_TIMEOUT" ? "模型服务请求超时。" : "用户已中止模型请求。";
        throw new ModelAdapterError(code, message, error);
      }
      if (error instanceof ModelAdapterError) {
        throw error;
      }
      throw new ModelAdapterError("PROVIDER_STREAM_PARSE_FAILED", "模型流解析失败。", error);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (firstEventTimeout) {
        clearTimeout(firstEventTimeout);
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

function normalizeUsage(usage: ChatCompletionChunk["usage"]): ProviderUsage | null {
  if (!usage) return null;
  return {
    promptTokens: finiteNumber(usage.prompt_tokens),
    completionTokens: finiteNumber(usage.completion_tokens),
    totalTokens: finiteNumber(usage.total_tokens),
    reasoningTokens: finiteNumber(usage.completion_tokens_details?.reasoning_tokens),
  };
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function removeUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(attempt: number) {
  return Math.min(1_000, 100 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 50);
}

function abortableDelay(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
