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
});
