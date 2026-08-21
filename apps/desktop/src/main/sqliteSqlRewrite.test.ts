import { describe, expect, it } from "vitest";
import {
  hasTopLevelCompoundOperator,
  quoteKnownIdentifiersForSqlite,
  rewriteCompoundOrderByForSqlite,
  rewriteTopLevelAliasSourceForSqlite,
  sqliteSqlStructureIssue,
  sqlReferencesIdentifier,
} from "./sqliteSqlRewrite";

describe("sqlite SQL rewrite", () => {
  it("rewrites compound queries with a top-level order by expression", () => {
    const sql = `WITH bad_loans AS (
      SELECT * FROM loan_contracts_1000 WHERE latest_risk_class = '不良'
    )
    SELECT '分行占比' AS analysis_type, accounting_org_name AS dimension_value, COUNT(*) AS record_count
    FROM bad_loans
    GROUP BY accounting_org_name
    UNION ALL
    SELECT '总计' AS analysis_type, '不良数据总数' AS dimension_value, COUNT(*) AS record_count
    FROM bad_loans
    ORDER BY CASE analysis_type WHEN '总计' THEN 0 ELSE 1 END, record_count DESC;`;

    expect(rewriteCompoundOrderByForSqlite(sql)).toBe(`select * from (WITH bad_loans AS (
      SELECT * FROM loan_contracts_1000 WHERE latest_risk_class = '不良'
    )
    SELECT '分行占比' AS analysis_type, accounting_org_name AS dimension_value, COUNT(*) AS record_count
    FROM bad_loans
    GROUP BY accounting_org_name
    UNION ALL
    SELECT '总计' AS analysis_type, '不良数据总数' AS dimension_value, COUNT(*) AS record_count
    FROM bad_loans) as cycle_probe_compound_order ORDER BY CASE analysis_type WHEN '总计' THEN 0 ELSE 1 END, record_count DESC`);
  });

  it("does not rewrite simple selects", () => {
    expect(rewriteCompoundOrderByForSqlite("select id, name from users order by name")).toBeNull();
  });

  it("does not treat nested unions as top-level compound operators", () => {
    const sql = "select * from (select 1 as id union all select 2 as id) nested order by id";

    expect(hasTopLevelCompoundOperator(sql)).toBe(false);
    expect(rewriteCompoundOrderByForSqlite(sql)).toBeNull();
  });

  it("ignores keywords inside strings and comments", () => {
    const sql = `select 'union all order by' as label
      -- union all select 2
      from sample
      order by label`;

    expect(hasTopLevelCompoundOperator(sql)).toBe(false);
    expect(rewriteCompoundOrderByForSqlite(sql)).toBeNull();
  });

  it("quotes known CSV identifiers without touching literals, comments or existing quotes", () => {
    const sql = `SELECT T1.贷款余额(万元), T1.合同流水号, '贷款余额(万元)' AS label
      FROM chat_csv_abc T1
      WHERE T1."主要担保方式名称" = '抵押' -- 贷款余额(万元)`;

    expect(quoteKnownIdentifiersForSqlite(sql, [
      "chat_csv_abc",
      "贷款余额(万元)",
      "合同流水号",
      "主要担保方式名称",
    ])).toBe(`SELECT T1."贷款余额(万元)", T1."合同流水号", '贷款余额(万元)' AS label
      FROM "chat_csv_abc" T1
      WHERE T1."主要担保方式名称" = '抵押' -- 贷款余额(万元)`);
  });

  it("rejects empty or unterminated quoted identifiers before SQLite execution", () => {
    expect(sqliteSqlStructureIssue("SELECT T1.``")).toBe("SQL 包含空字段名或空表名。");
    expect(sqliteSqlStructureIssue('SELECT T1.""')).toBe("SQL 包含空字段名或空表名。");
    expect(sqliteSqlStructureIssue("SELECT T1.[]")).toBe("SQL 包含空字段名或空表名。");
    expect(sqliteSqlStructureIssue('SELECT "" AS blank FROM loans')).toBeNull();
    expect(sqliteSqlStructureIssue('SELECT * FROM loans WHERE COALESCE("备注", "") = ""')).toBeNull();
    expect(sqliteSqlStructureIssue('SELECT * FROM ""')).toBe("SQL 包含空字段名或空表名。");
    expect(sqliteSqlStructureIssue('SELECT T1."贷款余额(万元) FROM loans T1')).toBe("SQL 包含未闭合的标识符引号。");
    expect(sqliteSqlStructureIssue('SELECT T1."贷款余额(万元)" FROM "loans" T1')).toBeNull();
  });

  it("finds actual SQL identifier references but ignores literals and comments", () => {
    const tableName = "chat_csv_abc";

    expect(sqlReferencesIdentifier('SELECT * FROM "chat_csv_abc"', tableName)).toBe(true);
    expect(sqlReferencesIdentifier("SELECT * FROM chat_csv_abc", tableName)).toBe(true);
    expect(sqlReferencesIdentifier("SELECT 'chat_csv_abc' AS label", tableName)).toBe(false);
    expect(sqlReferencesIdentifier("SELECT 1 -- chat_csv_abc", tableName)).toBe(false);
    expect(sqlReferencesIdentifier("SELECT * FROM chat_csv_abcdef", tableName)).toBe(false);
  });

  it("rewrites a top-level T1 alias used as the sole source to the verified table", () => {
    expect(rewriteTopLevelAliasSourceForSqlite(
      'SELECT T1."风险等级" FROM T1 WHERE T1."风险等级" = \'关注\';',
      "T1",
      "chat_csv_conversation_1",
    )).toBe('SELECT T1."风险等级" FROM "chat_csv_conversation_1" AS T1 WHERE T1."风险等级" = \'关注\';');
    expect(rewriteTopLevelAliasSourceForSqlite(
      "SELECT * FROM T1;",
      "T1",
      "chat_csv_conversation_1",
    )).toBe('SELECT * FROM "chat_csv_conversation_1" AS T1;');
  });

  it("does not rewrite unknown, quoted, nested, or already-aliased sources", () => {
    expect(rewriteTopLevelAliasSourceForSqlite("SELECT * FROM other_table", "T1", "chat_csv_1")).toBeNull();
    expect(rewriteTopLevelAliasSourceForSqlite('SELECT * FROM "T1"', "T1", "chat_csv_1")).toBeNull();
    expect(rewriteTopLevelAliasSourceForSqlite("SELECT * FROM (SELECT * FROM T1)", "T1", "chat_csv_1")).toBeNull();
    expect(rewriteTopLevelAliasSourceForSqlite("SELECT * FROM T1 AS source", "T1", "chat_csv_1")).toBeNull();
  });
});
