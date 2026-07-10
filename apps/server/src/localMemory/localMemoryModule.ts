import { ContextAssembler } from "./contextAssembler.js";
import { ContextCompressor } from "./contextCompressor.js";
import { InMemoryLocalMemoryStore } from "./inMemoryLocalMemoryStore.js";
import { ImportantFactExtractor, type ExtractImportantFactsInput } from "./importantFactExtractor.js";
import { LocalMemoryError } from "./localMemoryError.js";
import { MemoryCompressor } from "./memoryCompressor.js";
import { MemoryRetriever } from "./memoryRetriever.js";
import { SensitiveMemoryFilter } from "./sensitiveMemoryFilter.js";
import { applyTtl, clamp, createMemoryId, defaultRetention, nowIso } from "./utils.js";
import type {
  AssembleContextInput,
  CompressContextInput,
  LocalMemoryModuleConfig,
  LocalMemoryRecord,
  MemoryCleanupInput,
  MemoryCompressionInput,
  MemorySearchQuery,
  WriteMemoryInput,
  RetrieveMemoryInput,
} from "./types.js";

export class LocalMemoryModule {
  readonly store;
  readonly sensitiveFilter: SensitiveMemoryFilter;
  readonly retriever: MemoryRetriever;
  readonly contextCompressor: ContextCompressor;
  readonly memoryCompressor: MemoryCompressor;
  readonly contextAssembler: ContextAssembler;
  readonly factExtractor: ImportantFactExtractor;
  private readonly config: LocalMemoryModuleConfig;

  constructor(config: LocalMemoryModuleConfig) {
    this.config = config;
    this.store = config.store ?? new InMemoryLocalMemoryStore();
    this.sensitiveFilter = new SensitiveMemoryFilter();
    this.retriever = new MemoryRetriever(this.store, config.embeddingRetriever);
    this.contextCompressor = new ContextCompressor(this.sensitiveFilter);
    this.memoryCompressor = new MemoryCompressor(this.store, config.summarizerAdapter);
    this.contextAssembler = new ContextAssembler(this.retriever, this.contextCompressor);
    this.factExtractor = new ImportantFactExtractor();
  }

  async writeMemory(input: WriteMemoryInput): Promise<LocalMemoryRecord> {
    const filterResult = this.config.sensitiveFilterEnabled ? this.sensitiveFilter.filter(input.content) : { safeContent: input.content, action: "none" as const, issues: [] };
    if (filterResult.action === "blocked" || filterResult.action === "dropped") {
      throw new LocalMemoryError("MEMORY_WRITE_BLOCKED", "Memory 写入被敏感信息策略阻止。", {
        issues: filterResult.issues.map((issue) => ({ type: issue.type, severity: issue.severity })),
      });
    }

    const createdAt = nowIso();
    const visibility = input.visibility ?? (input.scope === "project" ? "project" : input.scope === "system" ? "system" : "session");
    const retention = defaultRetention(input.scope, visibility, input.retention);
    const record: LocalMemoryRecord = {
      memoryId: createMemoryId(),
      scope: input.scope,
      type: input.type,
      title: input.title,
      content: filterResult.safeContent,
      structured: sanitizeStructured(input.structured),
      tags: Array.from(new Set([...(input.tags ?? []), ...(filterResult.action === "masked" ? ["masked"] : [])])),
      importance: clamp(input.importance ?? defaultImportance(input.type), 0, 10),
      confidence: 0.8,
      source: input.source,
      visibility,
      retention,
      createdAt,
      updatedAt: createdAt,
      expiresAt: applyTtl(createdAt, retention),
      accessCount: 0,
      metadata: {
        ...(input.structured?.projectId && typeof input.structured.projectId === "string" ? { projectId: input.structured.projectId } : {}),
        sensitiveFilterAction: filterResult.action,
        sensitiveIssues: filterResult.issues.map((issue) => ({ type: issue.type, severity: issue.severity })),
      },
    };

    const created = await this.store.create(record);
    await this.autoCompressIfNeeded(created.source.conversationId);
    return created;
  }

  async writeExtractedFacts(input: ExtractImportantFactsInput): Promise<LocalMemoryRecord[]> {
    const facts = this.factExtractor.extract(input);
    const records: LocalMemoryRecord[] = [];
    for (const fact of facts) {
      try {
        records.push(await this.writeMemory(fact));
      } catch {
        // One extracted fact must not block the whole conversation.
      }
    }
    return records;
  }

  getMemory(memoryId: string) {
    return this.store.get(memoryId);
  }

  async updateMemory(memoryId: string, patch: Partial<LocalMemoryRecord>) {
    if (patch.content && this.config.sensitiveFilterEnabled) {
      const filterResult = this.sensitiveFilter.filter(patch.content);
      if (filterResult.action === "blocked" || filterResult.action === "dropped") {
        throw new LocalMemoryError("SENSITIVE_CONTENT_BLOCKED", "Memory 更新被敏感信息策略阻止。", { memoryId });
      }
      patch = { ...patch, content: filterResult.safeContent };
    }
    return this.store.update(memoryId, { ...patch, updatedAt: nowIso() });
  }

  deleteMemory(memoryId: string) {
    return this.store.delete(memoryId);
  }

  searchMemory(query: MemorySearchQuery) {
    return this.store.search(query);
  }

  retrieveForContext(input: RetrieveMemoryInput) {
    return this.retriever.retrieve(input);
  }

  compressContext(input: CompressContextInput) {
    return this.contextCompressor.compress(input);
  }

  assembleContext(input: AssembleContextInput) {
    return this.contextAssembler.assemble(input);
  }

  compressMemories(input: MemoryCompressionInput) {
    return this.memoryCompressor.compress(input);
  }

  cleanup(input?: MemoryCleanupInput) {
    return this.store.cleanup(input);
  }

  private async autoCompressIfNeeded(conversationId?: string) {
    if (!this.config.enableAutoCompression || !conversationId) {
      return;
    }
    const records = await this.store.listByConversation(conversationId);
    const maxRecords = this.config.maxMemoryRecordsPerConversation ?? Number.POSITIVE_INFINITY;
    const maxChars = this.config.maxMemoryCharsPerConversation ?? Number.POSITIVE_INFINITY;
    const totalChars = records.reduce((total, record) => total + record.content.length, 0);
    if (records.length <= maxRecords && totalChars <= maxChars) {
      return;
    }
    await this.compressMemories({ conversationId, maxSummaryChars: Math.min(this.config.defaultContextBudget.maxChars, 2000), deleteSourceMemories: false });
  }
}

export function createLocalMemoryModule(config: LocalMemoryModuleConfig) {
  return new LocalMemoryModule(config);
}

function defaultImportance(type: WriteMemoryInput["type"]) {
  if (type === "decision" || type === "task_state" || type === "sql_result_summary" || type === "python_result_summary") {
    return 8;
  }
  if (type === "preference" || type === "fact" || type === "schema_context_summary" || type === "report_version_summary") {
    return 7;
  }
  if (type === "message") {
    return 4;
  }
  return 6;
}

function sanitizeStructured(value: Record<string, unknown> | undefined) {
  if (!value) {
    return undefined;
  }
  const blockedKeys = /password|passwd|pwd|token|api[_-]?key|secret|connectionString/i;
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      if (input.length > 20 && input.every((item) => item && typeof item === "object")) {
        return { omitted: true, reason: "raw_table_rows_blocked", rowCount: input.length };
      }
      return input.map(walk);
    }
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, item]) => [key, blockedKeys.test(key) ? "[MASKED]" : walk(item)]),
      );
    }
    return input;
  };
  return walk(value) as Record<string, unknown>;
}
