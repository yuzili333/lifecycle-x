import { describe, expect, it } from "vitest";
import {
  DefaultVisualizationRendererRegistry,
  DefaultVisualizationThemeResolver,
  StreamVisualizationAssembler,
  VisualizationRouter,
  createDefaultVisualizationRendererRegistry,
  createEChartsRendererAdapter,
  createFallbackRendererAdapter,
  createKpiRendererAdapter,
  createNetworkRendererAdapter,
  createTableRendererAdapter,
  createTimelineRendererAdapter,
  neutralDarkVisualizationTheme,
  neutralLightVisualizationTheme,
  transformToControlledEChartsOption,
  transformToNetworkPayload,
  transformToTimelinePayload,
  validateVisualizationSpec,
  type ResolvedVisualizationData,
  type VisualizationSpec,
} from "../shared/visualization";
import { InMemoryDatasetStateManager, type WorkflowDatasetRef } from "./workflowRuntime";
import { VisualizationArtifactResolverError, WorkflowArtifactDataResolver } from "./visualizationArtifactResolver";

function baseSpec(patch: Partial<VisualizationSpec> = {}): VisualizationSpec {
  return {
    specVersion: "1.0",
    visualizationId: "viz-1",
    type: "line",
    title: "余额趋势",
    businessSemantic: "asset_scale_trend",
    data: {
      mode: "inline",
      trusted: true,
      rowCount: 2,
      rows: [
        { month: "2026-01", balance: 100 },
        { month: "2026-02", balance: 120 },
      ],
    },
    dimensions: [{ field: "month", dataType: "time", role: "x" }],
    measures: [{ field: "balance", dataType: "currency", role: "y" }],
    encoding: { x: "month", y: ["balance"] },
    provenance: { sourceType: "approved_inline", generatedAt: "2026-07-13T00:00:00.000Z" },
    ...patch,
  };
}

const resolvedData: ResolvedVisualizationData = {
  columns: [
    { name: "month", type: "string" },
    { name: "balance", type: "number" },
    { name: "source", type: "string" },
    { name: "target", type: "string" },
    { name: "startTime", type: "string" },
    { name: "title", type: "string" },
  ],
  rows: [
    { month: "2026-01", balance: 100, source: "A", target: "B", startTime: "2026-01-01", title: "检查" },
    { month: "2026-02", balance: 120, source: "B", target: "C", startTime: "2026-02-01", title: "整改" },
  ],
  rowCount: 2,
  truncated: false,
  masked: false,
  warnings: [],
};

describe("Visualization validator", () => {
  it("accepts legal line, KPI, circular, network and timeline specs", () => {
    expect(validateVisualizationSpec(baseSpec()).success).toBe(true);
    expect(validateVisualizationSpec(baseSpec({ type: "kpi", measures: [{ field: "balance", dataType: "currency", role: "value" }], encoding: { value: "balance" } })).success).toBe(true);
    expect(validateVisualizationSpec(baseSpec({ type: "pie" })).success).toBe(true);
    expect(validateVisualizationSpec(baseSpec({ type: "donut" })).success).toBe(true);
    expect(validateVisualizationSpec(baseSpec({ type: "network", businessSemantic: "guarantee_relationship", encoding: { source: "source", target: "target" }, dimensions: [{ field: "source", dataType: "identifier" }, { field: "target", dataType: "identifier" }] })).success).toBe(true);
    expect(validateVisualizationSpec(baseSpec({ type: "timeline", businessSemantic: "lifecycle_event_chain", encoding: { startTime: "startTime", category: "title" }, dimensions: [{ field: "startTime", dataType: "time" }, { field: "title", dataType: "category" }] })).success).toBe(true);
  });

  it("rejects missing artifact id, bad type, missing fields and unsafe values", () => {
    expect(validateVisualizationSpec(baseSpec({ data: { mode: "artifact", artifactId: "" } as VisualizationSpec["data"] })).success).toBe(false);
    expect(validateVisualizationSpec({ ...baseSpec(), type: "radar" }).success).toBe(false);
    expect(validateVisualizationSpec(baseSpec({ encoding: { x: "missing", y: ["balance"] } })).success).toBe(false);
    expect(validateVisualizationSpec(baseSpec({ type: "network", encoding: { source: "source" } })).success).toBe(false);
    expect(validateVisualizationSpec(baseSpec({ type: "timeline", encoding: { category: "title" } })).success).toBe(false);
    expect(validateVisualizationSpec(baseSpec({ metadata: { formatter: "function () { return 1 }" } })).success).toBe(false);
    expect(validateVisualizationSpec(baseSpec({ description: "<script>alert(1)</script>" })).success).toBe(false);
    expect(validateVisualizationSpec(baseSpec({ description: "file:///Users/yuzili/private.csv" })).success).toBe(false);
  });

  it("enforces inline data limits", () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({ month: `2026-0${index}`, balance: index }));
    expect(validateVisualizationSpec(baseSpec({ data: { mode: "inline", trusted: true, rowCount: 3, rows } }), { inlineDataMaxRows: 2 }).success).toBe(false);
  });

  it("treats a non-array encoding.y as invalid input without throwing", () => {
    expect(() => validateVisualizationSpec(baseSpec({ encoding: { x: "month", y: 1 } as never }))).not.toThrow();
  });
});

