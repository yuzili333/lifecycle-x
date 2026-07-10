import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ContextCompressor,
  FileJsonLocalMemoryStore,
  InMemoryLocalMemoryStore,
  LocalMemoryError,
  SensitiveMemoryFilter,
  createLocalMemoryModule,
  type ContextBudget,
  type ContextItem,
} from "./localMemory/index.js";

const budget: ContextBudget = {
  maxChars: 2200,
  reservedCharsForMemory: 800,
  reservedCharsForSchema: 800,
  reservedCharsForTools: 300,
  reservedCharsForRecentMessages: 500,
  reservedCharsForUserQuestion: 200,
};

function createModule() {
  return createLocalMemoryModule({
    defaultContextBudget: budget,
    sensitiveFilterEnabled: true,
    enableAutoCompression: true,
    maxMemoryRecordsPerConversation: 100,
    maxMemoryCharsPerConversation: 20_000,
  });
}

describe("LocalMemoryStore", () => {
  it("creates, updates, gets, deletes, searches and cleans expired memory", async () => {
    const memory = createModule();
    const record = await memory.writeMemory({
      scope: "conversation",
      type: "preference",
      title: "模型偏好",
      content: "用户默认使用 Siliconflow 渠道和 deepseek 模型。",
      source: { sourceType: "user_message", conversationId: "conv_1", messageId: "msg_1" },
      importance: 8,
      tags: ["model"],
    });

    expect(await memory.getMemory(record.memoryId)).toMatchObject({ title: "模型偏好" });
    const updated = await memory.updateMemory(record.memoryId, { content: "用户默认使用 Siliconflow 渠道。" });
    expect(updated.content).toContain("Siliconflow");
    expect(await memory.searchMemory({ text: "Siliconflow", conversationId: "conv_1" })).toHaveLength(1);
    expect(await memory.store.listByConversation("conv_1")).toHaveLength(1);

    await memory.updateMemory(record.memoryId, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      retention: { ...updated.retention, allowDeletion: true },
    });
    expect(await memory.getMemory(record.memoryId)).toBeNull();
    const cleanup = await memory.cleanup();
    expect(cleanup.deletedMemoryIds).toContain(record.memoryId);

    await memory.deleteMemory(record.memoryId);
    expect(await memory.getMemory(record.memoryId)).toBeNull();
  });

  it("persists records with FileJsonLocalMemoryStore", async () => {
    const dir = await mkdtemp(join(tmpdir(), "local-memory-"));
    const filePath = join(dir, "memory.json");
    try {
      const first = createLocalMemoryModule({
        store: new FileJsonLocalMemoryStore(filePath),
        defaultContextBudget: budget,
        sensitiveFilterEnabled: true,
      });
      await first.writeMemory({
        scope: "project",
        type: "task_state",
        title: "任务状态",
        content: "数据助手已完成基础对话区。",
        source: { sourceType: "manual" },
        structured: { projectId: "proj_1" },
      });

      const second = createLocalMemoryModule({
        store: new FileJsonLocalMemoryStore(filePath),
        defaultContextBudget: budget,
        sensitiveFilterEnabled: true,
      });
      expect(await second.store.listByProject("proj_1")).toHaveLength(1);
      expect(await readFile(filePath, "utf8")).toContain("数据助手");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SensitiveMemoryFilter", () => {
  it("masks API keys, bearer tokens, passwords, connection strings and personal identifiers", () => {
    const result = new SensitiveMemoryFilter({ maskEmails: true }).filter(
      [
        "api_key=sk-abcdefghijklmnopqrstuvwxyz",
        "Authorization: Bearer tokenvalue1234567890",
        "password=secret123",
        "mysql://user:pass@localhost:3306/prod",
        "手机号 13800138000 身份证 110101199003071234 银行卡 6222020202020202020",
        "邮箱 user@example.com",
      ].join("\n"),
    );

    expect(result.action).toBe("masked");
    expect(result.safeContent).not.toContain("secret123");
    expect(result.safeContent).not.toContain("user:pass");
    expect(result.safeContent).toContain("[MASKED_API_KEY]");
    expect(result.safeContent).toContain("[MASKED_PHONE]");
    expect(result.safeContent).toContain("[MASKED_EMAIL]");
  });

  it("blocks SSH private keys and large raw table data", () => {
    const filter = new SensitiveMemoryFilter();
    expect(filter.filter("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----").action).toBe("blocked");
    const rows = Array.from({ length: 25 }, (_, index) => ({ id: index, name: `客户${index}`, phone: "13800138000" }));
    expect(filter.filter(JSON.stringify(rows)).action).toBe("blocked");
  });
});

describe("LocalMemoryModule", () => {
  it("writes preferences, tool summaries, schema summaries and blocks sensitive writes", async () => {
    const memory = createModule();
    await memory.writeMemory({
      scope: "user",
      type: "preference",
      content: "用户偏好使用深色模式。",
      source: { sourceType: "user_message", conversationId: "conv_2" },
    });
    await memory.writeMemory({
      scope: "tool",
      type: "sql_result_summary",
      content: "SQL 结果摘要：关注类客户 12 户，逾期金额合计 120 万。",
      source: { sourceType: "sql_execution", conversationId: "conv_2", executionId: "sql_1", dataSourceId: "ds_1" },
      importance: 9,
    });
    await memory.writeMemory({
      scope: "data_source",
      type: "schema_context_summary",
      content: "贷后库包含 loan_customers、repayment_plans，敏感字段已脱敏。",
      source: { sourceType: "schema_context", conversationId: "conv_2", dataSourceId: "ds_1" },
    });

    await expect(
      memory.writeMemory({
        scope: "project",
        type: "fact",
        content: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
        source: { sourceType: "manual" },
      }),
    ).rejects.toBeInstanceOf(LocalMemoryError);

    const retrieved = await memory.retrieveForContext({
      conversationId: "conv_2",
      dataSourceIds: ["ds_1"],
      userQuestion: "关注类客户逾期金额",
      purpose: "risk_analysis",
      limit: 3,
    });
    expect(retrieved.results.map((result) => result.record.type)).toEqual(expect.arrayContaining(["sql_result_summary", "schema_context_summary"]));
  });

  it("extracts important facts without blocking the whole conversation", async () => {
    const memory = createModule();
    const records = await memory.writeExtractedFacts({
      content: "以后默认使用 Siliconflow。必须经过审批才能执行 SQL。下一步补充报告模板。",
      source: { sourceType: "user_message", conversationId: "conv_fact" },
      conversationId: "conv_fact",
    });
    expect(records.map((record) => record.type)).toEqual(expect.arrayContaining(["preference", "decision", "todo"]));
  });
});

describe("MemoryRetriever", () => {
  it("ranks by text relevance, conversation, project, data source, importance and injection policy", async () => {
    const store = new InMemoryLocalMemoryStore();
    const memory = createLocalMemoryModule({ store, defaultContextBudget: budget, sensitiveFilterEnabled: true });
    await memory.writeMemory({
      scope: "conversation",
      type: "fact",
      content: "关注类客户逾期金额出现上升。",
      source: { sourceType: "assistant_message", conversationId: "conv_rank", dataSourceId: "ds_risk" },
      importance: 9,
    });
    await memory.writeMemory({
      scope: "project",
      type: "preference",
      content: "报告默认使用中文摘要。",
      source: { sourceType: "manual" },
      structured: { projectId: "proj_rank" },
      importance: 6,
    });
    await memory.writeMemory({
      scope: "conversation",
      type: "message",
      content: "不应注入的临时内容。",
      source: { sourceType: "user_message", conversationId: "conv_rank" },
      retention: { allowPromptInjection: false },
    });

    const result = await memory.retrieveForContext({
      conversationId: "conv_rank",
      projectId: "proj_rank",
      dataSourceIds: ["ds_risk"],
      userQuestion: "逾期金额风险",
      limit: 5,
    });
    expect(result.results[0]?.record.content).toContain("逾期金额");
    expect(result.results.some((item) => item.record.content.includes("不应注入"))).toBe(false);
  });
});

describe("ContextCompressor", () => {
  const items: ContextItem[] = [
    { itemId: "sys", type: "system_instruction", content: "系统指令：必须遵守安全策略。", priority: 10, metadata: { safetyCritical: true } },
    { itemId: "old", type: "assistant_message", content: "较早普通对话 ".repeat(200), priority: 2 },
    { itemId: "tool", type: "tool_result", content: "SQL 工具结果摘要：逾期金额 Top 10，不含完整行数据。".repeat(20), priority: 8 },
    { itemId: "user", type: "user_message", content: "请分析逾期风险", priority: 10, metadata: { isCurrentUserQuestion: true } },
  ];

  it("supports lossless priority, summary and hybrid while preserving critical items", async () => {
    const compressor = new ContextCompressor();
    const lossless = await compressor.compress({ items, budget: { maxChars: 500 }, compressionMode: "lossless_priority", userQuestion: "请分析逾期风险" });
    expect(lossless.retainedItems.map((item) => item.itemId)).toEqual(expect.arrayContaining(["sys", "user"]));
    expect(lossless.droppedItems.some((item) => item.itemId === "old")).toBe(true);

    const summary = await compressor.compress({ items, budget: { maxChars: 800 }, compressionMode: "summary", userQuestion: "请分析逾期风险" });
    expect(summary.summary).toContain("压缩摘要");

    const hybrid = await compressor.compress({ items, budget: { maxChars: 900 }, compressionMode: "hybrid", userQuestion: "请分析逾期风险" });
    expect(hybrid.retainedItems.some((item) => item.type === "system_instruction")).toBe(true);
    expect(hybrid.originalChars).toBeGreaterThan(hybrid.compressedChars);
  });

  it("does not inject sensitive content", async () => {
    const result = await new ContextCompressor().compress({
      items: [{ itemId: "secret", type: "memory", content: "mysql://user:pass@localhost/prod", priority: 7 }],
      budget: { maxChars: 500 },
    });
    expect(JSON.stringify(result.retainedItems)).not.toContain("user:pass");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("ContextAssembler and MemoryCompressor", () => {
  it("assembles model messages with memory, schema context, tool context and task state", async () => {
    const memory = createModule();
    await memory.writeMemory({
      scope: "conversation",
      type: "task_state",
      title: "当前任务",
      content: "正在生成贷后风险分析报告。",
      source: { sourceType: "manual", conversationId: "conv_assemble" },
      importance: 9,
    });

    const output = await memory.assembleContext({
      conversationId: "conv_assemble",
      projectId: "proj_assemble",
      userQuestion: "继续生成报告",
      systemInstruction: "你是银行贷后分析助手。",
      recentMessages: [{ itemId: "recent_1", type: "assistant_message", content: "已完成数据质量检查。", priority: 6 }],
      schemaContextItems: [{ itemId: "schema_1", type: "schema_context", content: "Schema: loan_customers(customer_id,risk_level)", priority: 8 }],
      toolContextItems: [{ itemId: "tool_1", type: "task_state", content: "可用工具：request_sql_query_execution", priority: 8 }],
      taskStateItems: [{ itemId: "approval_1", type: "approval_state", content: "SQL 审批状态：pending", priority: 9 }],
      budget,
      purpose: "report_generation",
    });

    expect(output.messages[0]?.role).toBe("system");
    expect(output.messages[0]?.content).toContain("Memory: 当前任务");
    expect(output.messages[0]?.content).toContain("Schema: loan_customers");
    expect(output.messages.at(-1)?.content).toBe("继续生成报告");
    expect(output.injectedMemoryIds.length).toBeGreaterThan(0);
  });

  it("compresses long conversation memories into a summary memory", async () => {
    const memory = createModule();
    for (let i = 0; i < 5; i += 1) {
      await memory.writeMemory({
        scope: "conversation",
        type: i % 2 === 0 ? "fact" : "tool_result_summary",
        title: `记忆 ${i}`,
        content: `第 ${i} 条风险分析中间结论：关注客户逾期金额需要继续跟踪。`,
        source: { sourceType: "assistant_message", conversationId: "conv_compress" },
        importance: 7,
      });
    }

    const compressed = await memory.compressMemories({ conversationId: "conv_compress", maxSummaryChars: 800 });
    expect(compressed.sourceMemoryIds).toHaveLength(5);
    expect(compressed.compressedMemory.content).toContain("Memory 压缩摘要");
    expect(await memory.getMemory(compressed.compressedMemory.memoryId)).not.toBeNull();
  });
});
