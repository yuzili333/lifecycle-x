import { app, BrowserWindow, dialog } from "electron";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  evidenceCardMarkdown,
  parseReportEvidenceNodes,
  reportEvidenceCardIds,
  type EvidenceCard,
} from "../shared/evidence";
import {
  type ReportExportErrorCode,
  type ReportExportErrorDetail,
  type ReportExportFormat,
  type ReportExportRequest,
  type ReportExportResult,
  type ReportExportVisualizationImage,
} from "../shared/reportExport";
import {
  parseReportMarkdownVisualizations,
  reportVisualizationArtifactIds,
} from "../shared/visualization";
import type { ArtifactRecord } from "./toolOrchestration";
import { renderReportDocx, renderReportHtml, type ExportDocumentModel } from "./reportExportDocument";

const MAX_CHART_COUNT = 20;
const MAX_CHART_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_CHART_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16_000;

type ReportExportRuntime = {
  getConversationReportExportArtifact(
    userId: string,
    conversationId: string,
    artifactId: string,
    reportVersion: number,
  ): Promise<ArtifactRecord | null>;
  resolveConversationReportVisualization(
    userId: string,
    conversationId: string,
    reportArtifactId: string,
    reportVersion: number,
    visualizationArtifactId: string,
  ): Promise<unknown>;
  resolveConversationReportEvidence(
    userId: string,
    conversationId: string,
    reportArtifactId: string,
    reportVersion: number,
    evidenceCardId: string,
  ): Promise<{ evidenceCard: EvidenceCard }>;
};

export class ReportExportService {
  constructor(private readonly runtime: ReportExportRuntime) {}

  async export(request: ReportExportRequest): Promise<ReportExportResult> {
    const traceId = randomUUID();
    try {
      validateRequest(request);
      const artifact = await this.runtime.getConversationReportExportArtifact(
        request.userId,
        request.conversationId,
        request.reportArtifactId,
        request.reportVersion,
      );
      if (!artifact || typeof artifact.content !== "string") {
        throw exportError("REPORT_EXPORT_ARTIFACT_NOT_FOUND", "当前报告版本不存在或已失效。", request, traceId, false);
      }
      const sourceMarkdown = artifact.content;
      const model = request.format === "markdown"
        ? { markdown: sourceMarkdown, images: new Map<string, ReportExportVisualizationImage>() }
        : await this.prepareDocumentModel(request, sourceMarkdown, traceId);
      const fileName = defaultFileName(request.suggestedTitle || artifact.title || "分析报告", request.format);
      const target = await dialog.showSaveDialog({
        title: `导出${formatLabel(request.format)}`,
        defaultPath: join(app.getPath("documents"), fileName),
        filters: [{ name: formatLabel(request.format), extensions: [extensionFor(request.format)] }],
      });
      if (target.canceled || !target.filePath) {
        return { status: "cancelled", format: request.format };
      }
      const output = await createOutput(request.format, model);
      if (typeof output === "string") {
        await writeFile(target.filePath, output, "utf8");
      } else {
        await writeFile(target.filePath, output);
      }
      return {
        status: "completed",
        format: request.format,
        fileName: basename(target.filePath),
      };
    } catch (error) {
      const normalized = normalizeExportError(error, request, traceId);
      console.error("Report export failed", {
        code: normalized.code,
        format: normalized.format,
        reportArtifactId: normalized.reportArtifactId,
        reportVersion: normalized.reportVersion,
        traceId: normalized.traceId,
        recoverable: normalized.recoverable,
      });
      throw Object.assign(new Error(`[${normalized.code}] ${normalized.message} Trace: ${normalized.traceId}`), normalized);
    }
  }

