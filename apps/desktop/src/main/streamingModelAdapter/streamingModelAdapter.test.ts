import { describe, expect, it, vi } from "vitest";
import {
  InMemoryVersionManager,
  StreamingMarkdownParser,
  ToolRegistry,
  createStreamingModelAdapter,
  type ConversationMessage,
} from "./index";

describe("StreamingMarkdownParser", () => {
  it("parses common markdown blocks from chunked input and flushes unfinished fences", () => {
    const parser = new StreamingMarkdownParser();
    const events = [
      ...parser.push("# 标题\n段落"),
      ...parser.push("内容\n\n- A\n- B\n\n```mermaid\ngraph TD\nA --> B\n```\n$$\nE=mc^2"),
      ...parser.flush(),
    ];

    expect(events.some((event) => event.type === "start" && event.block.type === "heading")).toBe(true);
    expect(events.some((event) => event.type === "start" && event.block.type === "paragraph")).toBe(true);
    expect(events.some((event) => event.type === "start" && event.block.type === "unordered_list")).toBe(true);
    expect(events.some((event) => event.type === "start" && event.block.type === "mermaid")).toBe(true);
    const mathEnd = events.find((event) => event.type === "end" && event.block.type === "math_block");
    expect(mathEnd?.block.complete).toBe(false);
  });

  it("recognizes tables and code blocks", () => {
    const parser = new StreamingMarkdownParser();
    const events = [
      ...parser.push("| 字段 | 类型 |\n| --- | --- |\n| id | bigint |\n\n```ts\nconst a = 1\n```\n"),
      ...parser.flush(),
    ];

    expect(events.some((event) => event.type === "start" && event.block.type === "table")).toBe(true);
    expect(events.some((event) => event.type === "start" && event.block.type === "code_block" && event.block.language === "ts")).toBe(true);
  });
});

describe("ToolRegistry", () => {
  it("aggregates, validates, executes multiple tools and captures failures", async () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "searchCustomer",
      description: "查询客户",
      inputSchema: {
        type: "object",
        required: ["customerId"],
        properties: { customerId: { type: "string" } },
      },
      handler: async (input) => ({ customer: (input as { customerId: string }).customerId }),
    });
    registry.registerTool({
      name: "failTool",
      description: "失败工具",
      inputSchema: { type: "object" },
      handler: async () => {
        throw new Error("boom");
      },
    });

    const results = await registry.executeToolCalls(
      [
        { toolCallId: "tool_1", index: 0, name: "searchCustomer", argumentsText: '{"customerId":"A"}' },
        { toolCallId: "tool_2", index: 1, name: "failTool", argumentsText: "{}" },
      ],
      "parallel",
      { conversationId: "conv", messageId: "msg", traceId: "trace" },
    );

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error?.code).toBe("TOOL_EXECUTION_FAILED");
  });

  it("returns validation errors for incomplete JSON arguments", async () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "getLoanContracts",
      description: "查询借据",
      inputSchema: { type: "object" },
      handler: async () => ({}),
    });

    const [result] = await registry.executeToolCalls(
      [{ toolCallId: "tool_1", index: 0, name: "getLoanContracts", argumentsText: "{" }],
      "serial",
      { conversationId: "conv", messageId: "msg", traceId: "trace" },
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("TOOL_INPUT_INVALID");
  });

  it("returns not found and timeout errors as structured tool results", async () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "slowTool",
      description: "慢工具",
      inputSchema: { type: "object" },
      timeoutMs: 1,
      handler: async (_input, context) =>
        new Promise((resolve, reject) => {
          context.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          setTimeout(() => resolve({ ok: true }), 50);
        }),
    });

    const results = await registry.executeToolCalls(
      [
        { toolCallId: "tool_missing", index: 0, name: "missingTool", argumentsText: "{}" },
        { toolCallId: "tool_slow", index: 1, name: "slowTool", argumentsText: "{}" },
      ],
      "serial",
      { conversationId: "conv", messageId: "msg", traceId: "trace" },
    );

    expect(results[0].error?.code).toBe("TOOL_NOT_FOUND");
    expect(results[1].error?.code).toBe("TOOL_EXECUTION_TIMEOUT");
  });
});

