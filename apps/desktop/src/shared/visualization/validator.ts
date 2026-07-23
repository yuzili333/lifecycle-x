import {
  businessVisualizationSemantics,
  visualizationTypes,
  type VisualizationDataSource,
  type VisualizationEncoding,
  type VisualizationErrorCode,
  type VisualizationRenderError,
  type VisualizationSpec,
} from "./types";

export type VisualizationValidationOptions = {
  allowInlineData?: boolean;
  inlineDataMaxRows?: number;
  inlineDataMaxBytes?: number;
};

export type VisualizationValidationResult =
  | { success: true; spec: VisualizationSpec; warnings: string[] }
  | { success: false; error: VisualizationRenderError; warnings: string[] };

const DEFAULT_INLINE_MAX_ROWS = 200;
const DEFAULT_INLINE_MAX_BYTES = 64 * 1024;
const UNSAFE_KEY_PATTERN = /(?:renderer|rendererId|rendererClass|dynamicImport|importPath|component|html|dangerouslySetInnerHTML|echartsOption|visConfig)$/i;
const LOCAL_PATH_PATTERN = /(?:^|["'\s])(?:file:\/\/|\/Users\/|\/private\/|\/tmp\/|[A-Za-z]:\\)/;
const HTML_PATTERN = /<\/?[a-z][\s\S]*>/i;

export function validateVisualizationSpec(input: unknown, options: VisualizationValidationOptions = {}): VisualizationValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!isRecord(input)) {
    return failed("VISUALIZATION_SPEC_INVALID", "可视化配置无法解析。", ["协议必须是对象。"], warnings);
  }

  if (input.specVersion !== "1.0") {
    errors.push("specVersion 必须为 1.0。");
  }
  if (!isNonEmptyString(input.visualizationId)) {
    errors.push("visualizationId 必填。");
  }
  if (!isVisualizationType(input.type)) {
    errors.push("type 必须是受支持的可视化类型。");
  }
  if (!isNonEmptyString(input.title)) {
    errors.push("title 必填。");
  }
  if (input.businessSemantic !== undefined && !isBusinessSemantic(input.businessSemantic)) {
    errors.push("businessSemantic 不受支持。");
  }
  if (!isRecord(input.data)) {
    errors.push("data 必填。");
  } else {
    errors.push(...validateDataSource(input.data as VisualizationDataSource, options));
  }
  if (!isRecord(input.provenance)) {
    errors.push("provenance 必填。");
  } else {
    const sourceType = input.provenance.sourceType;
    if (!["sql", "python", "workflow_dataset", "approved_inline"].includes(String(sourceType))) {
      errors.push("provenance.sourceType 不受支持。");
    }
    if (!isNonEmptyString(input.provenance.generatedAt)) {
      errors.push("provenance.generatedAt 必填。");
    }
  }

  if (containsUnsafeValue(input)) {
    errors.push("协议中不允许包含 JavaScript 函数、原始 HTML、本地文件路径、renderer 注入或动态 import 路径。");
  }

  const knownFields = collectKnownFields(input);
  const encoding = isRecord(input.encoding) ? input.encoding as VisualizationEncoding : undefined;
  errors.push(...validateEncodingFields(encoding, knownFields));
  errors.push(...validateTypeSpecificRules(input, encoding));

  if (errors.length > 0) {
    return failed("VISUALIZATION_SPEC_INVALID", "可视化配置校验失败。", errors, warnings, String(input.visualizationId ?? ""));
  }

  return { success: true, spec: input as VisualizationSpec, warnings };
}

function validateDataSource(data: VisualizationDataSource, options: VisualizationValidationOptions) {
  const errors: string[] = [];
  if (data.mode === "artifact") {
    if (!isNonEmptyString(data.artifactId)) {
      errors.push("artifact 数据源必须提供 artifactId。");
    }
    return errors;
  }
  if (data.mode === "inline") {
    if (options.allowInlineData === false) {
      errors.push("当前策略不允许内联数据。");
    }
    if (!Array.isArray(data.rows)) {
      errors.push("inline 数据源必须提供 rows。");
    }
    if (!Number.isFinite(data.rowCount)) {
      errors.push("inline 数据源必须提供 rowCount。");
    }
    const maxRows = options.inlineDataMaxRows ?? DEFAULT_INLINE_MAX_ROWS;
    if (Array.isArray(data.rows) && data.rows.length > maxRows) {
      errors.push(`inline 数据超过 ${maxRows} 行上限。`);
    }
    if (typeof data.rowCount === "number" && data.rowCount > maxRows) {
      errors.push(`inline rowCount 超过 ${maxRows} 行上限。`);
    }
    const maxBytes = options.inlineDataMaxBytes ?? DEFAULT_INLINE_MAX_BYTES;
    if (safeJsonByteLength(data.rows) > maxBytes) {
      errors.push(`inline 数据超过 ${maxBytes} 字节上限。`);
    }
    if (data.trusted !== true) {
      errors.push("inline 数据必须标记 trusted=true。");
    }
    return errors;
  }
  errors.push("data.mode 必须是 artifact 或 inline。");
  return errors;
}

