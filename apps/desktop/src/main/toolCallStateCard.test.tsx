import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportToolCallCard, ToolCallStateCard, toolRecordSummary, toolStatusLabel } from "../renderer/src/components/tool-calls";
import { TOOL_NAMES, type ToolCallRecord, type ToolKind } from "./toolOrchestration";

const createdAt = "2026-07-14T00:00:00.000Z";

function record(toolKind: ToolKind, patch: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    toolCallId: `${toolKind}-1`,
    conversationId: "conversation-1",
    userId: "user-1",
    toolKind,
    toolName: TOOL_NAMES[toolKind],
    status: "completed",
    request: { userRequest: "test" },
    outputArtifactIds: [`${toolKind}-artifact-1`],
    parentToolCallIds: ["parent-1"],
    sourceArtifactIds: ["source-artifact-1"],
    version: 1,
    isLatestSuccessful: true,
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
    ...patch,
  };
}

describe("ToolCallStateCard", () => {
  it("renders the four independent tool kinds", () => {
    const html = renderToString(
      <>
        <ToolCallStateCard record={record("sql_query")} />
        <ToolCallStateCard record={record("python_analysis")} />
        <ToolCallStateCard record={record("chart_rendering")} />
        <ToolCallStateCard record={record("report_generation")} />
      </>,
    );

    expect(html).toContain("SQL 查询");
    expect(html).toContain("Python 分析");
    expect(html).toContain("绘制图表");
    expect(html).toContain("生成报告");
  });

  it("renders executing, approval, failed and selected states", () => {
    const html = renderToString(
      <>
        <ToolCallStateCard record={record("sql_query", { status: "executing", outputArtifactIds: [] })} />
        <ToolCallStateCard record={record("python_analysis", { status: "waiting_approval", outputArtifactIds: [] })} />
        <ToolCallStateCard record={record("chart_rendering", { status: "failed", outputArtifactIds: [], error: { code: "TOOL_EXECUTION_FAILED", message: "failed", traceId: "trace-1" } })} />
        <ToolCallStateCard record={record("report_generation")} isSelected canOpenReport />
      </>,
    );

    expect(html).toContain("执行中");
    expect(html).toContain("待审批");
    expect(html).toContain("失败");
    expect(html).toContain("默认输入");
    expect(html).toContain("打开报告");
  });

  it("summarizes version, artifacts and lineage", () => {
    expect(toolStatusLabel("blocked")).toBe("已阻塞");
    expect(toolRecordSummary(record("sql_query", { version: 3, outputArtifactIds: ["a", "b"] }))).toBe("v3 · 已完成 · 2 Artifact · 血缘 2");
  });
});

describe("ReportToolCallCard", () => {
  it("renders dynamic report metadata and creating status", () => {
    const html = renderToString(
      <ReportToolCallCard
        title="整体风险分类分布报告"
        version={2}
        generatedAt="2026/07/15 10:00"
        chartCount={1}
        dataSourceCount={1}
        dataSourceLabels={["信贷资产测试数据集 / CSV"]}
        status="creating"
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain("版本 2");
    expect(html).toContain("包含 <!-- -->1<!-- --> 张图表");
    expect(html).toContain("1<!-- --> 个数据来源");
    expect(html).toContain("数据来源：信贷资产测试数据集 / CSV");
    expect(html).toContain("creating");
    expect(html).not.toContain("已生成 Markdown 报告");
    expect(html).not.toContain("样本笔数");
    expect(html).not.toContain("数据源：用户选择数据源");
    expect(html).not.toContain("assistant-report-card-summary");
  });
});
