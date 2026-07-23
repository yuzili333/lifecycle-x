import { request, type AuthFailure, type AuthUser } from "./auth";

export type UserProfile = AuthUser & {
  department: string;
  title: string;
  phone: string;
};

export type WorkbenchSettings = {
  general: {
    language: "zh-CN" | "en-US";
    timezone: string;
    notificationsEnabled: boolean;
  };
  appearance: {
    themeMode: "light" | "dark";
    accentColor: string;
    backgroundColor: string;
    foregroundColor: string;
    fontFamily: string;
    codeFontFamily: string;
    uiFontSize: number;
    codeFontSize: number;
    translucentSidebar: boolean;
    contrast: "standard" | "high";
    dockIcon: "dark" | "light";
  };
  configuration: {
    modelProvider: string;
    modelName: string;
    executionModelName?: string;
    dualModelOrchestrationEnabled?: boolean;
    thinkingOptimizationEnabled?: boolean;
    apiKeyStatus: "not_configured" | "configured";
    skillEnabled: boolean;
    mcpEnabled: boolean;
  };
  personalization: {
    defaultModule: "data-assistant" | "data-management";
    compactNavigation: boolean;
  };
};

export type ApiResult<T extends { success: true }> = T | AuthFailure;

export type DataSourceSummary = {
  id: string;
  name: string;
  type: "mysql" | "csv";
  environment: "production" | "staging" | "development" | "imported";
  host: string;
  port: number;
  database: string;
  username: string;
  status: "online" | "offline" | "disabled" | "degraded";
  credentialStatus: "configured" | "missing" | "expired";
  readonly: boolean;
  schemaCount: number;
  tableCount: number;
  lastSyncedAt?: string;
  poolConfig: {
    min: number;
    max: number;
    acquireTimeoutMs: number;
    idleTimeoutMs: number;
    queryTimeoutMs: number;
  };
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
  sourceHeader?: string;
  physicalName?: string;
  businessFieldId?: string;
  displayNameZh?: string;
  displayNameEn?: string;
  logicalType?: string;
  sqliteType?: string;
  fieldComment?: string;
  aliases?: string[];
  mappingSource?: string;
  mappingConfidence?: number;
  mappingStatus?: string;
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
  sampleRows: Array<Record<string, string | number | boolean | null>>;
};

export type SampleDataResult = {
  success: true;
  columns: DatabaseColumn[];
  rows: Array<Record<string, string | number | boolean | null>>;
  policy: {
    maxRows: number;
    maxFields: number;
    maskedFields: string[];
    skippedLargeFields: string[];
  };
};

export type SchemaContextResult = {
  success: true;
  context: {
    contextId: string;
    conversationId?: string;
    dataSourceIds: string[];
    systemInstruction: string;
    dataSourceProfiles?: Array<{
      displayName?: string;
      tables?: Array<{
        tableName: string;
        columnCount?: number;
        columns?: unknown[];
      }>;
    }>;
    markdown: string;
    warnings: Array<{ code: string; message: string; dataSourceId?: string; tableName?: string }>;
    generatedAt: string;
  };
};

export type SchemaContextQuery = {
  conversationId?: string;
  question?: string;
  dataSourceId?: string;
  skill?: string | null;
  purpose?: "data_exploration" | "sql_generation" | "risk_analysis" | "report_generation" | "chart_generation";
  maxChars?: number;
  maxColumnsPerTable?: number;
};

export type DataSourceInput = {
  name: string;
  type: "mysql";
  environment: "production" | "staging" | "development";
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  readonly: boolean;
};

