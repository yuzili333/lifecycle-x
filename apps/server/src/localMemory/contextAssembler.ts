import { ContextCompressor } from "./contextCompressor.js";
import { MemoryRetriever } from "./memoryRetriever.js";
import { createContextId, nowIso, truncate } from "./utils.js";
import type { AssembleContextInput, AssembleContextOutput, AssembledModelMessage, ContextItem } from "./types.js";

export class ContextAssembler {
  constructor(
    private readonly retriever: MemoryRetriever,
    private readonly compressor: ContextCompressor,
  ) {}

  async assemble(input: AssembleContextInput): Promise<AssembleContextOutput> {
    const memoryRetrieval = await this.retriever.retrieve({
      conversationId: input.conversationId,
      projectId: input.projectId,
      userQuestion: input.userQuestion,
      purpose: input.purpose,
      limit: 8,
      maxChars: input.budget.reservedCharsForMemory,
    });

    const memoryItems: ContextItem[] = memoryRetrieval.results.map((result) => ({
      itemId: `memory_${result.record.memoryId}`,
      type: "memory",
      content: `Memory: ${result.record.title ?? result.record.type}\n${result.record.content}`,
      priority: Math.max(6, result.record.importance),
      createdAt: result.record.updatedAt,
      metadata: {
        memoryId: result.record.memoryId,
        title: result.record.title,
        memoryType: result.record.type,
        retrievalScore: result.score,
      },
    }));

    const safetyPolicy = [
      "安全策略：",
      "- 不得注入或推断数据库密码、API Key、Token、连接串和未脱敏敏感字段原值。",
      "- 不得把完整源表数据、完整 SQL 查询结果或完整 Python stdout 当作长期上下文。",
      "- 精确计算、SQL 执行和 Python 分析必须通过受控工具与审批流程。",
    ].join("\n");

    const systemInstruction = input.systemInstruction?.trim() || "你是存续期业务数据探针智能体，回答需基于授权数据、可追溯上下文和安全策略。";
    const systemItems: ContextItem[] = [
      {
        itemId: "system_instruction",
        type: "system_instruction",
        content: `${systemInstruction}\n\n${safetyPolicy}\n\n当前用途：${purposeLabel(input.purpose)}`,
        priority: 10,
        createdAt: nowIso(),
        metadata: { safetyCritical: true },
      },
    ];

    const currentUserItem: ContextItem = {
      itemId: "current_user_question",
      type: "user_message",
      content: input.userQuestion,
      priority: 10,
      createdAt: nowIso(),
      metadata: { isCurrentUserQuestion: true },
    };

    const items = [
      ...systemItems,
      ...memoryItems,
      ...(input.schemaContextItems ?? []),
      ...(input.toolContextItems ?? []),
      ...(input.taskStateItems ?? []),
      ...(input.recentMessages ?? []),
      currentUserItem,
    ];

    const compressedContext = await this.compressor.compress({
      conversationId: input.conversationId,
      userQuestion: input.userQuestion,
      items,
      budget: input.budget,
      compressionMode: "hybrid",
      preserveTypes: ["system_instruction", "user_message", "approval_state", "task_state"],
    });

    const messages = toMessages(compressedContext.retainedItems, input.userQuestion);
    return {
      contextId: createContextId(),
      messages,
      compressedContext,
      injectedMemoryIds: compressedContext.memoryRefs,
      warnings: [...memoryRetrieval.warnings, ...compressedContext.warnings],
      createdAt: nowIso(),
    };
  }
}

function toMessages(items: ContextItem[], userQuestion: string): AssembledModelMessage[] {
  const systemParts: string[] = [];
  const messages: AssembledModelMessage[] = [];
  const sorted = [...items].sort((left, right) => priorityOrder(left) - priorityOrder(right));
  let hasCurrentUser = false;
  for (const item of sorted) {
    if (item.type === "system_instruction" || item.type === "memory" || item.type === "schema_context" || item.type === "task_state" || item.type === "approval_state") {
      systemParts.push(item.content);
      continue;
    }
    if (item.type === "tool_result") {
      messages.push({ role: "tool", content: item.content, metadata: item.metadata });
      continue;
    }
    if (item.type === "assistant_message") {
      messages.push({ role: "assistant", content: item.content, metadata: item.metadata });
      continue;
    }
    if (item.type === "user_message") {
      if (item.metadata?.isCurrentUserQuestion) {
        hasCurrentUser = true;
      }
      messages.push({ role: "user", content: item.content, metadata: item.metadata });
    }
  }
  return [
    { role: "system", content: truncate(systemParts.join("\n\n"), 40_000) },
    ...messages,
    ...(hasCurrentUser ? [] : [{ role: "user" as const, content: userQuestion, metadata: { isCurrentUserQuestion: true } }]),
  ];
}

function priorityOrder(item: ContextItem) {
  if (item.type === "system_instruction") {
    return 0;
  }
  if (item.type === "memory" || item.type === "schema_context" || item.type === "task_state" || item.type === "approval_state") {
    return 1;
  }
  if (item.metadata?.isCurrentUserQuestion) {
    return 9;
  }
  return 5;
}

function purposeLabel(purpose: AssembleContextInput["purpose"]) {
  const labels: Record<AssembleContextInput["purpose"], string> = {
    chat: "通用对话",
    sql_generation: "SQL 生成",
    python_analysis: "Python 分析",
    report_generation: "报告生成",
    risk_analysis: "风险分析",
  };
  return labels[purpose];
}
