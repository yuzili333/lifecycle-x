import type { MemorySource, WriteMemoryInput } from "./types.js";
import { truncate } from "./utils.js";

export type ExtractImportantFactsInput = {
  content: string;
  source: MemorySource;
  conversationId?: string;
  projectId?: string;
};

export class ImportantFactExtractor {
  extract(input: ExtractImportantFactsInput): WriteMemoryInput[] {
    const sentences = input.content
      .split(/(?<=[。！？.!?])\s*|\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const results: WriteMemoryInput[] = [];
    for (const sentence of sentences) {
      const matched = classify(sentence);
      if (!matched) {
        continue;
      }
      results.push({
        scope: input.conversationId ? "conversation" : input.projectId ? "project" : "system",
        type: matched.type,
        title: matched.title,
        content: truncate(sentence, 600),
        importance: matched.importance,
        tags: matched.tags,
        source: { ...input.source, conversationId: input.source.conversationId ?? input.conversationId },
        visibility: input.projectId ? "project" : "session",
        structured: { extractedBy: "rule_based_fact_extractor" },
      });
    }
    return results.slice(0, 8);
  }
}

function classify(sentence: string): Pick<WriteMemoryInput, "type" | "title" | "importance" | "tags"> | null {
  if (/记住|偏好|以后|默认|我希望|配置/.test(sentence)) {
    return { type: "preference", title: "用户偏好", importance: 8, tags: ["preference"] };
  }
  if (/必须|禁止|不得|只允许|审批|权限|安全|脱敏|不可/.test(sentence)) {
    return { type: "decision", title: "已确认约束", importance: 9, tags: ["constraint", "safety"] };
  }
  if (/待办|后续|下一步|未完成|需要补充|TODO/i.test(sentence)) {
    return { type: "todo", title: "未完成事项", importance: 7, tags: ["todo"] };
  }
  if (/风险|异常|逾期|违约|预警|质量问题|缺失率|坏账/.test(sentence)) {
    return { type: "fact", title: "重要业务发现", importance: 8, tags: ["risk", "finding"] };
  }
  return null;
}
