import type { RequestSqlQueryExecutionInput, SqlExecutionResult, SqlModelResultPayload, SqlPythonAnalysisPayload, SqlResultColumn, SqlResultSummary } from "./types.js";

export type ProcessSqlResultInput = {
  executionId: string;
  requestId: string;
  request: RequestSqlQueryExecutionInput;
  columns: SqlResultColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  maxRows: number;
  executionTimeMs: number;
  sensitiveColumns: string[];
  storeRawRows?: boolean;
};

export class SqlResultProcessor {
  process(input: ProcessSqlResultInput): SqlExecutionResult {
    const maskedRows = maskAndTruncateRows(input.rows, input.columns, input.sensitiveColumns, Math.min(input.maxRows, 50));
    const truncated = input.rowCount > maskedRows.length || input.rows.length > maskedRows.length;
    const masked = input.sensitiveColumns.length > 0;
    const summary = summarizeRows(input.columns, maskedRows, input.rowCount, truncated);
    const safeModelPayload: SqlModelResultPayload = {
      executionId: input.executionId,
      dataSourceId: input.request.dataSourceId,
      queryPurpose: input.request.purpose,
      resultSummary: summary,
      previewRows: maskedRows.slice(0, 10),
      importantFindings: buildImportantFindings(summary),
      limitations: [
        "返回给模型的是裁剪、脱敏后的安全结果，不代表完整源表数据。",
        truncated ? "结果已按行数或字段策略截断。" : "结果未超过当前返回限制。",
        masked ? "敏感字段已脱敏。" : "未检测到需要脱敏的敏感字段。",
      ],
      masked,
      truncated,
    };
    const pythonAnalysisPayload = buildPythonPayload(input, maskedRows, masked, truncated);
    return {
      executionId: input.executionId,
      requestId: input.requestId,
      status: "success",
      columns: input.columns,
      rows: input.storeRawRows ? maskedRows : undefined,
      summary,
      safeModelPayload,
      pythonAnalysisPayload,
      rowCount: input.rowCount,
      truncated,
      masked,
      executionTimeMs: input.executionTimeMs,
      warnings: summary.warnings,
      createdAt: new Date().toISOString(),
    };
  }
}

function buildPythonPayload(input: ProcessSqlResultInput, rows: Record<string, unknown>[], masked: boolean, truncated: boolean): SqlPythonAnalysisPayload | undefined {
  if (input.request.expectedResultUse !== "python_analysis" && input.request.resultConsumer !== "python_tool") {
    return undefined;
  }
  const directRows = input.rowCount <= 1_000 && input.rows.length <= 1_000 ? rows : undefined;
  return {
    executionId: input.executionId,
    dataSourceId: input.request.dataSourceId,
    queryId: input.requestId,
    columns: input.columns,
    rowsRef: directRows ? undefined : `sql_rows_${input.executionId}`,
    rows: directRows,
    rowCount: input.rowCount,
    truncated,
    masked,
    schema: Object.fromEntries(input.columns.map((column) => [column.name, column.type])),
    warnings: [
      "Python 分析 payload 已按 SQL 权限和脱敏策略处理。",
      truncated ? "大结果集可能通过 rowsRef 传递，Python 工具仍需二次权限校验。" : "结果集可直接用于受控 Python 分析。",
    ],
  };
}

function summarizeRows(columns: SqlResultColumn[], rows: Record<string, unknown>[], rowCount: number, truncated: boolean): SqlResultSummary {
  const nullCounts: Record<string, number> = {};
  const numericSummaries: NonNullable<SqlResultSummary["numericSummaries"]> = {};
  const categoricalSummaries: NonNullable<SqlResultSummary["categoricalSummaries"]> = {};
  const timeRangeSummaries: NonNullable<SqlResultSummary["timeRangeSummaries"]> = {};
  for (const column of columns) {
    const values = rows.map((row) => row[column.name]);
    nullCounts[column.name] = values.filter((value) => value == null || value === "").length;
    const numericValues = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
    if (numericValues.length > 0 && /int|decimal|numeric|float|double|number/i.test(column.type)) {
      numericSummaries[column.name] = {
        min: numericValues[0],
        max: numericValues[numericValues.length - 1],
        mean: Number((numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length).toFixed(4)),
        median: numericValues[Math.floor(numericValues.length / 2)],
      };
      continue;
    }
    const dates = values.map(String).filter((value) => /\d{4}-\d{1,2}-\d{1,2}/.test(value)).sort();
    if (dates.length > 0 && /date|time/i.test(column.type)) {
      timeRangeSummaries[column.name] = { min: dates[0], max: dates[dates.length - 1] };
      continue;
    }
    categoricalSummaries[column.name] = topValues(values, rows.length);
  }
  return {
    rowCount,
    columnCount: columns.length,
    columns,
    numericSummaries,
    categoricalSummaries,
    timeRangeSummaries,
    nullCounts,
    warnings: [
      "SQL 结果摘要基于受控返回结果生成。",
      truncated ? "结果已截断，不能视为完整源表数据。" : "结果未触发截断。",
    ],
  };
}

function maskAndTruncateRows(rows: Record<string, unknown>[], columns: SqlResultColumn[], sensitiveColumns: string[], maxRows: number) {
  const sensitive = new Set([...sensitiveColumns, ...columns.filter((column) => column.sensitive).map((column) => column.name)]);
  return rows.slice(0, maxRows).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, sensitive.has(key) ? maskValue(value) : truncateValue(value)]),
    ),
  );
}

function maskValue(value: unknown) {
  if (value == null) {
    return null;
  }
  const text = String(value);
  return text.length <= 4 ? "****" : `${text.slice(0, 2)}****${text.slice(-2)}`;
}

function truncateValue(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }
  return value.length > 120 ? `${value.slice(0, 120)}...` : value;
}

function topValues(values: unknown[], total: number) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(String(value ?? "null"), (counts.get(String(value ?? "null")) ?? 0) + 1));
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value, count, ratio: total > 0 ? Number((count / total).toFixed(4)) : 0 }));
}

function buildImportantFindings(summary: SqlResultSummary) {
  return [`返回 ${summary.rowCount} 行、${summary.columnCount} 列。`];
}
