import { randomUUID } from "node:crypto";

export const CHAT_CSV_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_CHAT_CSV_TTL_MS = 24 * 60 * 60 * 1000;

export type ChatCsvUploadStatus = "selected" | "validating" | "parsing" | "importing" | "ready" | "failed" | "removed";

export type ChatCsvImportErrorCode =
  | "CSV_FILE_TOO_LARGE"
  | "CSV_FILE_EMPTY"
  | "CSV_FILE_TYPE_INVALID"
  | "CSV_PARSE_FAILED"
  | "CSV_HEADER_MISSING"
  | "CSV_COLUMN_DUPLICATED"
  | "CSV_ENCODING_UNSUPPORTED"
  | "CSV_SQLITE_TABLE_CREATE_FAILED"
  | "CSV_SQLITE_IMPORT_FAILED"
  | "CSV_TEMP_SOURCE_SAVE_FAILED"
  | "CSV_TEMP_SOURCE_EXPIRED"
  | "CSV_TEMP_SOURCE_NOT_FOUND"
  | "CSV_TEMP_SOURCE_PERMISSION_DENIED"
  | "UNKNOWN_ERROR";

export type ChatCsvImportError = {
  code: ChatCsvImportErrorCode;
  message: string;
};

export type ChatCsvLogicalType = "string" | "integer" | "decimal" | "boolean" | "date" | "datetime" | "category" | "text" | "unknown";
export type ChatCsvSqliteType = "TEXT" | "INTEGER" | "REAL" | "NUMERIC" | "BLOB";
export type SchemaContextMode = "selected_fields" | "full_schema" | "schema_summary";

export function resolveSchemaContextMode(input: {
  selectedFieldRefs?: ChatCsvSelectedFieldRef[];
  requiresFullSchema?: boolean;
  userRequestedFieldDiscovery?: boolean;
}): SchemaContextMode {
  const selectedFieldCount = input.selectedFieldRefs?.filter((field) => field.status === "valid").length ?? 0;
  if (selectedFieldCount > 0 && !input.requiresFullSchema && !input.userRequestedFieldDiscovery) {
    return "selected_fields";
  }
  if (input.requiresFullSchema || input.userRequestedFieldDiscovery) {
    return "full_schema";
  }
  return "schema_summary";
}

export type ChatCsvColumnMetadata = {
  ordinalPosition: number;
  sourceHeader: string;
  sqliteColumnName: string;
  displayName: string;
  inferredLogicalType: ChatCsvLogicalType;
  sqliteType: ChatCsvSqliteType;
  nullable?: boolean;
  sampleValues?: unknown[];
  warnings?: string[];
  suggestedBusinessFieldId?: string;
};

export type ChatCsvSelectedFieldRef = {
  tokenId: string;
  type: "csv_field";
  tempDataSourceId: string;
  tempTableId: string;
  fieldId: string;
  sourceHeader: string;
  physicalName: string;
  displayName: string;
  logicalType: ChatCsvLogicalType;
  sqliteType: ChatCsvSqliteType;
  rawText: string;
  start: number;
  end: number;
  createdAt: string;
  status: "valid" | "expired" | "missing";
};

export type ChatCsvAttachment = {
  attachmentId: string;
  conversationId: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: "text/csv";
  status: ChatCsvUploadStatus;
  tempDataSourceId?: string;
  tempTableId?: string;
  sqliteTableName?: string;
  rowCount?: number;
  columnCount?: number;
  columns?: ChatCsvColumnMetadata[];
  createdAt: string;
  warnings?: string[];
  error?: ChatCsvImportError;
};

export type ConversationTempCsvTable = {
  tempTableId: string;
  tempDataSourceId: string;
  conversationId: string;
  userId: string;
  fileName: string;
  fileSizeBytes: number;
  sqliteTableName: string;
  rowCount: number;
  columnCount: number;
  columns: ChatCsvColumnMetadata[];
  status: "creating" | "ready" | "failed" | "expired" | "deleted";
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};

export type ImportConversationCsvInput = {
  conversationId: string;
  userId: string;
  fileName: string;
  fileSizeBytes: number;
  fileBuffer: Uint8Array;
  mimeType?: string;
  ttlMs?: number;
};

