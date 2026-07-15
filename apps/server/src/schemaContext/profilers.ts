import type { DatabaseTable, DataSourceSummary as StoreDataSourceSummary } from "../dataManagementStore.js";
import { DEFAULT_SCHEMA_CONTEXT_SAFETY_POLICY, mergeTokenBudget } from "./safetyPolicy.js";
import { ToolContextBuilder } from "./toolContextBuilder.js";
import type {
  BuildSchemaContextInput,
  DataSourceProfile,
  DataSourceRef,
  SchemaContextWarning,
  SchemaProfiler,
  TableProfile,
} from "./types.js";
import {
  buildColumnStatistics,
  buildTableStatistics,
  inferSqlType,
  maskRows,
  sensitivityFromFlags,
} from "./profileUtils.js";

export type DataSourceMetadataProvider = {
  getDataSource(dataSourceId: string): StoreDataSourceSummary | null;
  listTables(dataSourceId: string): DatabaseTable[];
  getCsvFileProfile?(dataSourceId: string): { fileName: string; fileSizeBytes: number; encoding: string; delimiter: string; rowCount: number; columnCount: number } | undefined;
};

export class SqlProfiler implements SchemaProfiler {
  constructor(private readonly provider: DataSourceMetadataProvider, private readonly toolContextBuilder = new ToolContextBuilder()) {}

  supports(ref: DataSourceRef) {
    return ref.type === "sql_database";
  }

  profile(ref: DataSourceRef, input: BuildSchemaContextInput) {
    const source = this.provider.getDataSource(ref.dataSourceId);
    if (!source) {
      return { warnings: [warning("DATA_SOURCE_NOT_FOUND", `数据源不可用：${ref.name}`, ref.dataSourceId)] };
    }
    if (source.status === "disabled") {
      return { warnings: [warning("PERMISSION_DENIED", `数据源已禁用：${ref.name}`, ref.dataSourceId)] };
    }
    const budget = mergeTokenBudget(input.tokenBudget);
    const warnings: SchemaContextWarning[] = [];
    const tables = filterTablesByPermission(this.provider.listTables(ref.dataSourceId), input)
      .slice(0, budget.maxTables)
      .map((table) => profileTable(table, budget.maxSampleRowsPerTable, budget.maxTopValuesPerColumn, source.environment === "production"));
    const profile: DataSourceProfile = {
      dataSourceId: source.id,
      sourceType: "sql_database",
      displayName: source.name,
      databaseInfo: {
        databaseType: source.type === "mysql" ? "MySQL" : "SQLite",
        databaseName: source.database,
        schemaName: source.database,
        tableCount: source.tableCount,
        viewCount: tables.filter((table) => table.metadata?.type === "view").length,
        isReadOnly: source.readonly,
      },
      tables,
      summary: {
        tableCount: tables.length,
        totalRows: tables.reduce((sum, table) => sum + (table.rowCount ?? 0), 0),
        sensitiveFieldCount: tables.reduce((sum, table) => sum + table.columns.filter((column) => column.sensitivity === "sensitive" || column.sensitivity === "restricted").length, 0),
        largeTableCount: tables.filter((table) => table.metadata?.isLarge).length,
        warnings: warnings.map((item) => item.message),
      },
      toolHandles: this.toolContextBuilder.buildToolHandles(),
      generatedAt: new Date().toISOString(),
    };
    return { profile, warnings };
  }
}

export class CsvSqliteTempProfiler implements SchemaProfiler {
  constructor(private readonly provider: DataSourceMetadataProvider, private readonly toolContextBuilder = new ToolContextBuilder()) {}

  supports(ref: DataSourceRef) {
    return ref.type === "csv_sqlite_temp";
  }

  profile(ref: DataSourceRef, input: BuildSchemaContextInput) {
    const source = this.provider.getDataSource(ref.dataSourceId);
    if (!source) {
      return { warnings: [warning("DATA_SOURCE_NOT_FOUND", `CSV 数据源不可用：${ref.name}`, ref.dataSourceId)] };
    }
    const budget = mergeTokenBudget(input.tokenBudget);
    const tables = filterTablesByPermission(this.provider.listTables(ref.dataSourceId), input)
      .slice(0, budget.maxTables)
      .map((table) => profileTable(table, budget.maxSampleRowsPerTable, budget.maxTopValuesPerColumn, false));
    const firstTable = tables[0];
    const fileProfile = this.provider.getCsvFileProfile?.(ref.dataSourceId);
    const profile: DataSourceProfile = {
      dataSourceId: source.id,
      sourceType: "csv_sqlite_temp",
      displayName: source.name,
      fileInfo: {
        fileName: fileProfile?.fileName ?? `${source.name}.csv`,
        fileType: "csv",
        fileSizeBytes: fileProfile?.fileSizeBytes ?? Math.round((firstTable?.metadata?.estimatedSizeMb as number | undefined ?? 1) * 1024 * 1024),
        encoding: fileProfile?.encoding ?? "utf-8",
        delimiter: fileProfile?.delimiter ?? ",",
        rowCount: fileProfile?.rowCount ?? firstTable?.rowCount,
        columnCount: fileProfile?.columnCount ?? firstTable?.columnCount,
      },
      databaseInfo: {
        databaseType: "SQLite",
        databaseName: "csv_imports",
        schemaName: "csv_imports",
        tableCount: tables.length,
        isReadOnly: true,
      },
      tables,
      summary: {
        tableCount: tables.length,
        totalRows: tables.reduce((sum, table) => sum + (table.rowCount ?? 0), 0),
        sensitiveFieldCount: tables.reduce((sum, table) => sum + table.columns.filter((column) => column.sensitivity === "sensitive" || column.sensitivity === "restricted").length, 0),
        largeTableCount: tables.filter((table) => table.metadata?.isLarge).length,
        warnings: [],
      },
      toolHandles: this.toolContextBuilder.buildToolHandles(),
      generatedAt: new Date().toISOString(),
    };
    return { profile, warnings: [] };
  }
}

