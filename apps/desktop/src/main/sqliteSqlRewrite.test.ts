import { describe, expect, it } from "vitest";
import { hasTopLevelCompoundOperator, rewriteCompoundOrderByForSqlite } from "./sqliteSqlRewrite";

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
});
