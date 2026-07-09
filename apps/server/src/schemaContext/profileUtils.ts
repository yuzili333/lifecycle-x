import type { ColumnProfile, SensitivityLevel, TableProfile } from "./types.js";

export function isSensitiveFieldName(name: string) {
  return /(name|phone|mobile|id_card|cert|email|address|customer_name|客户名|证件|手机号|邮箱|地址)/i.test(name);
}

export function sensitivityFromFlags(isSensitive: boolean, name: string): SensitivityLevel {
  if (isSensitive || isSensitiveFieldName(name)) {
    return "sensitive";
  }
  return "internal";
}

export function maskSensitiveValue(value: unknown) {
  if (value == null) {
    return null;
  }
  const text = String(value);
  if (text.length <= 4) {
    return "****";
  }
  return `${text.slice(0, 2)}****${text.slice(-2)}`;
}

export function truncateValue(value: unknown, maxLength = 80): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function inferValueType(values: unknown[]): ColumnProfile["inferredType"] {
  const nonEmpty = values.filter((value) => value !== "" && value != null);
  if (nonEmpty.length === 0) {
    return "unknown";
  }
  if (nonEmpty.every((value) => typeof value === "boolean" || /^(true|false)$/i.test(String(value)))) {
    return "boolean";
  }
  if (nonEmpty.every((value) => /^-?\d+$/.test(String(value)))) {
    return "integer";
  }
  if (nonEmpty.every((value) => /^-?\d+(?:\.\d+)?$/.test(String(value)))) {
    return "number";
  }
  if (nonEmpty.every((value) => /^\d{4}-\d{1,2}-\d{1,2}$/.test(String(value)))) {
    return "date";
  }
  if (nonEmpty.every((value) => !Number.isNaN(Date.parse(String(value))) && /\d{4}/.test(String(value)))) {
    return "datetime";
  }
  const uniqueCount = new Set(nonEmpty.map(String)).size;
  if (uniqueCount <= Math.max(12, Math.ceil(nonEmpty.length * 0.4))) {
    return "category";
  }
  if (nonEmpty.some((value) => String(value).length > 120)) {
    return "text";
  }
  return "string";
}

export function inferSqlType(type: string): ColumnProfile["inferredType"] {
  if (/int|bigint|smallint|tinyint/i.test(type)) {
    return "integer";
  }
  if (/decimal|numeric|float|double|real/i.test(type)) {
    return "number";
  }
  if (/datetime|timestamp/i.test(type)) {
    return "datetime";
  }
  if (/\bdate\b/i.test(type)) {
    return "date";
  }
  if (/bool/i.test(type)) {
    return "boolean";
  }
  if (/json|text|blob/i.test(type)) {
    return "text";
  }
  return "string";
}

export function buildColumnStatistics(columnName: string, values: unknown[], dataType: string, sensitivity: SensitivityLevel): ColumnProfile {
  const total = values.length || 1;
  const nonEmpty = values.filter((value) => value !== "" && value != null);
  const uniqueValues = Array.from(new Set(nonEmpty.map(String)));
  const inferredType = inferValueType(values);
  const column: ColumnProfile = {
    columnName,
    dataType,
    inferredType,
    nullable: nonEmpty.length < values.length,
    missingRate: Number(((values.length - nonEmpty.length) / total).toFixed(4)),
    uniqueCount: uniqueValues.length,
    sampleValues: uniqueValues.slice(0, 5).map((value) => (sensitivity === "sensitive" || sensitivity === "restricted" ? maskSensitiveValue(value) : truncateValue(value))),
    sensitivity,
  };
  if (inferredType === "integer" || inferredType === "number") {
    const numbers = nonEmpty.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
    if (numbers.length > 0) {
      column.min = numbers[0];
      column.max = numbers[numbers.length - 1];
      column.mean = Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(4));
      column.median = numbers[Math.floor(numbers.length / 2)];
    }
  }
  if (inferredType === "category" || inferredType === "string") {
    column.topValues = topValues(nonEmpty, total, sensitivity).slice(0, 5);
  }
  if (inferredType === "date" || inferredType === "datetime") {
    const sortedDates = nonEmpty.map(String).sort();
    column.timeRange = { min: sortedDates[0], max: sortedDates[sortedDates.length - 1] };
    column.min = sortedDates[0];
    column.max = sortedDates[sortedDates.length - 1];
  }
  return column;
}

export function buildTableStatistics(table: TableProfile) {
  return {
    numericColumns: Object.fromEntries(
      table.columns
        .filter((column) => (column.inferredType === "number" || column.inferredType === "integer") && (column.min != null || column.max != null))
        .map((column) => [column.columnName, { min: Number(column.min), max: Number(column.max), mean: column.mean, median: column.median }]),
    ),
    categoryColumns: Object.fromEntries(
      table.columns.filter((column) => column.topValues?.length).map((column) => [column.columnName, column.topValues ?? []]),
    ),
    timeColumns: Object.fromEntries(
      table.columns.filter((column) => column.timeRange).map((column) => [column.columnName, column.timeRange ?? {}]),
    ),
    warnings: table.rowCount && table.sampleRows && table.rowCount > table.sampleRows.length ? ["样例行仅用于理解数据形态，不代表全量统计结论。"] : [],
  };
}

export function maskRows(rows: Record<string, unknown>[], columns: ColumnProfile[], maxRows: number) {
  const columnMap = new Map(columns.map((column) => [column.columnName, column]));
  return rows.slice(0, maxRows).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        const column = columnMap.get(key);
        const masked = column?.sensitivity === "sensitive" || column?.sensitivity === "restricted" ? maskSensitiveValue(value) : truncateValue(value);
        return [key, masked];
      }),
    ),
  );
}

function topValues(values: unknown[], total: number, sensitivity: SensitivityLevel) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(String(value), (counts.get(String(value)) ?? 0) + 1));
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([value, count]) => ({
      value: sensitivity === "sensitive" || sensitivity === "restricted" ? maskSensitiveValue(value) : truncateValue(value),
      count,
      ratio: Number((count / total).toFixed(4)),
    }));
}