  private async prepareDocumentModel(
    request: ReportExportRequest,
    sourceMarkdown: string,
    traceId: string,
  ): Promise<ExportDocumentModel> {
    const visualizationIds = reportVisualizationArtifactIds(sourceMarkdown);
    const imageByArtifactId = validateVisualizationImages(request, visualizationIds, traceId);
    await Promise.all(visualizationIds.map(async (artifactId) => {
      try {
        await this.runtime.resolveConversationReportVisualization(
          request.userId,
          request.conversationId,
          request.reportArtifactId,
          request.reportVersion,
          artifactId,
        );
      } catch {
        throw exportError(
          "REPORT_EXPORT_VISUALIZATION_MISSING",
          `图表“${imageByArtifactId.get(artifactId)?.title ?? "未命名图表"}”已失效，无法导出完整报告。`,
          request,
          traceId,
          true,
        );
      }
    }));
    const evidenceById = new Map<string, EvidenceCard>();
    for (const evidenceCardId of reportEvidenceCardIds(sourceMarkdown)) {
      try {
        const resolved = await this.runtime.resolveConversationReportEvidence(
          request.userId,
          request.conversationId,
          request.reportArtifactId,
          request.reportVersion,
          evidenceCardId,
        );
        evidenceById.set(evidenceCardId, resolved.evidenceCard);
      } catch {
        throw exportError(
          "REPORT_EXPORT_EVIDENCE_UNAVAILABLE",
          "报告溯据卡已失效，无法导出完整报告。",
          request,
          traceId,
          true,
        );
      }
    }
    return materializeExportDocument(sourceMarkdown, request.reportVersion, imageByArtifactId, evidenceById);
  }
}

type ValidatedImage = ReportExportVisualizationImage & { title: string };

function validateRequest(request: ReportExportRequest) {
  if (
    !request
    || !["pdf", "docx", "markdown"].includes(request.format)
    || !request.userId?.trim()
    || !request.conversationId?.trim()
    || !request.reportArtifactId?.trim()
    || !Number.isInteger(request.reportVersion)
    || request.reportVersion < 1
    || !Array.isArray(request.visualizationImages)
  ) {
    throw new Error("导出参数不完整。");
  }
}

function validateVisualizationImages(
  request: ReportExportRequest,
  expectedIds: string[],
  traceId: string,
) {
  if (expectedIds.length > MAX_CHART_COUNT || request.visualizationImages.length !== expectedIds.length) {
    throw exportError(
      "REPORT_EXPORT_VISUALIZATION_MISSING",
      "报告图表快照不完整，请重新打开报告后再导出。",
      request,
      traceId,
      true,
    );
  }
  const expected = new Set(expectedIds);
  const images = new Map<string, ValidatedImage>();
  let totalBytes = 0;
  for (const image of request.visualizationImages) {
    const bytes = estimatedDataUrlBytes(image.dataUrl);
    if (
      !expected.has(image.artifactId)
      || images.has(image.artifactId)
      || !isPngDataUrl(image.dataUrl)
      || bytes <= 0
      || bytes > MAX_CHART_BYTES
      || !Number.isInteger(image.width)
      || !Number.isInteger(image.height)
      || image.width < 1
      || image.height < 1
      || image.width > MAX_IMAGE_DIMENSION
      || image.height > MAX_IMAGE_DIMENSION
    ) {
      throw exportError(
        "REPORT_EXPORT_VISUALIZATION_INVALID",
        "报告图表快照无效，请重新打开报告后再导出。",
        request,
        traceId,
        true,
      );
    }
    totalBytes += bytes;
    images.set(image.artifactId, { ...image, title: "报告图表" });
  }
  if (totalBytes > MAX_TOTAL_CHART_BYTES || images.size !== expected.size) {
    throw exportError(
      "REPORT_EXPORT_VISUALIZATION_INVALID",
      "报告图表数据过大或不完整，无法导出。",
      request,
      traceId,
      true,
    );
  }
  return images;
}

