import { describe, expect, it } from "vitest";
import { calculateDocxColumnWidths, renderReportDocx, renderReportHtml } from "./reportExportDocument";
import type { TableCellNode } from "@astryxdesign/core/Markdown";

const chartDataUrl = `data:image/png;base64,${Buffer.from("png-test-data").toString("base64")}`;
const model = {
  markdown: [
    "# 信贷风险分析报告",
    "",
    "正文包含 **重要结论**。",
    "",
    "| 分类 | 笔数 |",
    "|---|---:|",
    "| 正常 | 10 |",
    "",
    "![风险分类分布](report-export-image-0)",
  ].join("\n"),
  images: new Map([[
    "report-export-image-0",
    {
      artifactId: "assistant-chart-spec:private-id",
      dataUrl: chartDataUrl,
      width: 1200,
      height: 700,
    },
  ]]),
};

describe("report export document rendering", () => {
  it("renders headings, bold text, tables and chart images into print HTML without Artifact IDs", () => {
    const html = renderReportHtml(model);

    expect(html).toContain("@page { size: A4");
    expect(html).toContain('"FangSong", "仿宋"');
    expect(html).toContain("<h1>信贷风险分析报告</h1>");
    expect(html).toContain("<strong>重要结论</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain(chartDataUrl);
    expect(html).not.toContain("assistant-chart-spec:private-id");
  });

  it("creates a DOCX package for the same structured report", async () => {
    const output = await renderReportDocx(model);

    expect(output.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(output.byteLength).toBeGreaterThan(2_000);
  });

  it("allocates the full document width across table columns based on content length", () => {
    const cell = (content: string): TableCellNode => ({ children: [{ type: "text", content }] });
    const widths = calculateDocxColumnWidths(
      [cell("分类"), cell("分析说明")],
      [[cell("正常"), cell("该列包含较长的分析说明，应获得更宽的可读空间。")]],
    );

    expect(widths).toHaveLength(2);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeGreaterThan(9_000);
    expect(widths[1]).toBeGreaterThan(widths[0]);
  });
});
