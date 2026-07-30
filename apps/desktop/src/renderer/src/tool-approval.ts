import type {
  AssistantMessage,
} from "../../main/assistantRuntime";
import type {
  ConversationToolState,
  ToolCallRecord,
  ToolKind,
} from "../../main/toolOrchestration";

export type PendingToolApproval = {
  toolCallId: string;
  messageId?: string;
  toolName: string;
  createdAt: string;
  order: number;
};

const toolKindApprovalNames: Record<ToolKind, string> = {
  sql_query: "SQL",
  python_analysis: "PYTHON",
  chart_rendering: "图表",
  report_generation: "报告",
};

function recordApproval(record: ToolCallRecord, order: number): PendingToolApproval {
  return {
    toolCallId: record.toolCallId,
    messageId: record.messageId,
    toolName: toolKindApprovalNames[record.toolKind],
    createdAt: record.createdAt,
    order,
  };
}

export function pendingToolApprovals(
  messages: AssistantMessage[],
  toolState?: ConversationToolState | null,
): PendingToolApproval[] {
  const approvals = new Map<string, PendingToolApproval>();
  let order = 0;

  for (const record of toolState?.toolCalls ?? []) {
    if (record.status !== "waiting_approval") {
      continue;
    }
    approvals.set(record.toolCallId, recordApproval(record, order));
    order += 1;
  }

  for (const message of messages) {
    for (const block of message.blocks) {
      if (!block.toolCallId || block.toolStatus !== "pending_approval") {
        continue;
      }
      const existing = approvals.get(block.toolCallId);
      approvals.set(block.toolCallId, {
        toolCallId: block.toolCallId,
        messageId: message.id,
        toolName: block.toolName?.trim() || existing?.toolName || "TOOL",
        createdAt: existing?.createdAt ?? message.createdAt,
        order: existing?.order ?? order,
      });
      order += 1;
    }
  }

  return Array.from(approvals.values()).sort((left, right) => {
    const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (Number.isFinite(timeDifference) && timeDifference !== 0) {
      return timeDifference;
    }
    return left.order - right.order;
  });
}

export function hasOnlyPendingApprovalBlocks(message: AssistantMessage) {
  return (
    message.blocks.length > 0 &&
    message.blocks.every((block) => Boolean(block.toolCallId) && block.toolStatus === "pending_approval")
  );
}