describe("Visualization router", () => {
  it("routes KPI, common charts, timeline, network and fallback", () => {
    const router = new VisualizationRouter(createDefaultVisualizationRendererRegistry());
    expect(router.route(baseSpec({ type: "kpi" })).engine).toBe("kpi");
    expect(router.route(baseSpec({ type: "heatmap" })).engine).toBe("echarts");
    expect(router.route(baseSpec({ type: "timeline", businessSemantic: "lifecycle_event_chain" })).engine).toBe("vis_timeline");
    expect(router.route(baseSpec({ type: "network", businessSemantic: "guarantee_relationship" })).engine).toBe("vis_network");

    const fallbackOnly = new VisualizationRouter(new DefaultVisualizationRendererRegistry([createFallbackRendererAdapter()]));
    expect(fallbackOnly.route(baseSpec({ type: "bar" })).engine).toBe("fallback");
  });

  it("supports dynamic register and unregister by capability priority", () => {
    const registry = new DefaultVisualizationRendererRegistry([createFallbackRendererAdapter()]);
    const router = new VisualizationRouter(registry);
    expect(router.route(baseSpec({ type: "bar" })).engine).toBe("fallback");
    registry.register(createEChartsRendererAdapter());
    expect(router.route(baseSpec({ type: "bar" })).engine).toBe("echarts");
    registry.unregister("echarts-controlled-renderer");
    expect(router.route(baseSpec({ type: "bar" })).engine).toBe("fallback");
  });
});

describe("StreamVisualizationAssembler", () => {
  it("handles start, duplicate/out-of-order deltas, complete and incomplete streams", () => {
    const assembler = new StreamVisualizationAssembler({ allowInlineData: true });
    assembler.handleStreamEvent({ type: "visualization_start", eventId: "e1", conversationId: "c", messageId: "m", visualizationId: "viz-1", createdAt: "2026-07-13T00:00:00.000Z", payload: { title: "余额趋势" } });
    assembler.handleStreamEvent({ type: "visualization_delta", eventId: "e3", conversationId: "c", messageId: "m", visualizationId: "viz-1", createdAt: "2026-07-13T00:00:02.000Z", payload: { sequence: 2, path: "title", value: "余额趋势" } });
    assembler.handleStreamEvent({ type: "visualization_delta", eventId: "e2", conversationId: "c", messageId: "m", visualizationId: "viz-1", createdAt: "2026-07-13T00:00:01.000Z", payload: { sequence: 1, path: "type", value: "line" } });
    assembler.handleStreamEvent({ type: "visualization_delta", eventId: "e2d", conversationId: "c", messageId: "m", visualizationId: "viz-1", createdAt: "2026-07-13T00:00:01.000Z", payload: { sequence: 1, path: "type", value: "bar" } });
    const completed = assembler.handleStreamEvent({ type: "visualization_complete", eventId: "e4", conversationId: "c", messageId: "m", visualizationId: "viz-1", createdAt: "2026-07-13T00:00:03.000Z", payload: { spec: baseSpec() } });
    expect(completed.status).toBe("ready");

    assembler.handleStreamEvent({ type: "visualization_start", eventId: "e5", conversationId: "c", messageId: "m", visualizationId: "viz-2", createdAt: "2026-07-13T00:00:04.000Z", payload: {} });
    expect(assembler.flushIncomplete().some((state) => state.visualizationId === "viz-2" && state.status === "failed")).toBe(true);
  });
});

