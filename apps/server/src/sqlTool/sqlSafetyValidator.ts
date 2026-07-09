import type { SqlSafetyCheckResult, SqlSafetyIssue } from "./types.js";
import { RegexSqlParserAdapter, normalizeSql, type SqlParserAdapter } from "./sqlParserAdapter.js";

const FORBIDDEN_PATTERNS: Array<[string, RegExp]> = [
  ["INSERT", /\binsert\b/i],
  ["UPDATE", /\bupdate\b/i],
  ["DELETE", /\bdelete\b/i],
  ["MERGE", /\bmerge\b/i],
  ["UPSERT", /\bupsert\b/i],
  ["DROP", /\bdrop\b/i],
  ["ALTER", /\balter\b/i],
  ["TRUNCATE", /\btruncate\b/i],
  ["CREATE", /\bcreate\b/i],
  ["RENAME", /\brename\b/i],
  ["REPLACE", /\breplace\b/i],
  ["GRANT", /\bgrant\b/i],
  ["REVOKE", /\brevoke\b/i],
  ["COMMIT", /\bcommit\b/i],
  ["ROLLBACK", /\brollback\b/i],
  ["SAVEPOINT", /\bsavepoint\b/i],
  ["LOCK", /\block\b/i],
  ["UNLOCK", /\bunlock\b/i],
  ["CALL", /\bcall\b/i],
  ["EXEC", /\bexec(?:ute)?\b/i],
  ["LOAD DATA", /\bload\s+data\b/i],
  ["COPY", /\bcopy\b/i],
  ["INTO OUTFILE", /\binto\s+outfile\b/i],
  ["INTO DUMPFILE", /\binto\s+dumpfile\b/i],
  ["ATTACH", /\battach\b/i],
  ["DETACH", /\bdetach\b/i],
  ["PRAGMA", /\bpragma\b/i],
  ["VACUUM", /\bvacuum\b/i],
  ["ANALYZE", /\banalyze\b/i],
];

const DANGEROUS_FUNCTIONS = /\b(load_file|sleep|benchmark|sys_eval|sys_exec|xp_cmdshell)\s*\(/i;
const SYSTEM_TABLES = /\b(information_schema|mysql|performance_schema|sys|pg_catalog|sqlite_master|sqlite_schema)\b/i;

export class SqlSafetyValidator {
  constructor(private readonly parser: SqlParserAdapter = new RegexSqlParserAdapter()) {}

  validate(sql: string): SqlSafetyCheckResult {
    const parsed = this.parser.parse(sql);
    const normalizedSql = parsed.normalizedSql;
    const reasons: SqlSafetyIssue[] = [];
    if (!normalizedSql) {
      reasons.push(issue("PARSE_FAILED", "error", "SQL 不能为空。"));
      return blocked(reasons, normalizedSql);
    }
    if (hasComments(sql)) {
      reasons.push(issue("UNSUPPORTED_SQL", "error", "SQL 注释被禁止，避免注释绕过安全检测。"));
    }
    if (hasMultipleStatements(normalizedSql)) {
      reasons.push(issue("MULTIPLE_STATEMENTS", "critical", "禁止多语句执行。"));
    }
    const statementType = parsed.statementType;
    if (statementType !== "select" && statementType !== "with") {
      reasons.push(issue("NON_SELECT_STATEMENT", "critical", "仅允许 SELECT 或 WITH ... SELECT 查询。"));
    }
    if (statementType === "with" && !/\bselect\b/i.test(normalizedSql)) {
      reasons.push(issue("NON_SELECT_STATEMENT", "critical", "WITH 查询必须包含 SELECT。"));
    }
    for (const [keyword, pattern] of FORBIDDEN_PATTERNS) {
      if (pattern.test(normalizedSql)) {
        reasons.push(issue("FORBIDDEN_KEYWORD", "critical", `禁止 SQL 关键字：${keyword}。`));
      }
    }
    if (/\bfor\s+(update|share)\b/i.test(normalizedSql)) {
      reasons.push(issue("FORBIDDEN_KEYWORD", "critical", "禁止 SELECT FOR UPDATE / FOR SHARE。"));
    }
    if (DANGEROUS_FUNCTIONS.test(normalizedSql)) {
      reasons.push(issue("DANGEROUS_FUNCTION", "critical", "检测到危险函数调用。"));
    }
    if (SYSTEM_TABLES.test(normalizedSql)) {
      reasons.push(issue("SYSTEM_TABLE_ACCESS", "critical", "禁止访问系统表或元数据 schema。"));
    }

    const hasLimit = parsed.hasLimit;
    const detectedTables = parsed.tables;
    const detectedColumns = parsed.columns;
    const hasJoin = parsed.hasJoin;
    const hasAggregation = parsed.hasAggregation;
    const hasSubQuery = parsed.hasSubQuery;
    const hasPotentialFullScan = !hasLimit && detectedTables.length > 0 && !/\bwhere\b/i.test(normalizedSql) && !hasAggregation;
    if (!hasLimit) {
      reasons.push(issue("MISSING_LIMIT", hasPotentialFullScan ? "warning" : "info", "查询未显式指定 LIMIT，执行时将按策略限制返回行数。"));
    }
    if (hasPotentialFullScan) {
      reasons.push(issue("POTENTIAL_FULL_SCAN", "warning", "查询可能触发全表扫描。"));
    }

    const hasBlockingIssue = reasons.some((item) => item.severity === "error" || item.severity === "critical");
    return {
      passed: !hasBlockingIssue,
      level: hasBlockingIssue ? "blocked" : reasons.some((item) => item.severity === "warning") ? "warning" : "safe",
      reasons,
      normalizedSql,
      detectedStatementType: statementType,
      detectedTables,
      detectedColumns,
      hasLimit,
      hasJoin,
      hasAggregation,
      hasSubQuery,
      hasPotentialFullScan,
    };
  }
}

function hasComments(sql: string) {
  return /--|#|\/\*/.test(sql);
}

function hasMultipleStatements(sql: string) {
  return sql.split(";").filter((part) => part.trim()).length > 1;
}

function issue(code: SqlSafetyIssue["code"], severity: SqlSafetyIssue["severity"], message: string): SqlSafetyIssue {
  return { code, severity, message };
}

export { normalizeSql };

function blocked(reasons: SqlSafetyIssue[], normalizedSql?: string): SqlSafetyCheckResult {
  return {
    passed: false,
    level: "blocked",
    reasons,
    normalizedSql,
    detectedTables: [],
    detectedColumns: [],
  };
}
