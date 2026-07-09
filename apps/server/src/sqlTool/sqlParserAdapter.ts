export type ParsedSqlInfo = {
  normalizedSql: string;
  statementType?: string;
  tables: string[];
  columns: string[];
  hasLimit: boolean;
  hasJoin: boolean;
  hasAggregation: boolean;
  hasSubQuery: boolean;
};

export type SqlParserAdapter = {
  parse(sql: string): ParsedSqlInfo;
};

export class RegexSqlParserAdapter implements SqlParserAdapter {
  parse(sql: string): ParsedSqlInfo {
    const normalizedSql = normalizeSql(sql);
    return {
      normalizedSql,
      statementType: normalizedSql.match(/^([a-z]+)/i)?.[1]?.toLowerCase(),
      tables: extractTables(normalizedSql),
      columns: extractColumns(normalizedSql),
      hasLimit: /\blimit\s+\d+/i.test(normalizedSql),
      hasJoin: /\bjoin\b/i.test(normalizedSql),
      hasAggregation: /\b(count|sum|avg|min|max|group_concat)\s*\(/i.test(normalizedSql) || /\bgroup\s+by\b/i.test(normalizedSql),
      hasSubQuery: /\(\s*select\b/i.test(normalizedSql),
    };
  }
}

export function normalizeSql(sql: string) {
  return sql.trim().replace(/\s+/g, " ").replace(/;+\s*$/, "");
}

export function extractTables(sql: string) {
  const tables = new Set<string>();
  const pattern = /\b(?:from|join)\s+([`"\[]?[a-zA-Z_][\w.]*[`"\]]?)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql))) {
    tables.add(stripIdentifier(match[1]).split(".").pop() ?? stripIdentifier(match[1]));
  }
  return Array.from(tables);
}

export function extractColumns(sql: string) {
  const selectMatch = sql.match(/\bselect\s+([\s\S]+?)\s+\bfrom\b/i);
  if (!selectMatch) {
    return [];
  }
  const selectList = selectMatch[1].trim();
  if (selectList === "*") {
    return ["*"];
  }
  return selectList
    .split(",")
    .map((part) => part.trim().replace(/\bas\s+[`"\[]?[\w]+[`"\]]?$/i, "").trim())
    .map((part) => part.match(/(?:^|\.)([`"\[]?[a-zA-Z_][\w]*[`"\]]?)$/)?.[1] ?? part.match(/([a-zA-Z_][\w]*)\s*\)?$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(stripIdentifier);
}

function stripIdentifier(identifier: string) {
  return identifier.replace(/^[`"\[]|[`"\]]$/g, "");
}