function profileTable(table: DatabaseTable, maxSampleRows: number, maxTopValues: number, productionMode: boolean): TableProfile {
  const columns = table.columns.map((column) => {
    const values = table.sampleRows.map((row) => row[column.name]);
    const sensitivity = sensitivityFromFlags(column.sensitive, column.name);
    const profile = buildColumnStatistics(column.name, values, column.type, sensitivity);
    return {
      ...profile,
      dataType: column.type,
      displayName: column.displayNameZh ?? column.sourceHeader ?? column.name,
      sourceHeader: column.sourceHeader ?? column.name,
      physicalName: column.physicalName ?? column.name,
      businessFieldId: column.businessFieldId,
      displayNameZh: column.displayNameZh,
      logicalType: column.logicalType,
      sqliteType: column.sqliteType,
      fieldComment: column.fieldComment ?? column.comment,
      mappingStatus: column.mappingStatus,
      inferredType: profile.inferredType ?? inferSqlType(column.type),
      nullable: column.nullable,
      businessMeaning: column.fieldComment ?? column.comment,
      isPrimaryKey: column.primaryKey,
      isForeignKey: table.foreignKeys.some((foreignKey) => foreignKey.columns.includes(column.name)),
      metadata: {
        indexed: column.indexed,
        largeField: column.largeField,
        businessFieldId: column.businessFieldId,
        sourceHeader: column.sourceHeader,
        physicalName: column.physicalName ?? column.name,
        displayNameZh: column.displayNameZh,
        mappingSource: column.mappingSource,
        mappingConfidence: column.mappingConfidence,
        mappingStatus: column.mappingStatus,
      },
      topValues: profile.topValues?.slice(0, maxTopValues),
    };
  });
  const visibleSampleRows = productionMode && table.isLarge ? [] : maskRows(table.sampleRows, columns, maxSampleRows);
  const tableProfile: TableProfile = {
    tableId: table.id,
    tableName: table.name,
    displayName: table.name,
    description: table.comment,
    rowCount: table.estimatedRows,
    columnCount: table.columns.length,
    columns,
    primaryKeys: table.primaryKey ? [table.primaryKey] : table.columns.filter((column) => column.primaryKey).map((column) => column.name),
    foreignKeys: table.foreignKeys.map((foreignKey) => ({
      name: foreignKey.name,
      columns: foreignKey.columns,
      referencesTable: foreignKey.referencesTable,
      referencesColumns: foreignKey.referencesColumns,
    })),
    indexes: table.indexes.map((index) => ({
      name: index.name,
      columns: index.columns,
      unique: index.unique,
      type: index.type,
    })),
    sampleRows: visibleSampleRows,
    representativeRows: visibleSampleRows.slice(0, Math.min(3, visibleSampleRows.length)),
    sensitivity: table.isSensitive ? "sensitive" : "internal",
    metadata: {
      schema: table.schema,
      type: table.type,
      isLarge: table.isLarge,
      estimatedSizeMb: table.estimatedSizeMb,
      previewPolicy: productionMode && table.isLarge ? "生产大表默认不注入样例行。" : `最多注入 ${DEFAULT_SCHEMA_CONTEXT_SAFETY_POLICY.maxPreviewRowsPerTable} 行样例。`,
    },
  };
  tableProfile.statistics = buildTableStatistics(tableProfile);
  return tableProfile;
}

function filterTablesByPermission(tables: DatabaseTable[], input: BuildSchemaContextInput) {
  const allowedTables = input.userPermissionContext?.allowedTables;
  if (!allowedTables) {
    return tables;
  }
  return tables.filter((table) => allowedTables[table.dataSourceId]?.includes(table.name));
}

function warning(code: SchemaContextWarning["code"], message: string, dataSourceId?: string): SchemaContextWarning {
  return { code, message, dataSourceId };
}
