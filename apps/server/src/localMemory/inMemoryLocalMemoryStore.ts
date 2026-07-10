import { LocalMemoryError } from "./localMemoryError.js";
import { cloneRecord, isExpired, nowIso, recordText, textSimilarity } from "./utils.js";
import type { LocalMemoryRecord, LocalMemoryStore, MemoryCleanupInput, MemoryCleanupResult, MemorySearchQuery, MemorySearchResult } from "./types.js";

export class InMemoryLocalMemoryStore implements LocalMemoryStore {
  protected readonly records = new Map<string, LocalMemoryRecord>();

  async create(record: LocalMemoryRecord): Promise<LocalMemoryRecord> {
    if (this.records.has(record.memoryId)) {
      throw new LocalMemoryError("MEMORY_UPDATE_FAILED", "Memory 已存在。", { memoryId: record.memoryId });
    }
    this.records.set(record.memoryId, cloneRecord(record));
    return cloneRecord(record);
  }

  async update(memoryId: string, patch: Partial<LocalMemoryRecord>): Promise<LocalMemoryRecord> {
    const current = this.records.get(memoryId);
    if (!current) {
      throw new LocalMemoryError("MEMORY_NOT_FOUND", "Memory 不存在。", { memoryId });
    }
    const next: LocalMemoryRecord = {
      ...current,
      ...patch,
      memoryId,
      source: patch.source ?? current.source,
      retention: patch.retention ?? current.retention,
      updatedAt: patch.updatedAt ?? nowIso(),
    };
    this.records.set(memoryId, cloneRecord(next));
    return cloneRecord(next);
  }

  async get(memoryId: string): Promise<LocalMemoryRecord | null> {
    const current = this.records.get(memoryId);
    if (!current || isExpired(current)) {
      return null;
    }
    const accessed: LocalMemoryRecord = {
      ...current,
      lastAccessedAt: nowIso(),
      accessCount: (current.accessCount ?? 0) + 1,
    };
    this.records.set(memoryId, accessed);
    return cloneRecord(accessed);
  }

  async delete(memoryId: string): Promise<void> {
    this.records.delete(memoryId);
  }

  async search(query: MemorySearchQuery): Promise<MemorySearchResult[]> {
    const now = new Date();
    const results = Array.from(this.records.values())
      .filter((record) => query.includeExpired || !isExpired(record, now))
      .filter((record) => !query.scope || query.scope.includes(record.scope))
      .filter((record) => !query.type || query.type.includes(record.type))
      .filter((record) => !query.tags || query.tags.every((tag) => record.tags?.includes(tag)))
      .filter((record) => !query.conversationId || record.source.conversationId === query.conversationId)
      .filter((record) => !query.projectId || record.metadata?.projectId === query.projectId)
      .filter((record) => !query.dataSourceId || record.source.dataSourceId === query.dataSourceId || record.metadata?.dataSourceId === query.dataSourceId)
      .filter((record) => query.minImportance === undefined || record.importance >= query.minImportance)
      .map((record) => {
        const similarity = textSimilarity(query.text, recordText(record));
        const importance = record.importance / 10;
        const score = query.text ? similarity * 0.7 + importance * 0.3 : importance;
        return {
          record: cloneRecord(record),
          score,
          reason: query.text ? `文本相关性 ${similarity.toFixed(2)}，重要性 ${record.importance}` : `重要性 ${record.importance}`,
        } satisfies MemorySearchResult;
      })
      .filter((result) => !query.text || result.score > 0.03)
      .sort((left, right) => right.score - left.score || Date.parse(right.record.updatedAt) - Date.parse(left.record.updatedAt))
      .slice(0, query.limit ?? 20);

    const accessedAt = nowIso();
    for (const result of results) {
      const current = this.records.get(result.record.memoryId);
      if (current) {
        this.records.set(current.memoryId, {
          ...current,
          lastAccessedAt: accessedAt,
          accessCount: (current.accessCount ?? 0) + 1,
        });
      }
    }
    return results;
  }

  async listByConversation(conversationId: string): Promise<LocalMemoryRecord[]> {
    return Array.from(this.records.values())
      .filter((record) => record.source.conversationId === conversationId && !isExpired(record))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .map(cloneRecord);
  }

  async listByProject(projectId: string): Promise<LocalMemoryRecord[]> {
    return Array.from(this.records.values())
      .filter((record) => record.metadata?.projectId === projectId && !isExpired(record))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .map(cloneRecord);
  }

  async cleanup(input: MemoryCleanupInput = {}): Promise<MemoryCleanupResult> {
    const at = input.now ? new Date(input.now) : new Date();
    const deletedMemoryIds: string[] = [];
    for (const record of this.records.values()) {
      if (input.maxDeleted && deletedMemoryIds.length >= input.maxDeleted) {
        break;
      }
      const shouldDelete = isExpired(record, at) || (input.includeEphemeral && record.retention.mode === "ephemeral" && record.retention.allowDeletion);
      if (shouldDelete && record.retention.allowDeletion) {
        this.records.delete(record.memoryId);
        deletedMemoryIds.push(record.memoryId);
      }
    }
    return { deletedCount: deletedMemoryIds.length, deletedMemoryIds, warnings: [] };
  }

  protected snapshot() {
    return Array.from(this.records.values()).map(cloneRecord);
  }

  protected replaceAll(records: LocalMemoryRecord[]) {
    this.records.clear();
    records.forEach((record) => this.records.set(record.memoryId, cloneRecord(record)));
  }
}
