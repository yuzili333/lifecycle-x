import { describe, expect, it, vi } from "vitest";
import { InMemoryArtifactManager, InMemoryToolResultRegistry, type ArtifactRecord, type ToolCallRecord, type ToolKind } from "./toolOrchestration";
import { InMemoryDatasetStateManager } from "./workflowRuntime";
import { ReportVisualizationArtifactResolver } from "./reportVisualizationArtifactResolver";

const conversationId = "conversation-1";
const chartArtifactId = "assistant-chart-spec:chart-1";
const reportArtifactId = "assistant-report-markdown:report-1";
const reportVersion = 1;

function visualizationSpec(data: Record<string, unknown> = {
  mode: "inline",
  trusted: true,
  rowCount: 2,
  rows: [
    { category: "正常", count: 8 },
    { category: "关注", count: 2 },
  ],
}) {
  return {
    specVersion: "1.0",
    visualizationId: "viz-chart-1",
    type: "bar",
    title: "风险分类分布",
    data,
    dimensions: [{ field: "category", dataType: "category", role: "x" }],
    measures: [{ field: "count", dataType: "count", role: "y" }],
    encoding: { x: "category", y: ["count"] },
    provenance: { sourceType: "approved_inline", generatedAt: "2026-07-22T00:00:00.000Z" },
  };
}

function reportMarkdown(artifactId = chartArtifactId) {
  return [
    "# 风险报告",
    "",
    "```visualization",
    JSON.stringify({
      specVersion: "1.0",
      visualizationId: "report-viz-ref",
      type: "table",
      title: "风险分类分布",
      data: { mode: "artifact", artifactId },
      dimensions: [{ field: "artifactId", dataType: "identifier", role: "category" }],
      measures: [],
      encoding: { category: "artifactId" },
      provenance: { sourceType: "workflow_dataset", generatedAt: "2026-07-22T00:00:00.000Z" },
      metadata: { reportEmbeddedVisualization: true, artifactId },
    }, null, 2),
    "```",
    "",
    "后续正文。",
  ].join("\n");
}

function toolRecord(toolKind: ToolKind, artifactId: string, sourceArtifactIds: string[] = []): ToolCallRecord {
  const toolCallId = `${toolKind}-1`;
  return {
    toolCallId,
    conversationId,
    messageId: "message-1",
    userId: "user-1",
    toolKind,
    toolName: toolKind,
    status: "completed",
    request: {},
    result: {
      resultId: `result-${toolCallId}`,
      toolKind,
      artifactIds: [artifactId],
      primaryArtifactId: artifactId,
      createdAt: "2026-07-22T00:00:00.000Z",
    },
    parentToolCallIds: [],
    sourceArtifactIds,
    outputArtifactIds: [artifactId],
    version: 1,
    isLatestSuccessful: true,
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    completedAt: "2026-07-22T00:00:00.000Z",
  };
}

async function fixture(options: {
  chartContent?: unknown;
  chartArtifactType?: ArtifactRecord["artifactType"];
  reportContent?: string;
  reportArtifactType?: ArtifactRecord["artifactType"];
  registerChart?: boolean;
  registerReport?: boolean;
  sourceArtifactIds?: string[];
} = {}) {
  const artifacts = new InMemoryArtifactManager();
  const records = new InMemoryToolResultRegistry();
  const datasets = new InMemoryDatasetStateManager();
  await artifacts.createArtifact({
    artifactId: chartArtifactId,
    artifactType: options.chartArtifactType ?? "visualization_spec",
    title: "风险分类分布",
    contentType: "visualization",
    content: options.chartContent ?? visualizationSpec(),
  });
  await artifacts.createArtifact({
    artifactId: reportArtifactId,
    artifactType: options.reportArtifactType ?? "report_markdown",
    title: "风险报告",
    contentType: "markdown",
    content: options.reportContent ?? reportMarkdown(),
  });
  if (options.registerChart !== false) {
    await records.register(toolRecord("chart_rendering", chartArtifactId, options.sourceArtifactIds));
  }
  if (options.registerReport !== false) {
    await records.register(toolRecord("report_generation", reportArtifactId, [chartArtifactId]));
  }
  return { artifacts, records, datasets, resolver: new ReportVisualizationArtifactResolver(artifacts, records, datasets) };
}