type ParsedCsv = {
  delimiter: string;
  encoding: "utf-8" | "utf-8-bom";
  headers: string[];
  columns: ChatCsvColumnMetadata[];
  rows: string[][];
};

function nowIso() {
  return new Date().toISOString();
}

function fail(code: ChatCsvImportErrorCode, message: string): never {
  const error = new Error(message) as Error & { code: ChatCsvImportErrorCode };
  error.code = code;
  throw error;
}

export function quoteSqliteIdentifier(identifier: string) {
  if (identifier.includes("\u0000")) {
    fail("CSV_SQLITE_TABLE_CREATE_FAILED", "SQLite 标识符不能包含 NUL 字符。");
  }
  const normalized = identifier.trim();
  if (!normalized) {
    fail("CSV_SQLITE_TABLE_CREATE_FAILED", "SQLite 标识符不能为空。");
  }
  if (normalized.length > 128) {
    fail("CSV_SQLITE_TABLE_CREATE_FAILED", "SQLite 标识符长度不能超过 128 个字符。");
  }
  return `"${normalized.replaceAll('"', '""')}"`;
}

function tableNameFor(conversationId: string) {
  const shortConversation = conversationId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "conv";
  const timestamp = Math.floor(Date.now() / 1000);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  return `chat_csv_${shortConversation}_${timestamp}_${suffix}`;
}

function validateFile(input: ImportConversationCsvInput) {
  const fileName = input.fileName.trim();
  if (!fileName) {
    fail("CSV_FILE_TYPE_INVALID", "CSV 文件名不能为空。");
  }
  const hasCsvExtension = /\.csv$/i.test(fileName);
  const hasCsvMime = Boolean(input.mimeType && /^(text\/csv|application\/vnd\.ms-excel)$/i.test(input.mimeType));
  if (!hasCsvExtension && !hasCsvMime) {
    fail("CSV_FILE_TYPE_INVALID", "仅支持上传 CSV 文件。");
  }
  if (input.fileSizeBytes > CHAT_CSV_MAX_FILE_SIZE_BYTES || input.fileBuffer.byteLength > CHAT_CSV_MAX_FILE_SIZE_BYTES) {
    fail("CSV_FILE_TOO_LARGE", "CSV 文件不能超过 10 MB。");
  }
  if (input.fileSizeBytes <= 0 || input.fileBuffer.byteLength <= 0) {
    fail("CSV_FILE_EMPTY", "CSV 文件不能为空。");
  }
}

function parseCsv(content: string): ParsedCsv {
  const encoding = content.startsWith("\uFEFF") ? "utf-8-bom" : "utf-8";
  const normalizedContent = content.replace(/^\uFEFF/, "");
  const records = parseCsvRecords(normalizedContent);
  if (records.length === 0) {
    fail("CSV_HEADER_MISSING", "CSV 表头不能为空。");
  }
  const delimiter = detectDelimiter(records[0] ?? "");
  const parsedRows = records.map((record) => parseCsvRecord(record, delimiter));
  const rawHeaders = parsedRows[0] ?? [];
  if (rawHeaders.length === 0 || rawHeaders.every((header) => !header.trim())) {
    fail("CSV_HEADER_MISSING", "CSV 表头不能为空。");
  }
  const headers = normalizeHeaders(rawHeaders);
  const rows = parsedRows.slice(1);
  const columns = buildColumns(headers, rows);
  return { delimiter, encoding, headers: headers.map((header) => header.sqliteColumnName), columns, rows };
}

