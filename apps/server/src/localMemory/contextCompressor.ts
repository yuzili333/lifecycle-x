import { SensitiveMemoryFilter } from "./sensitiveMemoryFilter.js";
import { createContextId, itemChars, nowIso, truncate } from "./utils.js";
import type { CompressedContext, CompressContextInput, ContextItem } from "./types.js";

const DEFAULT_PRESERVE_TYPES: ContextItem["type"][] = ["system_instruction", "approval_state", "task_state"];

export class ContextCompressor {
  constructor(private readonly filter = new SensitiveMemoryFilter()) {}

  async compress(input: CompressContextInput): Promise<CompressedContext> {
    const mode = input.compressionMode ?? "hybrid";
    const preserveTypes = new Set([...(input.preserveTypes ?? []), ...DEFAULT_PRESERVE_TYPES]);
    const warnings: string[] = [];
    const originalChars = input.items.reduce((total, item) => total + itemChars(item), 0);
    const safeItems: ContextItem[] = [];
    const droppedItems: ContextItem[] = [];

    for (const item of input.items) {
      const filterResult = this.filter.filter(item.content);
      if (filterResult.action === "blocked" || filterResult.action === "dropped") {
        droppedItems.push(item);
        warnings.push(...filterResult.issues.map((issue) => `${item.itemId}: ${issue.message}`));
        continue;
      }
      const safeItem = filterResult.action === "masked" ? { ...item, content: filterResult.safeContent } : item;
      warnings.push(...filterResult.issues.map((issue) => `${item.itemId}: ${issue.message}`));
      safeItems.push(safeItem);
    }

    const sorted = [...safeItems].sort((left, right) => {
      const leftPreserved = shouldPreserve(left, preserveTypes, input.userQuestion) ? 1 : 0;
      const rightPreserved = shouldPreserve(right, preserveTypes, input.userQuestion) ? 1 : 0;
      return rightPreserved - leftPreserved || right.priority - left.priority || Date.parse(right.createdAt ?? "0") - Date.parse(left.createdAt ?? "0");
    });

    const retainedItems: ContextItem[] = [];
    const summaryParts: string[] = [];
    const maxChars = Math.max(1, input.budget.maxChars);
    const maxItems = input.budget.maxItems ?? Number.POSITIVE_INFINITY;
    let usedChars = 0;

    if (mode === "summary") {
      for (const item of sorted) {
        if (shouldPreserve(item, preserveTypes, input.userQuestion) && retainedItems.length < maxItems) {
          const retained = fitItem(item, Math.max(0, maxChars - usedChars));
          retainedItems.push(retained);
          usedChars += itemChars(retained);
        } else {
          summaryParts.push(summarizeItem(item));
          droppedItems.push(item);
        }
      }
    } else {
      for (const item of sorted) {
        const preserved = shouldPreserve(item, preserveTypes, input.userQuestion);
        const highPriority = item.priority >= 8;
        const nextChars = usedChars + itemChars(item);
        if (retainedItems.length < maxItems && (nextChars <= maxChars || preserved)) {
          const retained = nextChars <= maxChars ? item : fitItem(item, Math.max(160, maxChars - usedChars));
          retainedItems.push(retained);
          usedChars += itemChars(retained);
          if (nextChars > maxChars) {
            warnings.push(`${item.itemId}: 预算不足，已截断但保留关键项。`);
          }
          continue;
        }
        if (mode === "hybrid" && highPriority) {
          summaryParts.push(summarizeItem(item));
        }
        droppedItems.push(item);
      }
    }

    const summary = buildSummary(summaryParts, input.budget.maxChars);
    const summaryItem = summary
      ? ({
          itemId: `summary_${createContextId()}`,
          type: "memory",
          content: summary,
          priority: 7,
          createdAt: nowIso(),
          metadata: { compressionSummary: true },
        } satisfies ContextItem)
      : null;

    if (summaryItem && retainedItems.reduce((total, item) => total + itemChars(item), 0) + summaryItem.content.length <= maxChars && retainedItems.length < maxItems) {
      retainedItems.push(summaryItem);
    } else if (summaryItem) {
      warnings.push("摘要因上下文预算不足未作为独立 item 注入，仅保留在 compressedContext.summary。");
    }

    const compressedChars = retainedItems.reduce((total, item) => total + itemChars(item), 0);
    if (compressedChars > maxChars) {
      warnings.push(`压缩后上下文 ${compressedChars} 字符仍超过预算 ${maxChars}。`);
    }

    return {
      contextId: createContextId(),
      conversationId: input.conversationId,
      originalItemCount: input.items.length,
      compressedItemCount: retainedItems.length,
      originalChars,
      compressedChars,
      summary,
      retainedItems,
      droppedItems,
      memoryRefs: retainedItems.map((item) => item.metadata?.memoryId).filter((memoryId): memoryId is string => typeof memoryId === "string"),
      warnings,
      createdAt: nowIso(),
      metadata: { compressionMode: mode },
    };
  }
}

function shouldPreserve(item: ContextItem, preserveTypes: Set<ContextItem["type"]>, userQuestion?: string) {
  return preserveTypes.has(item.type) || item.metadata?.safetyCritical === true || item.metadata?.isCurrentUserQuestion === true || Boolean(userQuestion && item.type === "user_message" && item.content === userQuestion);
}

function fitItem(item: ContextItem, maxChars: number): ContextItem {
  if (item.content.length <= maxChars || maxChars <= 0) {
    return item;
  }
  return {
    ...item,
    content: truncate(item.content, maxChars),
    tokenEstimate: Math.min(item.tokenEstimate ?? item.content.length, maxChars),
    metadata: { ...item.metadata, truncatedByMemoryCompressor: true },
  };
}

function summarizeItem(item: ContextItem) {
  const title = typeof item.metadata?.title === "string" ? item.metadata.title : item.type;
  return `- ${title}：${truncate(item.content.replace(/\s+/g, " ").trim(), 220)}`;
}

function buildSummary(parts: string[], maxChars: number) {
  if (parts.length === 0) {
    return "";
  }
  const content = ["压缩摘要：", ...parts].join("\n");
  return truncate(content, Math.max(240, Math.floor(maxChars * 0.4)));
}
