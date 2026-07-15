export type LogicalFieldType = string;

export type SQLiteFieldType = "TEXT" | "INTEGER" | "REAL" | "NUMERIC" | "BLOB";

export type FieldConstraints = {
  required?: boolean;
  min?: number;
  max?: number;
  scale?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: Array<string | number>;
  formats?: string[];
  trim?: boolean;
  allowUnknownEnum?: boolean;
  defaultValue?: unknown;
};

export type BusinessFieldDefinition = {
  businessFieldId: string;
  domain: string;
  displayNameZh: string;
  displayNameEn?: string;
  logicalType: LogicalFieldType;
  aliases: string[];
  description?: string;
};

export type FieldDictionaryDefinition = {
  fieldOrder: number;
  fieldNameZh: string;
  fieldNameEn: string;
  businessFieldId: string;
  sourceFieldName: string;
  logicalType: LogicalFieldType;
  sourceType?: string;
  sqliteType: SQLiteFieldType;
  mysqlType?: string;
  nullable: boolean;
  unique: boolean;
  primaryKey: boolean;
  constraints: FieldConstraints;
  sourceExample?: string;
  fieldComment: string;
  aliases: string[];
  sensitivity?: "public" | "internal" | "sensitive" | "restricted";
};

export type CsvImportIssue = {
  code:
    | "DICTIONARY_COLUMN_MISSING"
    | "DICTIONARY_FIELD_DUPLICATED"
    | "DICTIONARY_CONSTRAINT_INVALID"
    | "CSV_HEADER_MISSING"
    | "CSV_HEADER_AMBIGUOUS"
    | "REQUIRED_VALUE_MISSING"
    | "TYPE_CONVERSION_FAILED"
    | "ENUM_VALUE_INVALID"
    | "VALUE_OUT_OF_RANGE"
    | "VALUE_LENGTH_INVALID"
    | "PATTERN_MISMATCH"
    | "UNIQUE_CONSTRAINT_VIOLATED"
    | "PRIMARY_KEY_MISSING"
    | "BUSINESS_FIELD_UNKNOWN";
  severity: "warning" | "error" | "critical";
  rowNumber?: number;
  sourceHeader?: string;
  physicalName?: string;
  businessFieldId?: string;
  rawValue?: unknown;
  message: string;
};

export type CsvDictionaryValidationResult = {
  valid: boolean;
  definitions: FieldDictionaryDefinition[];
  errors: CsvImportIssue[];
  warnings: CsvImportIssue[];
};

export type CsvFieldMatchResult = {
  sourceHeader: string;
  matched: boolean;
  dictionaryField?: FieldDictionaryDefinition;
  matchSource:
    | "source_field_name"
    | "field_name_zh"
    | "field_name_en"
    | "alias"
    | "normalized"
    | "business_dictionary"
    | "manual"
    | "none";
  confidence: number;
  warnings: string[];
};

export const BUILTIN_BUSINESS_FIELDS: BusinessFieldDefinition[] = [
  {
    businessFieldId: "credit.contract_id",
    domain: "credit",
    displayNameZh: "合同编号",
    displayNameEn: "Contract ID",
    logicalType: "identifier",
    aliases: ["合同编号", "合同号", "借据号", "业务编号", "contract_id", "contract_no", "loan_contract_no"],
    description: "信贷合同或借据唯一标识。",
  },
  {
    businessFieldId: "credit.five_level_classification",
    domain: "credit",
    displayNameZh: "五级分类",
    displayNameEn: "Five-level Classification",
    logicalType: "category",
    aliases: ["五级分类", "风险分类", "贷款风险分类", "risk_class", "risk_level", "five_level_classification"],
    description: "贷款五级风险分类。",
  },
  {
    businessFieldId: "credit.twelve_level_classification",
    domain: "credit",
    displayNameZh: "十二级分类",
    displayNameEn: "Twelve-level Classification",
    logicalType: "category",
    aliases: ["十二级分类", "风险细分类", "十二级风险分类", "risk_subclass", "twelve_level_classification"],
    description: "贷款十二级细分风险分类。",
  },
  {
    businessFieldId: "credit.loan_balance",
    domain: "credit",
    displayNameZh: "贷款余额",
    displayNameEn: "Loan Balance",
    logicalType: "decimal",
    aliases: ["贷款余额", "当前余额", "本金余额", "未偿余额", "loan_balance", "outstanding_balance", "current_balance"],
    description: "当前未偿还贷款本金余额。",
  },
  {
    businessFieldId: "credit.contract_amount",
    domain: "credit",
    displayNameZh: "合同金额",
    displayNameEn: "Contract Amount",
    logicalType: "decimal",
    aliases: ["合同金额", "授信金额", "借款金额", "contract_amount", "loan_amount"],
    description: "信贷合同金额。",
  },
  {
    businessFieldId: "credit.report_date",
    domain: "credit",
    displayNameZh: "报告日期",
    displayNameEn: "Report Date",
    logicalType: "date",
    aliases: ["报告日期", "统计日期", "分区日期", "report_date", "stat_date", "p_date"],
  },
  {
    businessFieldId: "credit.institution_name",
    domain: "credit",
    displayNameZh: "机构名称",
    displayNameEn: "Institution Name",
    logicalType: "string",
    aliases: ["机构名称", "分行", "branch_name", "institution_name"],
  },
  {
    businessFieldId: "credit.product_name",
    domain: "credit",
    displayNameZh: "产品名称",
    displayNameEn: "Product Name",
    logicalType: "string",
    aliases: ["产品名称", "product_name"],
  },
];

