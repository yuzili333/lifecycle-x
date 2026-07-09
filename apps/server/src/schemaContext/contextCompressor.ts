import { mergeTokenBudget } from "./safetyPolicy.js";
import type { ContextTokenBudget, DataSourceProfile, SchemaContext } from "./types.js";

export class ContextCompressor {
  compressProfiles(profiles: DataSourceProfile[], budget?: Partial<ContextTokenBudget>) {
    const mergedBudget = mergeTokenBudget(budget);
    return profiles.map((profile) => ({
      ...profile,
      tables: profile.tables.slice(0, mergedBudget.maxTables).map((table) => ({
        ...table,
        columns: table.columns.slice(0, mergedBudget.maxColumnsPerTable).map((column) => ({
          ...column,
          sampleValues: column.sampleValues?.map((value) => truncate(value, 48)),
          topValues: column.topValues?.slice(0, mergedBudget.maxTopValuesPerColumn).map((item) => ({
            ...item,
            value: truncate(item.value, 48),
          })),
        })),
        sampleRows: table.sampleRows?.slice(0, mergedBudget.maxSampleRowsPerTable).map((row) => truncateRow(row)),
        tailRows: mergedBudget.includeTailRows ? table.tailRows?.slice(0, 2).map((row) => truncateRow(row)) : undefined,
        representativeRows: mergedBudget.includeRepresentativeRows
          ? table.representativeRows?.slice(0, Math.max(1, Math.min(3, mergedBudget.maxSampleRowsPerTable))).map((row) => truncateRow(row))
          : undefined,
        statistics: mergedBudget.includeStatistics ? table.statistics : undefined,
      })),
    }));
  }

  enforceMarkdownBudget(context: SchemaContext) {
    const budget = mergeTokenBudget(context.tokenBudget);
    if (!budget.maxChars || context.markdown.length <= budget.maxChars) {
      return context;
    }
    const preserve = [
      "# Data Source Context",
      "",
      "## Usage Policy",
      context.systemInstruction,
      "",
      "## Available Tools",
      ...context.availableTools.map((tool) => `- ${tool.toolName}：${tool.description}`),
      "",
      "## Context Truncated",
      `当前 Schema Context 超出 ${budget.maxChars} 字符预算，已保留安全策略和工具句柄，并压缩数据源画像。`,
    ].join("\n");
    return {
      ...context,
      markdown: preserve.length > budget.maxChars ? preserve.slice(0, budget.maxChars) : `${preserve}\n\n${context.markdown.slice(0, Math.max(0, budget.maxChars - preserve.length - 2))}`,
      warnings: [
        ...context.warnings,
        { code: "CONTEXT_BUDGET_EXCEEDED" as const, message: "Schema Context 已按字符预算压缩。" },
      ],
    };
  }
}

function truncate(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return value;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function truncateRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, truncate(value, 80)]));
}
