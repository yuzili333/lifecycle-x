import { describe, expect, it } from "vitest";
import { artifactDataSourceMeta } from "../renderer/src/DataAssistantWorkspace";
import type { AssistantMessage } from "./assistantRuntime";
import type { ConversationToolState, ToolCallRecord } from "./toolOrchestration";

const createdAt = "2026-07-17T00:00:00.000Z";

function message(): AssistantMessage {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    userId: "user-1",
    role: "assistant",
    status: "completed",
    content: "# 报告",
    blocks: [
      {
        id: "sql-block",
        type: "json",
        content: "SQL result",
        toolCallId: "sql-1",
        toolStatus: "completed",
        toolName: "sql",
        toolTarget: "SQL Script",
        toolFiles: ["query.sql"],
      },
      {
        id: "python-block",
        type: "markdown",
        content: "# 报告\nworkflow-dataset:dataset-1",
        toolCallId: "python-1",
        toolStatus: "completed",
        toolName: "python",
        toolTarget: "Python Script",
        toolFiles: ["analysis.py"],
      },
    ],
    createdAt,
    updatedAt: createdAt,
    context: { dataSourceLabel: "loan_contracts.csv" },
    integrityHash: "hash-message-1",
  };
}

function record(toolCallId: string, toolKind: ToolCallRecord["toolKind"], request: Record<string, unknown>): ToolCallRecord {
  return {
    toolCallId,
    conversationId: "conversation-1",
    userId: "user-1",
    toolKind,
    toolName: toolKind,
    status: "completed",
    request,
    outputArtifactIds: [`${toolCallId}-artifact`],
    sourceArtifactIds: ["workflow-dataset:dataset-1"],
    parentToolCallIds: [],
    version: 1,
    isLatestSuccessful: true,
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
  };
}

describe("artifactDataSourceMeta", () => {
  it("counts only real selected data sources, not tool scripts or artifacts", () => {
    const meta = artifactDataSourceMeta(message(), {
      conversationId: "conversation-1",
      toolCalls: [
        record("sql-1", "sql_query", {
          dataSourceId: "csv-source-1",
          dataSourceLabel: "loan_contracts.csv",
        }),
        record("python-1", "python_analysis", {}),
        record("report-1", "report_generation", {}),
      ],
      updatedAt: createdAt,
    } satisfies ConversationToolState);

    expect(meta).toEqual({
      count: 1,
      labels: ["loan_contracts.csv"],
    });
  });
});
