import {
  reportVisualizationArtifactIds,
  validateVisualizationSpec,
  type ResolvedReportVisualizationArtifact,
  type ResolvedVisualizationData,
  type ReportVisualizationErrorCode,
  type VisualizationSpec,
} from "../shared/visualization";
import { parseMarkdown, type BlockNode, type InlineNode, type TableCellNode } from "@astryxdesign/core/Markdown";
import type { ArtifactManager, ArtifactRecord, ToolCallRecord, ToolResultRegistry } from "./toolOrchestration";
import { WorkflowArtifactDataResolver } from "./visualizationArtifactResolver";
import type { DatasetStateManager } from "./workflowRuntime";

export class ReportVisualizationArtifactResolver {
  private readonly cache = new Map<string, Promise<ResolvedReportVisualizationArtifact>>();

  constructor(
    private readonly artifactManager: ArtifactManager,
    private readonly toolResultRegistry: ToolResultRegistry,
    private readonly datasetStateManager: DatasetStateManager,
  ) {}

  resolve(input: {
    conversationId: string;
    reportArtifactId: string;
    reportVersion: number;
    visualizationArtifactId: string;
  }): Promise<ResolvedReportVisualizationArtifact> {
    const cacheKey = `${input.conversationId}\u0000${input.reportArtifactId}\u0000${input.reportVersion}\u0000${input.visualizationArtifactId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const pending = this.resolveUncached(input).catch((error) => {
      this.cache.delete(cacheKey);
      throw error;
    });
    this.cache.set(cacheKey, pending);
    return pending;
  }

  clearConversation(conversationId: string) {
    const prefix = `${conversationId}\u0000`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  private async resolveUncached(input: {
    conversationId: string;
    reportArtifactId: string;
    reportVersion: number;
    visualizationArtifactId: string;
  }): Promise<ResolvedReportVisualizationArtifact> {
    const toolCalls = await this.toolResultRegistry.listByConversation(input.conversationId);
    const reportRecord = completedOwner(toolCalls, input.reportArtifactId, "report_generation");
    if (!reportRecord || reportRecord.version !== input.reportVersion) {
      throw reportVisualizationError("VISUALIZATION_ARTIFACT_PERMISSION_DENIED", "当前报告不允许加载该可视化内容。");
    }
    const reportArtifact = await this.artifactManager.getArtifact(input.reportArtifactId);
    if (!reportArtifact || reportArtifact.artifactType !== "report_markdown" || typeof reportArtifact.content !== "string") {
      throw reportVisualizationError("VISUALIZATION_ARTIFACT_EXPIRED", "报告内容已失效。");
    }
    const declaredArtifactIds = reportVisualizationArtifactIds(reportArtifact.content);
    if (!declaredArtifactIds.includes(input.visualizationArtifactId)) {
      throw reportVisualizationError("VISUALIZATION_ARTIFACT_PERMISSION_DENIED", "报告未声明该可视化内容。");
    }

    const chartRecord = completedOwner(toolCalls, input.visualizationArtifactId, "chart_rendering");
    if (!chartRecord) {
      throw reportVisualizationError("VISUALIZATION_ARTIFACT_NOT_FOUND", "图表内容不存在或尚未完成。");
    }
    const chartArtifact = await this.artifactManager.getArtifact(input.visualizationArtifactId);
    if (!chartArtifact) {
      throw reportVisualizationError("VISUALIZATION_ARTIFACT_NOT_FOUND", "图表内容不存在。");
    }
    if (!["chart", "visualization_spec"].includes(chartArtifact.artifactType)) {
      throw reportVisualizationError("VISUALIZATION_SPEC_INVALID", "图表内容类型不正确。");
    }
    const validation = validateVisualizationSpec(chartArtifact.content, {
      allowInlineData: true,
      inlineDataMaxRows: 200,
      inlineDataMaxBytes: 64 * 1024,
    });
    if (!validation.success) {
      throw reportVisualizationError("VISUALIZATION_SPEC_INVALID", "图表配置无效。");
    }

    const data = await this.resolveData(validation.spec, input.conversationId, chartRecord, toolCalls);
    return {
      artifactId: chartArtifact.artifactId,
      version: chartRecord.version,
      status: "ready",
      visualizationSpec: validation.spec,
      data,
      title: chartArtifact.title ?? validation.spec.title,
      description: validation.spec.description,
      sourceArtifactIds: uniqueStrings([
        ...(chartRecord.sourceArtifactIds ?? []),
        ...(validation.spec.data.mode === "artifact" ? [validation.spec.data.artifactId] : []),
      ]),
      createdAt: chartArtifact.createdAt,
    };
  }

  private async resolveData(
    spec: VisualizationSpec,
    conversationId: string,
    chartRecord: ToolCallRecord,
    toolCalls: ToolCallRecord[],
  ): Promise<ResolvedVisualizationData> {
    if (spec.data.mode === "inline") {
      const rows = spec.data.rows;
      return {
        columns: inferColumns(rows),
        rows,
        rowCount: spec.data.rowCount,
        truncated: rows.length < spec.data.rowCount,
        masked: spec.provenance.masked ?? false,
        warnings: spec.provenance.warnings ?? [],
      };
    }

    const sourceArtifactId = spec.data.artifactId;
    const isDeclaredSource = (chartRecord.sourceArtifactIds ?? []).includes(sourceArtifactId)
      || toolCalls.some((record) => recordArtifactIds(record).includes(sourceArtifactId));
    if (!isDeclaredSource) {
      throw reportVisualizationError("VISUALIZATION_ARTIFACT_PERMISSION_DENIED", "图表上游数据不属于当前会话。");
    }

    if (sourceArtifactId.startsWith("workflow-dataset:")) {
      const datasetId = sourceArtifactId.slice("workflow-dataset:".length);
      const dataset = await this.datasetStateManager.getDataset(datasetId);
      if (!dataset || dataset.conversationId !== conversationId) {
        throw reportVisualizationError("VISUALIZATION_ARTIFACT_PERMISSION_DENIED", "图表上游数据不属于当前会话。");
      }
      try {
        return await new WorkflowArtifactDataResolver(this.datasetStateManager).resolve({
          artifactId: sourceArtifactId,
          expectedSchema: normalizeExpectedSchema(spec.data.expectedSchema),
          maxRowsForInline: 200,
        });
      } catch (error) {
        const code = errorCode(error);
        if (code === "VISUALIZATION_DATA_PERMISSION_DENIED") {
          throw reportVisualizationError("VISUALIZATION_ARTIFACT_PERMISSION_DENIED", "图表上游数据无权访问。");
        }
        if (code === "VISUALIZATION_SCHEMA_MISMATCH") {
          throw reportVisualizationError("VISUALIZATION_SPEC_INVALID", "图表字段与上游数据不匹配。");
        }
        throw reportVisualizationError("VISUALIZATION_ARTIFACT_EXPIRED", "图表上游数据已失效。");
      }
    }

    const sourceArtifact = await this.artifactManager.getArtifact(sourceArtifactId);
    if (!sourceArtifact) {
      throw reportVisualizationError("VISUALIZATION_ARTIFACT_EXPIRED", "图表上游数据已失效。");
    }
    const structured = structuredArtifactData(sourceArtifact, spec) ?? markdownArtifactData(sourceArtifact, spec);
    if (!structured) {
      throw reportVisualizationError("VISUALIZATION_ARTIFACT_EXPIRED", "图表上游结果不再包含可渲染的结构化数据。");
    }
    validateResolvedExpectedSchema(structured, normalizeExpectedSchema(spec.data.expectedSchema));
    return structured;
  }
}

export class ReportVisualizationResolverError extends Error {
  constructor(readonly code: ReportVisualizationErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "ReportVisualizationResolverError";
  }
}

function completedOwner(toolCalls: ToolCallRecord[], artifactId: string, toolKind: ToolCallRecord["toolKind"]) {
  return toolCalls.find((record) =>
    record.toolKind === toolKind
    && record.status === "completed"
    && recordArtifactIds(record).includes(artifactId),
  );
}

function recordArtifactIds(record: ToolCallRecord) {
  return uniqueStrings([...(record.outputArtifactIds ?? []), ...(record.result?.artifactIds ?? [])]);
}

function structuredArtifactData(artifact: ArtifactRecord, spec: VisualizationSpec): ResolvedVisualizationData | null {
  const content = parseStructuredContent(artifact.content);
  const rows = Array.isArray(content)
    ? content
    : isRecord(content) && Array.isArray(content.rows)
      ? content.rows
      : isRecord(content) && Array.isArray(content.previewRows)
        ? content.previewRows
        : null;
  if (!rows || !rows.every(isRecord)) {
    return null;
  }
  const typedRows = rows as Record<string, unknown>[];
  const rowCount = isRecord(content) && typeof content.rowCount === "number" ? content.rowCount : typedRows.length;
  return {
    artifactId: artifact.artifactId,
    columns: inferColumns(typedRows),
    rows: typedRows,
    rowCount,
    truncated: typedRows.length < rowCount,
    masked: spec.provenance.masked ?? false,
    warnings: spec.provenance.warnings ?? [],
  };
}

function markdownArtifactData(artifact: ArtifactRecord, spec: VisualizationSpec): ResolvedVisualizationData | null {
  if (artifact.contentType !== "markdown" || typeof artifact.content !== "string") {
    return null;
  }
  const requiredFields = visualizationDataFields(spec);
  if (requiredFields.length === 0) {
    return null;
  }
  const tables = collectMarkdownTables(parseMarkdown(artifact.content));
  for (const table of tables) {
    const headers = table.headers.map(markdownCellText);
    if (!requiredFields.every((field) => headers.includes(field))) {
      continue;
    }
    const columnIndexes = new Map(requiredFields.map((field) => [field, headers.indexOf(field)]));
    const rows = table.rows.slice(0, 200).map((cells) => Object.fromEntries(requiredFields.map((field) => [
      field,
      coerceMarkdownTableValue(markdownCellText(cells[columnIndexes.get(field) ?? -1])),
    ])));
    return {
      artifactId: artifact.artifactId,
      columns: inferColumns(rows),
      rows,
      rowCount: table.rows.length,
      truncated: rows.length < table.rows.length,
      masked: spec.provenance.masked ?? false,
      warnings: spec.provenance.warnings ?? [],
    };
  }
  return null;
}

function visualizationDataFields(spec: VisualizationSpec) {
  return uniqueStrings([
    spec.encoding?.x ?? "",
    ...(spec.encoding?.y ?? []),
    spec.encoding?.category ?? "",
    spec.encoding?.series ?? "",
    spec.encoding?.colorBy ?? "",
    spec.encoding?.sizeBy ?? "",
    spec.encoding?.source ?? "",
    spec.encoding?.target ?? "",
    spec.encoding?.startTime ?? "",
    spec.encoding?.endTime ?? "",
    spec.encoding?.value ?? "",
  ]);
}

function collectMarkdownTables(nodes: BlockNode[]): Array<Extract<BlockNode, { type: "table" }>> {
  const tables: Array<Extract<BlockNode, { type: "table" }>> = [];
  for (const node of nodes) {
    if (node.type === "table") {
      tables.push(node);
    } else if (node.type === "blockquote") {
      tables.push(...collectMarkdownTables(node.children));
    } else if (node.type === "list") {
      for (const item of node.items) {
        tables.push(...collectMarkdownTables(item.children));
      }
    }
  }
  return tables;
}

function markdownCellText(cell: TableCellNode | undefined) {
  return inlineMarkdownText(cell?.children ?? []).replace(/\s+/g, " ").trim();
}

function inlineMarkdownText(nodes: InlineNode[]): string {
  return nodes.map((node) => {
    if (node.type === "text" || node.type === "code") {
      return node.content;
    }
    if (node.type === "image") {
      return node.alt;
    }
    if (node.type === "citation") {
      return node.sourceId;
    }
    if (node.type === "break") {
      return " ";
    }
    return inlineMarkdownText(node.children);
  }).join("");
}

function coerceMarkdownTableValue(value: string): string | number | boolean | null {
  const normalized = value.trim();
  if (!normalized || normalized === "--" || normalized === "-") {
    return null;
  }
  if (/^(true|false)$/i.test(normalized)) {
    return normalized.toLowerCase() === "true";
  }
  const numeric = normalized.replace(/[,，]/g, "").replace(/%$/, "");
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(numeric)) {
    return Number(numeric);
  }
  return normalized;
}

function parseStructuredContent(content: unknown): unknown {
  if (typeof content !== "string") {
    return content;
  }
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function inferColumns(rows: Record<string, unknown>[]) {
  const names = uniqueStrings(rows.flatMap((row) => Object.keys(row)));
  return names.map((name) => ({ name, type: inferColumnType(rows, name) }));
}

function inferColumnType(rows: Record<string, unknown>[], field: string) {
  const value = rows.find((row) => row[field] !== null && row[field] !== undefined)?.[field];
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  return "text";
}

function normalizeExpectedSchema(schema: Record<string, string> | undefined) {
  if (!schema) {
    return undefined;
  }
  const entries = Object.entries(schema).filter(([, type]) => type && type.toLowerCase() !== "unknown");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function validateResolvedExpectedSchema(data: ResolvedVisualizationData, expectedSchema: Record<string, string> | undefined) {
  if (!expectedSchema) {
    return;
  }
  const actualSchema = Object.fromEntries(data.columns.map((column) => [column.name, column.type]));
  for (const [field, expectedType] of Object.entries(expectedSchema)) {
    const actualType = actualSchema[field];
    if (!actualType || normalizeDataType(actualType) !== normalizeDataType(expectedType)) {
      throw reportVisualizationError("VISUALIZATION_SPEC_INVALID", "图表字段与上游数据不匹配。");
    }
  }
}

function normalizeDataType(value: string) {
  const type = value.trim().toLowerCase();
  if (/(int|number|numeric|decimal|float|double|real|currency|amount|count|percent|ratio)/.test(type)) {
    return "number";
  }
  if (/(bool)/.test(type)) {
    return "boolean";
  }
  return "text";
}

function reportVisualizationError(code: ReportVisualizationErrorCode, message: string) {
  return new ReportVisualizationResolverError(code, message);
}

function errorCode(error: unknown) {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