export const OVERALL_RISK_REQUIRED_FIELDS = [
  { semantic: "contract_id", businessFieldId: "bf.loan_contract.contract_serial", compatibleBusinessFieldIds: ["bf.loan_contract.contract_no", "credit.contract_id"], displayNameZh: "合同流水号", required: true },
  { semantic: "five_level_classification", businessFieldId: "bf.loan_contract.latest_risk", compatibleBusinessFieldIds: ["bf.loan_contract.latest_five_level_risk", "credit.five_level_classification"], displayNameZh: "最新风险分类", required: true },
  { semantic: "twelve_level_classification", businessFieldId: "bf.loan_contract.latest_risk_result", compatibleBusinessFieldIds: ["bf.loan_contract.year_start_risk_detail", "credit.twelve_level_classification"], displayNameZh: "最新风险分类结果", required: false },
  { semantic: "loan_balance", businessFieldId: "bf.loan_contract.loan_balance_10k", compatibleBusinessFieldIds: ["credit.loan_balance"], displayNameZh: "贷款余额(万元)", required: true },
  { semantic: "contract_amount", businessFieldId: "bf.loan_contract.contract_amount_10k", compatibleBusinessFieldIds: ["credit.contract_amount"], displayNameZh: "合同金额(万元)", required: false },
] as const;

const REQUIRED_DICTIONARY_COLUMNS = [
  "field_order",
  "field_name_zh",
  "field_name_en",
  "business_field_id",
  "source_field_name",
  "logical_type",
  "source_type",
  "sqlite_type",
  "mysql_type",
  "nullable",
  "unique",
  "primary_key",
  "constraints_json",
  "source_example",
  "field_comment",
  "aliases",
  "sensitivity",
];

const LOGICAL_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SQLITE_TYPES = new Set<SQLiteFieldType>(["TEXT", "INTEGER", "REAL", "NUMERIC", "BLOB"]);
const BUSINESS_FIELD_BY_ID = new Map(BUILTIN_BUSINESS_FIELDS.map((field) => [field.businessFieldId, field]));

export function listBusinessFieldDefinitions() {
  return BUILTIN_BUSINESS_FIELDS;
}

export function findBusinessFieldDefinition(businessFieldId: string) {
  return BUSINESS_FIELD_BY_ID.get(businessFieldId.trim()) ?? null;
}

export function findBusinessFieldByAlias(alias: string) {
  const normalized = normalizeFieldName(alias).normalized;
  return BUILTIN_BUSINESS_FIELDS.find((field) =>
    [field.businessFieldId, field.displayNameZh, field.displayNameEn, ...field.aliases]
      .filter(Boolean)
      .some((candidate) => normalizeFieldName(candidate ?? "").normalized === normalized),
  ) ?? null;
}

