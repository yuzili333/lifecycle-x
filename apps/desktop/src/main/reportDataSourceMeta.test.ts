import { describe, expect, it } from "vitest";
import { artifactDataSourceMeta, sortToolRecordsByExecutionOrder, toolRecordDurationMs } from "../renderer/src/DataAssistantWorkspace";
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
    messageId: "message-1",
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
        record("python-1", "python_analysis", {
          temporaryDataSourceLabels: ["loan_contracts.csv"],
        }),
        record("report-1", "report_generation", {
          temporaryDataSourceLabels: ["loan_contracts.csv"],
        }),
      ],
      updatedAt: createdAt,
    } satisfies ConversationToolState);

    expect(meta).toEqual({
      count: 1,
      labels: ["loan_contracts.csv"],
    });
  });
});

describe("tool call presentation", () => {
  it("sorts tool records by actual completion order and reads recorded durations", () => {
    const report = {
      ...record("report-1", "report_generation", {}),
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:04.000Z",
      completedAt: "2026-07-17T00:00:04.000Z",
      metadata: { toolDurationMs: 200 },
    };
    const sql = {
      ...record("sql-1", "sql_query", {}),
      createdAt: "2026-07-17T00:00:01.000Z",
      updatedAt: "2026-07-17T00:00:02.000Z",
      completedAt: "2026-07-17T00:00:02.000Z",
      metadata: { toolDurationMs: 1_000 },
    };
    const chart = {
      ...record("chart-1", "chart_rendering", {}),
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:03.000Z",
      completedAt: "2026-07-17T00:00:03.000Z",
      metadata: { toolDurationMs: 80 },
    };

    expect(sortToolRecordsByExecutionOrder([report, chart, sql]).map((item) => item.toolCallId)).toEqual([
      "sql-1",
      "chart-1",
      "report-1",
    ]);
    expect(toolRecordDurationMs(report)).toBe(200);
  });
});
