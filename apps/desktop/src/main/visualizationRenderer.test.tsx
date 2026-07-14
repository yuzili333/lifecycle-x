import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildNumericTicks, VisualizationRenderer } from "../renderer/src/components/VisualizationRenderer";
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
    expect(html).toContain("--color-accent-primary");
    expect(html).toContain("--color-icon-blue");
    expect(html).toContain("--color-icon-teal");
  });

  it("derives continuous axis ranges from rendered data", () => {
    const html = renderToString(
      <VisualizationRenderer
        spec={barSpec({
          data: {
            mode: "inline",
            trusted: true,
            rowCount: 3,
            rows: [
              { year: 2024, amount: 30 },
              { year: 2025, amount: 85 },
              { year: 2026, amount: 120 },
            ],
          },
          dimensions: [{ field: "year", label: "年份", dataType: "number", role: "x" }],
          measures: [{ field: "amount", label: "金额", dataType: "number", role: "y" }],
          encoding: { x: "year", y: ["amount"] },
        })}
      />,
    );

    expect(html).toContain("2024");
    expect(html).toContain("2026");
    expect(html).toContain("120");
    expect(html).toContain("年份");
    expect(html).toContain("金额");
  });

  it("does not force zero into non-baseline numeric ticks", () => {
    expect(buildNumericTicks([2024, 2025, 2026], 5, { includeZero: false })).not.toContain(0);
    expect(buildNumericTicks([30, 85, 120], 5, { includeZero: true })).toContain(0);
  });

  it("renders time axis ticks from the source data range", () => {
    const html = renderToString(
      <VisualizationRenderer
        spec={barSpec({
          type: "line",
          data: {
            mode: "inline",
            trusted: true,
            rowCount: 3,
            rows: [
              { date: "2026-01-01", value: 101 },
              { date: "2026-01-02", value: 108 },
              { date: "2026-01-03", value: 112 },
            ],
          },
          dimensions: [{ field: "date", label: "日期", dataType: "time", role: "x" }],
          measures: [{ field: "value", label: "指标值", dataType: "number", role: "y" }],
          encoding: { x: "date", y: ["value"] },
        })}
      />,
    );

    expect(html).toContain("01/01");
    expect(html).toContain("01/03");
    expect(html).toContain("101");
    expect(html).toContain("112");
    expect(html).not.toContain(">0</text>");
  });

  it("renders two-dimensional point charts with data-derived x and y ticks", () => {
    const html = renderToString(
      <VisualizationRenderer
        spec={barSpec({
          type: "scatter",
          data: {
            mode: "inline",
            trusted: true,
            rowCount: 4,
            rows: [
              { riskScore: 620, exposureRatio: 0.18 },
              { riskScore: 700, exposureRatio: 0.27 },
              { riskScore: 760, exposureRatio: 0.41 },
              { riskScore: null, exposureRatio: null },
            ],
          },
          dimensions: [{ field: "riskScore", label: "风险评分", dataType: "number", role: "x" }],
          measures: [{ field: "exposureRatio", label: "敞口占比", dataType: "number", role: "y" }],
          encoding: { x: "riskScore", y: ["exposureRatio"] },
        })}
      />,
    );

    expect(html).toContain("风险评分");
    expect(html).toContain("敞口占比");
    expect(html).toContain(">620</text>");
    expect(html).toContain(">760</text>");
    expect(html).toContain(">0.24</text>");
    expect(html).toContain(">0.41</text>");
    expect(html).toContain("class=\"point\"");
    expect(html).not.toContain(">0</text>");
  });
});