export function parseCsvDictionary(content: string): CsvDictionaryValidationResult {
  const records = parseCsvRecords(content.replace(/^\uFEFF/, ""));
  if (records.length === 0) {
    return {
      valid: false,
      definitions: [],
      errors: [{ code: "DICTIONARY_COLUMN_MISSING", severity: "critical", message: "表字典不能为空。" }],
      warnings: [],
    };
  }
  const delimiter = detectDelimiter(records[0] ?? "");
  const rows = records.map((record) => parseCsvRecord(record, delimiter));
  const headers = (rows[0] ?? []).map((header) => header.trim());
  const bodyRows = rows.slice(1);
  const missingColumns = REQUIRED_DICTIONARY_COLUMNS.filter((column) => !headers.includes(column));
  const errors: CsvImportIssue[] = missingColumns.map((column) => ({
    code: "DICTIONARY_COLUMN_MISSING",
    severity: "critical",
    message: `表字典缺少必需列：${column}`,
  }));
  const definitions: FieldDictionaryDefinition[] = [];
  const warnings: CsvImportIssue[] = [];
  const seenEnglishNames = new Set<string>();
  const seenBusinessFields = new Map<string, string>();

  for (const [index, rawValues] of bodyRows.entries()) {
    const values = normalizeDictionaryValues(headers, rawValues, delimiter);
    if (values.every((value) => !value.trim())) {
      continue;
    }
    const row = Object.fromEntries(headers.map((header, valueIndex) => [header, values[valueIndex]?.trim() ?? ""]));
    const fieldNameZh = row.field_name_zh;
    const fieldNameEn = row.field_name_en;
    const businessFieldId = row.business_field_id.trim();
    const logicalType = normalizeLogicalType(row.logical_type);
    const sqliteType = row.sqlite_type?.toUpperCase() as SQLiteFieldType;
    const rowNumber = index + 2;
    const constraints = parseConstraints(row.constraints_json, rowNumber, errors);

    if (!fieldNameZh) {
      errors.push({ code: "DICTIONARY_CONSTRAINT_INVALID", severity: "error", rowNumber, message: "field_name_zh 不能为空。" });
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(fieldNameEn)) {
      errors.push({ code: "DICTIONARY_CONSTRAINT_INVALID", severity: "error", rowNumber, physicalName: fieldNameEn, message: `field_name_en 非法：${fieldNameEn}` });
    }
    if (seenEnglishNames.has(fieldNameEn)) {
      errors.push({ code: "DICTIONARY_FIELD_DUPLICATED", severity: "error", rowNumber, physicalName: fieldNameEn, message: `field_name_en 重复：${fieldNameEn}` });
    }
    seenEnglishNames.add(fieldNameEn);
    if (!businessFieldId) {
      errors.push({ code: "BUSINESS_FIELD_UNKNOWN", severity: "error", rowNumber, businessFieldId, message: "business_field_id 不能为空。" });
    }
    if (seenBusinessFields.has(businessFieldId) && seenBusinessFields.get(businessFieldId) !== fieldNameEn) {
      errors.push({ code: "DICTIONARY_FIELD_DUPLICATED", severity: "error", rowNumber, businessFieldId, message: `同一 business_field_id 被多个字段映射：${businessFieldId}` });
    }
    seenBusinessFields.set(businessFieldId, fieldNameEn);
    if (!logicalType) {
      errors.push({ code: "DICTIONARY_CONSTRAINT_INVALID", severity: "error", rowNumber, businessFieldId, message: "logical_type 不能为空。" });
    } else if (!LOGICAL_TYPE_PATTERN.test(logicalType)) {
      errors.push({ code: "DICTIONARY_CONSTRAINT_INVALID", severity: "error", rowNumber, businessFieldId, message: `logical_type 格式非法：${row.logical_type}` });
    }
    if (!SQLITE_TYPES.has(sqliteType)) {
      errors.push({ code: "DICTIONARY_CONSTRAINT_INVALID", severity: "error", rowNumber, businessFieldId, message: `sqlite_type 不支持：${row.sqlite_type}` });
    }
    const nullable = parseBool(row.nullable);
    const unique = parseBool(row.unique);
    const primaryKey = parseBool(row.primary_key);
    if (nullable == null || unique == null || primaryKey == null) {
      errors.push({ code: "DICTIONARY_CONSTRAINT_INVALID", severity: "error", rowNumber, businessFieldId, message: "nullable、unique、primary_key 必须为 true/false。" });
    }
    if (primaryKey && nullable) {
      errors.push({ code: "DICTIONARY_CONSTRAINT_INVALID", severity: "error", rowNumber, businessFieldId, message: "主键字段不允许为空。" });
    }
    const aliases = splitAliases(row.aliases);
    if (row.source_example && !isCsvNullValue(row.source_example) && !exampleMatchesType(row.source_example, logicalType)) {
      warnings.push({ code: "TYPE_CONVERSION_FAILED", severity: "warning", rowNumber, businessFieldId, rawValue: row.source_example, message: `source_example 与 logical_type 可能不匹配：${row.source_example}` });
    }

    definitions.push({
      fieldOrder: Number(row.field_order) || rowNumber,
      fieldNameZh,
      fieldNameEn,
      businessFieldId,
      sourceFieldName: row.source_field_name,
      logicalType: logicalType || "unknown",
      sourceType: row.source_type,
      sqliteType: SQLITE_TYPES.has(sqliteType) ? sqliteType : "TEXT",
      mysqlType: row.mysql_type,
      nullable: Boolean(nullable),
      unique: Boolean(unique),
      primaryKey: Boolean(primaryKey),
      constraints,
      sourceExample: row.source_example,
      fieldComment: row.field_comment || fieldNameZh,
      aliases,
      sensitivity: parseSensitivity(row.sensitivity),
    });
  }

  return { valid: errors.length === 0, definitions: definitions.sort((left, right) => left.fieldOrder - right.fieldOrder), errors, warnings };
}

