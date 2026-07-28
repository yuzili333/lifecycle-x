import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactRecord } from "./toolOrchestration";
import type { ReportExportRequest } from "../shared/reportExport";

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  BrowserWindow: class BrowserWindow {},
  dialog: { showSaveDialog: mocks.showSaveDialog },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, writeFile: mocks.writeFile };
});

import { ReportExportService } from "./reportExportService";

const reportArtifact: ArtifactRecord = {
  artifactId: "assistant-report-markdown:report-1",
  artifactType: "report_markdown",
  title: "信贷风险表分析报告",
  contentType: "markdown",
  content: "# 报告\n\n**结论**",
  createdAt: "2026-07-28T00:00:00.000Z",
};

function request(overrides: Partial<ReportExportRequest> = {}): ReportExportRequest {
  return {
    userId: "user-1",
    conversationId: "conversation-1",
    reportArtifactId: reportArtifact.artifactId,
    reportVersion: 2,
    suggestedTitle: "信贷风险表分析报告",
    format: "markdown",
    visualizationImages: [],
    ...overrides,
  };
}

function runtime(artifact: ArtifactRecord | null = reportArtifact) {
  return {
    getConversationReportExportArtifact: vi.fn().mockResolvedValue(artifact),
    resolveConversationReportVisualization: vi.fn(),
    resolveConversationReportEvidence: vi.fn(),
  };
}

function visualizationReportArtifact() {
  const chartArtifactId = "assistant-chart-spec:chart-1";
  return {
    chartArtifactId,
    artifact: {
      ...reportArtifact,
      content: [
        "# 报告",
        "```visualization",
        JSON.stringify({
          specVersion: "1.0",
          visualizationId: "chart_1",
          type: "table",
          title: "风险分类分布",
          data: { mode: "artifact", artifactId: chartArtifactId },
          dimensions: [{ field: "artifactId", dataType: "identifier", role: "category" }],
          measures: [],
          encoding: { category: "artifactId" },
          provenance: { sourceType: "workflow_dataset", generatedAt: "2026-07-28T00:00:00.000Z" },
          metadata: { reportEmbeddedVisualization: true, artifactId: chartArtifactId },
        }),
        "```",
      ].join("\n"),
    } satisfies ArtifactRecord,
  };
}

describe("ReportExportService", () => {
  beforeEach(() => {
    mocks.showSaveDialog.mockReset();
    mocks.writeFile.mockReset();
  });

  it("writes the trusted report Artifact as UTF-8 Markdown for the selected version", async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/信贷风险表分析报告.md" });
    const source = runtime();
    const result = await new ReportExportService(source).export(request());

    expect(source.getConversationReportExportArtifact).toHaveBeenCalledWith(
      "user-1",
      "conversation-1",
      reportArtifact.artifactId,
      2,
    );
    expect(mocks.writeFile).toHaveBeenCalledWith("/tmp/信贷风险表分析报告.md", reportArtifact.content, "utf8");
    expect(result).toEqual({
      status: "completed",
      format: "markdown",
      fileName: "信贷风险表分析报告.md",
    });
  });

  it("treats a cancelled save dialog as a non-error result", async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true });
    const result = await new ReportExportService(runtime()).export(request());

    expect(result).toEqual({ status: "cancelled", format: "markdown" });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("blocks PDF export before opening the save dialog when a declared chart snapshot is missing", async () => {
    const { artifact } = visualizationReportArtifact();

    await expect(new ReportExportService(runtime(artifact)).export(request({ format: "pdf" })))
      .rejects.toThrow("REPORT_EXPORT_VISUALIZATION_MISSING");
    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("embeds a validated PNG chart in DOCX without exposing its Artifact ID", async () => {
    const { artifact, chartArtifactId } = visualizationReportArtifact();
    const source = runtime(artifact);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/信贷风险表分析报告.docx" });

    const result = await new ReportExportService(source).export(request({
      format: "docx",
      visualizationImages: [{ artifactId: chartArtifactId, dataUrl: png, width: 2, height: 2 }],
    }));

    expect(source.resolveConversationReportVisualization).toHaveBeenCalledWith(
      "user-1",
      "conversation-1",
      reportArtifact.artifactId,
      2,
      chartArtifactId,
    );
    const output = mocks.writeFile.mock.calls[0]?.[1] as Buffer;
    expect(output.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(output.includes(Buffer.from(chartArtifactId))).toBe(false);
    expect(result.status).toBe("completed");
  });
});
