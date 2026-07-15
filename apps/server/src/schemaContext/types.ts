export type DataSourceType = "sql_database" | "csv_sqlite_temp";

export type SensitivityLevel = "public" | "internal" | "sensitive" | "restricted";

export type DataSourceRef = {
  dataSourceId: string;
  type: DataSourceType;
  name: string;
  description?: string;
  owner?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export type FileProfile = {
  fileName: string;
  fileType: "csv" | "xlsx" | "unknown";
  fileSizeBytes?: number;
  encoding?: string;
  delimiter?: string;
  sheetCount?: number;
  rowCount?: number;
  columnCount?: number;
};

export type DatabaseProfile = {
  databaseType: string;
  databaseName?: string;
  schemaName?: string;
  tableCount?: number;
  viewCount?: number;
  isReadOnly?: boolean;
};

export type ForeignKeyProfile = {
  name: string;
  columns: string[];
  referencesTable: string;
  referencesColumns: string[];
};

export type IndexProfile = {
  name: string;
  columns: string[];
  unique: boolean;
  type?: string;
};

export type ColumnProfile = {
  columnName: string;
  displayName?: string;
  sourceHeader?: string;
  physicalName?: string;
  businessFieldId?: string;
  displayNameZh?: string;
  logicalType?: string;
  sqliteType?: string;
  fieldComment?: string;
  mappingStatus?: string;
  dataType: string;
  inferredType?: "string" | "number" | "integer" | "boolean" | "date" | "datetime" | "category" | "text" | "unknown";
  nullable?: boolean;
  missingRate?: number;
  uniqueCount?: number;
  sampleValues?: unknown[];
  min?: number | string;
  max?: number | string;
  mean?: number;
  median?: number;
  topValues?: Array<{ value: unknown; count: number; ratio?: number }>;
  timeRange?: {
    min?: string;
    max?: string;
  };
  businessMeaning?: string;
  sensitivity?: SensitivityLevel;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  metadata?: Record<string, unknown>;
};

export type TableStatistics = {
  numericColumns?: Record<string, { min?: number; max?: number; mean?: number; median?: number }>;
  categoryColumns?: Record<string, Array<{ value: unknown; count: number; ratio?: number }>>;
  timeColumns?: Record<string, { min?: string; max?: string }>;
  warnings?: string[];
};

export type TableProfile = {
  tableId: string;
  tableName: string;
  displayName?: string;
  description?: string;
  rowCount?: number;
  columnCount?: number;
  columns: ColumnProfile[];
  primaryKeys?: string[];
  foreignKeys?: ForeignKeyProfile[];
  indexes?: IndexProfile[];
  sampleRows?: Record<string, unknown>[];
  tailRows?: Record<string, unknown>[];
  representativeRows?: Record<string, unknown>[];
  statistics?: TableStatistics;
  sensitivity?: SensitivityLevel;
  metadata?: Record<string, unknown>;
};

export type DataSourceSummary = {
  tableCount: number;
  totalRows?: number;
  sensitiveFieldCount: number;
  largeTableCount: number;
  warnings: string[];
};

export type ToolHandle = {
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputDescription?: string;
  riskLevel?: "low" | "medium" | "high";
  requiresUserApproval?: boolean;
  useCases?: string[];
  forbiddenUseCases?: string[];
};

export type DataSourceProfile = {
  dataSourceId: string;
  sourceType: DataSourceType;
  displayName: string;
  fileInfo?: FileProfile;
  databaseInfo?: DatabaseProfile;
  tables: TableProfile[];
  summary: DataSourceSummary;
  toolHandles: ToolHandle[];
  generatedAt: string;
};

export type RelevantDataSnippet = {
  snippetId: string;
  dataSourceId: string;
  tableName?: string;
  columnNames?: string[];
  reason: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
};

export type ToolRequiredTaskType =
  | "full_table_sum"
  | "top_n_sorting"
  | "group_by_statistics"
  | "distinct_count"
  | "complex_filtering"
  | "correlation_analysis"
  | "missing_value_statistics"
  | "outlier_detection"
  | "trend_analysis"
  | "multi_table_join"
  | "chart_generation"
  | "medical_data_analysis"
  | "financial_data_analysis"
  | "scientific_data_analysis";

export type SchemaContextSafetyPolicy = {
  disallowFullDataInjection: boolean;
  requireToolForPreciseComputation: boolean;
  requireUserApprovalForSqlExecution: boolean;
  requireUserApprovalForPythonExecution: boolean;
  maskSensitiveFields: boolean;
  maxPreviewRowsPerTable: number;
  forbiddenDirectAnswerTasks: ToolRequiredTaskType[];
};

export type ContextTokenBudget = {
  maxChars?: number;
  maxTables?: number;
  maxColumnsPerTable?: number;
  maxSampleRowsPerTable?: number;
  maxTopValuesPerColumn?: number;
  includeTailRows?: boolean;
  includeRepresentativeRows?: boolean;
  includeStatistics?: boolean;
};

export type UserPermissionContext = {
  allowedDataSourceIds?: string[];
  deniedDataSourceIds?: string[];
  allowedTables?: Record<string, string[]>;
  allowedColumns?: Record<string, Record<string, string[]>>;
};

export type SchemaContext = {
  contextId: string;
  conversationId?: string;
  dataSourceIds: string[];
  purpose?: string;
  systemInstruction: string;
  dataSourceProfiles: DataSourceProfile[];
  relevantSnippets: RelevantDataSnippet[];
  availableTools: ToolHandle[];
  safetyPolicy: SchemaContextSafetyPolicy;
  tokenBudget: ContextTokenBudget;
  markdown: string;
  raw: Record<string, unknown>;
  warnings: SchemaContextWarning[];
  generatedAt: string;
};

export type BuildSchemaContextInput = {
  conversationId?: string;
  userQuestion?: string;
  dataSourceRefs: DataSourceRef[];
  purpose?: "data_exploration" | "sql_generation" | "risk_analysis" | "report_generation" | "chart_generation";
  tokenBudget?: Partial<ContextTokenBudget>;
  userPermissionContext?: UserPermissionContext;
};

export type BuildSchemaContextOutput = SchemaContext;

export type SchemaContextErrorCode =
  | "DATA_SOURCE_NOT_FOUND"
  | "DATA_SOURCE_UNSUPPORTED"
  | "PERMISSION_DENIED"
  | "PROFILE_GENERATION_FAILED"
  | "CSV_PROFILE_FAILED"
  | "SQL_PROFILE_FAILED"
  | "CONTEXT_BUILD_FAILED"
  | "CONTEXT_BUDGET_EXCEEDED"
  | "SENSITIVE_FIELD_MASK_FAILED"
  | "UNKNOWN_ERROR";

export type SchemaContextWarning = {
  code: SchemaContextErrorCode;
  message: string;
  dataSourceId?: string;
  tableName?: string;
};

export type SchemaProfiler = {
  supports(ref: DataSourceRef): boolean;
  profile(ref: DataSourceRef, input: BuildSchemaContextInput): Promise<{ profile?: DataSourceProfile; warnings: SchemaContextWarning[] }> | { profile?: DataSourceProfile; warnings: SchemaContextWarning[] };
};