export function matchCsvHeaders(headers: string[], definitions: FieldDictionaryDefinition[]): CsvFieldMatchResult[] {
  const usedDefinitions = new Set<FieldDictionaryDefinition>();
  return headers.map((header) => {
    const exactSources: Array<[CsvFieldMatchResult["matchSource"], (field: FieldDictionaryDefinition) => boolean, number]> = [
      ["source_field_name", (field) => field.sourceFieldName === header, 1],
      ["field_name_zh", (field) => field.fieldNameZh === header, 0.98],
      ["field_name_en", (field) => field.fieldNameEn === header, 0.96],
      ["alias", (field) => field.aliases.includes(header), 0.92],
    ];
    for (const [matchSource, predicate, confidence] of exactSources) {
      const candidates = definitions.filter(predicate);
      if (candidates.length === 1) {
        usedDefinitions.add(candidates[0]);
        return { sourceHeader: header, matched: true, dictionaryField: candidates[0], matchSource, confidence, warnings: [] };
      }
      if (candidates.length > 1) {
        return { sourceHeader: header, matched: false, matchSource: "none", confidence: 0, warnings: [`字段 ${header} 匹配到多个字典字段。`] };
      }
    }

    const normalizedHeader = normalizeFieldName(header);
    const normalizedCandidates = definitions.filter((field) => {
      const names = [field.sourceFieldName, field.fieldNameZh, field.fieldNameEn, ...field.aliases];
      return names.some((name) => {
        const normalizedName = normalizeFieldName(name);
        return normalizedName.normalized === normalizedHeader.normalized || normalizedName.withoutUnit === normalizedHeader.withoutUnit;
      });
    });
    if (normalizedCandidates.length === 1) {
      usedDefinitions.add(normalizedCandidates[0]);
      return { sourceHeader: header, matched: true, dictionaryField: normalizedCandidates[0], matchSource: "normalized", confidence: 0.82, warnings: [] };
    }
    if (normalizedCandidates.length > 1) {
      return { sourceHeader: header, matched: false, matchSource: "none", confidence: 0, warnings: [`字段 ${header} 归一化后匹配到多个字典字段。`] };
    }

    const businessField = findBusinessFieldByAlias(header);
    const dictionaryField = businessField ? definitions.find((field) => field.businessFieldId === businessField.businessFieldId) : undefined;
    if (dictionaryField) {
      usedDefinitions.add(dictionaryField);
      return { sourceHeader: header, matched: true, dictionaryField, matchSource: "business_dictionary", confidence: 0.72, warnings: [] };
    }
    return { sourceHeader: header, matched: false, matchSource: "none", confidence: 0, warnings: [] };
  });
}

