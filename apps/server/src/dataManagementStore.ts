import { createHash, randomUUID } from "node:crypto";

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
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { headers: [] as string[], rows: [] as Record<string, string>[] };
  }

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delimiter).map((item) => item.trim() || "column");
  const rows = lines.slice(1, 51).map((line) => {
    const values = line.split(delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
  });
  return { headers, rows };
}

export class DataManagementStore {
  private dataSources = new Map<string, DataSourceSummary & { credentialHash?: string; createdBy: string; createdAt: string }>();
  private schemas = new Map<string, DatabaseSchema[]>();
  private tables = new Map<string, DatabaseTable[]>();
  private csvFiles = new Map<string, { id: string; name: string; content: string; createdAt: string }>();
  readonly queryAuditLogs: QueryAuditLog[] = [];

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
    return this.getDataSource(dataSourceId);
  }

  listSchemas(dataSourceId: string) {
    return this.schemas.get(dataSourceId) ?? [];
  }

  listTables(dataSourceId: string, schema?: string) {
    const tables = this.tables.get(dataSourceId) ?? [];
    return schema ? tables.filter((table) => table.schema === schema) : tables;
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

    const safeColumns = table.columns
      .filter((column) => !column.largeField)
      .filter((column) => !columns || columns.length === 0 || columns.includes(column.name))
      .slice(0, source.safety.fieldLimit);
    const rows = table.sampleRows.slice(0, Math.min(limit, source.safety.sampleLimit)).map((row) =>
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
        maxRows: source.safety.sampleLimit,
        maxFields: source.safety.fieldLimit,
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
          type: /^\d+$/.test(parsed.rows[0]?.[header] ?? "") ? "number" : "text",
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
    source.lastSyncedAt = nowIso();
    source.schemaCount = 1;
    source.tableCount = 1;
    const actualSizeMb = Math.max(1, Math.round(file.content.length / 1024 / 1024));
    this.dataSources.set(dataSourceId, source);
    this.schemas.set(dataSourceId, [{ id: `${dataSourceId}:schema:csv_imports`, dataSourceId, name: "csv_imports", tableCount: 1, viewCount: 0, lastSyncedAt: source.lastSyncedAt }]);
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
        updatedAt: nowIso(),
        isLarge: false,
        isSensitive: parsed.headers.some(isSensitiveName),
        columns: parsed.headers.map((header) => ({
          id: `${tableId}:col:${header}`,
          name: header,
          type: "text",
          nullable: true,
          primaryKey: false,
          indexed: false,
          sensitive: isSensitiveName(header),
          largeField: false,
          comment: "CSV 推断字段",
        })),
        indexes: [],
        foreignKeys: [],
        sampleRows: parsed.rows,
      }),
    ]);
    return { success: true as const, job: { id: id("import_job"), status: "completed", importedTableId: tableId, dataSourceId, importedRows: parsed.rows.length } };
  }

  schemaContext() {
    return {
      success: true as const,
      context: this.listDataSources().map((source) => ({
        dataSourceId: source.id,
        name: source.name,
        type: source.type,
        environment: source.environment,
        status: source.status,
        schemas: this.listSchemas(source.id).map((schema) => ({
          name: schema.name,
          tables: this.listTables(source.id, schema.name).map((table) => ({
            name: table.name,
            type: table.type,
            estimatedRows: table.estimatedRows,
            isLarge: table.isLarge,
            columns: table.columns
              .filter((column) => !column.sensitive)
              .slice(0, 20)
              .map((column) => ({ name: column.name, type: column.type, comment: column.comment })),
          })),
        })),
      })),
    };
  }

  private appendQueryAudit(log: Omit<QueryAuditLog, "id" | "createdAt">) {
    this.queryAuditLogs.push({ ...log, id: id("query_audit"), createdAt: nowIso() });
  }

  private buildSource(input: ConnectionInput, userId: string): DataSourceSummary & { credentialHash?: string; createdBy: string; createdAt: string } {
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
