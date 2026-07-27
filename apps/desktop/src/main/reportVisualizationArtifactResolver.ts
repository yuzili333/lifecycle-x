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
  const selection = selectStructuredRows(content, spec);
  if (!selection) {
    return null;
  }
  const typedRows = selection.rows.slice(0, 200).map((row) =>
    Object.fromEntries(selection.fields.map(({ target, source }) => [target, row[source]])));
  return {
    artifactId: artifact.artifactId,
    columns: inferColumns(typedRows),
    rows: typedRows,
    rowCount: selection.rowCount,
    truncated: typedRows.length < selection.rowCount,
    masked: spec.provenance.masked ?? false,
    warnings: spec.provenance.warnings ?? [],
  };
}

export function materializeStructuredVisualizationSpec(
  spec: VisualizationSpec,
  artifact: ArtifactRecord,
): VisualizationSpec {
  if (spec.data.mode !== "artifact") {
    return spec;
  }
  const resolved = structuredArtifactData(artifact, spec);
  const resolvedRows = resolved?.rows;
  if (!resolved || !resolvedRows || resolved.rowCount > 200 || resolvedRows.length > 200) {
    return spec;
  }
  const rows = resolvedRows.map(toInlineVisualizationRow);
  if (rows.some((row) => row === null)) {
    return spec;
  }
  return {
    ...spec,
    data: {
      mode: "inline",
      rows: rows as Array<Record<string, string | number | boolean | null>>,
      rowCount: resolved.rowCount,
      trusted: true,
    },
    metadata: {
      ...spec.metadata,
      materializedFromArtifactId: artifact.artifactId,
    },
  };
}

function toInlineVisualizationRow(row: Record<string, unknown>) {
  const entries = Object.entries(row);
  if (entries.some(([, value]) =>
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  )) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, string | number | boolean | null>;
}

type StructuredRowsCandidate = {
  path: string;
  rows: Record<string, unknown>[];
  rowCount: number;
};

function selectStructuredRows(content: unknown, spec: VisualizationSpec) {
  const expectedFields = spec.data.mode === "artifact"
    ? Object.keys(spec.data.expectedSchema ?? {})
    : [];
  const requestedFields = expectedFields.length > 0
    ? expectedFields
    : visualizationDataFields(spec);
  if (requestedFields.length === 0) {
    return null;
  }
  const candidates = collectStructuredRows(content);
  const ranked = candidates.flatMap((candidate) => {
    const mapping = mapVisualizationFields(candidate.rows, requestedFields);
    if (!mapping) {
      return [];
    }
    const pathTokens = semanticTokens(candidate.path);
    const requestedTokens = new Set(requestedFields.flatMap(semanticTokens));
    const pathScore = pathTokens.filter((token) => requestedTokens.has(token)).length * 5;
    return [{
      ...candidate,
      fields: mapping.fields,
      score: mapping.score + pathScore,
    }];
  }).sort((left, right) => right.score - left.score);
  if (ranked[0]) {
    return ranked[0];
  }
  const conventional = candidates.find((candidate) =>
    candidate.path === "root.rows" || candidate.path === "root.previewRows");
  if (!conventional) {
    return null;
  }
  return {
    ...conventional,
    fields: uniqueStrings(conventional.rows.flatMap((row) => Object.keys(row)))
      .map((field) => ({ target: field, source: field })),
    score: 0,
  };
}

function collectStructuredRows(content: unknown, path = "root", depth = 0): StructuredRowsCandidate[] {
  if (depth > 5) {
    return [];
  }
  if (Array.isArray(content)) {
    if (content.every(isRecord)) {
      return [{ path, rows: content as Record<string, unknown>[], rowCount: content.length }];
    }
    return content.flatMap((item, index) => collectStructuredRows(item, `${path}[${index}]`, depth + 1));
  }
  if (!isRecord(content)) {
    return [];
  }
  return Object.entries(content).flatMap(([key, value]) => {
    if (Array.isArray(value) && value.every(isRecord)) {
      const rowCount = (key === "rows" || key === "previewRows") && typeof content.rowCount === "number"
        ? content.rowCount
        : value.length;
      return [{ path: `${path}.${key}`, rows: value as Record<string, unknown>[], rowCount }];
    }
    return collectStructuredRows(value, `${path}.${key}`, depth + 1);
  });
}

function mapVisualizationFields(rows: Record<string, unknown>[], requestedFields: string[]) {
  const sourceFields = uniqueStrings(rows.flatMap((row) => Object.keys(row)));
  const used = new Set<string>();
  const fields: Array<{ target: string; source: string }> = [];
  let score = 0;
  for (const target of requestedFields) {
    const exact = sourceFields.find((source) => source === target && !used.has(source));
    const normalized = exact
      ? undefined
      : sourceFields.find((source) =>
          normalizeSemanticField(source) === normalizeSemanticField(target) && !used.has(source));
    const targetKind = semanticFieldKind(target);
    const semantic = exact || normalized || !targetKind
      ? undefined
      : sourceFields.find((source) => semanticFieldKind(source) === targetKind && !used.has(source));
    const source = exact ?? normalized ?? semantic;
    if (!source) {
      return null;
    }
    used.add(source);
    fields.push({ target, source });
    score += exact ? 100 : normalized ? 80 : 40;
  }
  return { fields, score };
}

function normalizeSemanticField(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s_\-—–/\\:：.]+/g, "");
}

function semanticFieldKind(value: string) {
  const normalized = normalizeSemanticField(value);
  if (/占比|比率|百分|率$|^(?:rate|ratio|share|percent|percentage|countrate|amountrate)$/.test(normalized)) {
    return "rate";
  }
  if (/贷款余额|余额|^(?:loanbalance|outstandingbalance|balance)$/.test(normalized)) {
    return "balance";
  }
  if (/合同金额|金额|^(?:contractamount|amount)$/.test(normalized)) {
    return "amount";
  }
  if (/笔数|数量|总计数|合同数|^(?:count|totalcount|recordcount|rowcount|quantity)$/.test(normalized)) {
    return "count";
  }
  if (/分类|类别|^(?:category|classification|class|group|label|name|dimension)$/.test(normalized)) {
    return "category";
  }
  return null;
}

function semanticTokens(value: string) {
  const expanded = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  const tokens: string[] = [...(expanded.match(/[a-z0-9]+/g) ?? [])];
  if (/风险/.test(value)) tokens.push("risk");
  if (/五级/.test(value)) tokens.push("five", "level");
  if (/分类|类别/.test(value)) tokens.push("classification", "category");
  if (/笔数|数量|合同数/.test(value)) tokens.push("count");
  if (/贷款余额|余额/.test(value)) tokens.push("loan", "balance");
  if (/合同金额|金额/.test(value)) tokens.push("amount");
  if (/占比|比率|百分|率/.test(value)) tokens.push("rate");
  return uniqueStrings(tokens);
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

function parseStructuredContent(content: unknown, depth = 0): unknown {
  if (depth > 4) {
    return content;
  }
  if (typeof content !== "string") {
    if (isRecord(content) && typeof content.stdout === "string") {
      return parseStructuredContent(content.stdout, depth + 1);
    }
    return content;
  }
  try {
    return parseStructuredContent(JSON.parse(content), depth + 1);
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