export function validateRequiredHeaderMatches(headers: string[], definitions: FieldDictionaryDefinition[]) {
  const matches = matchCsvHeaders(headers, definitions);
  const matchedDefinitions = new Set(matches.map((match) => match.dictionaryField).filter(Boolean));
  const errors = definitions
    .filter((definition) => !definition.nullable || definition.primaryKey || definition.constraints.required)
    .filter((definition) => !matchedDefinitions.has(definition))
    .map((definition): CsvImportIssue => ({
      code: "CSV_HEADER_MISSING",
      severity: "critical",
      businessFieldId: definition.businessFieldId,
      physicalName: definition.fieldNameEn,
      sourceHeader: definition.sourceFieldName,
      message: `CSV 缺少必需字段：${definition.fieldNameZh}（${definition.sourceFieldName}）`,
    }));
  const warnings = matches.flatMap((match) => match.warnings.map((message): CsvImportIssue => ({
    code: "CSV_HEADER_AMBIGUOUS",
    severity: "warning",
    sourceHeader: match.sourceHeader,
    message,
  })));
  return { matches, errors, warnings };
}

export function validateCsvRows(rows: Array<Record<string, string>>, fieldMappings: Array<{ sourceHeader: string; definition: FieldDictionaryDefinition }>, mode: "strict" | "quarantine" = "strict") {
  const issues: CsvImportIssue[] = [];
  const uniqueValues = new Map<string, Set<string>>();
  for (const mapping of fieldMappings) {
    if (mapping.definition.unique || mapping.definition.primaryKey) {
      uniqueValues.set(mapping.definition.fieldNameEn, new Set());
    }
  }
  for (const [rowIndex, row] of rows.entries()) {
    const rowNumber = rowIndex + 2;
    for (const mapping of fieldMappings) {
      const value = row[mapping.sourceHeader];
      const definition = mapping.definition;
      const trimmed = String(value ?? "").trim();
      const required = !definition.nullable || definition.primaryKey || definition.constraints.required;
      if (isCsvNullValue(trimmed) && required) {
        issues.push({
          code: definition.primaryKey ? "PRIMARY_KEY_MISSING" : "REQUIRED_VALUE_MISSING",
          severity: "error",
          rowNumber,
          sourceHeader: mapping.sourceHeader,
          physicalName: definition.fieldNameEn,
          businessFieldId: definition.businessFieldId,
          rawValue: value,
          message: `${definition.fieldNameZh} 不能为空。`,
        });
        continue;
      }
      if (isCsvNullValue(trimmed)) {
        continue;
      }
      const conversion = convertCsvValue(trimmed, definition);
      if (!conversion.ok) {
        issues.push({ code: "TYPE_CONVERSION_FAILED", severity: "error", rowNumber, sourceHeader: mapping.sourceHeader, physicalName: definition.fieldNameEn, businessFieldId: definition.businessFieldId, rawValue: value, message: conversion.message });
        continue;
      }
      validateValueConstraints(conversion.value, definition, rowNumber, mapping.sourceHeader, issues);
      const uniqueSet = uniqueValues.get(definition.fieldNameEn);
      if (uniqueSet) {
        const key = String(conversion.value);
        if (uniqueSet.has(key)) {
          issues.push({ code: "UNIQUE_CONSTRAINT_VIOLATED", severity: "error", rowNumber, sourceHeader: mapping.sourceHeader, physicalName: definition.fieldNameEn, businessFieldId: definition.businessFieldId, rawValue: value, message: `${definition.fieldNameZh} 存在重复值：${key}` });
        }
        uniqueSet.add(key);
      }
    }
  }
  return {
    mode,
    validRows: mode === "strict" && issues.some((issue) => issue.severity !== "warning") ? 0 : rows.length - new Set(issues.map((issue) => issue.rowNumber).filter(Boolean)).size,
    invalidRows: new Set(issues.map((issue) => issue.rowNumber).filter(Boolean)).size,
    issues,
  };
}

export function convertCsvValue(value: string, definition: FieldDictionaryDefinition): { ok: true; value: string | number | null } | { ok: false; message: string } {
  const trimmed = definition.constraints.trim === false ? value : value.trim();
  if (isCsvNullValue(trimmed)) {
    return { ok: true, value: null };
  }
  if (definition.logicalType === "integer" || definition.sqliteType === "INTEGER") {
    if (!/^[-+]?\d+$/.test(trimmed.replaceAll(",", ""))) {
      return { ok: false, message: `${definition.fieldNameZh} 不是合法整数。` };
    }
    return { ok: true, value: Number(trimmed.replaceAll(",", "")) };
  }
  if (definition.logicalType === "decimal" || definition.sqliteType === "REAL" || definition.sqliteType === "NUMERIC") {
    const number = Number(trimmed.replaceAll(",", ""));
    if (!Number.isFinite(number)) {
      return { ok: false, message: `${definition.fieldNameZh} 不是合法数值。` };
    }
    return { ok: true, value: number };
  }
  if (definition.logicalType === "date" && !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(trimmed)) {
    return { ok: false, message: `${definition.fieldNameZh} 不是合法日期。` };
  }
  return { ok: true, value: trimmed };
}