function validateEncodingFields(encoding: VisualizationEncoding | undefined, knownFields: Set<string>) {
  const errors: string[] = [];
  if (!encoding || knownFields.size === 0) {
    return errors;
  }
  const yFields = Array.isArray(encoding.y)
    ? encoding.y
    : typeof encoding.y === "string"
      ? [encoding.y]
      : [];
  const fields = [
    encoding.x,
    encoding.category,
    encoding.series,
    encoding.colorBy,
    encoding.sizeBy,
    encoding.source,
    encoding.target,
    encoding.startTime,
    encoding.endTime,
    encoding.value,
    ...yFields,
  ].filter(Boolean) as string[];
  for (const field of fields) {
    if (!knownFields.has(field)) {
      errors.push(`encoding 引用了不存在的字段：${field}。`);
    }
  }
  return errors;
}

function validateTypeSpecificRules(input: Record<string, unknown>, encoding: VisualizationEncoding | undefined) {
  const errors: string[] = [];
  if (input.type === "network" && (!encoding?.source || !encoding.target)) {
    errors.push("网络图必须包含 encoding.source 和 encoding.target。");
  }
  if ((input.type === "timeline" || input.businessSemantic === "lifecycle_event_chain") && !encoding?.startTime) {
    errors.push("时间轴必须包含 encoding.startTime。");
  }
  if (input.type === "kpi" && (!Array.isArray(input.measures) || input.measures.length === 0)) {
    errors.push("KPI 必须至少包含一个 measure。");
  }
  return errors;
}

function collectKnownFields(input: Record<string, unknown>) {
  const fields = new Set<string>();
  for (const item of arrayOfRecords(input.dimensions)) {
    if (isNonEmptyString(item.field)) {
      fields.add(item.field);
    }
  }
  for (const item of arrayOfRecords(input.measures)) {
    if (isNonEmptyString(item.field)) {
      fields.add(item.field);
    }
  }
  const data = input.data;
  if (isRecord(data)) {
    if (data.mode === "inline" && Array.isArray(data.rows)) {
      for (const row of data.rows) {
        if (isRecord(row)) {
          Object.keys(row).forEach((field) => fields.add(field));
        }
      }
    }
    if (data.mode === "artifact" && isRecord(data.expectedSchema)) {
      Object.keys(data.expectedSchema).forEach((field) => fields.add(field));
    }
  }
  return fields;
}

function containsUnsafeValue(value: unknown, key = ""): boolean {
  if (typeof value === "function") {
    return true;
  }
  if (UNSAFE_KEY_PATTERN.test(key)) {
    return true;
  }
  if (typeof value === "string") {
    return HTML_PATTERN.test(value) || LOCAL_PATH_PATTERN.test(value) || /\bfunction\s*\(|=>|javascript:/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsUnsafeValue(item));
  }
  if (isRecord(value)) {
    return Object.entries(value).some(([childKey, childValue]) => containsUnsafeValue(childValue, childKey));
  }
  return false;
}

function failed(code: VisualizationErrorCode, message: string, details: string[], warnings: string[], visualizationId?: string): VisualizationValidationResult {
  return {
    success: false,
    warnings,
    error: {
      code,
      message,
      visualizationId,
      recoverable: true,
      details,
    },
  };
}

export function isVisualizationSpec(input: unknown): input is VisualizationSpec {
  return validateVisualizationSpec(input).success;
}

export function parseVisualizationSpecJson(input: string, options?: VisualizationValidationOptions): VisualizationValidationResult {
  try {
    return validateVisualizationSpec(JSON.parse(input), options);
  } catch {
    return failed("VISUALIZATION_SPEC_INVALID", "可视化配置无法解析。", ["JSON 格式不合法。"], []);
  }
}

function isVisualizationType(value: unknown) {
  return typeof value === "string" && (visualizationTypes as readonly string[]).includes(value);
}

function isBusinessSemantic(value: unknown) {
  return typeof value === "string" && (businessVisualizationSemantics as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function safeJsonByteLength(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