describe("InMemoryVersionManager", () => {
  it("creates, updates, selects, lists and compares versions", () => {
    const manager = new InMemoryVersionManager();
    const v1 = manager.createVersion({
      conversationId: "conv",
      messageId: "msg1",
      contentType: "markdown",
      content: "a\nb",
      title: "v1",
    });
    const v2 = manager.createVersion({
      conversationId: "conv",
      messageId: "msg2",
      parentVersionId: v1.versionId,
      contentType: "markdown",
      content: "a\nc",
      title: "v2",
    });

    expect(manager.listVersions("conv")).toHaveLength(2);
    expect(manager.updateVersion({ versionId: v1.versionId, title: "v1 updated" }).title).toBe("v1 updated");
    expect(manager.setSelectedVersion(v2.versionId).status).toBe("selected");
    expect(manager.getVersion(v1.versionId).status).toBe("draft");
    expect(manager.compareVersions(v1.versionId, v2.versionId).map((line) => line.type)).toEqual(["unchanged", "removed", "added"]);
  });

  it("throws structured errors for missing versions", () => {
    const manager = new InMemoryVersionManager();
    expect(() => manager.getVersion("missing")).toThrow("版本不存在");
  });
});

describe("StreamingModelAdapter", () => {
  it("streams markdown events, executes tool calls, continues generation and creates a version", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"searchCustomer","arguments":"{\\"customerId\\""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"A\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]))
      .mockResolvedValueOnce(sseResponse([
        'data: {"choices":[{"delta":{"content":"# 报告\\n"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"客户 A 风险稳定。"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]));
    const adapter = createStreamingModelAdapter({
      baseURL: "https://example.local/v1",
      apiKey: "secret",
      model: "test-model",
      fetch: fetchMock as unknown as typeof fetch,
    });
    adapter.registerTool({
      name: "searchCustomer",
      description: "查询客户",
      inputSchema: {
        type: "object",
        required: ["customerId"],
        properties: { customerId: { type: "string" } },
      },
      handler: async (input) => ({ customerId: (input as { customerId: string }).customerId, risk: "stable" }),
    });

    const events = await collect(adapter.streamChat(baseInput()));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.type)).toContain("stream-start");
    expect(events.map((event) => event.type)).toContain("tool-call-start");
    expect(events.map((event) => event.type)).toContain("tool-execution-result");
    expect(events.some((event) => event.type === "markdown-block-start" && event.payload.block && (event.payload.block as { type: string }).type === "heading")).toBe(true);
    expect(events.map((event) => event.type)).toContain("version-created");
    expect(events.map((event) => event.type)).toContain("version-updated");
    expect(events.at(-1)?.type).toBe("stream-end");
  });

  it("emits stream errors for provider parse failures", async () => {
    const adapter = createStreamingModelAdapter({
      baseURL: "https://example.local/v1",
      apiKey: "secret",
      model: "test-model",
      fetch: vi.fn().mockResolvedValue(sseResponse(["data: {bad-json}\n\n"])) as unknown as typeof fetch,
    });

    const events = await collect(adapter.streamChat(baseInput()));

    expect(events.some((event) => event.type === "stream-error" && (event.payload.error as { code: string }).code === "PROVIDER_STREAM_PARSE_FAILED")).toBe(true);
  });

  it("emits user aborted errors", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = createStreamingModelAdapter({
      baseURL: "https://example.local/v1",
      apiKey: "secret",
      model: "test-model",
      fetch: abortAwareFetch() as unknown as typeof fetch,
    });

    const events = await collect(adapter.streamChat({ ...baseInput(), signal: controller.signal }));

    expect(events.some((event) => event.type === "stream-error" && (event.payload.error as { code: string }).code === "USER_ABORTED")).toBe(true);
  });

  it("emits provider timeout errors", async () => {
    const adapter = createStreamingModelAdapter({
      baseURL: "https://example.local/v1",
      apiKey: "secret",
      model: "test-model",
      timeoutMs: 1,
      fetch: abortAwareFetch() as unknown as typeof fetch,
    });

    const events = await collect(adapter.streamChat(baseInput()));

    expect(events.some((event) => event.type === "stream-error" && (event.payload.error as { code: string }).code === "PROVIDER_TIMEOUT")).toBe(true);
  });
});

function baseInput() {
  const messages: ConversationMessage[] = [
    {
      id: "user_msg",
      role: "user",
      content: "分析客户 A",
      createdAt: new Date().toISOString(),
    },
  ];
  return {
    conversationId: "conv",
    messageId: "assistant_msg",
    messages,
    contentType: "markdown" as const,
  };
}

async function collect<T>(stream: AsyncGenerator<T>) {
  const items: T[] = [];
  for await (const item of stream) {
    items.push(item);
  }
  return items;
}

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function abortAwareFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  });
}