export function normalizeFieldName(value: string) {
  const halfWidth = value
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/\s+/g, "_")
    .replace(/-/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
  return {
    normalized: halfWidth,
    withoutUnit: halfWidth.replace(/\([^)]*\)/g, ""),
  };
}

function validateValueConstraints(value: string | number | null, definition: FieldDictionaryDefinition, rowNumber: number, sourceHeader: string, issues: CsvImportIssue[]) {
  if (value == null) {
    return;
  }
  const constraints = definition.constraints;
  if (constraints.enum && !constraints.allowUnknownEnum && !constraints.enum.map(String).includes(String(value))) {
    issues.push({ code: "ENUM_VALUE_INVALID", severity: "error", rowNumber, sourceHeader, physicalName: definition.fieldNameEn, businessFieldId: definition.businessFieldId, rawValue: value, message: `${definition.fieldNameZh} 不在枚举范围内。` });
  }
  if (typeof value === "number") {
    if (typeof constraints.min === "number" && value < constraints.min) {
      issues.push({ code: "VALUE_OUT_OF_RANGE", severity: "error", rowNumber, sourceHeader, physicalName: definition.fieldNameEn, businessFieldId: definition.businessFieldId, rawValue: value, message: `${definition.fieldNameZh} 小于最小值 ${constraints.min}。` });
    }
    if (typeof constraints.max === "number" && value > constraints.max) {
      issues.push({ code: "VALUE_OUT_OF_RANGE", severity: "error", rowNumber, sourceHeader, physicalName: definition.fieldNameEn, businessFieldId: definition.businessFieldId, rawValue: value, message: `${definition.fieldNameZh} 大于最大值 ${constraints.max}。` });
    }
  }
  const text = String(value);
  if (typeof constraints.minLength === "number" && text.length < constraints.minLength) {
    issues.push({ code: "VALUE_LENGTH_INVALID", severity: "error", rowNumber, sourceHeader, physicalName: definition.fieldNameEn, businessFieldId: definition.businessFieldId, rawValue: value, message: `${definition.fieldNameZh} 长度小于 ${constraints.minLength}。` });
  }
  if (typeof constraints.maxLength === "number" && text.length > constraints.maxLength) {
    issues.push({ code: "VALUE_LENGTH_INVALID", severity: "error", rowNumber, sourceHeader, physicalName: definition.fieldNameEn, businessFieldId: definition.businessFieldId, rawValue: value, message: `${definition.fieldNameZh} 长度大于 ${constraints.maxLength}。` });
  }
  if (constraints.pattern && !new RegExp(constraints.pattern).test(text)) {
    issues.push({ code: "PATTERN_MISMATCH", severity: "error", rowNumber, sourceHeader, physicalName: definition.fieldNameEn, businessFieldId: definition.businessFieldId, rawValue: value, message: `${definition.fieldNameZh} 不符合格式规则。` });
  }
}

function parseConstraints(value: string | undefined, rowNumber: number, errors: CsvImportIssue[]): FieldConstraints {
  if (!value?.trim()) {
    return {};
  }
  const normalized = normalizeJsonCell(value);
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as FieldConstraints : {};
  } catch {
    const relaxed = parseRelaxedConstraints(normalized);
    if (relaxed) {
      return relaxed;
    }
    errors.push({ code: "DICTIONARY_CONSTRAINT_INVALID", severity: "error", rowNumber, message: "constraints_json 不是合法 JSON。" });
    return {};
  }
}

