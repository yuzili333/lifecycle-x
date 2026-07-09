import { maskSensitiveValue, truncateValue } from "./profileUtils.js";
import type { DataSourceProfile, RelevantDataSnippet } from "./types.js";

export class RelevantSnippetRetriever {
  retrieve(profiles: DataSourceProfile[], question?: string, limit = 8): RelevantDataSnippet[] {
    const keywords = tokenize(question);
    const snippets: RelevantDataSnippet[] = [];
    for (const profile of profiles) {
      for (const table of profile.tables) {
        const tableText = [table.tableName, table.description, table.displayName].filter(Boolean).join(" ");
        const tableScore = scoreText(tableText, keywords);
        const matchedColumns = table.columns
          .map((column) => ({
            column,
            score: scoreText([column.columnName, column.displayName, column.businessMeaning, column.sampleValues?.join(" ")].filter(Boolean).join(" "), keywords),
          }))
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, 8);
        const totalScore = tableScore + matchedColumns.reduce((sum, item) => sum + item.score, 0);
        if (totalScore <= 0 && keywords.length > 0) {
          continue;
        }
        const safeColumns = matchedColumns.length > 0 ? matchedColumns.map((item) => item.column) : table.columns.slice(0, 5);
        snippets.push({
          snippetId: `${profile.dataSourceId}:${table.tableName}:${snippets.length}`,
          dataSourceId: profile.dataSourceId,
          tableName: table.tableName,
          columnNames: safeColumns.map((column) => column.columnName),
          reason: keywords.length > 0 ? "根据用户问题关键词匹配到相关表字段。" : "无用户问题，返回数据源结构概览片段。",
          score: totalScore || 0.1,
          content: [
            `表：${table.tableName}`,
            table.description ? `说明：${table.description}` : undefined,
            `字段：${safeColumns.map((column) => `${column.columnName}(${column.dataType})`).join(", ")}`,
            sampleRowText(table, safeColumns.map((column) => column.columnName)),
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: {
            sourceType: profile.sourceType,
            warning: "片段仅用于理解结构和样例形态，不代表全量统计结论。",
          },
        });
      }
    }
    return snippets.sort((left, right) => right.score - left.score).slice(0, limit);
  }
}

function tokenize(question?: string) {
  if (!question) {
    return [];
  }
  return Array.from(new Set(question.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])).filter((token) => token.length >= 2);
}

function scoreText(text: string, keywords: string[]) {
  if (keywords.length === 0) {
    return 0;
  }
  const normalized = text.toLowerCase();
  return keywords.reduce((score, keyword) => score + (normalized.includes(keyword) ? keyword.length : 0), 0);
}

function sampleRowText(table: DataSourceProfile["tables"][number], columnNames: string[]) {
  const row = table.sampleRows?.[0];
  if (!row) {
    return undefined;
  }
  const columnMap = new Map(table.columns.map((column) => [column.columnName, column]));
  const values = Object.fromEntries(
    columnNames.map((columnName) => {
      const column = columnMap.get(columnName);
      const value = column?.sensitivity === "sensitive" || column?.sensitivity === "restricted" ? maskSensitiveValue(row[columnName]) : truncateValue(row[columnName], 48);
      return [columnName, value];
    }),
  );
  return `样例片段：${JSON.stringify(values)}`;
}
