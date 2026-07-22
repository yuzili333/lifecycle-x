import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseReportMarkdownVisualizations, reportVisualizationArtifactIds } from "../shared/visualization";
import { ReportMarkdownViewer } from "../renderer/src/components/tool-calls/ReportMarkdownViewer";
import { ReportVisualizationContent, type ReportVisualizationState } from "../renderer/src/components/tool-calls/ReportVisualizationNode";

function visualizationFence(artifactId: string, title = "五级分类分布") {
  return [
    "```visualization",
    JSON.stringify({
      specVersion: "1.0",
      visualizationId: `ref_${artifactId.replace(/[^a-z0-9]/gi, "_")}`,
      type: "table",
      title,
      data: { mode: "artifact", artifactId },
      dimensions: [{ field: "artifactId", dataType: "identifier", role: "category" }],
      measures: [],
      encoding: { category: "artifactId" },
      provenance: { sourceType: "workflow_dataset", generatedAt: "2026-07-22T00:00:00.000Z" },
      metadata: { reportEmbeddedVisualization: true, artifactId },
    }, null, 2),
    "```",
  ].join("\n");
}

describe("report visualization markdown", () => {
  it("parses a visualization node between ordinary report sections without leaking the raw fence", () => {
    const markdown = `# 风险报告\n\n正文上半段。\n\n${visualizationFence("assistant-chart-spec:chart-1")}\n\n正文下半段。`;
    const segments = parseReportMarkdownVisualizations(markdown, 3);

    expect(segments.map((segment) => segment.type)).toEqual(["markdown", "visualization", "markdown"]);
    expect(segments[1]).toMatchObject({
      type: "visualization",
      artifactId: "assistant-chart-spec:chart-1",
      key: "report-viz:assistant-chart-spec:chart-1:v3",
      title: "五级分类分布",
    });
    expect(segments.filter((segment) => segment.type === "markdown").map((segment) => segment.markdown).join(""))
      .toBe("# 风险报告\n\n正文上半段。\n\n\n正文下半段。");
    expect(JSON.stringify(segments)).not.toContain("```visualization");
  });

  it("supports multiple stable chart nodes and deduplicates declared artifact ids", () => {
    const markdown = `${visualizationFence("assistant-chart-spec:chart-1")}\n${visualizationFence("assistant-chart-spec:chart-2", "贷款余额分布")}`;
    const segments = parseReportMarkdownVisualizations(markdown, 7);

    expect(reportVisualizationArtifactIds(markdown)).toEqual(["assistant-chart-spec:chart-1", "assistant-chart-spec:chart-2"]);
    expect(segments.filter((segment) => segment.type === "visualization").map((segment) => segment.key)).toEqual([
      "report-viz:assistant-chart-spec:chart-1:v7",
      "report-viz:assistant-chart-spec:chart-2:v7",
    ]);
  });

  it("turns malformed, inline, duplicate and unclosed nodes into safe fallback nodes", () => {
    const inline = visualizationFence("assistant-chart-spec:chart-1").replace(
      '"mode": "artifact",\n    "artifactId": "assistant-chart-spec:chart-1"',
      '"mode": "inline",\n    "trusted": true,\n    "rowCount": 0,\n    "rows": []',
    );
    const markdown = [
      "```visualization\n{bad json}\n```",
      inline,
      visualizationFence("assistant-chart-spec:chart-2"),
      visualizationFence("assistant-chart-spec:chart-2"),
      "```visualization\n{}",
    ].join("\n\n");
    const nodes = parseReportMarkdownVisualizations(markdown).filter((segment) => segment.type === "visualization");

    expect(nodes).toHaveLength(5);
    expect(nodes.filter((node) => node.errorCode === "VISUALIZATION_NODE_INVALID")).toHaveLength(4);
    expect(JSON.stringify(nodes)).not.toContain("bad json");
  });

  it("keeps ordinary fenced code intact", () => {
    const markdown = "正文\n\n```sql\nselect 1;\n```\n\n结尾";
    expect(parseReportMarkdownVisualizations(markdown)).toEqual([{ type: "markdown", key: "report-markdown:1:0", markdown }]);
  });

  it("does not parse visualization examples nested inside ordinary fences", () => {
    const nested = visualizationFence("assistant-chart-spec:example-only");
    const markdown = `正文\n\n\`\`\`\`markdown\n${nested}\n\`\`\`\`\n\n结尾`;

    expect(parseReportMarkdownVisualizations(markdown)).toEqual([{ type: "markdown", key: "report-markdown:1:0", markdown }]);
    expect(reportVisualizationArtifactIds(markdown)).toEqual([]);
  });

  it("renders a stable loading node without showing the visualization protocol or artifact id", () => {
    const artifactId = "assistant-chart-spec:private-chart-1";
    const html = renderToString(
      <ReportMarkdownViewer
        markdown={`# 报告\n\n${visualizationFence(artifactId)}\n\n图表后正文。`}
        userId="user-1"
        conversationId="conversation-1"
        reportArtifactId="assistant-report-markdown:report-1"
        reportVersion={2}
      />,
    );

    expect(html).toContain("报告");
    expect(html).toContain("图表后正文");
    expect(html).toContain("data-visualization-state=\"loading\"");
    expect(html).not.toContain("```visualization");
    expect(html).not.toContain(artifactId);
  });

  it.each([
    [{ status: "loading" }, "loading", "加载中"],
    [{ status: "empty" }, "empty", "当前图表没有可展示的数据"],
    [{ status: "expired" }, "expired", "该图表数据已失效"],
    [{ status: "failed", message: "图表加载失败，报告中的其他内容仍可正常查看。" }, "failed", "图表加载失败"],
  ] as Array<[ReportVisualizationState, string, string]>)
  ("renders the %s report visualization state without internal references", (state, stateName, expectedText) => {
    const html = renderToString(
      <ReportVisualizationContent
        state={state}
        title="风险分类分布"
        artifactId="assistant-chart-spec:private-chart-1"
        retryKey="report-viz-key"
        onRetry={() => undefined}
      />,
    );

    expect(html).toContain(`data-visualization-state="${stateName}"`);
    expect(html).toContain(expectedText);
    expect(html).not.toContain("assistant-chart-spec:private-chart-1");
  });

  it("renders a resolved chart through the shared visualization renderer", () => {
    const artifactId = "assistant-chart-spec:private-chart-1";
    const html = renderToString(
      <ReportVisualizationContent
        state={{
          status: "ready",
          artifact: {
            artifactId,
            version: 2,
            status: "ready",
            visualizationSpec: {
              specVersion: "1.0",
              visualizationId: "viz-risk-classification",
              type: "bar",
              title: "风险分类分布",
              data: { mode: "artifact", artifactId: "workflow-dataset:analysis-1" },
              dimensions: [{ field: "risk", label: "风险分类", dataType: "category", role: "x" }],
              measures: [{ field: "count", label: "合同笔数", dataType: "count", role: "y" }],
              encoding: { x: "risk", y: ["count"] },
              provenance: { sourceType: "python", generatedAt: "2026-07-22T00:00:00.000Z" },
            },
            data: {
              columns: [{ name: "risk", type: "text" }, { name: "count", type: "number" }],
              rows: [{ risk: "正常", count: 8 }, { risk: "关注", count: 2 }],
              rowCount: 2,
              truncated: false,
              masked: false,
              warnings: [],
            },
            sourceArtifactIds: ["workflow-dataset:analysis-1"],
            createdAt: "2026-07-22T00:00:00.000Z",
          },
        }}
        title="风险分类分布"
        artifactId={artifactId}
        retryKey={`${artifactId}:v2`}
        onRetry={() => undefined}
      />,
    );

    expect(html).toContain('data-visualization-state="ready"');
    expect(html).toContain("assistant-visualization embedded");
    expect(html).toContain("风险分类分布");
    expect(html).toContain("正常");
    expect(html).not.toContain(artifactId);
    expect(html).not.toContain("workflow-dataset:analysis-1");
  });
});