function parseCsvRecords(content: string) {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (current.length > 0) {
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

  if (current.length > 0) {
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
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
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

function detectDelimiter(headerLine: string) {
  const candidates = [",", "\t", ";"];
  return candidates
    .map((delimiter) => ({ delimiter, count: parseCsvRecord(headerLine, delimiter).length }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ",";
}

function normalizeHeaders(rawHeaders: string[]) {
  const used = new Map<string, number>();
  return rawHeaders.map((sourceHeader, index) => {
    const trimmed = sourceHeader.trim();
    const warnings: string[] = [];
    const baseName = trimmed || `未命名字段_${index + 1}`;
    if (!trimmed) {
      warnings.push("空表头已自动命名。");
    }
    const safeBase = baseName.slice(0, 120);
    const count = used.get(safeBase) ?? 0;
    used.set(safeBase, count + 1);
    const sqliteColumnName = count === 0 ? safeBase : `${safeBase}_${count + 1}`;
    if (count > 0) {
      warnings.push(`重复表头已重命名为 ${sqliteColumnName}。`);
    }
    return { sourceHeader: trimmed || baseName, sqliteColumnName, displayName: trimmed || baseName, warnings };
  });
}

function buildColumns(headers: ReturnType<typeof normalizeHeaders>, rows: string[][]): ChatCsvColumnMetadata[] {
  return headers.map((header, index) => {
    const values = rows.map((row) => row[index]?.trim() ?? "");
    const inferredLogicalType = inferLogicalType(values);
    const warnings = [...header.warnings];
    if (values.some((value) => /^[=+\-@]/.test(value))) {
      warnings.push("检测到疑似 CSV 公式注入值，已按普通文本/数值受控导入，不作为公式执行。");
    }
    return {
      ordinalPosition: index + 1,
      sourceHeader: header.sourceHeader,
      sqliteColumnName: header.sqliteColumnName,
      displayName: header.displayName,
      inferredLogicalType,
      sqliteType: sqliteTypeForLogicalType(inferredLogicalType),
      nullable: values.some((value) => value.length === 0),
      sampleValues: Array.from(new Set(values.filter(Boolean))).slice(0, 5),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  });
}

function inferLogicalType(values: string[]): ChatCsvLogicalType {
  const nonEmpty = values.map((value) => value.trim()).filter(Boolean);
  if (nonEmpty.length === 0) {
    return "unknown";
  }
  if (nonEmpty.every((value) => /^[-+]?(?:0|[1-9]\d*)$/.test(value))) {
    return "integer";
  }
  if (nonEmpty.every((value) => /^[-+]?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)$/.test(value.replaceAll(",", "")))) {
    return "decimal";
  }
  if (nonEmpty.every((value) => /^(true|false|yes|no|y|n|0|1|是|否)$/i.test(value))) {
    return "boolean";
  }
  if (nonEmpty.every((value) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(value))) {
    return "date";
  }
  if (nonEmpty.every((value) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?$/.test(value))) {
    return "datetime";
  }
  const uniqueCount = new Set(nonEmpty).size;
  if (uniqueCount <= Math.max(20, Math.ceil(nonEmpty.length * 0.2))) {
    return "category";
  }
  return nonEmpty.some((value) => value.length > 120) ? "text" : "string";
}

function sqliteTypeForLogicalType(type: ChatCsvLogicalType): ChatCsvSqliteType {
  if (type === "integer" || type === "boolean") {
    return "INTEGER";
  }
  if (type === "decimal") {
    return "NUMERIC";
  }
  return "TEXT";
}

function sqliteValue(column: ChatCsvColumnMetadata, rawValue: string | undefined) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return null;
  }
  if (column.inferredLogicalType === "integer") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (column.inferredLogicalType === "decimal") {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (column.inferredLogicalType === "boolean") {
    if (/^(true|yes|y|1|是)$/i.test(value)) {
      return 1;
    }
    if (/^(false|no|n|0|否)$/i.test(value)) {
      return 0;
    }
  }
  return value;
}

function rowFromDb(row: Record<string, unknown>): ConversationTempCsvTable {
  return {
    tempTableId: row.temp_table_id as string,
    tempDataSourceId: row.id as string,
    conversationId: row.conversation_id as string,
    userId: row.user_id as string,
    fileName: row.file_name as string,
    fileSizeBytes: row.file_size_bytes as number,
    sqliteTableName: row.sqlite_table_name as string,
    rowCount: (row.row_count as number | null) ?? 0,
    columnCount: (row.column_count as number | null) ?? 0,
    columns: JSON.parse(row.columns_json as string) as ChatCsvColumnMetadata[],
    status: row.status as ConversationTempCsvTable["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    expiresAt: (row.expires_at as string | null) ?? undefined,
  };
}

function attachmentFromTable(table: ConversationTempCsvTable, status: ChatCsvUploadStatus = table.status === "ready" ? "ready" : "failed", warnings: string[] = []): ChatCsvAttachment {
  return {
    attachmentId: table.tempDataSourceId,
    conversationId: table.conversationId,
    fileName: table.fileName,
    fileSizeBytes: table.fileSizeBytes,
    mimeType: "text/csv",
    status,
    tempDataSourceId: table.tempDataSourceId,
    tempTableId: table.tempTableId,
    sqliteTableName: table.sqliteTableName,
    rowCount: table.rowCount,
    columnCount: table.columnCount,
    columns: table.columns,
    createdAt: table.createdAt,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export class ConversationTempSourceManager {
  constructor(private readonly db: any, private readonly ttlMs = DEFAULT_CHAT_CSV_TTL_MS) {}

  migrate() {
    this.db.exec(`
      create table if not exists conversation_temp_data_sources (
        id text primary key,
        temp_table_id text not null,
        conversation_id text not null,
        user_id text not null,
        file_name text not null,
        file_size_bytes integer not null,
        sqlite_table_name text not null,
        row_count integer,
        column_count integer,
        columns_json text not null,
        status text not null,
        created_at text not null,
        updated_at text not null,
        expires_at text
      );
      create index if not exists idx_conversation_temp_sources_conversation
        on conversation_temp_data_sources(conversation_id);
      create index if not exists idx_conversation_temp_sources_expires
        on conversation_temp_data_sources(expires_at);
    `);
  }

  importCsv(input: ImportConversationCsvInput): ChatCsvAttachment {
    validateFile(input);
    const content = Buffer.from(input.fileBuffer).toString("utf8");
    if (!content.trim()) {
      fail("CSV_FILE_EMPTY", "CSV 文件不能为空。");
    }
    const parsed = parseCsv(content);
    const createdAt = nowIso();
    const tempDataSourceId = `chat_csv_${randomUUID()}`;
    const tempTableId = `chat_csv_table_${randomUUID()}`;
    const sqliteTableName = tableNameFor(input.conversationId);
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? this.ttlMs)).toISOString();
    const createSql = `create table ${quoteSqliteIdentifier(sqliteTableName)} (__row_index integer primary key${
      parsed.columns.length > 0
        ? `, ${parsed.columns.map((column) => `${quoteSqliteIdentifier(column.sqliteColumnName)} ${column.sqliteType}`).join(", ")}`
        : ""
    })`;
    const insertSql = `insert into ${quoteSqliteIdentifier(sqliteTableName)} (__row_index, ${parsed.columns.map((column) => quoteSqliteIdentifier(column.sqliteColumnName)).join(", ")}) values (?, ${parsed.columns.map(() => "?").join(", ")})`;

    const transaction = this.db.transaction(() => {
      this.db.prepare(createSql).run();
      const insert = this.db.prepare(insertSql);
      for (const [index, row] of parsed.rows.entries()) {
        insert.run(index + 1, ...parsed.columns.map((column, columnIndex) => sqliteValue(column, row[columnIndex])));
      }
      this.db
        .prepare(
          `insert into conversation_temp_data_sources
            (id, temp_table_id, conversation_id, user_id, file_name, file_size_bytes, sqlite_table_name, row_count, column_count, columns_json, status, created_at, updated_at, expires_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          tempDataSourceId,
          tempTableId,
          input.conversationId,
          input.userId,
          input.fileName.trim(),
          input.fileSizeBytes,
          sqliteTableName,
          parsed.rows.length,
          parsed.columns.length,
          JSON.stringify(parsed.columns),
          "ready",
          createdAt,
          createdAt,
          expiresAt,
        );
    });

    try {
      transaction();
    } catch (error) {
      try {
        this.db.prepare(`drop table if exists ${quoteSqliteIdentifier(sqliteTableName)}`).run();
      } catch {
        // Best-effort cleanup; original error is surfaced below.
      }
      if (error instanceof Error && "code" in error) {
        throw error;
      }
      fail("CSV_SQLITE_IMPORT_FAILED", error instanceof Error ? error.message : "CSV 导入 SQLite 失败。");
    }

    return attachmentFromTable(
      {
        tempTableId,
        tempDataSourceId,
        conversationId: input.conversationId,
        userId: input.userId,
        fileName: input.fileName.trim(),
        fileSizeBytes: input.fileSizeBytes,
        sqliteTableName,
        rowCount: parsed.rows.length,
        columnCount: parsed.columns.length,
        columns: parsed.columns,
        status: "ready",
        createdAt,
        updatedAt: createdAt,
        expiresAt,
      },
      "ready",
      parsed.rows.length === 0 ? ["CSV 仅包含表头，暂无数据行。"] : [],
    );
  }

  getTempSource(tempDataSourceId: string, userId?: string, conversationId?: string) {
    const row = this.db.prepare("select * from conversation_temp_data_sources where id = ?").get(tempDataSourceId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    const table = rowFromDb(row);
    if (userId && table.userId !== userId) {
      fail("CSV_TEMP_SOURCE_PERMISSION_DENIED", "无权访问该临时 CSV 数据源。");
    }
    if (conversationId && table.conversationId !== conversationId) {
      fail("CSV_TEMP_SOURCE_PERMISSION_DENIED", "临时 CSV 数据源不属于当前会话。");
    }
    if (table.status !== "ready") {
      return table;
    }
    if (table.expiresAt && Date.parse(table.expiresAt) <= Date.now()) {
      this.expireTempSource(table);
      return { ...table, status: "expired" as const };
    }
    return table;
  }

  listByConversation(conversationId: string, userId: string) {
    return (this.db
      .prepare("select * from conversation_temp_data_sources where conversation_id = ? and user_id = ? and status = 'ready' order by created_at desc")
      .all(conversationId, userId) as Array<Record<string, unknown>>)
      .map(rowFromDb)
      .filter((table) => !table.expiresAt || Date.parse(table.expiresAt) > Date.now());
  }

  removeTempSource(tempDataSourceId: string, userId: string, conversationId?: string) {
    const table = this.getTempSource(tempDataSourceId, userId, conversationId);
    if (!table) {
      fail("CSV_TEMP_SOURCE_NOT_FOUND", "临时 CSV 数据源不存在。");
    }
    this.db.prepare(`drop table if exists ${quoteSqliteIdentifier(table.sqliteTableName)}`).run();
    this.db
      .prepare("update conversation_temp_data_sources set status = 'deleted', updated_at = ? where id = ?")
      .run(nowIso(), tempDataSourceId);
  }

  cleanupExpired() {
    const expired = (this.db
      .prepare("select * from conversation_temp_data_sources where status = 'ready' and expires_at is not null and expires_at <= ?")
      .all(nowIso()) as Array<Record<string, unknown>>).map(rowFromDb);
    const warnings: string[] = [];
    for (const table of expired) {
      try {
        this.expireTempSource(table);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : `清理临时表失败：${table.tempDataSourceId}`);
      }
    }
    return { removedSources: expired.length, removedTables: expired.length - warnings.length, warnings };
  }

  cleanupConversation(conversationId: string, userId: string) {
    const tables = (this.db
      .prepare("select * from conversation_temp_data_sources where conversation_id = ? and user_id = ? and status <> 'deleted'")
      .all(conversationId, userId) as Array<Record<string, unknown>>).map(rowFromDb);
    for (const table of tables) {
      try {
        this.db.prepare(`drop table if exists ${quoteSqliteIdentifier(table.sqliteTableName)}`).run();
      } finally {
        this.db
          .prepare("update conversation_temp_data_sources set status = 'deleted', updated_at = ? where id = ?")
          .run(nowIso(), table.tempDataSourceId);
      }
    }
  }

  assertSqlCanAccessTempTables(input: { sql: string; conversationId: string; userId: string; selectedFieldRefs?: ChatCsvSelectedFieldRef[] }) {
    const references = Array.from(input.sql.matchAll(/["'`]?((?:chat_csv_)[a-z0-9_]+)["'`]?/gi)).map((match) => match[1]);
    for (const tableName of new Set(references)) {
      const row = this.db.prepare("select * from conversation_temp_data_sources where sqlite_table_name = ?").get(tableName) as Record<string, unknown> | undefined;
      if (!row) {
        fail("CSV_TEMP_SOURCE_PERMISSION_DENIED", "SQL 查询引用了未授权或不可用的会话临时 CSV 表。");
      }
      const table = rowFromDb(row);
      if (table.userId !== input.userId || table.conversationId !== input.conversationId || table.status !== "ready") {
        fail("CSV_TEMP_SOURCE_PERMISSION_DENIED", "SQL 查询引用了未授权或不可用的会话临时 CSV 表。");
      }
      if (table.expiresAt && Date.parse(table.expiresAt) <= Date.now()) {
        this.expireTempSource(table);
        fail("CSV_TEMP_SOURCE_EXPIRED", "会话临时 CSV 表已过期。");
      }
    }
  }

  buildSchemaContextMarkdown(input: {
    conversationId: string;
    userId: string;
    tempDataSourceIds?: string[];
    selectedFieldRefs?: ChatCsvSelectedFieldRef[];
    maxFieldsPerSource?: number;
    requiresFullSchema?: boolean;
    userRequestedFieldDiscovery?: boolean;
  }) {
    const sources = input.tempDataSourceIds?.length
      ? input.tempDataSourceIds
        .map((id) => this.getTempSource(id, input.userId, input.conversationId))
        .filter((table): table is ConversationTempCsvTable => Boolean(table && table.status === "ready"))
      : this.listByConversation(input.conversationId, input.userId);
    if (sources.length === 0) {
      return null;
    }
    const mode = resolveSchemaContextMode(input);
    if (mode === "selected_fields") {
      return this.buildSelectedFieldsSchemaContextMarkdown(sources, input.selectedFieldRefs);
    }
    const maxFieldsPerSource = Number.isFinite(input.maxFieldsPerSource)
      ? Math.max(0, Math.floor(input.maxFieldsPerSource as number))
      : undefined;
    const selectedSources = sources
      .map((source) => ({
        source,
        fields: typeof maxFieldsPerSource === "number" ? source.columns.slice(0, maxFieldsPerSource) : source.columns,
      }))
      .filter((item) => item.fields.length > 0);
    if (selectedSources.length === 0) {
      return null;
    }
    return [
      "## 本轮 CSV 全表字段清单",
      "",
      `Schema Context Mode：${mode === "full_schema" ? "full_schema" : "schema_summary"}`,
      "用户在自然语言中通过 # 选择的字段主要用于表达查询条件或关注维度；如模型上下文中存在“本轮字段引用映射”，必须优先使用该映射中的实际字段名。本节全表字段清单仅用于补充未选择字段、select * 明细查询或用户明确要求使用全字段时的字段范围确认。",
      "生成 SQLite SQL 时必须使用 SQLite 双引号安全引用表名和字段名；不得把 # 前缀写入 SQL、Python、图表或报告字段名。",
      typeof maxFieldsPerSource === "number"
        ? `字段注入策略：用户拒绝全量字段导入，本轮每个临时 CSV 仅注入前 ${maxFieldsPerSource} 个字段。`
        : "字段注入策略：已注入当前临时 CSV 的全表字段清单。",
      "",
      ...selectedSources.flatMap(({ source, fields }) => [
        `### ${source.fileName}`,
        "",
        `- 临时数据源 ID：${source.tempDataSourceId}`,
        `- SQLite 临时表：${source.sqliteTableName}`,
        `- SQLite 临时表（已转义）：${quoteSqliteIdentifier(source.sqliteTableName)}`,
        `- 行数：${source.rowCount}`,
        `- 表字段总数：${source.columns.length}`,
        `- 本轮注入字段数：${fields.length}`,
        "- 数据范围：当前会话",
        "- 生命周期：临时",
        `- 过期时间：${source.expiresAt ?? "--"}`,
        "- Python 分析时可使用当前临时 CSV 表字段清单中明确存在的字段及工具返回结果中明确存在的字段，不得自行猜测或改写字段名称。",
        "",
        "| 展示名称 | 实际字段名 | SQLite 字段（已转义） | 推断类型 | SQLite 类型 | 脱敏样例 |",
        "|---|---|---|---|---|---|",
        ...fields.map((column) =>
          `| ${escapeMarkdownTable(column.displayName)} | ${escapeMarkdownTable(column.sqliteColumnName)} | ${escapeMarkdownTable(quoteSqliteIdentifier(column.sqliteColumnName))} | ${column.inferredLogicalType} | ${column.sqliteType} | ${escapeMarkdownTable((column.sampleValues ?? []).join(", ")) || "--"} |`
        ),
        "",
      ]),
    ].join("\n");
  }

  private buildSelectedFieldsSchemaContextMarkdown(sources: ConversationTempCsvTable[], selectedFieldRefs: ChatCsvSelectedFieldRef[] | undefined) {
    const validRefs = (selectedFieldRefs ?? [])
      .filter((field) => field.status === "valid")
      .filter((field, index, all) => all.findIndex((item) => item.fieldId === field.fieldId && item.tempDataSourceId === field.tempDataSourceId) === index);
    if (validRefs.length === 0) {
      return [
        "## 本轮已选字段",
        "",
        "Schema Context Mode：selected_fields",
        "当前消息包含字段引用，但没有可用的 valid 字段。请重新通过 # 选择字段后再执行查询、分析、绘图或报告生成。",
      ].join("\n");
    }

    const sourceById = new Map(sources.map((source) => [source.tempDataSourceId, source]));
    const rows = validRefs.flatMap((field) => {
      const source = sourceById.get(field.tempDataSourceId);
      if (!source) {
        return [];
      }
      const column = source.columns.find((item) => item.sqliteColumnName === field.physicalName || item.sourceHeader === field.sourceHeader);
      if (!column) {
        return [];
      }
      return [{
        source,
        field,
        displayName: field.displayName || column.displayName,
        physicalName: column.sqliteColumnName,
        logicalType: field.logicalType || column.inferredLogicalType,
        sqliteType: field.sqliteType || column.sqliteType,
      }];
    });

    if (rows.length === 0) {
      return [
        "## 本轮已选字段",
        "",
        "Schema Context Mode：selected_fields",
        "当前已选字段与会话临时表不匹配，字段可能已过期或数据源已被移除。请重新上传 CSV 或重新通过 # 选择字段。",
      ].join("\n");
    }

    const sourceLines = Array.from(new Map(rows.map((row) => [row.source.tempDataSourceId, row.source])).values()).flatMap((source) => [
      `### ${source.fileName}`,
      "",
      `- 临时数据源 ID：${source.tempDataSourceId}`,
      `- 临时表 ID：${source.tempTableId}`,
      `- SQLite 临时表：${source.sqliteTableName}`,
      `- SQLite 临时表（已转义）：${quoteSqliteIdentifier(source.sqliteTableName)}`,
      `- 行数：${source.rowCount}`,
      `- 表字段总数：${source.columns.length}`,
      `- 本轮注入字段数：${rows.filter((row) => row.source.tempDataSourceId === source.tempDataSourceId).length}`,
      "",
    ]);

    return [
      "## 本轮已选字段",
      "",
      "Schema Context Mode：selected_fields",
      "以下字段来自 ChatComposer 的 # 字段选择，已由客户端确认存在。模型无需搜索全表字段、比较字段别名或重新推断物理字段。",
      "生成 SQL 时使用表名和 SQL字段引用；生成 Python 时使用实际字段名；生成图表和报告时使用展示名称。",
      "",
      ...sourceLines,
      "| 字段 ID | 用户文本 | 展示名称 | 实际字段名 | SQL字段引用 | 逻辑类型 | SQLite 类型 |",
      "|---|---|---|---|---|---|---|",
      ...rows.map(({ field, displayName, physicalName, logicalType, sqliteType }) =>
        `| ${escapeMarkdownTable(field.fieldId)} | ${escapeMarkdownTable(field.rawText)} | ${escapeMarkdownTable(displayName)} | ${escapeMarkdownTable(physicalName)} | ${escapeMarkdownTable(quoteSqliteIdentifier(physicalName))} | ${escapeMarkdownTable(logicalType)} | ${escapeMarkdownTable(sqliteType)} |`
      ),
    ].join("\n");
  }

  private expireTempSource(table: ConversationTempCsvTable) {
    this.db.prepare(`drop table if exists ${quoteSqliteIdentifier(table.sqliteTableName)}`).run();
    this.db
      .prepare("update conversation_temp_data_sources set status = 'expired', updated_at = ? where id = ?")
      .run(nowIso(), table.tempDataSourceId);
  }
}

function escapeMarkdownTable(value: unknown) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

export function chatCsvError(error: unknown): ChatCsvImportError {
  if (error instanceof Error && "code" in error && typeof (error as Error & { code?: unknown }).code === "string") {
    return { code: (error as Error & { code: ChatCsvImportErrorCode }).code, message: error.message };
  }
  return { code: "UNKNOWN_ERROR", message: error instanceof Error ? error.message : "CSV 导入失败。" };
}
