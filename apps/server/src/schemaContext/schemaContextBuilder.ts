import { randomUUID } from "node:crypto";
import { ContextCompressor } from "./contextCompressor.js";
import { RelevantSnippetRetriever } from "./relevantSnippetRetriever.js";
import {
  DEFAULT_SCHEMA_CONTEXT_SAFETY_POLICY,
  SCHEMA_CONTEXT_SYSTEM_INSTRUCTION,
  detectToolRequiredTasks,
  mergeTokenBudget,
} from "./safetyPolicy.js";
import { ToolContextBuilder } from "./toolContextBuilder.js";
import type {
  BuildSchemaContextInput,
  BuildSchemaContextOutput,
  ColumnProfile,
  DataSourceProfile,
  SchemaContextWarning,
  SchemaProfiler,
  TableProfile,
  ToolHandle,
} from "./types.js";

export type SchemaContextBuilderConfig = {
  profilers: SchemaProfiler[];
  toolContextBuilder?: ToolContextBuilder;
  compressor?: ContextCompressor;
  retriever?: RelevantSnippetRetriever;
};

export class SchemaContextBuilder {
  private readonly toolContextBuilder: ToolContextBuilder;
  private readonly compressor: ContextCompressor;
  private readonly retriever: RelevantSnippetRetriever;

  constructor(private readonly config: SchemaContextBuilderConfig) {
    this.toolContextBuilder = config.toolContextBuilder ?? new ToolContextBuilder();
    this.compressor = config.compressor ?? new ContextCompressor();
    this.retriever = config.retriever ?? new RelevantSnippetRetriever();
  }

  async buildContext(input: BuildSchemaContextInput): Promise<BuildSchemaContextOutput> {
    const warnings: SchemaContextWarning[] = [];
    const profiles: DataSourceProfile[] = [];
    for (const ref of input.dataSourceRefs) {
      if (!this.canAccessDataSource(ref.dataSourceId, input)) {
        warnings.push({ code: "PERMISSION_DENIED", message: `无权限访问数据源：${ref.name}`, dataSourceId: ref.dataSourceId });
        continue;
      }
      const profiler = this.config.profilers.find((candidate) => candidate.supports(ref));
      if (!profiler) {
        warnings.push({ code: "DATA_SOURCE_UNSUPPORTED", message: `暂不支持的数据源类型：${ref.type}`, dataSourceId: ref.dataSourceId });
        continue;
      }
      try {
        const result = await profiler.profile(ref, input);
        warnings.push(...result.warnings);
        if (result.profile) {
          profiles.push(this.applyColumnPermissions(result.profile, input));
        }
      } catch {
        warnings.push({ code: "PROFILE_GENERATION_FAILED", message: `数据源画像生成失败：${ref.name}`, dataSourceId: ref.dataSourceId });
      }
    }

    const compressedProfiles = this.compressor.compressProfiles(profiles, input.tokenBudget);
    const availableTools = this.getAvailableToolsFromProfiles(compressedProfiles);
    const relevantSnippets = this.retriever.retrieve(compressedProfiles, input.userQuestion);
    const tokenBudget = mergeTokenBudget(input.tokenBudget);
    const systemInstruction = this.buildSystemInstruction({
      purpose: input.purpose,
      userQuestion: input.userQuestion,
      availableTools,
    });
    const markdown = this.buildPromptMarkdownFromParts({
      systemInstruction,
      profiles: compressedProfiles,
      relevantSnippets,
      availableTools,
      userQuestion: input.userQuestion,
    });
    const context: BuildSchemaContextOutput = {
      contextId: `schema_ctx_${randomUUID()}`,
      conversationId: input.conversationId,
      dataSourceIds: compressedProfiles.map((profile) => profile.dataSourceId),
      purpose: input.purpose,
      systemInstruction,
      dataSourceProfiles: compressedProfiles,
      relevantSnippets,
      availableTools,
      safetyPolicy: DEFAULT_SCHEMA_CONTEXT_SAFETY_POLICY,
      tokenBudget,
      markdown,
      raw: {
        toolRequiredTasks: detectToolRequiredTasks(input.userQuestion),
        sourceCount: compressedProfiles.length,
      },
      warnings,
      generatedAt: new Date().toISOString(),
    };
    return this.compressor.enforceMarkdownBudget(context);
  }