export function materializeExportDocument(
  sourceMarkdown: string,
  reportVersion: number,
  imageByArtifactId: Map<string, ValidatedImage>,
  evidenceById: Map<string, EvidenceCard>,
): ExportDocumentModel {
  const images = new Map<string, ReportExportVisualizationImage>();
  const markdownParts: string[] = [];
  let imageIndex = 0;
  for (const segment of parseReportEvidenceNodes(sourceMarkdown, reportVersion)) {
    if (segment.type === "evidence") {
      const card = segment.evidenceCardId ? evidenceById.get(segment.evidenceCardId) : undefined;
      if (!card) throw new Error("报告溯据卡内容不完整。");
      markdownParts.push(evidenceCardMarkdown(card, segment.sectionNumber));
      continue;
    }
    for (const nested of parseReportMarkdownVisualizations(segment.markdown, reportVersion)) {
      if (nested.type === "markdown") {
        markdownParts.push(nested.markdown);
        continue;
      }
      const image = nested.artifactId ? imageByArtifactId.get(nested.artifactId) : undefined;
      if (!image) throw new Error("报告图表内容不完整。");
      const token = `report-export-image-${imageIndex++}`;
      images.set(token, image);
      markdownParts.push(`\n\n![${escapeMarkdownLabel(nested.title ?? image.title)}](${token})\n\n`);
    }
  }
  return { markdown: markdownParts.join(""), images };
}

async function createOutput(format: ReportExportFormat, model: ExportDocumentModel) {
  if (format === "markdown") return model.markdown;
  if (format === "docx") return renderReportDocx(model);
  return renderPdf(renderReportHtml(model));
}

async function renderPdf(html: string) {
  const temporaryDirectory = await mkdtemp(join(app.getPath("temp"), "cycle-probe-report-export-"));
  const temporaryHtmlPath = join(temporaryDirectory, "report.html");
  let window: BrowserWindow | null = null;
  try {
    window = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await writeFile(temporaryHtmlPath, html, "utf8");
    await window.loadFile(temporaryHtmlPath);
    await window.webContents.executeJavaScript("document.fonts ? document.fonts.ready.then(() => true) : true");
    return await window.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function defaultFileName(title: string, format: ReportExportFormat) {
  const cleanTitle = title
    .replace(/\.(?:pdf|docx?|md|markdown)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "分析报告";
  const date = new Date();
  const timestamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
  return `${cleanTitle}-${timestamp}.${extensionFor(format)}`;
}

function extensionFor(format: ReportExportFormat) {
  return format === "markdown" ? "md" : format;
}

function formatLabel(format: ReportExportFormat) {
  return format === "docx" ? "Word 文档" : format === "markdown" ? "Markdown" : "PDF";
}

function estimatedDataUrlBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? 0 : Math.floor((dataUrl.length - comma - 1) * 0.75);
}

function isPngDataUrl(dataUrl: string) {
  if (!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(dataUrl)) return false;
  const comma = dataUrl.indexOf(",");
  const signature = Buffer.from(dataUrl.slice(comma + 1), "base64").subarray(0, 8);
  return signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/[[\]\\]/g, "\\$&").replace(/\r?\n/g, " ").trim();
}

function exportError(
  code: ReportExportErrorCode,
  message: string,
  request: ReportExportRequest,
  traceId: string,
  recoverable: boolean,
) {
  return Object.assign(new Error(message), {
    code,
    message,
    format: request.format,
    reportArtifactId: request.reportArtifactId,
    reportVersion: request.reportVersion,
    traceId,
    recoverable,
  } satisfies ReportExportErrorDetail);
}

function normalizeExportError(
  error: unknown,
  request: ReportExportRequest,
  traceId: string,
): ReportExportErrorDetail {
  if (
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
    && error.code.startsWith("REPORT_EXPORT_")
  ) {
    return error as ReportExportErrorDetail;
  }
  const message = error instanceof Error ? error.message : "报告导出失败。";
  return {
    code: /导出参数/.test(message)
      ? "REPORT_EXPORT_REQUEST_INVALID"
      : /write|EACCES|EPERM|ENOSPC/i.test(message)
        ? "REPORT_EXPORT_WRITE_FAILED"
        : "REPORT_EXPORT_RENDER_FAILED",
    message: /导出参数/.test(message) ? message : "报告导出失败，请重试。",
    format: request.format,
    reportArtifactId: request.reportArtifactId,
    reportVersion: request.reportVersion,
    traceId,
    recoverable: true,
  };
}
