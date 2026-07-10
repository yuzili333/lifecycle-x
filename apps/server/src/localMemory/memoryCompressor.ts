import { createMemoryId, nowIso, truncate } from "./utils.js";
import type { LocalMemoryRecord, LocalMemoryStore, MemoryCompressionInput, MemoryCompressionResult, MemorySummarizerAdapter } from "./types.js";

export class MemoryCompressor {
  constructor(
    private readonly store: LocalMemoryStore,
    private readonly summarizerAdapter?: MemorySummarizerAdapter,
  ) {}

  async compress(input: MemoryCompressionInput): Promise<MemoryCompressionResult> {
    const maxSummaryChars = input.maxSummaryChars ?? 1600;
    const records = await this.loadRecords(input);
    const compressible = records.filter((record) => record.retention.allowCompression);
    const warnings: string[] = [];
    if (compressible.length === 0) {
      warnings.push("没有可压缩的 Memory。");
    }

    const content = compressible
      .map((record) => [`[${record.type}] ${record.title ?? record.memoryId}`, truncate(record.content.replace(/\s+/g, " "), 500)].join("\n"))
      .join("\n\n");
    const adapterSummary = this.summarizerAdapter
      ? await this.summarizerAdapter.summarize({ content, purpose: "memory_compression", maxChars: maxSummaryChars })
      : null;
    const summary = adapterSummary?.summary ?? truncate(ruleBasedSummary(compressible), maxSummaryChars);
    warnings.push(...(adapterSummary?.warnings ?? []));

    const now = nowIso();
    const sourceMemoryIds = compressible.map((record) => record.memoryId);
    const conversationId = input.conversationId ?? compressible.find((record) => record.source.conversationId)?.source.conversationId;
    const projectId = input.projectId ?? (compressible.find((record) => typeof record.metadata?.projectId === "string")?.metadata?.projectId as string | undefined);
    const compressedMemory: LocalMemoryRecord = {
      memoryId: createMemoryId(),
      scope: conversationId ? "conversation" : projectId ? "project" : "system",
      type: "summary",
      title: conversationId ? "长会话 Memory 压缩摘要" : "Memory 压缩摘要",
      content: summary || "暂无可用摘要。",
      structured: {
        sourceMemoryIds,
        sourceCount: sourceMemoryIds.length,
        typeCounts: countBy(compressible.map((record) => record.type)),
      },
      tags: ["memory-compression"],
      importance: Math.max(6, ...compressible.map((record) => record.importance)),
      confidence: 0.75,
      source: { sourceType: "system", conversationId },
      visibility: projectId ? "project" : "session",
      retention: {
        mode: projectId ? "project" : "session",
        allowCompression: true,
        allowDeletion: true,
        allowPromptInjection: true,
      },
      createdAt: now,
      updatedAt: now,
      metadata: { projectId, sourceMemoryIds, compressedBy: "rule_based_memory_compressor" },
    };

    await this.store.create(compressedMemory);
    const droppedMemoryIds: string[] = [];
    if (input.deleteSourceMemories) {
      for (const record of compressible) {
        if (record.retention.allowDeletion) {
          await this.store.delete(record.memoryId);
          droppedMemoryIds.push(record.memoryId);
        }
      }
    }

    return { compressedMemory, sourceMemoryIds, droppedMemoryIds, warnings };
  }

  private async loadRecords(input: MemoryCompressionInput) {
    if (input.memoryIds?.length) {
      const records = await Promise.all(input.memoryIds.map((memoryId) => this.store.get(memoryId)));
      return records.filter((record): record is LocalMemoryRecord => Boolean(record));
    }
    if (input.conversationId) {
      return this.store.listByConversation(input.conversationId);
    }
    if (input.projectId) {
      return this.store.listByProject(input.projectId);
    }
    return [];
  }
}

function ruleBasedSummary(records: LocalMemoryRecord[]) {
  const important = [...records].sort((left, right) => right.importance - left.importance).slice(0, 12);
  const facts = important.filter((record) => record.type === "fact" || record.type === "decision" || record.type === "task_state" || record.type === "todo");
  const tools = important.filter((record) => record.type.endsWith("_summary"));
  const lines = ["Memory 压缩摘要："];
  if (facts.length > 0) {
    lines.push("关键事实/决策/任务：", ...facts.map((record) => `- ${record.title ?? record.type}：${truncate(record.content.replace(/\s+/g, " "), 180)}`));
  }
  if (tools.length > 0) {
    lines.push("工具与数据结果摘要：", ...tools.map((record) => `- ${record.title ?? record.type}：${truncate(record.content.replace(/\s+/g, " "), 180)}`));
  }
  const remaining = important.filter((record) => !facts.includes(record) && !tools.includes(record));
  if (remaining.length > 0) {
    lines.push("其他上下文：", ...remaining.map((record) => `- ${record.title ?? record.type}：${truncate(record.content.replace(/\s+/g, " "), 160)}`));
  }
  return lines.join("\n");
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}