  buildPromptMarkdown(context: BuildSchemaContextOutput) {
    return context.markdown;
  }

  buildSystemInstruction(context: Pick<BuildSchemaContextInput, "purpose" | "userQuestion"> & { availableTools?: ToolHandle[] }) {
    const toolRequiredTasks = detectToolRequiredTasks(context.userQuestion);
    return [
      SCHEMA_CONTEXT_SYSTEM_INSTRUCTION,
      "使用 businessFieldId 理解字段业务语义；生成 SQL 时必须使用对应 physicalName；生成页面标题、分析结论和报告内容时使用 displayNameZh。不得把 displayNameZh 直接作为 SQL 字段名，除非 physicalName 本身为中文。",
      context.purpose ? `当前任务目的：${context.purpose}` : undefined,
      toolRequiredTasks.length > 0 ? `检测到需要工具完成的任务类型：${toolRequiredTasks.join(", ")}。不要基于样例行直接给出全量结论。` : undefined,
      context.availableTools?.length ? `可用工具：${context.availableTools.map((tool) => tool.toolName).join(", ")}。` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  }

  getAvailableTools(context: BuildSchemaContextOutput) {
    return context.availableTools;
  }

  getRelevantSnippets(context: BuildSchemaContextOutput) {
    return context.relevantSnippets;
  }

  private buildPromptMarkdownFromParts({
    systemInstruction,
    profiles,
    relevantSnippets,
    availableTools,
    userQuestion,
  }: {
    systemInstruction: string;
    profiles: DataSourceProfile[];
    relevantSnippets: BuildSchemaContextOutput["relevantSnippets"];
    availableTools: ToolHandle[];
    userQuestion?: string;
  }) {
    return [
      "# Data Source Context",
      "",
      "## Usage Policy",
      systemInstruction,
      "",
      userQuestion ? `## User Question\n${userQuestion}\n` : undefined,
      "## Data Sources",
      profiles.length > 0 ? profiles.map(renderProfileSummary).join("\n\n") : "当前没有可注入的数据源画像。",
      "",
      "## Tables",
      profiles.flatMap((profile) => profile.tables.map((table) => renderTable(profile, table))).join("\n\n"),
      "",
      "## Relevant Snippets",
      relevantSnippets.length > 0 ? relevantSnippets.map((snippet) => `- ${snippet.reason}\n  - ${snippet.content.replace(/\n/g, "\n  - ")}`).join("\n") : "无额外相关片段。",
      "",
      "## Sample Rows Policy",
      "仅展示少量样例行，不代表全量统计结论；精确统计、筛选、聚合、排序、去重、趋势分析和图表生成必须调用工具。",
      "",
      "## Available Tools",
      availableTools.map((tool) => `- ${tool.toolName}：${tool.description}${tool.requiresUserApproval ? "（需授权）" : ""}`).join("\n"),
    ]
      .filter(Boolean)
      .join("\n");
  }

  private getAvailableToolsFromProfiles(profiles: DataSourceProfile[]) {
    const byName = new Map<string, ToolHandle>();
    for (const tool of this.toolContextBuilder.buildToolHandles()) {
      byName.set(tool.toolName, tool);
    }
    for (const profile of profiles) {
      for (const tool of profile.toolHandles) {
        byName.set(tool.toolName, tool);
      }
    }
    return Array.from(byName.values());
  }

  private canAccessDataSource(dataSourceId: string, input: BuildSchemaContextInput) {
    const permissions = input.userPermissionContext;
    if (permissions?.deniedDataSourceIds?.includes(dataSourceId)) {
      return false;
    }
    if (permissions?.allowedDataSourceIds && !permissions.allowedDataSourceIds.includes(dataSourceId)) {
      return false;
    }
    return true;
  }

  private applyColumnPermissions(profile: DataSourceProfile, input: BuildSchemaContextInput) {
    const allowedColumns = input.userPermissionContext?.allowedColumns?.[profile.dataSourceId];
    if (!allowedColumns) {
      return profile;
    }
    return {
      ...profile,
      tables: profile.tables.map((table) => {
        const allowed = allowedColumns[table.tableName];
        if (!allowed) {
          return table;
        }
        const filteredColumns = table.columns.filter((column) => allowed.includes(column.columnName));
        return {
          ...table,
          columns: filteredColumns,
          columnCount: filteredColumns.length,
          sampleRows: filterRows(table.sampleRows, filteredColumns),
          representativeRows: filterRows(table.representativeRows, filteredColumns),
          tailRows: filterRows(table.tailRows, filteredColumns),
        };
      }),
    };
  }
}

export function createSchemaContextBuilder(config: SchemaContextBuilderConfig) {
  return new SchemaContextBuilder(config);
}

function renderProfileSummary(profile: DataSourceProfile) {
  return [
    `### 数据源：${profile.displayName}`,
    `- 类型：${profile.sourceType === "csv_sqlite_temp" ? "CSV 导入数据 / SQLite 临时表" : "SQL 数据库"}`,
    profile.fileInfo ? `- 文件：${profile.fileInfo.fileName}，行数：${profile.fileInfo.rowCount ?? "--"}，列数：${profile.fileInfo.columnCount ?? "--"}` : undefined,
    profile.databaseInfo ? `- 数据库：${profile.databaseInfo.databaseType} / ${profile.databaseInfo.databaseName ?? "--"}，只读：${profile.databaseInfo.isReadOnly ? "是" : "否"}` : undefined,
    `- 表数量：${profile.summary.tableCount}`,
    `- 敏感字段数：${profile.summary.sensitiveFieldCount}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderTable(profile: DataSourceProfile, table: TableProfile) {
  const rows = [
    `### ${table.tableName}`,
    table.description ? `说明：${table.description}` : undefined,
    `数据源：${profile.displayName}；估算行数：${table.rowCount ?? "--"}；字段数：${table.columnCount ?? table.columns.length}`,
    "",
    "| 物理字段 | 业务字段 ID | 中文名称 | 类型 | 逻辑类型 | 缺失率 | 唯一值 | 敏感等级 | 字段说明 |",
    "|---|---|---|---|---|---:|---:|---|---|",
    ...table.columns.map(renderColumn),
    "",
    table.sampleRows?.length ? "样例行（已脱敏/截断，仅用于理解数据形态）：" : undefined,
    table.sampleRows?.length ? "```json" : undefined,
    table.sampleRows?.length ? JSON.stringify(table.sampleRows, null, 2) : undefined,
    table.sampleRows?.length ? "```" : undefined,
  ];
  return rows.filter(Boolean).join("\n");
}

function renderColumn(column: ColumnProfile) {
  return `| ${column.physicalName ?? column.columnName} | ${column.businessFieldId ?? "--"} | ${column.displayNameZh ?? column.displayName ?? column.columnName} | ${column.dataType} | ${column.logicalType ?? column.inferredType ?? "--"} | ${percent(column.missingRate)} | ${column.uniqueCount ?? "--"} | ${column.sensitivity ?? "internal"} | ${column.fieldComment ?? column.businessMeaning ?? "--"} |`;
}

function percent(value?: number) {
  if (value == null) {
    return "--";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function filterRows(rows: Record<string, unknown>[] | undefined, columns: ColumnProfile[]) {
  if (!rows) {
    return rows;
  }
  const names = new Set(columns.map((column) => column.columnName));
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => names.has(key))));
}