function authHeaders(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

export const workbenchApi = {
  profile(accessToken: string) {
    return request<{ success: true; profile: UserProfile }>("/users/me/profile", {
      headers: authHeaders(accessToken),
    });
  },

  updateAvatar(accessToken: string, avatarUrl: string) {
    return request<{ success: true; profile: UserProfile }>("/users/me/avatar", {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ avatarUrl }),
    });
  },

  settings(accessToken: string) {
    return request<{ success: true; settings: WorkbenchSettings }>("/users/me/settings", {
      headers: authHeaders(accessToken),
    });
  },

  updateSettings(accessToken: string, settings: Partial<WorkbenchSettings>) {
    return request<{ success: true; settings: WorkbenchSettings }>("/users/me/settings", {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify(settings),
    });
  },

  dataSources(accessToken: string) {
    return request<{ success: true; dataSources: DataSourceSummary[] }>("/data-sources", {
      headers: authHeaders(accessToken),
    });
  },

  createDataSource(accessToken: string, input: DataSourceInput) {
    return request<{ success: true; dataSource: DataSourceSummary }>("/data-sources", {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify(input),
    });
  },

  testConnectionInput(accessToken: string, input: DataSourceInput) {
    return request<{
      success: true;
      status: "passed" | "blocked";
      version: string;
      latencyMs: number;
      accessibleSchemas: string[];
      readonly: boolean;
      warnings: string[];
    }>("/data-sources/test-connection", {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify(input),
    });
  },

  testDataSource(accessToken: string, dataSourceId: string) {
    return request<{
      success: true;
      status: "passed" | "blocked";
      version: string;
      latencyMs: number;
      accessibleSchemas: string[];
      readonly: boolean;
      warnings: string[];
    }>(`/data-sources/${encodeURIComponent(dataSourceId)}/test-connection`, {
      method: "POST",
      headers: authHeaders(accessToken),
    });
  },

  syncMetadata(accessToken: string, dataSourceId: string) {
    return request<{ success: true; dataSource: DataSourceSummary }>(
      `/data-sources/${encodeURIComponent(dataSourceId)}/metadata/sync`,
      { method: "POST", headers: authHeaders(accessToken) },
    );
  },

  schemas(accessToken: string, dataSourceId: string) {
    return request<{ success: true; schemas: DatabaseSchema[] }>(`/data-sources/${encodeURIComponent(dataSourceId)}/schemas`, {
      headers: authHeaders(accessToken),
    });
  },

  tables(accessToken: string, dataSourceId: string, schema?: string) {
    const query = schema ? `?schema=${encodeURIComponent(schema)}` : "";
    return request<{ success: true; tables: DatabaseTable[] }>(
      `/data-sources/${encodeURIComponent(dataSourceId)}/tables${query}`,
      { headers: authHeaders(accessToken) },
    );
  },

  table(accessToken: string, dataSourceId: string, tableId: string) {
    return request<{ success: true; table: DatabaseTable }>(
      `/data-sources/${encodeURIComponent(dataSourceId)}/tables/${encodeURIComponent(tableId)}`,
      { headers: authHeaders(accessToken) },
    );
  },

  sampleData(accessToken: string, dataSourceId: string, tableId: string) {
    return request<SampleDataResult>(`/data-sources/${encodeURIComponent(dataSourceId)}/query/sample`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ tableId, limit: 20 }),
    });
  },

  largeTablePlan(accessToken: string, dataSourceId: string, tableId: string) {
    return request<{
      success: true;
      tableId: string;
      isLarge: boolean;
      estimatedRows: number;
      estimatedSizeMb: number;
      strategy: string;
      requiresConfirmation: boolean;
      safeguards: string[];
    }>(`/data-sources/${encodeURIComponent(dataSourceId)}/query/large-table-plan`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ tableId }),
    });
  },

  confirmLargeTable(accessToken: string, dataSourceId: string, tableId: string) {
    return request<SampleDataResult>(`/data-sources/${encodeURIComponent(dataSourceId)}/query/confirm-large-table`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ tableId }),
    });
  },

  uploadCsv(accessToken: string, name: string, content: string) {
    return request<{ success: true; file: { id: string; name: string; size: number; createdAt: string } }>("/csv/files", {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ name, content }),
    });
  },

  previewCsv(accessToken: string, fileId: string) {
    return request<{
      success: true;
      preview: {
        fileId: string;
        headers: string[];
        rows: Array<Record<string, string>>;
        inferredColumns: Array<{ name: string; type: string; sensitive: boolean; csvInjectionRisk: boolean }>;
      };
    }>(`/csv/files/${encodeURIComponent(fileId)}/preview`, {
      method: "POST",
      headers: authHeaders(accessToken),
    });
  },

  importCsv(accessToken: string, fileId: string, dictionaryFileId: string, validationMode: "strict" | "quarantine" = "strict") {
    return request<{
      success: true;
      job: { id: string; status: "completed" | "completed_with_warnings"; importedTableId: string; dataSourceId: string; importedRows: number; invalidRows?: number };
    }>(`/csv/files/${encodeURIComponent(fileId)}/import`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ dictionaryFileId, validationMode }),
    });
  },

  deleteCsvDataSource(accessToken: string, dataSourceId: string) {
    return request<{ success: true; dataSourceId: string }>(
      `/csv/data-sources/${encodeURIComponent(dataSourceId)}/delete`,
      { method: "POST", headers: authHeaders(accessToken) },
    );
  },

  renameCsvDataSource(accessToken: string, dataSourceId: string, name: string) {
    return request<{ success: true; dataSource: DataSourceSummary; table: DatabaseTable | null }>(
      `/csv/data-sources/${encodeURIComponent(dataSourceId)}/rename`,
      {
        method: "POST",
        headers: authHeaders(accessToken),
        body: JSON.stringify({ name }),
      },
    );
  },

  schemaContext(accessToken: string, query: SchemaContextQuery) {
    const params = new URLSearchParams();
    if (query.conversationId) {
      params.set("conversationId", query.conversationId);
    }
    if (query.question) {
      params.set("question", query.question);
    }
    if (query.dataSourceId) {
      params.set("dataSourceId", query.dataSourceId);
    }
    if (query.skill) {
      params.set("skill", query.skill);
    }
    if (query.purpose) {
      params.set("purpose", query.purpose);
    }
    if (query.maxChars) {
      params.set("maxChars", String(query.maxChars));
    }
    if (query.maxColumnsPerTable) {
      params.set("maxColumnsPerTable", String(query.maxColumnsPerTable));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return request<SchemaContextResult>(`/agent/context/schema${suffix}`, {
      headers: authHeaders(accessToken),
    });
  },
};
