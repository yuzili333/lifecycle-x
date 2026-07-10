import { isExpired, recordText, textSimilarity } from "./utils.js";
import type { LocalMemoryStore, MemoryEmbeddingRetriever, MemorySearchResult, RetrieveMemoryInput } from "./types.js";

export class MemoryRetriever {
  constructor(
    private readonly store: LocalMemoryStore,
    private readonly embeddingRetriever?: MemoryEmbeddingRetriever,
  ) {}

  async retrieve(input: RetrieveMemoryInput): Promise<{ results: MemorySearchResult[]; warnings: string[] }> {
    const warnings: string[] = [];
    try {
      const conversationResults = input.conversationId
        ? await this.store.search({
            text: input.userQuestion,
            conversationId: input.conversationId,
            limit: Math.max(input.limit ?? 8, 20),
          })
        : [];
      const projectResults = input.projectId
        ? await this.store.search({
            text: input.userQuestion,
            projectId: input.projectId,
            limit: Math.max(input.limit ?? 8, 20),
          })
        : [];
      const broadResults = await this.store.search({
        text: input.userQuestion,
        limit: Math.max(input.limit ?? 8, 20),
      });

      const dataSourceResults = await Promise.all(
        (input.dataSourceIds ?? []).map((dataSourceId) =>
          this.store.search({
            text: input.userQuestion,
            dataSourceId,
            limit: input.limit ?? 8,
          }),
        ),
      );

      let embeddingResults: MemorySearchResult[] = [];
      if (this.embeddingRetriever && input.userQuestion) {
        embeddingResults = await this.embeddingRetriever.search({
          query: input.userQuestion,
          limit: input.limit ?? 8,
          filters: {
            conversationId: input.conversationId,
            projectId: input.projectId,
            dataSourceIds: input.dataSourceIds,
            purpose: input.purpose,
          },
        });
      }

      const deduped = new Map<string, MemorySearchResult>();
      for (const result of [...conversationResults, ...projectResults, ...broadResults, ...dataSourceResults.flat(), ...embeddingResults]) {
        const current = deduped.get(result.record.memoryId);
        if (!current || result.score > current.score) {
          deduped.set(result.record.memoryId, result);
        }
      }

      let usedChars = 0;
      const ranked = Array.from(deduped.values())
        .filter((result) => result.record.retention.allowPromptInjection)
        .filter((result) => !isExpired(result.record))
        .map((result) => {
          const textScore = textSimilarity(input.userQuestion, recordText(result.record));
          const importanceScore = result.record.importance / 10;
          const ageMs = Date.now() - Date.parse(result.record.updatedAt);
          const recencyScore = Math.max(0, 1 - ageMs / (1000 * 60 * 60 * 24 * 30));
          const scopeMatchScore =
            (input.conversationId && result.record.source.conversationId === input.conversationId ? 0.5 : 0) +
            (input.projectId && result.record.metadata?.projectId === input.projectId ? 0.3 : 0) +
            (input.dataSourceIds?.some((dataSourceId) => dataSourceId === result.record.source.dataSourceId || dataSourceId === result.record.metadata?.dataSourceId) ? 0.2 : 0);
          const score = textScore * 0.4 + importanceScore * 0.25 + recencyScore * 0.2 + scopeMatchScore * 0.15;
          return { ...result, score, reason: `相关性 ${textScore.toFixed(2)}，重要性 ${importanceScore.toFixed(2)}，新鲜度 ${recencyScore.toFixed(2)}` };
        })
        .sort((left, right) => right.score - left.score);

      const results: MemorySearchResult[] = [];
      for (const result of ranked) {
        if (results.length >= (input.limit ?? 8)) {
          break;
        }
        const nextChars = usedChars + result.record.content.length;
        if (input.maxChars && nextChars > input.maxChars) {
          continue;
        }
        usedChars = nextChars;
        results.push(result);
      }
      return { results, warnings };
    } catch (error) {
      warnings.push(`Memory 检索失败，已返回空结果：${error instanceof Error ? error.message : "UNKNOWN_ERROR"}`);
      return { results: [], warnings };
    }
  }
}
