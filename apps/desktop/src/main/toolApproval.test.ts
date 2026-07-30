import { describe, expect, it } from "vitest";
import type { AssistantMessage, AssistantToolKind } from "./assistantRuntime";
import type { ConversationToolState } from "./toolOrchestration";
import {
  hasOnlyPendingApprovalBlocks,
  pendingToolApprovals,
} from "../renderer/src/tool-approval";

function message(
  id: string,
  createdAt: string,
  toolCallId: string,
  toolName: AssistantToolKind,
): AssistantMessage {
  return {
    id,
    conversationId: "conversation-1",
    userId: "user-1",
    role: "assistant",
    status: "awaiting_approval",
    content: "工具调用等待审批。",
    blocks: [
      {
        id: `${id}-block`,
        type: "card",
        content: "",
        toolCallId,
        toolName,
        toolStatus: "pending_approval",
      },
    ],
    createdAt,
    updatedAt: createdAt,
    integrityHash: `${id}-hash`,
  };
}

describe("pendingToolApprovals", () => {
  it("merges tool state and message approvals, deduplicates and preserves creation order", () => {
    const state: ConversationToolState = {
      conversationId: "conversation-1",
      toolCalls: [
        {
          toolCallId: "tool-python",
          conversationId: "conversation-1",
          messageId: "message-python",
          userId: "user-1",
          toolKind: "python_analysis",
          toolName: "request_python_analysis",
          status: "waiting_approval",
          request: {},
          version: 1,
          isLatestSuccessful: false,
          createdAt: "2026-07-30T10:00:02.000Z",
          updatedAt: "2026-07-30T10:00:02.000Z",
        },
      ],
      updatedAt: "2026-07-30T10:00:02.000Z",
    };
    const approvals = pendingToolApprovals(
      [
        message("message-sql", "2026-07-30T10:00:01.000Z", "tool-sql", "sql"),
        message("message-python", "2026-07-30T10:00:02.000Z", "tool-python", "python"),
      ],
      state,
    );

    expect(approvals.map((approval) => approval.toolCallId)).toEqual([
      "tool-sql",
      "tool-python",
    ]);
    expect(approvals.map((approval) => approval.toolName)).toEqual(["sql", "python"]);
  });

  it("recognizes approval-only messages so the empty bubble can be suppressed", () => {
    expect(
      hasOnlyPendingApprovalBlocks(
        message("message-sql", "2026-07-30T10:00:01.000Z", "tool-sql", "sql"),
      ),
    ).toBe(true);
    const withText = message(
      "message-sql",
      "2026-07-30T10:00:01.000Z",
      "tool-sql",
      "sql",
    );
    withText.blocks.unshift({ id: "text", type: "text", content: "准备查询。" });
    expect(hasOnlyPendingApprovalBlocks(withText)).toBe(false);
  });
});
