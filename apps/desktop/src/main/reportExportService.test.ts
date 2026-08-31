import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactRecord } from "./toolOrchestration";
import type { ReportExportRequest } from "../shared/reportExport";
import type { EvidenceCard } from "../shared/evidence";

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
        `{{chart:${chartArtifactId}}}`,
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

function evidenceCard(): EvidenceCard {
  return {
    evidenceCardId: "evidence-card:report-1:v2",
    reportArtifactId: reportArtifact.artifactId,
    reportVersion: 2,
    title: "溯据卡",
    statement: "本卡记录报告证据链。",
    status: "complete",
    dataSources: [{
      dataSourceId: "source-1",
      displayName: "脱敏信贷风险.csv",
      type: "conversation_csv",
      sourceFileName: "脱敏信贷风险.csv",
      tableIds: ["table-1"],
      tableNames: ["信贷风险"],
      scope: "conversation",
      rowCount: 200,
      fieldCount: 80,
      accessMode: "read_only",
      sourceToolCallIds: ["sql-call-1"],
    }],
    analysisScope: {
      description: "整体风险分类分析",
      tables: [{ tableId: "table-1", displayName: "信贷风险" }],
      selectedFields: [{ displayName: "风险分类", role: "dimension" }],
    },
    filters: [],
    formulas: [],
    sqlExecutions: [{
      toolCallId: "sql-call-1",
      status: "completed",
      purpose: "查询风险分类分布",
      dataSourceId: "source-1",
      tableNames: ["信贷风险"],
      sqlHash: "1234567890abcdef1234567890abcdef",
      inputArtifactIds: [],
      outputArtifactIds: ["sql-artifact-1"],
    }],
    pythonExecutions: [{
      toolCallId: "python-call-1",
      status: "completed",
      purpose: "计算风险分类占比",
      scriptHash: "abcdef1234567890abcdef1234567890",
      inputArtifactIds: ["sql-artifact-1"],
      outputArtifactIds: ["python-artifact-1"],
      inputFields: ["风险分类"],
      outputMetrics: ["分类占比"],
    }],
    upstreamArtifacts: [{
      artifactId: "sql-artifact-1",
      type: "sql_dataset",
      title: "风险分类查询结果",
      status: "ready",
      createdByToolCallId: "sql-call-1",
      sourceArtifactIds: [],
      downstreamArtifactIds: ["python-artifact-1"],
    }, {
      artifactId: "python-artifact-1",
      type: "python_analysis",
      title: "风险分类统计结果",
      status: "ready",
      createdByToolCallId: "python-call-1",
      sourceArtifactIds: ["sql-artifact-1"],
      downstreamArtifactIds: ["chart-artifact-1"],
    }],
    downstreamArtifacts: [{
      artifactId: "chart-artifact-1",
      type: "visualization",
      title: "风险分类分布图",
      status: "ready",
      sourceArtifactIds: ["python-artifact-1"],
      downstreamArtifactIds: [reportArtifact.artifactId],
    }],
    lineage: {
      nodes: [],
      edges: [],
      rootDataSourceIds: ["source-1"],
      reportArtifactId: reportArtifact.artifactId,
      complete: true,
    },
    limitations: [],
    validation: { valid: true, checks: [], missingEvidence: [] },
    generatedAt: "2026-08-31T00:00:00.000Z",
    generatedBy: "system",
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

  it("exports portable Markdown with the chart snapshot and expanded evidence sections", async () => {
    const { artifact, chartArtifactId } = visualizationReportArtifact();
    const card = evidenceCard();
    artifact.content = `${artifact.content}\n\n## 4. 溯据卡\n\n<evidence-card evidenceCardId="${card.evidenceCardId}"/>`;
    const source = runtime(artifact);
    source.resolveConversationReportEvidence.mockResolvedValue({ evidenceCard: card });
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/信贷风险表分析报告.md" });

    await new ReportExportService(source).export(request({
      visualizationImages: [{ artifactId: chartArtifactId, dataUrl: png, width: 2, height: 2 }],
    }));

    expect(source.resolveConversationReportEvidence).toHaveBeenCalledWith(
      "user-1",
      "conversation-1",
      reportArtifact.artifactId,
      2,
      card.evidenceCardId,
    );
    const output = mocks.writeFile.mock.calls[0]?.[1] as string;
    expect(output).toContain(`![风险分类分布](${png})`);
    expect(output).toContain("### 4.1 数据来源");
    expect(output).toContain("脱敏信贷风险.csv");
    expect(output).toContain("### 4.5 工具执行记录");
    expect(output).toContain("查询风险分类分布");
    expect(output).toContain("计算风险分类占比");
    expect(output).toContain("### 4.6 源数据与分析产物");
    expect(output).toContain("风险分类查询结果");
    expect(output).toContain("风险分类分布图");
    expect(output).not.toContain("{{chart:");
    expect(output).not.toContain("<evidence-card");
    expect(output).not.toContain(chartArtifactId);
  });
});
