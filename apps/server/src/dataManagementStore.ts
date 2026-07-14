import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  CsvSqliteTempProfiler,
  SqlProfiler,
  createSchemaContextBuilder,
  type BuildSchemaContextInput,
  type DataSourceRef,
} from "./schemaContext/index.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => any };

export type DataSourceType = "mysql" | "csv";
export type DataSourceStatus = "online" | "offline" | "disabled" | "degraded";
export type DataSourceEnvironment = "production" | "staging" | "development" | "imported";
export type CredentialStatus = "configured" | "missing" | "expired";

export type PoolConfig = {
  min: number;
  max: number;
  acquireTimeoutMs: number;
  idleTimeoutMs: number;
  queryTimeoutMs: number;
};

export type DataSourceSummary = {
  id: string;
  name: string;
  type: DataSourceType;
  environment: DataSourceEnvironment;
  host: string;
  port: number;
  database: string;
  username: string;
  status: DataSourceStatus;
  credentialStatus: CredentialStatus;
  readonly: boolean;
  schemaCount: number;
  tableCount: number;
  lastSyncedAt?: string;
  poolConfig: PoolConfig;
  safety: {
    circuitBreaker: "closed" | "open" | "half-open";
    degradedReason?: string;
    sampleLimit: number;
    fieldLimit: number;
  };
};

export type DatabaseSchema = {
  id: string;
  dataSourceId: string;
  name: string;
  tableCount: number;
  viewCount: number;
  lastSyncedAt?: string;
};

export type DatabaseColumn = {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  indexed: boolean;
  sensitive: boolean;
  largeField: boolean;
  comment: string;
};

export type DatabaseIndex = {
  id: string;
  name: string;
  columns: string[];
  unique: boolean;
  type: string;
};

export type DatabaseForeignKey = {
  id: string;
  name: string;
  columns: string[];
  referencesTable: string;
  referencesColumns: string[];
};

export type DatabaseTable = {
  id: string;
  dataSourceId: string;
  schema: string;
  name: string;
  type: "table" | "view" | "imported";
  comment: string;
  estimatedRows: number;
  estimatedSizeMb: number;
  updatedAt: string;
  isLarge: boolean;
  isSensitive: boolean;
  primaryKey?: string;
  columns: DatabaseColumn[];
  indexes: DatabaseIndex[];
  foreignKeys: DatabaseForeignKey[];
  sampleRows: Record<string, string | number | boolean | null>[];
};

type CsvCellValue = string | number | null;

export type ConnectionInput = {
  name?: string;
  type?: DataSourceType;
  environment?: DataSourceEnvironment;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  readonly?: boolean;
  poolConfig?: Partial<PoolConfig>;
};

export type QueryAuditLog = {
  id: string;
  traceId: string;
  userId: string;
  dataSourceId: string;
  tableId?: string;
  action: "sample" | "large-plan" | "large-confirm" | "cancel";
  result: "success" | "blocked";
  reason?: string;
  createdAt: string;
};

type StoredDataSource = DataSourceSummary & { credentialHash?: string; createdBy: string; createdAt: string };
type CsvFileProfile = {
  fileName: string;
  fileSizeBytes: number;
  encoding: string;
  delimiter: string;
  rowCount: number;
  columnCount: number;
};
type DataManagementSnapshot = {
  version: 1;
  dataSources: StoredDataSource[];
  schemas: Array<[string, DatabaseSchema[]]>;
  tables: Array<[string, DatabaseTable[]]>;
  csvFileProfiles: Array<[string, CsvFileProfile]>;
};
type CsvSqliteColumn = DatabaseColumn & { sqliteColumnName: string; ordinalIndex: number };
type CsvDatasetTableMeta = {
  data_source_id: string;
  table_id: string;
  sqlite_table_name: string;
  display_name: string;
  aliases_json?: string;
};

const DEFAULT_POOL_CONFIG: PoolConfig = {
  min: 0,
  max: 3,
  acquireTimeoutMs: 2_000,
  idleTimeoutMs: 60_000,
  queryTimeoutMs: 5_000,
};

const LARGE_TABLE_ROW_THRESHOLD = 1_000_000;
const LARGE_TABLE_SIZE_MB_THRESHOLD = 1_024;
const LARGE_TABLE_COLUMN_THRESHOLD = 100;
const DATA_MANAGEMENT_STORE_FILE = "data-management-store.json";
const CSV_SQLITE_STORE_FILE = "csv-data.sqlite";
const CSV_PREVIEW_ROW_LIMIT = 20;

function defaultPersistencePath() {
  if (process.env.VITEST) {
    return null;
  }

  return join(process.env.LIFECYCLE_X_DATA_DIR ?? join(homedir(), ".cycle-probe"), DATA_MANAGEMENT_STORE_FILE);
}