describe("Visualization renderer adapters", () => {
  it("transforms controlled ECharts, network, timeline and table payloads", async () => {
    const echarts = transformToControlledEChartsOption(baseSpec({ type: "bar_line_combo" }), resolvedData, neutralDarkVisualizationTheme);
    expect(echarts).toHaveProperty("series");
    expect(JSON.stringify(echarts)).not.toContain("function");

    const network = transformToNetworkPayload(baseSpec({ type: "network", encoding: { source: "source", target: "target" } }), resolvedData);
    expect(network.nodes.length).toBeGreaterThan(0);

    const timeline = transformToTimelinePayload(baseSpec({ type: "timeline", encoding: { startTime: "startTime", category: "title" } }), resolvedData);
    expect(timeline.items).toHaveLength(2);

    const tablePayload = await createTableRendererAdapter().transform({ spec: baseSpec({ type: "table" }), data: resolvedData, theme: neutralDarkVisualizationTheme });
    expect(tablePayload.engine).toBe("table");
    expect(createKpiRendererAdapter().canRender({ spec: baseSpec({ type: "kpi" }) })).toBe(true);
    expect(createNetworkRendererAdapter().canRender({ spec: baseSpec({ type: "network", businessSemantic: "related_enterprise_risk" }) })).toBe(true);
    expect(createTimelineRendererAdapter().canRender({ spec: baseSpec({ type: "timeline", businessSemantic: "lifecycle_event_chain" }) })).toBe(true);
  });

  it("maps Astryx neutral tokens to light and dark chart options", () => {
    const light = transformToControlledEChartsOption(baseSpec({ type: "bar" }), resolvedData, neutralLightVisualizationTheme);
    const dark = transformToControlledEChartsOption(baseSpec({ type: "donut" }), resolvedData, neutralDarkVisualizationTheme);

    expect(neutralLightVisualizationTheme.name).toBe("astryx-neutral");
    expect(neutralDarkVisualizationTheme.name).toBe("astryx-neutral");
    expect(neutralLightVisualizationTheme.mode).toBe("light");
    expect(neutralDarkVisualizationTheme.mode).toBe("dark");
    expect(neutralLightVisualizationTheme.colors.background).not.toBe(neutralDarkVisualizationTheme.colors.background);
    expect(light.tooltip).toMatchObject({
      backgroundColor: neutralLightVisualizationTheme.colors.background,
      borderColor: neutralLightVisualizationTheme.colors.border,
    });
    expect(dark.legend).toMatchObject({ textStyle: { color: neutralDarkVisualizationTheme.colors.textSecondary } });
    expect(JSON.stringify(dark)).not.toContain("gradient");
  });

  it("resolves system appearance without changing the visualization artifact", () => {
    const resolver = new DefaultVisualizationThemeResolver();
    const spec = baseSpec({ theme: { palette: "neutral", mode: "system" } });
    const originalSpec = JSON.stringify(spec);
    const light = resolver.resolve(spec, { appearance: "light" });
    const dark = resolver.resolve(spec, { appearance: "dark" });

    expect(light.mode).toBe("light");
    expect(dark.mode).toBe("dark");
    expect(light.colors.background).not.toBe(dark.colors.background);
    expect(JSON.stringify(spec)).toBe(originalSpec);
  });
});

describe("WorkflowArtifactDataResolver", () => {
  function dataset(patch: Partial<WorkflowDatasetRef> = {}): WorkflowDatasetRef {
    return {
      datasetId: "dataset-1",
      workflowId: "workflow-1",
      conversationId: "conversation-1",
      name: "查询结果",
      sourceType: "sql_execution_result",
      sqliteTableName: "wf_dataset_1",
      sqliteDatabasePath: "/Users/yuzili/private/app.sqlite",
      rowCount: 100,
      columnCount: 2,
      schema: { branch_name: "text", balance: "number" },
      profile: {
        datasetId: "dataset-1",
        rowCount: 100,
        columnCount: 2,
        columns: [
          { name: "branch_name", type: "text" },
          { name: "balance", type: "number" },
        ],
        previewRows: [
          { branch_name: "上海分行", balance: 12 },
          { branch_name: "北京分行", balance: 18 },
        ],
        warnings: [],
        generatedAt: "2026-07-13T00:00:00.000Z",
      },
      status: "ready",
      canQuery: true,
      canAnalyze: true,
      canUseForReport: true,
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
      ...patch,
    };
  }

  it("resolves workflow dataset artifacts without exposing local paths", async () => {
    const manager = new InMemoryDatasetStateManager();
    await manager.registerDataset(dataset());
    const resolver = new WorkflowArtifactDataResolver(manager);

    const result = await resolver.resolve({ artifactId: "workflow-dataset:dataset-1", expectedSchema: { branch_name: "text" }, maxRowsForInline: 1 });

    expect(result.artifactId).toBe("workflow-dataset:dataset-1");
    expect(result.rows).toHaveLength(1);
    expect(result.dataRef).toBe("workflow-dataset:dataset-1");
    expect(JSON.stringify(result)).not.toContain("/Users/yuzili");
    expect(result.truncated).toBe(true);
  });

  it("rejects missing, unauthorized and schema-mismatched artifacts", async () => {
    const manager = new InMemoryDatasetStateManager();
    await manager.registerDataset(dataset({ datasetId: "blocked", canQuery: false, canAnalyze: false, canUseForReport: false }));
    const resolver = new WorkflowArtifactDataResolver(manager);

    await expect(resolver.resolve({ artifactId: "missing" })).rejects.toMatchObject({ code: "VISUALIZATION_DATA_NOT_FOUND" });
    await expect(resolver.resolve({ artifactId: "blocked" })).rejects.toMatchObject({ code: "VISUALIZATION_DATA_PERMISSION_DENIED" });

    await manager.registerDataset(dataset());
    await expect(resolver.resolve({ artifactId: "dataset-1", expectedSchema: { unknown: "text" } })).rejects.toMatchObject({ code: "VISUALIZATION_SCHEMA_MISMATCH" });
  });

  it("uses typed resolver errors", async () => {
    const error = new VisualizationArtifactResolverError("VISUALIZATION_ARTIFACT_FAILED", "failed");
    expect(error.name).toBe("VisualizationArtifactResolverError");
    expect(error.code).toBe("VISUALIZATION_ARTIFACT_FAILED");
  });
});
