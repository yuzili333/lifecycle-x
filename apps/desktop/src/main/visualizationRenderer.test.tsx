import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VisualizationRenderer } from "../renderer/src/components/VisualizationRenderer";
import type { VisualizationSpec } from "../shared/visualization";

function kpiSpec(patch: Partial<VisualizationSpec> = {}): VisualizationSpec {
  return {
    specVersion: "1.0",
    visualizationId: "viz-render-1",
    type: "kpi",
    title: "风险客户数",
    data: {
      mode: "inline",
      trusted: true,
      rowCount: 1,
      rows: [{ riskCount: 12 }],
    },
    measures: [{ field: "riskCount", label: "风险客户数", dataType: "count", role: "value" }],
    encoding: { value: "riskCount" },
    provenance: { sourceType: "approved_inline", generatedAt: "2026-07-13T00:00:00.000Z" },
    ...patch,
  };
}

function barSpec(patch: Partial<VisualizationSpec> = {}): VisualizationSpec {
  return {
    specVersion: "1.0",
    visualizationId: "viz-render-bar",
    type: "bar",
    title: "分行风险数量",
    data: {
      mode: "inline",
      trusted: true,
      rowCount: 3,
      rows: [
        { branch: "杭州分行", count: 120 },
        { branch: "宁波分行", count: 80 },
        { branch: "温州分行", count: 30 },
      ],
    },
    dimensions: [{ field: "branch", label: "分行", dataType: "category", role: "x" }],
    measures: [{ field: "count", label: "风险数量", dataType: "count", role: "y" }],
    encoding: { x: "branch", y: ["count"] },
    provenance: { sourceType: "approved_inline", generatedAt: "2026-07-13T00:00:00.000Z" },
    ...patch,
  };
}

describe("VisualizationRenderer", () => {
  it("renders KPI specs without exposing raw protocol JSON", () => {
    const html = renderToString(<VisualizationRenderer spec={kpiSpec()} />);

    expect(html).toContain("风险客户数");
    expect(html).toContain("12");
    expect(html).not.toContain("specVersion");
  });

  it("renders artifact references as controlled source state", () => {
    const html = renderToString(
      <VisualizationRenderer
        spec={kpiSpec({
          data: { mode: "artifact", artifactId: "workflow-dataset:dataset-1", expectedSchema: { riskCount: "number" }, rowCount: 1 },
          provenance: { sourceType: "workflow_dataset", generatedAt: "2026-07-13T00:00:00.000Z", truncated: true },
        })}
      />,
    );

    expect(html).toContain("Artifact workflow-dataset:dataset-1");
    expect(html).toContain("已截断");
    expect(html).not.toContain("/Users/");
  });

  it("renders validation errors as fallback UI", () => {
    const html = renderToString(<VisualizationRenderer spec={{ ...kpiSpec(), type: "network", encoding: { source: "from" } } as VisualizationSpec} />);

    expect(html).toContain("可视化配置无法解析");
    expect(html).not.toContain("from");
  });

  it("renders cartesian chart axes and neutral themed SVG marks", () => {
    const html = renderToString(<VisualizationRenderer spec={barSpec()} />);

    expect(html).toContain("axis-tick-label");
    expect(html).toContain("grid-line");
    expect(html).toContain("杭州分行");
    expect(html).toContain("风险数量");
    expect(html).toContain("--viz-series-0");
  });
});