function defaultCsvSqlitePath(persistencePath: string | null) {
  if (process.env.LIFECYCLE_X_CSV_SQLITE_PATH) {
    return process.env.LIFECYCLE_X_CSV_SQLITE_PATH;
  }
  return persistencePath ? join(dirname(persistencePath), CSV_SQLITE_STORE_FILE) : null;
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isLargeTableByRule(estimatedRows: number, actualSizeMb: number, fieldCount: number) {
  return (
    estimatedRows >= LARGE_TABLE_ROW_THRESHOLD ||
    actualSizeMb >= LARGE_TABLE_SIZE_MB_THRESHOLD ||
    fieldCount >= LARGE_TABLE_COLUMN_THRESHOLD
  );
}

function applyLargeTableRule(table: DatabaseTable): DatabaseTable {
  return {
    ...table,
    isLarge: isLargeTableByRule(table.estimatedRows, table.estimatedSizeMb, table.columns.length),
  };
}

function isSensitiveName(name: string) {
  return /(name|phone|mobile|id_card|cert|email|address|customer)/i.test(name);
}

function maskValue(value: unknown) {
  if (value == null) {
    return null;
  }
  const text = String(value);
  if (text.length <= 4) {
    return "****";
  }
  return `${text.slice(0, 2)}****${text.slice(-2)}`;
}

function parseCsv(content: string) {
  const normalizedContent = content.replace(/^\uFEFF/, "");
  const records = parseCsvRecords(normalizedContent);
  if (records.length === 0) {
    return { headers: [] as string[], rows: [] as Record<string, string>[], delimiter: ",", encoding: content.startsWith("\uFEFF") ? "utf-8-bom" : "utf-8" };
  }

  const delimiter = detectDelimiter(records[0] ?? "");
  const parsedRecords = records.map((line) => parseCsvRecord(line, delimiter));
  const headers = uniqueCsvHeaders((parsedRecords[0] ?? []).map((item) => item.trim() || "column"));
  const rows = parsedRecords.slice(1).map((values) => {
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
  });
  return { headers, rows, delimiter, encoding: content.startsWith("\uFEFF") ? "utf-8-bom" : "utf-8" };
}

function parseCsvRecords(content: string) {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += char;
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

function uniqueCsvHeaders(headers: string[]) {
  const used = new Map<string, number>();
  return headers.map((header, index) => {
    const baseName = header || `column_${index + 1}`;
    const count = used.get(baseName) ?? 0;
    used.set(baseName, count + 1);
    return count === 0 ? baseName : `${baseName}_${count + 1}`;
  });
}

function detectDelimiter(headerLine: string) {
  const candidates = [",", "\t", ";"];
  return candidates
    .map((delimiter) => ({ delimiter, count: headerLine.split(delimiter).length }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ",";
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function parseAliasJson(value: string | undefined) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function sqliteSafeName(value: string, fallback: string) {
  const normalized = value.trim().replace(/[^\da-z_]/gi, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const withPrefix = /^[a-z_]/i.test(normalized) ? normalized : `col_${normalized}`;
  return (withPrefix || fallback).slice(0, 80);
}

function uniqueSqliteColumnNames(headers: string[]) {
  const used = new Map<string, number>();
  return headers.map((header, index) => {
    const baseName = sqliteSafeName(header, `column_${index + 1}`);
    const count = used.get(baseName) ?? 0;
    used.set(baseName, count + 1);
    return count === 0 ? baseName : `${baseName}_${count + 1}`;
  });
}

function isIntegerType(type: string) {
  return /int|bigint|smallint|tinyint/i.test(type);
}

function isNumberType(type: string) {
  return isIntegerType(type) || /decimal|numeric|float|double|real|number/i.test(type);
}

function sqliteTypeForColumn(column: DatabaseColumn) {
  if (isIntegerType(column.type)) {
    return "INTEGER";
  }
  if (isNumberType(column.type)) {
    return "REAL";
  }
  return "TEXT";
}

function parseCsvNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const normalized = text.replaceAll(",", "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function csvValueForColumn(column: DatabaseColumn, value: unknown): CsvCellValue {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  return isNumberType(column.type) ? parseCsvNumber(text) : text;
}

function isCsvIntegerLiteral(value: string) {
  return /^[-+]?(?:0|[1-9]\d*)$/.test(value);
}

function isCsvDecimalLiteral(value: string) {
  return /^[-+]?(?:(?:0|[1-9]\d*)\.\d+|\.\d+)$/.test(value);
}

function isCsvThousandsNumberLiteral(value: string) {
  return /^[-+]?(?:\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value);
}

function inferCsvColumnType(values: unknown[]) {
  const nonEmpty = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (nonEmpty.length === 0) {
    return "text";
  }
  if (nonEmpty.every((value) => isCsvIntegerLiteral(value))) {
    return "bigint";
  }
  if (nonEmpty.every((value) => isCsvIntegerLiteral(value) || isCsvDecimalLiteral(value) || isCsvThousandsNumberLiteral(value))) {
    return "decimal(18,4)";
  }
  if (nonEmpty.every((value) => /^\d{4}-\d{1,2}-\d{1,2}$/.test(value))) {
    return "date";
  }
  return "text";
}

function inferCsvColumns(headers: string[], rows: Record<string, string>[], tableId: string): DatabaseColumn[] {
  return headers.map((header) => ({
    id: `${tableId}:col:${header}`,
    name: header,
    type: inferCsvColumnType(rows.map((row) => row[header])),
    nullable: rows.some((row) => !String(row[header] ?? "").trim()),
    primaryKey: false,
    indexed: false,
    sensitive: isSensitiveName(header),
    largeField: false,
    comment: "CSV 推断字段",
  }));
}

class CsvSqliteStore {
  private db: any | null = null;

  constructor(private readonly dbPath: string | null) {
    if (!dbPath) {
      return;
    }

    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.ensureSchema();
  }

  get isAvailable() {
    return Boolean(this.db);
  }

  hasDataset(dataSourceId: string) {
    if (!this.db) {
      return false;
    }
    const row = this.db.prepare("SELECT 1 FROM csv_dataset_tables WHERE data_source_id = ? LIMIT 1").get(dataSourceId);
    return Boolean(row);
  }

  importDataset(input: {
    dataSourceId: string;
    tableId: string;
    tableName: string;
    columns: DatabaseColumn[];
    rows: Record<string, CsvCellValue>[];
    importedAt: string;
  }) {
    if (!this.db) {
      return;
    }

    const sqliteTableName = `csv_${input.dataSourceId.replace(/[^\da-z_]/gi, "_")}`;
    const sqliteColumnNames = uniqueSqliteColumnNames(input.columns.map((column) => column.name));
    const sqliteColumns: CsvSqliteColumn[] = input.columns.map((column, index) => ({
      ...column,
      sqliteColumnName: sqliteColumnNames[index] ?? `column_${index + 1}`,
      ordinalIndex: index,
    }));
    const sqliteDataColumns = sqliteColumns.map((column) => quoteIdentifier(column.sqliteColumnName));
    const createSql = `CREATE TABLE ${quoteIdentifier(sqliteTableName)} ("__row_index" INTEGER PRIMARY KEY${
      sqliteColumns.length > 0
        ? `, ${sqliteColumns.map((column) => `${quoteIdentifier(column.sqliteColumnName)} ${sqliteTypeForColumn(column)}`).join(", ")}`
        : ""
    })`;

    this.transaction(() => {
      this.deleteDatasetWithoutTransaction(input.dataSourceId);
      this.db.prepare(createSql).run();
      this.db
        .prepare(
          "INSERT INTO csv_dataset_tables (data_source_id, table_id, sqlite_table_name, display_name, aliases_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(input.dataSourceId, input.tableId, sqliteTableName, input.tableName, "[]", input.importedAt, input.importedAt);

      const insertColumn = this.db.prepare(
        [
          "INSERT INTO csv_dataset_columns",
          "(data_source_id, table_id, ordinal_index, name, sqlite_column_name, type, nullable, primary_key, indexed, sensitive, large_field, comment)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      );
      for (const column of sqliteColumns) {
        insertColumn.run(
          input.dataSourceId,
          input.tableId,
          column.ordinalIndex,
          column.name,
          column.sqliteColumnName,
          column.type,
          column.nullable ? 1 : 0,
          column.primaryKey ? 1 : 0,
          column.indexed ? 1 : 0,
          column.sensitive ? 1 : 0,
          column.largeField ? 1 : 0,
          column.comment,
        );
      }

      if (input.rows.length === 0) {
        return;
      }
      const insertColumns = ['"__row_index"', ...sqliteDataColumns].join(", ");
      const placeholders = ["?", ...sqliteColumns.map(() => "?")].join(", ");
      const insertRow = this.db.prepare(
        `INSERT INTO ${quoteIdentifier(sqliteTableName)} (${insertColumns}) VALUES (${placeholders})`,
      );
      for (const [rowIndex, row] of input.rows.entries()) {
        insertRow.run(rowIndex + 1, ...input.columns.map((column) => csvValueForColumn(column, row[column.name])));
      }
    });
  }

  readRows(dataSourceId: string, columns: DatabaseColumn[], limit: number) {
    if (!this.db) {
      return null;
    }
    const table = this.datasetTable(dataSourceId);
    if (!table) {
      return null;
    }
    const sqliteColumns = this.sqliteColumns(dataSourceId);
    const selectColumns = columns
      .map((column) => {
        const sqliteColumn = sqliteColumns.find((candidate) => candidate.name === column.name);
        if (!sqliteColumn) {
          return null;
        }
        const quotedSqliteColumn = quoteIdentifier(sqliteColumn.sqlite_column_name);
        if (isIntegerType(column.type)) {
          return `CASE WHEN ${quotedSqliteColumn} IS NULL OR ${quotedSqliteColumn} = '' THEN NULL ELSE CAST(REPLACE(${quotedSqliteColumn}, ',', '') AS INTEGER) END AS ${quoteIdentifier(column.name)}`;
        }
        if (isNumberType(column.type)) {
          return `CASE WHEN ${quotedSqliteColumn} IS NULL OR ${quotedSqliteColumn} = '' THEN NULL ELSE CAST(REPLACE(${quotedSqliteColumn}, ',', '') AS REAL) END AS ${quoteIdentifier(column.name)}`;
        }
        return `${quotedSqliteColumn} AS ${quoteIdentifier(column.name)}`;
      })
      .filter(Boolean);
    if (selectColumns.length === 0) {
      return [];
    }
    return this.db
      .prepare(`SELECT ${selectColumns.join(", ")} FROM ${quoteIdentifier(table.sqlite_table_name)} ORDER BY "__row_index" LIMIT ?`)
      .all(limit) as Record<string, string | number | null>[];
  }

  inferStoredColumnTypes(dataSourceId: string, columns: DatabaseColumn[], sampleLimit = 500) {
    if (!this.db) {
      return new Map<string, string>();
    }
    const table = this.datasetTable(dataSourceId);
    if (!table) {
      return new Map<string, string>();
    }
    const sqliteColumns = this.sqliteColumns(dataSourceId);
    const inferred = new Map<string, string>();
    for (const column of columns) {
      const sqliteColumn = sqliteColumns.find((candidate) => candidate.name === column.name);
      if (!sqliteColumn) {
        continue;
      }
      const rows = this.db
        .prepare(`SELECT ${quoteIdentifier(sqliteColumn.sqlite_column_name)} AS value FROM ${quoteIdentifier(table.sqlite_table_name)} ORDER BY "__row_index" LIMIT ?`)
        .all(sampleLimit) as Array<{ value: unknown }>;
      inferred.set(column.name, inferCsvColumnType(rows.map((row) => row.value)));
    }
    return inferred;
  }

  updateColumnTypes(dataSourceId: string, columnTypes: Map<string, string>) {
    if (!this.db || columnTypes.size === 0) {
      return;
    }
    const updateColumnType = this.db.prepare("UPDATE csv_dataset_columns SET type = ? WHERE data_source_id = ? AND name = ?");
    this.transaction(() => {
      for (const [columnName, type] of columnTypes) {
        updateColumnType.run(type, dataSourceId, columnName);
      }
    });
  }

  deleteDataset(dataSourceId: string) {
    if (!this.db) {
      return;
    }
    this.transaction(() => this.deleteDatasetWithoutTransaction(dataSourceId));
  }

  private deleteDatasetWithoutTransaction(dataSourceId: string) {
    const table = this.datasetTable(dataSourceId);
    if (table) {
      this.db.prepare(`DROP TABLE IF EXISTS ${quoteIdentifier(table.sqlite_table_name)}`).run();
    }
    this.db.prepare("DELETE FROM csv_dataset_columns WHERE data_source_id = ?").run(dataSourceId);
    this.db.prepare("DELETE FROM csv_dataset_tables WHERE data_source_id = ?").run(dataSourceId);
  }

  renameDataset(dataSourceId: string, tableName: string, updatedAt: string) {
    if (!this.db) {
      return;
    }
    const current = this.db
      .prepare("SELECT data_source_id, table_id, sqlite_table_name, display_name, aliases_json FROM csv_dataset_tables WHERE data_source_id = ?")
      .get(dataSourceId) as CsvDatasetTableMeta | undefined;
    const aliases = new Set(parseAliasJson(current?.aliases_json));
    if (current?.display_name && current.display_name !== tableName) {
      aliases.add(current.display_name);
    }
    aliases.delete(tableName);
    this.db
      .prepare("UPDATE csv_dataset_tables SET display_name = ?, aliases_json = ?, updated_at = ? WHERE data_source_id = ?")
      .run(tableName, JSON.stringify(Array.from(aliases)), updatedAt, dataSourceId);
  }

  mergeDatasetAliases(dataSourceId: string, aliasesToAdd: string[], updatedAt: string) {
    if (!this.db || aliasesToAdd.length === 0) {
      return;
    }
    const current = this.db
      .prepare("SELECT data_source_id, table_id, sqlite_table_name, display_name, aliases_json FROM csv_dataset_tables WHERE data_source_id = ?")
      .get(dataSourceId) as CsvDatasetTableMeta | undefined;
    if (!current) {
      return;
    }
    const aliases = new Set(parseAliasJson(current.aliases_json));
    for (const alias of aliasesToAdd) {
      const nextAlias = alias.trim();
      if (nextAlias && nextAlias !== current.display_name && nextAlias !== current.table_id && nextAlias !== current.sqlite_table_name) {
        aliases.add(nextAlias);
      }
    }
    this.db
      .prepare("UPDATE csv_dataset_tables SET aliases_json = ?, updated_at = ? WHERE data_source_id = ?")
      .run(JSON.stringify(Array.from(aliases)), updatedAt, dataSourceId);
  }

  private ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS csv_dataset_tables (
        data_source_id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL,
        sqlite_table_name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS csv_dataset_columns (
        data_source_id TEXT NOT NULL,
        table_id TEXT NOT NULL,
        ordinal_index INTEGER NOT NULL,
        name TEXT NOT NULL,
        sqlite_column_name TEXT NOT NULL,
        type TEXT NOT NULL,
        nullable INTEGER NOT NULL,
        primary_key INTEGER NOT NULL,
        indexed INTEGER NOT NULL,
        sensitive INTEGER NOT NULL,
        large_field INTEGER NOT NULL,
        comment TEXT NOT NULL,
        PRIMARY KEY (data_source_id, ordinal_index),
        FOREIGN KEY (data_source_id) REFERENCES csv_dataset_tables(data_source_id) ON DELETE CASCADE
      );
    `);
    this.ensureColumn("csv_dataset_tables", "aliases_json", "TEXT NOT NULL DEFAULT '[]'");
  }

  private ensureColumn(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    this.db.prepare(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`).run();
  }

  private transaction(callback: () => void) {
    this.db.exec("BEGIN");
    try {
      callback();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private datasetTable(dataSourceId: string) {
    return this.db
      .prepare("SELECT data_source_id, table_id, sqlite_table_name FROM csv_dataset_tables WHERE data_source_id = ?")
      .get(dataSourceId) as { data_source_id: string; table_id: string; sqlite_table_name: string } | undefined;
  }

  private sqliteColumns(dataSourceId: string) {
    return this.db
      .prepare("SELECT name, sqlite_column_name FROM csv_dataset_columns WHERE data_source_id = ? ORDER BY ordinal_index")
      .all(dataSourceId) as Array<{ name: string; sqlite_column_name: string }>;
  }
}

export class DataManagementStore {
  private dataSources = new Map<string, StoredDataSource>();
  private schemas = new Map<string, DatabaseSchema[]>();
  private tables = new Map<string, DatabaseTable[]>();
  private csvFiles = new Map<string, { id: string; name: string; content: string; createdAt: string }>();
  private csvFileProfiles = new Map<string, CsvFileProfile>();
  private csvSqliteStore: CsvSqliteStore;
  readonly queryAuditLogs: QueryAuditLog[] = [];

  constructor(
    private readonly persistencePath: string | null = defaultPersistencePath(),
    csvSqlitePath: string | null = defaultCsvSqlitePath(persistencePath),
  ) {
    this.csvSqliteStore = new CsvSqliteStore(csvSqlitePath);
    this.loadPersistedState();
    this.migrateSnapshotCsvRowsToSqlite();
    this.syncCsvDatasetAliases();
    this.refreshCsvColumnTypes();
  }

  listDataSources() {
    return Array.from(this.dataSources.values()).map(({ credentialHash: _credentialHash, createdBy: _createdBy, createdAt: _createdAt, ...summary }) => summary);
  }

  getDataSource(dataSourceId: string) {
    const source = this.dataSources.get(dataSourceId);
    if (!source) {
      return null;
    }
    const { credentialHash: _credentialHash, createdBy: _createdBy, createdAt: _createdAt, ...summary } = source;
    return summary;
  }

  createDataSource(input: ConnectionInput, userId: string) {
    const source = this.buildSource(input, userId);
    this.dataSources.set(source.id, source);
    this.schemas.set(source.id, [
      {
        id: `${source.id}:schema:${source.database}`,
        dataSourceId: source.id,
        name: source.database,
        tableCount: 0,
        viewCount: 0,
        lastSyncedAt: source.lastSyncedAt,
      },
    ]);
    this.tables.set(source.id, []);
    return this.syncMetadata(source.id);
  }

  updateDataSource(dataSourceId: string, input: ConnectionInput) {
    const current = this.dataSources.get(dataSourceId);
    if (!current) {
      return null;
    }
    const next = {
      ...current,
      ...("name" in input && input.name ? { name: input.name } : {}),
      ...("environment" in input && input.environment ? { environment: input.environment } : {}),
      ...("host" in input && input.host ? { host: input.host } : {}),
      ...("port" in input && typeof input.port === "number" ? { port: input.port } : {}),
      ...("database" in input && input.database ? { database: input.database } : {}),
      ...("username" in input && input.username ? { username: input.username } : {}),
      ...("readonly" in input && typeof input.readonly === "boolean" ? { readonly: input.readonly } : {}),
      ...(input.password ? { credentialHash: hashSecret(input.password), credentialStatus: "configured" as const } : {}),
      poolConfig: { ...current.poolConfig, ...input.poolConfig },
    };
    this.dataSources.set(dataSourceId, next);
    this.persist();
    return this.getDataSource(dataSourceId);
  }

  testConnection(dataSourceId: string) {
    const source = this.dataSources.get(dataSourceId);
    if (!source) {
      return null;
    }
    return {
      success: true as const,
      status: source.status === "disabled" ? "blocked" : "passed",
      version: source.type === "mysql" ? "MySQL 8.0 compatible adapter (simulated)" : "CSV imported dataset",
      latencyMs: source.type === "mysql" ? 42 : 8,
      accessibleSchemas: this.schemas.get(dataSourceId)?.map((schema) => schema.name) ?? [],
      readonly: source.readonly,
      warnings: source.readonly ? [] : ["建议使用只读账号，避免分析工具影响业务库。"],
    };
  }

  testDraftConnection(input: ConnectionInput) {
    return {
      success: true as const,
      status: input.host && input.username && input.password ? "passed" : "blocked",
      version: "MySQL 8.0 compatible adapter (simulated)",
      latencyMs: 38,
      accessibleSchemas: [input.database || "post_loan"],
      readonly: input.readonly ?? true,
      warnings: input.readonly === false ? ["建议使用只读账号，避免分析工具影响业务库。"] : [],
    };
  }

  syncMetadata(dataSourceId: string) {
    const source = this.dataSources.get(dataSourceId);
    if (!source) {
      return null;
    }
    const syncedAt = nowIso();
    source.lastSyncedAt = syncedAt;

    const currentTables = this.tables.get(dataSourceId);
    if (currentTables && currentTables.length > 0) {
      this.schemas.set(
        dataSourceId,
        (this.schemas.get(dataSourceId) ?? []).map((schema) => ({
          ...schema,
          tableCount: currentTables.filter((table) => table.schema === schema.name && table.type !== "view").length,
          viewCount: currentTables.filter((table) => table.schema === schema.name && table.type === "view").length,
          lastSyncedAt: syncedAt,
        })),
      );
      this.persist();
      return this.getDataSource(dataSourceId);
    }

    const generated = this.buildDefaultTables(source);
    this.tables.set(dataSourceId, generated);
    this.schemas.set(dataSourceId, [
      {
        id: `${dataSourceId}:schema:${source.database}`,
        dataSourceId,
        name: source.database,
        tableCount: generated.filter((table) => table.type !== "view").length,
        viewCount: generated.filter((table) => table.type === "view").length,
        lastSyncedAt: syncedAt,
      },
    ]);
    source.tableCount = generated.length;
    source.schemaCount = 1;
    this.persist();
    return this.getDataSource(dataSourceId);
  }

  listSchemas(dataSourceId: string) {
    return this.schemas.get(dataSourceId) ?? [];
  }

  listTables(dataSourceId: string, schema?: string) {
    const tables = this.tables.get(dataSourceId) ?? [];
    return schema ? tables.filter((table) => table.schema === schema) : tables;
  }

  getCsvFileProfile(dataSourceId: string) {
    return this.csvFileProfiles.get(dataSourceId);
  }

  tableDetail(dataSourceId: string, tableId: string) {
    return this.listTables(dataSourceId).find((table) => table.id === tableId) ?? null;
  }

  sampleData(dataSourceId: string, tableId: string, userId: string, traceId: string, columns?: string[], limit = 20) {
    const source = this.dataSources.get(dataSourceId);
    const table = this.tableDetail(dataSourceId, tableId);
    if (!source || !table || source.status === "disabled") {
      this.appendQueryAudit({ traceId, userId, dataSourceId, tableId, action: "sample", result: "blocked", reason: "DATA_SOURCE_UNAVAILABLE" });
      return null;
    }

    const readableColumns = table.columns
      .filter((column) => !column.largeField)
      .filter((column) => !columns || columns.length === 0 || columns.includes(column.name));
    const safeColumns = table.type === "imported" ? readableColumns : readableColumns.slice(0, source.safety.fieldLimit);
    const rowLimit = table.type === "imported" && !table.isLarge ? table.estimatedRows : Math.min(limit, source.safety.sampleLimit);
    const sourceRows =
      table.type === "imported"
        ? (this.csvSqliteStore.readRows(dataSourceId, safeColumns, rowLimit) ?? table.sampleRows.slice(0, rowLimit))
        : table.sampleRows.slice(0, rowLimit);
    const rows = sourceRows.map((row) =>
      Object.fromEntries(
        safeColumns.map((column) => [column.name, column.sensitive ? maskValue(row[column.name]) : row[column.name] ?? null]),
      ),
    );
    this.appendQueryAudit({ traceId, userId, dataSourceId, tableId, action: "sample", result: "success" });
    return {
      success: true as const,
      columns: safeColumns,
      rows,
      policy: {
        maxRows: rowLimit,
        maxFields: table.type === "imported" ? safeColumns.length : source.safety.fieldLimit,
        maskedFields: safeColumns.filter((column) => column.sensitive).map((column) => column.name),
        skippedLargeFields: table.columns.filter((column) => column.largeField).map((column) => column.name),
      },
    };
  }

  largeTablePlan(dataSourceId: string, tableId: string, userId: string, traceId: string) {
    const table = this.tableDetail(dataSourceId, tableId);
    if (!table) {
      return null;
    }
    this.appendQueryAudit({ traceId, userId, dataSourceId, tableId, action: "large-plan", result: "success" });
    return {
      success: true as const,
      tableId,
      isLarge: table.isLarge,
      estimatedRows: table.estimatedRows,
      estimatedSizeMb: table.estimatedSizeMb,
      strategy: table.primaryKey ? "keyset-pagination" : "sample-only",
      requiresConfirmation: table.isLarge,
      safeguards: [
        "只读事务",
        "5 秒查询超时",
        "字段裁剪",
        "敏感字段脱敏",
        table.primaryKey ? "主键游标分页" : "无主键表仅允许抽样预览",
      ],
    };
  }

  confirmLargeTable(dataSourceId: string, tableId: string, userId: string, traceId: string) {
    this.appendQueryAudit({ traceId, userId, dataSourceId, tableId, action: "large-confirm", result: "success" });
    return this.sampleData(dataSourceId, tableId, userId, traceId, undefined, 20);
  }

  cancelQuery(queryId: string, userId: string, traceId: string) {
    this.appendQueryAudit({ traceId, userId, dataSourceId: "runtime", action: "cancel", result: "success", reason: queryId });
    return { success: true as const, queryId, status: "cancelled" };
  }

  uploadCsv(name: string, content: string) {
    const file = { id: id("csv_file"), name, content, createdAt: nowIso() };
    this.csvFiles.set(file.id, file);
    return { success: true as const, file: { id: file.id, name: file.name, size: content.length, createdAt: file.createdAt } };
  }

  previewCsv(fileId: string) {
    const file = this.csvFiles.get(fileId);
    if (!file) {
      return null;
    }
    const parsed = parseCsv(file.content);
    return {
      success: true as const,
      preview: {
        fileId,
        headers: parsed.headers,
        rows: parsed.rows.slice(0, 10),
        inferredColumns: parsed.headers.map((header) => ({
          name: header,
          type: inferCsvColumnType(parsed.rows.map((row) => row[header])),
          sensitive: isSensitiveName(header),
          csvInjectionRisk: parsed.rows.some((row) => /^[=+\-@]/.test(row[header] ?? "")),
        })),
      },
    };
  }

  importCsv(fileId: string, userId: string) {
    const file = this.csvFiles.get(fileId);
    if (!file) {
      return null;
    }
    const parsed = parseCsv(file.content);
    const dataSourceId = id("ds_csv");
    const tableId = id("tbl_csv");
    const importedAt = nowIso();
    const source = this.buildSource(
      {
        name: file.name.replace(/\.[^.]+$/, ""),
        type: "csv",
        environment: "imported",
        host: "local-import",
        port: 0,
        database: "csv_imports",
        username: "imported",
        readonly: true,
        password: "csv",
      },
      userId,
    );
    source.id = dataSourceId;
    source.status = "online";
    source.lastSyncedAt = importedAt;
    source.schemaCount = 1;
    source.tableCount = 1;
    const actualSizeMb = Math.max(1, Math.round(file.content.length / 1024 / 1024));
    const columns = inferCsvColumns(parsed.headers, parsed.rows, tableId);
    this.csvSqliteStore.importDataset({
      dataSourceId,
      tableId,
      tableName: source.name,
      columns,
      rows: parsed.rows,
      importedAt,
    });
    this.dataSources.set(dataSourceId, source);
    this.csvFileProfiles.set(dataSourceId, {
      fileName: file.name,
      fileSizeBytes: file.content.length,
      encoding: parsed.encoding,
      delimiter: parsed.delimiter,
      rowCount: parsed.rows.length,
      columnCount: parsed.headers.length,
    });
    this.schemas.set(dataSourceId, [{ id: `${dataSourceId}:schema:csv_imports`, dataSourceId, name: "csv_imports", tableCount: 1, viewCount: 0, lastSyncedAt: source.lastSyncedAt }]);
    const normalizedRows = parsed.rows.map((row) =>
      Object.fromEntries(columns.map((column) => [column.name, csvValueForColumn(column, row[column.name])])) as Record<string, string | number | boolean | null>,
    );
    const previewRows = this.csvSqliteStore.isAvailable ? normalizedRows.slice(0, CSV_PREVIEW_ROW_LIMIT) : normalizedRows;
    this.tables.set(dataSourceId, [
      applyLargeTableRule({
        id: tableId,
        dataSourceId,
        schema: "csv_imports",
        name: source.name,
        type: "imported",
        comment: "CSV 导入补充数据源",
        estimatedRows: parsed.rows.length,
        estimatedSizeMb: actualSizeMb,
        updatedAt: importedAt,
        isLarge: false,
        isSensitive: parsed.headers.some(isSensitiveName),
        columns,
        indexes: [],
        foreignKeys: [],
        sampleRows: previewRows,
      }),
    ]);
    this.csvFiles.delete(fileId);
    this.persist();
    return { success: true as const, job: { id: id("import_job"), status: "completed", importedTableId: tableId, dataSourceId, importedRows: parsed.rows.length } };
  }

  deleteCsvDataSource(dataSourceId: string) {
    const source = this.dataSources.get(dataSourceId);
    if (!source || source.type !== "csv") {
      return null;
    }
    this.dataSources.delete(dataSourceId);
    this.schemas.delete(dataSourceId);
    this.tables.delete(dataSourceId);
    this.csvFileProfiles.delete(dataSourceId);
    this.csvSqliteStore.deleteDataset(dataSourceId);
    this.persist();
    return { success: true as const, dataSourceId };
  }

  renameCsvDataSource(dataSourceId: string, name: string) {
    const source = this.dataSources.get(dataSourceId);
    const nextName = name.trim();
    if (!source || source.type !== "csv" || !nextName || nextName.length > 100) {
      return null;
    }
    const updatedAt = nowIso();
    source.name = nextName;
    source.lastSyncedAt = updatedAt;
    const sourceTables = this.tables.get(dataSourceId) ?? [];
    const importedTable = sourceTables.find((table) => table.type === "imported") ?? sourceTables[0];
    if (importedTable) {
      importedTable.name = nextName;
      importedTable.updatedAt = updatedAt;
    }
    this.csvSqliteStore.renameDataset(dataSourceId, nextName, updatedAt);
    this.persist();
    return {
      success: true as const,
      dataSource: this.getDataSource(dataSourceId),
      table: importedTable ? this.tableDetail(dataSourceId, importedTable.id) : null,
    };
  }

  async schemaContext(input: Partial<BuildSchemaContextInput> = {}) {
    const dataSourceRefs = input.dataSourceRefs ?? this.listDataSources().map(toSchemaDataSourceRef);
    const builder = createSchemaContextBuilder({
      profilers: [new SqlProfiler(this), new CsvSqliteTempProfiler(this)],
    });
    const context = await builder.buildContext({
      ...input,
      dataSourceRefs,
    });
    return {
      success: true as const,
      context,
    };
  }

  private appendQueryAudit(log: Omit<QueryAuditLog, "id" | "createdAt">) {
    this.queryAuditLogs.push({ ...log, id: id("query_audit"), createdAt: nowIso() });
  }

  private persist() {
    if (!this.persistencePath) {
      return;
    }

    try {
      mkdirSync(dirname(this.persistencePath), { recursive: true });
      const snapshot: DataManagementSnapshot = {
        version: 1,
        dataSources: Array.from(this.dataSources.values()),
        schemas: Array.from(this.schemas.entries()),
        tables: Array.from(this.tables.entries()),
        csvFileProfiles: Array.from(this.csvFileProfiles.entries()),
      };
      writeFileSync(this.persistencePath, JSON.stringify(snapshot), "utf8");
    } catch {
      // Data management can continue with in-memory state; the next mutation will retry persistence.
    }
  }

  private loadPersistedState() {
    if (!this.persistencePath || !existsSync(this.persistencePath)) {
      return;
    }

    try {
      const snapshot = JSON.parse(readFileSync(this.persistencePath, "utf8")) as Partial<DataManagementSnapshot>;
      if (snapshot.version !== 1) {
        return;
      }

      this.dataSources = new Map((snapshot.dataSources ?? []).map((source) => [source.id, source]));
      this.schemas = new Map(snapshot.schemas ?? []);
      this.tables = new Map(snapshot.tables ?? []);
      this.csvFileProfiles = new Map(snapshot.csvFileProfiles ?? []);
    } catch {
      this.dataSources.clear();
      this.schemas.clear();
      this.tables.clear();
      this.csvFileProfiles.clear();
    }
  }

  private migrateSnapshotCsvRowsToSqlite() {
    let didMigrate = false;
    for (const source of this.dataSources.values()) {
      if (source.type !== "csv" || this.csvSqliteStore.hasDataset(source.id)) {
        continue;
      }
      const importedTable = (this.tables.get(source.id) ?? []).find((table) => table.type === "imported");
      if (!importedTable || importedTable.sampleRows.length === 0) {
        continue;
      }
      const importedAt = importedTable.updatedAt || source.lastSyncedAt || nowIso();
      this.csvSqliteStore.importDataset({
        dataSourceId: source.id,
        tableId: importedTable.id,
        tableName: importedTable.name,
        columns: importedTable.columns,
        rows: importedTable.sampleRows.map((row) =>
          Object.fromEntries(importedTable.columns.map((column) => [column.name, row[column.name] == null ? "" : String(row[column.name])])),
        ),
        importedAt,
      });
      importedTable.sampleRows = importedTable.sampleRows.slice(0, CSV_PREVIEW_ROW_LIMIT);
      didMigrate = true;
    }

    if (didMigrate) {
      this.persist();
    }
  }

  private syncCsvDatasetAliases() {
    const updatedAt = nowIso();
    for (const source of this.dataSources.values()) {
      if (source.type !== "csv" || !this.csvSqliteStore.hasDataset(source.id)) {
        continue;
      }
      const importedTable = (this.tables.get(source.id) ?? []).find((table) => table.type === "imported");
      const profile = this.csvFileProfiles.get(source.id);
      const originalFileBaseName = profile?.fileName.replace(/\.[^.]+$/, "");
      this.csvSqliteStore.mergeDatasetAliases(
        source.id,
        [originalFileBaseName, importedTable?.name, source.name].filter((alias): alias is string => Boolean(alias?.trim())),
        updatedAt,
      );
    }
  }

  private refreshCsvColumnTypes() {
    let didUpdate = false;
    for (const source of this.dataSources.values()) {
      if (source.type !== "csv") {
        continue;
      }
      const sourceTables = this.tables.get(source.id) ?? [];
      const importedTable = sourceTables.find((table) => table.type === "imported") ?? sourceTables[0];
      if (!importedTable) {
        continue;
      }
      const inferredTypes = this.csvSqliteStore.hasDataset(source.id)
        ? this.csvSqliteStore.inferStoredColumnTypes(source.id, importedTable.columns)
        : new Map(importedTable.columns.map((column) => [column.name, inferCsvColumnType(importedTable.sampleRows.map((row) => row[column.name]))]));
      const changedTypes = new Map<string, string>();
      const nextColumns = importedTable.columns.map((column) => {
        const inferredType = inferredTypes.get(column.name);
        if (!inferredType || inferredType === column.type) {
          return column;
        }
        didUpdate = true;
        changedTypes.set(column.name, inferredType);
        return { ...column, type: inferredType };
      });
      importedTable.columns = nextColumns;
      const nextSampleRows = importedTable.sampleRows.map((row) =>
        Object.fromEntries(nextColumns.map((column) => [column.name, csvValueForColumn(column, row[column.name])])) as Record<string, string | number | boolean | null>,
      );
      if (JSON.stringify(nextSampleRows) !== JSON.stringify(importedTable.sampleRows)) {
        didUpdate = true;
      }
      importedTable.sampleRows = nextSampleRows;
      if (changedTypes.size > 0) {
        this.csvSqliteStore.updateColumnTypes(source.id, changedTypes);
      }
    }

    if (didUpdate) {
      this.persist();
    }
  }

  private buildSource(input: ConnectionInput, userId: string): StoredDataSource {
    const sourceId = id(input.type === "csv" ? "ds_csv" : "ds_mysql");
    return {
      id: sourceId,
      name: input.name?.trim() || "新增 MySQL 数据源",
      type: input.type ?? "mysql",
      environment: input.environment ?? "staging",
      host: input.host?.trim() || "127.0.0.1",
      port: input.port ?? 3306,
      database: input.database?.trim() || "lifecycle_probe",
      username: input.username?.trim() || "readonly_user",
      status: "online",
      credentialStatus: input.password ? "configured" : "missing",
      credentialHash: input.password ? hashSecret(input.password) : undefined,
      readonly: input.readonly ?? true,
      schemaCount: 0,
      tableCount: 0,
      lastSyncedAt: undefined,
      poolConfig: { ...DEFAULT_POOL_CONFIG, ...input.poolConfig },
      safety: {
        circuitBreaker: "closed",
        sampleLimit: 20,
        fieldLimit: 20,
      },
      createdBy: userId,
      createdAt: nowIso(),
    };
  }

  private buildDefaultTables(source: DataSourceSummary): DatabaseTable[] {
    const schema = source.database || "post_loan";
    const customerTableId = `${source.id}:table:${schema}:loan_customers`;
    const repaymentTableId = `${source.id}:table:${schema}:repayment_plans`;
    const riskTableId = `${source.id}:table:${schema}:risk_events`;
    const tables: DatabaseTable[] = [
      {
        id: customerTableId,
        dataSourceId: source.id,
        schema,
        name: "loan_customers",
        type: "table",
        comment: "贷后客户主数据，包含客户识别和授信摘要。",
        estimatedRows: 2_350_000,
        estimatedSizeMb: 1_280,
        updatedAt: nowIso(),
        isLarge: true,
        isSensitive: true,
        primaryKey: "customer_id",
        columns: [
          { id: `${customerTableId}:customer_id`, name: "customer_id", type: "varchar(32)", nullable: false, primaryKey: true, indexed: true, sensitive: false, largeField: false, comment: "客户唯一编号" },
          { id: `${customerTableId}:customer_name`, name: "customer_name", type: "varchar(128)", nullable: false, primaryKey: false, indexed: true, sensitive: true, largeField: false, comment: "客户名称" },
          { id: `${customerTableId}:id_card_no`, name: "id_card_no", type: "varchar(32)", nullable: true, primaryKey: false, indexed: false, sensitive: true, largeField: false, comment: "证件号" },
          { id: `${customerTableId}:credit_limit`, name: "credit_limit", type: "decimal(18,2)", nullable: false, primaryKey: false, indexed: false, sensitive: false, largeField: false, comment: "授信额度" },
          { id: `${customerTableId}:risk_level`, name: "risk_level", type: "varchar(16)", nullable: false, primaryKey: false, indexed: true, sensitive: false, largeField: false, comment: "风险等级" },
          { id: `${customerTableId}:profile_json`, name: "profile_json", type: "json", nullable: true, primaryKey: false, indexed: false, sensitive: true, largeField: true, comment: "客户画像大字段，样例读取默认跳过" },
        ],
        indexes: [
          { id: `${customerTableId}:pk`, name: "PRIMARY", columns: ["customer_id"], unique: true, type: "BTREE" },
          { id: `${customerTableId}:idx_risk_level`, name: "idx_risk_level", columns: ["risk_level"], unique: false, type: "BTREE" },
        ],
        foreignKeys: [],
        sampleRows: [
          { customer_id: "C20260001", customer_name: "北京启明制造有限公司", id_card_no: "91110108MA000001", credit_limit: 50_000_000, risk_level: "关注", profile_json: "{}" },
          { customer_id: "C20260002", customer_name: "上海景程贸易有限公司", id_card_no: "91310115MA000002", credit_limit: 18_000_000, risk_level: "正常", profile_json: "{}" },
          { customer_id: "C20260003", customer_name: "深圳海岳科技有限公司", id_card_no: "91440300MA000003", credit_limit: 32_000_000, risk_level: "预警", profile_json: "{}" },
        ],
      },
      {
        id: repaymentTableId,
        dataSourceId: source.id,
        schema,
        name: "repayment_plans",
        type: "table",
        comment: "还款计划与实还状态。",
        estimatedRows: 8_800_000,
        estimatedSizeMb: 3_760,
        updatedAt: nowIso(),
        isLarge: true,
        isSensitive: false,
        primaryKey: "plan_id",
        columns: [
          { id: `${repaymentTableId}:plan_id`, name: "plan_id", type: "varchar(32)", nullable: false, primaryKey: true, indexed: true, sensitive: false, largeField: false, comment: "计划编号" },
          { id: `${repaymentTableId}:customer_id`, name: "customer_id", type: "varchar(32)", nullable: false, primaryKey: false, indexed: true, sensitive: false, largeField: false, comment: "客户编号" },
          { id: `${repaymentTableId}:due_date`, name: "due_date", type: "date", nullable: false, primaryKey: false, indexed: true, sensitive: false, largeField: false, comment: "应还日期" },
          { id: `${repaymentTableId}:due_amount`, name: "due_amount", type: "decimal(18,2)", nullable: false, primaryKey: false, indexed: false, sensitive: false, largeField: false, comment: "应还金额" },
          { id: `${repaymentTableId}:paid_amount`, name: "paid_amount", type: "decimal(18,2)", nullable: false, primaryKey: false, indexed: false, sensitive: false, largeField: false, comment: "实还金额" },
          { id: `${repaymentTableId}:status`, name: "status", type: "varchar(16)", nullable: false, primaryKey: false, indexed: true, sensitive: false, largeField: false, comment: "还款状态" },
        ],
        indexes: [
          { id: `${repaymentTableId}:pk`, name: "PRIMARY", columns: ["plan_id"], unique: true, type: "BTREE" },
          { id: `${repaymentTableId}:idx_customer_due`, name: "idx_customer_due", columns: ["customer_id", "due_date"], unique: false, type: "BTREE" },
        ],
        foreignKeys: [
          { id: `${repaymentTableId}:fk_customer`, name: "fk_repayment_customer", columns: ["customer_id"], referencesTable: "loan_customers", referencesColumns: ["customer_id"] },
        ],
        sampleRows: [
          { plan_id: "P202607001", customer_id: "C20260001", due_date: "2026-07-21", due_amount: 420_000, paid_amount: 0, status: "待还" },
          { plan_id: "P202607002", customer_id: "C20260002", due_date: "2026-07-24", due_amount: 180_000, paid_amount: 180_000, status: "已还" },
          { plan_id: "P202607003", customer_id: "C20260003", due_date: "2026-07-28", due_amount: 260_000, paid_amount: 80_000, status: "部分还款" },
        ],
      },
      {
        id: riskTableId,
        dataSourceId: source.id,
        schema,
        name: "risk_events",
        type: "table",
        comment: "贷后风险事件流水。",
        estimatedRows: 480_000,
        estimatedSizeMb: 620,
        updatedAt: nowIso(),
        isLarge: false,
        isSensitive: false,
        primaryKey: "event_id",
        columns: [
          { id: `${riskTableId}:event_id`, name: "event_id", type: "varchar(32)", nullable: false, primaryKey: true, indexed: true, sensitive: false, largeField: false, comment: "事件编号" },
          { id: `${riskTableId}:customer_id`, name: "customer_id", type: "varchar(32)", nullable: false, primaryKey: false, indexed: true, sensitive: false, largeField: false, comment: "客户编号" },
          { id: `${riskTableId}:event_type`, name: "event_type", type: "varchar(32)", nullable: false, primaryKey: false, indexed: true, sensitive: false, largeField: false, comment: "事件类型" },
          { id: `${riskTableId}:severity`, name: "severity", type: "varchar(16)", nullable: false, primaryKey: false, indexed: true, sensitive: false, largeField: false, comment: "严重程度" },
          { id: `${riskTableId}:occurred_at`, name: "occurred_at", type: "datetime", nullable: false, primaryKey: false, indexed: true, sensitive: false, largeField: false, comment: "发生时间" },
        ],
        indexes: [
          { id: `${riskTableId}:pk`, name: "PRIMARY", columns: ["event_id"], unique: true, type: "BTREE" },
          { id: `${riskTableId}:idx_customer_time`, name: "idx_customer_time", columns: ["customer_id", "occurred_at"], unique: false, type: "BTREE" },
        ],
        foreignKeys: [
          { id: `${riskTableId}:fk_customer`, name: "fk_risk_customer", columns: ["customer_id"], referencesTable: "loan_customers", referencesColumns: ["customer_id"] },
        ],
        sampleRows: [
          { event_id: "R202607001", customer_id: "C20260001", event_type: "逾期预警", severity: "高", occurred_at: "2026-07-01 09:24:00" },
          { event_id: "R202607002", customer_id: "C20260003", event_type: "工商变更", severity: "中", occurred_at: "2026-07-02 14:08:00" },
        ],
      },
    ];
    return tables.map(applyLargeTableRule);
  }

}

function toSchemaDataSourceRef(source: DataSourceSummary): DataSourceRef {
  return {
    dataSourceId: source.id,
    type: source.type === "csv" ? "csv_sqlite_temp" : "sql_database",
    name: source.name,
    description: source.type === "csv" ? "CSV 导入 SQLite 临时表" : `${source.type.toUpperCase()} 数据库 ${source.database}`,
    updatedAt: source.lastSyncedAt,
    metadata: {
      environment: source.environment,
      status: source.status,
    },
  };
}