function normalizeDictionaryValues(headers: string[], values: string[], delimiter: string) {
  if (values.length <= headers.length || delimiter !== ",") {
    return values;
  }
  const mysqlIndex = headers.indexOf("mysql_type");
  const nullableIndex = headers.indexOf("nullable");
  const uniqueIndex = headers.indexOf("unique");
  const primaryKeyIndex = headers.indexOf("primary_key");
  const constraintsIndex = headers.indexOf("constraints_json");
  if (mysqlIndex < 0 || nullableIndex < 0 || uniqueIndex < 0 || primaryKeyIndex < 0 || constraintsIndex < 0) {
    return values;
  }

  const boolStart = findBooleanTriple(values, mysqlIndex);
  if (boolStart == null) {
    return values;
  }

  const next = values.slice(0, mysqlIndex);
  next[mysqlIndex] = values.slice(mysqlIndex, boolStart).join(delimiter).trim();
  next[nullableIndex] = values[boolStart]?.trim() ?? "";
  next[uniqueIndex] = values[boolStart + 1]?.trim() ?? "";
  next[primaryKeyIndex] = values[boolStart + 2]?.trim() ?? "";

  const remaining = values.slice(boolStart + 3);
  const tailHeaders = headers.slice(constraintsIndex + 1);
  if (remaining.length <= tailHeaders.length + 1) {
    next[constraintsIndex] = remaining[0]?.trim() ?? "";
    for (const [tailIndex, header] of tailHeaders.entries()) {
      next[headers.indexOf(header)] = remaining[tailIndex + 1]?.trim() ?? "";
    }
    return next;
  }

  const constraintPartCount = remaining.length - tailHeaders.length;
  next[constraintsIndex] = remaining.slice(0, constraintPartCount).join(delimiter).trim();
  for (const [tailIndex, header] of tailHeaders.entries()) {
    next[headers.indexOf(header)] = remaining[constraintPartCount + tailIndex]?.trim() ?? "";
  }
  return next;
}

function findBooleanTriple(values: string[], startIndex: number) {
  for (let index = startIndex; index <= values.length - 3; index += 1) {
    if (parseBool(values[index]) != null && parseBool(values[index + 1]) != null && parseBool(values[index + 2]) != null) {
      return index;
    }
  }
  return null;
}

function normalizeJsonCell(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith("“") && trimmed.endsWith("”"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

function parseRelaxedConstraints(value: string): FieldConstraints | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "{}") {
    return {};
  }
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  const withQuotedKeys = trimmed.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
  const withQuotedArrayItems = withQuotedKeys.replace(/\[([^\]]*)\]/g, (_match, content: string) => {
    const items = content.split(",").map((item) => item.trim()).filter(Boolean);
    if (items.length === 0) {
      return "[]";
    }
    return `[${items.map((item) => {
      if (/^".*"$/.test(item) || /^'.*'$/.test(item) || /^[-+]?\d+(?:\.\d+)?$/.test(item) || /^(true|false|null)$/i.test(item)) {
        return item.replace(/^'(.*)'$/, '"$1"');
      }
      return JSON.stringify(item);
    }).join(",")}]`;
  });
  try {
    const parsed = JSON.parse(withQuotedArrayItems);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as FieldConstraints : null;
  } catch {
    return null;
  }
}

function parseBool(value: string | undefined) {
  if (/^(true|1|yes|y)$/i.test(value ?? "")) {
    return true;
  }
  if (/^(false|0|no|n)$/i.test(value ?? "")) {
    return false;
  }
  return null;
}

function normalizeLogicalType(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isCsvNullValue(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return true;
  }
  return /^(?:null|nil|none|n\/a|na|nan|\\N)$/i.test(trimmed);
}

function splitAliases(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      // Fall through to legacy delimiter parsing.
    }
  }
  return trimmed
    .split(/[|,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSensitivity(value: string | undefined) {
  return ["public", "internal", "sensitive", "restricted"].includes(value ?? "") ? value as FieldDictionaryDefinition["sensitivity"] : undefined;
}

function exampleMatchesType(value: string, logicalType: LogicalFieldType) {
  if (logicalType === "integer") {
    return /^[-+]?\d+$/.test(value.replaceAll(",", ""));
  }
  if (logicalType === "decimal") {
    return Number.isFinite(Number(value.replaceAll(",", "")));
  }
  if (logicalType === "date") {
    return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(value);
  }
  return true;
}

function detectDelimiter(headerLine: string) {
  const candidates = [",", "\t", ";"];
  return candidates
    .map((delimiter) => ({ delimiter, count: headerLine.split(delimiter).length }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ",";
}

function parseCsvRecords(content: string) {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += `${char}${next}`;
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (current.trim()) {
        records.push(current);
      }
      current = "";
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    records.push(current);
  }
  return records;
}

function parseCsvRecord(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}