describe("ReportVisualizationArtifactResolver", () => {
  it("resolves a declared ready chart artifact and caches repeated reads", async () => {
    const { artifacts, resolver } = await fixture();
    const getArtifact = vi.spyOn(artifacts, "getArtifact");

    const first = await resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId });
    const second = await resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId });

    expect(first).toMatchObject({
      artifactId: chartArtifactId,
      version: 1,
      status: "ready",
      visualizationSpec: { type: "bar", title: "风险分类分布" },
      data: { rowCount: 2 },
    });
    expect(second).toBe(first);
    expect(getArtifact).toHaveBeenCalledTimes(2);
  });

  it("rejects an artifact not declared by the report", async () => {
    const { resolver } = await fixture({ reportContent: reportMarkdown("assistant-chart-spec:other") });
    await expect(resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId }))
      .rejects.toMatchObject({ code: "VISUALIZATION_ARTIFACT_PERMISSION_DENIED" });
  });

  it("rejects stale report versions, missing report ownership and wrong artifact types", async () => {
    const current = await fixture();
    await expect(current.resolver.resolve({ conversationId, reportArtifactId, reportVersion: 2, visualizationArtifactId: chartArtifactId }))
      .rejects.toMatchObject({ code: "VISUALIZATION_ARTIFACT_PERMISSION_DENIED" });

    const missingReportOwner = await fixture({ registerReport: false });
    await expect(missingReportOwner.resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId }))
      .rejects.toMatchObject({ code: "VISUALIZATION_ARTIFACT_PERMISSION_DENIED" });

    const wrongChartType = await fixture({ chartArtifactType: "analysis" });
    await expect(wrongChartType.resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId }))
      .rejects.toMatchObject({ code: "VISUALIZATION_SPEC_INVALID" });

    const wrongReportType = await fixture({ reportArtifactType: "analysis" });
    await expect(wrongReportType.resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId }))
      .rejects.toMatchObject({ code: "VISUALIZATION_ARTIFACT_EXPIRED" });
  });

  it("rejects missing ownership and invalid visualization specs", async () => {
    const missing = await fixture({ registerChart: false });
    await expect(missing.resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId }))
      .rejects.toMatchObject({ code: "VISUALIZATION_ARTIFACT_NOT_FOUND" });

    const invalid = await fixture({ chartContent: { type: "bar" } });
    await expect(invalid.resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId }))
      .rejects.toMatchObject({ code: "VISUALIZATION_SPEC_INVALID" });
  });

  it("reports expired structured data without exposing paths", async () => {
    const sourceArtifactId = "assistant-python-analysis:missing";
    const { resolver } = await fixture({
      chartContent: visualizationSpec({ mode: "artifact", artifactId: sourceArtifactId }),
      sourceArtifactIds: [sourceArtifactId],
    });
    await expect(resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId }))
      .rejects.toMatchObject({ code: "VISUALIZATION_ARTIFACT_EXPIRED" });
  });

  it("validates structured source schema across all resolved rows", async () => {
    const sourceArtifactId = "assistant-analysis-data:source-1";
    const { artifacts, resolver } = await fixture({
      chartContent: visualizationSpec({
        mode: "artifact",
        artifactId: sourceArtifactId,
        expectedSchema: { category: "text", amount: "number" },
      }),
      sourceArtifactIds: [sourceArtifactId],
    });
    await artifacts.createArtifact({
      artifactId: sourceArtifactId,
      artifactType: "analysis",
      contentType: "json",
      content: { rows: [{ category: "正常" }, { category: "关注", amount: 20 }], rowCount: 2 },
    });

    const result = await resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId });
    expect(result.data.columns.map((column) => column.name)).toEqual(["category", "amount"]);

    const mismatch = await fixture({
      chartContent: visualizationSpec({
        mode: "artifact",
        artifactId: sourceArtifactId,
        expectedSchema: { category: "text", missing: "number" },
      }),
      sourceArtifactIds: [sourceArtifactId],
    });
    await mismatch.artifacts.createArtifact({
      artifactId: sourceArtifactId,
      artifactType: "analysis",
      contentType: "json",
      content: { rows: [{ category: "正常", amount: 20 }], rowCount: 1 },
    });
    await expect(mismatch.resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId }))
      .rejects.toMatchObject({ code: "VISUALIZATION_SPEC_INVALID" });
  });

  it("resolves only explicitly encoded fields from a Python markdown table AST", async () => {
    const sourceArtifactId = "assistant-python-analysis:source-1";
    const { artifacts, resolver } = await fixture({
      chartContent: visualizationSpec({
        mode: "artifact",
        artifactId: sourceArtifactId,
        expectedSchema: { "客户所属国标行业名称": "unknown", "占比": "unknown" },
      }),
      sourceArtifactIds: [sourceArtifactId],
    });
    const chart = await artifacts.getArtifact(chartArtifactId);
    await artifacts.createArtifact({
      ...(chart as ArtifactRecord),
      artifactId: chartArtifactId,
      artifactType: "visualization_spec",
      contentType: "visualization",
      content: {
        ...visualizationSpec({
          mode: "artifact",
          artifactId: sourceArtifactId,
          expectedSchema: { "客户所属国标行业名称": "unknown", "占比": "unknown" },
        }),
        dimensions: [{ field: "客户所属国标行业名称", dataType: "category", role: "x" }],
        measures: [{ field: "占比", dataType: "percentage", role: "y" }],
        encoding: { x: "客户所属国标行业名称", y: ["占比"] },
      },
    });
    await artifacts.createArtifact({
      artifactId: sourceArtifactId,
      artifactType: "analysis",
      contentType: "markdown",
      content: [
        "# 分析结果",
        "",
        "## 按行业汇总",
        "| 客户所属国标行业名称 | 总计数 | 占比 |",
        "|---|---:|---:|",
        "| F5162--石油及制品批发 | 7 | 22.58% |",
        "| F5213--便利店零售 | 5 | 16.13% |",
        "",
        "## 其他表格",
        "| 风险分类 | 占比 |",
        "|---|---:|",
        "| 关注 | 19.35% |",
      ].join("\n"),
    });

    const result = await resolver.resolve({ conversationId, reportArtifactId, reportVersion, visualizationArtifactId: chartArtifactId });
    expect(result.data).toMatchObject({
      rowCount: 2,
      rows: [
        { "客户所属国标行业名称": "F5162--石油及制品批发", "占比": 22.58 },
        { "客户所属国标行业名称": "F5213--便利店零售", "占比": 16.13 },
      ],
    });
    expect(result.data.columns.map((column) => column.name)).toEqual(["客户所属国标行业名称", "占比"]);
  });
});
