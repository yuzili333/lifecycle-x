import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compileSkillAnalysisRecipe } from "./SkillAnalysisRecipe";

const recipe = {
  kind: "grouped-risk-distribution-v1",
  fieldRoles: {
    group: { candidates: ["主要担保方式名称"] },
    risk: { candidates: ["最新风险五级分类"] },
    amount: { candidates: ["贷款余额", "贷款余额(万元)"] },
    recordId: { candidates: ["合同流水号"] },
  },
  groupOrder: ["保证", "信用", "其他", "抵押", "质押"],
  groupRules: [
    { label: "质押", keywords: ["保证金"] },
    { label: "抵押", keywords: ["抵押"] },
    { label: "质押", keywords: ["质押"] },
    { label: "保证", keywords: ["保证", "担保"] },
    { label: "信用", keywords: ["信用"] },
  ],
  riskRules: {
    normal: ["正常"],
    attention: ["关注"],
    nonperforming: ["不良", "次级", "可疑", "损失"],
  },
  output: {
    distributionKey: "guaranteeMethodDistribution",
    groupLabelKey: "guaranteeMethod",
    specialMetrics: [{
      key: "professionalGuaranteeNonperformingCount",
      groupSourceContains: "专业担保公司保证",
      risk: "nonperforming",
    }],
  },
};

const overallRiskRecipe = {
  kind: "overall-risk-distribution-v1",
  fieldRoles: {
    fiveLevelClassification: { candidates: ["最新风险五级分类"] },
    riskClassificationResult: { candidates: ["最新风险分类结果"] },
    loanBalance: { candidates: ["贷款余额", "贷款余额(万元)"] },
    contractAmount: { candidates: ["合同金额", "合同金额(万元)"] },
    contractSerial: { candidates: ["合同流水号"] },
  },
  categoryOrder: ["正常", "关注", "次级", "可疑", "损失"],
};

describe("Skill analysis recipe compiler", () => {
  it("compiles real fields into a bounded executable Python aggregation", () => {
    const compiled = compileSkillAnalysisRecipe({
      recipe,
      availableFields: ["主要担保方式名称", "最新风险五级分类", "贷款余额(万元)", "合同流水号"],
      dataSourceName: "loan-sample.csv",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.fieldBindings).toEqual({
      group: "主要担保方式名称",
      risk: "最新风险五级分类",
      amount: "贷款余额(万元)",
      recordId: "合同流水号",
    });
    expect(compiled.value.script.length).toBeLessThan(12_000);
    const rows = [
      { "主要担保方式名称": "01--一般保证", "最新风险五级分类": "正常", "贷款余额(万元)": "100", "合同流水号": "C1" },
      { "主要担保方式名称": "02--信用", "最新风险五级分类": "关注", "贷款余额(万元)": "200", "合同流水号": "C2" },
      { "主要担保方式名称": "03--专业担保公司保证", "最新风险五级分类": "损失", "贷款余额(万元)": "300", "合同流水号": "C3" },
      { "主要担保方式名称": "04--保证金质押", "最新风险五级分类": "正常", "贷款余额(万元)": "400", "合同流水号": "C4" },
      { "主要担保方式名称": "04--保证金质押", "最新风险五级分类": "正常", "贷款余额(万元)": "400", "合同流水号": "C4" },
    ];
    const stdout = execFileSync("python3", ["-I", "-S", "-c", compiled.value.script], {
      input: JSON.stringify(rows),
      encoding: "utf8",
    });
    const result = JSON.parse(stdout) as Record<string, any>;
    expect(result).toMatchObject({
      dataSourceName: "loan-sample.csv",
      sourceRowCount: 5,
      countBasis: "contract_serial",
      analyzedRecordCount: 4,
      professionalGuaranteeNonperformingCount: 1,
      validation: {
        categorySetReconciled: true,
        countReconciled: true,
        amountReconciled: true,
      },
    });
    expect(result.overall.counts.total).toBe(4);
    expect(result.overall.amounts.total).toBe(1_000);
    expect(result.guaranteeMethodDistribution.map((row: any) => row.guaranteeMethod)).toEqual([
      "保证", "信用", "其他", "抵押", "质押",
    ]);
  });

  it("rejects ambiguous amount fields instead of falling back to model-generated code", () => {
    const compiled = compileSkillAnalysisRecipe({
      recipe,
      availableFields: ["主要担保方式名称", "最新风险五级分类", "贷款余额(万元)", "贷款余额（万元）", "合同流水号"],
      dataSourceName: "loan-sample.csv",
    });
    expect(compiled).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining("多个精确候选"),
    }));
  });

  it("uses a user-selected real field to resolve otherwise ambiguous amount candidates", () => {
    const compiled = compileSkillAnalysisRecipe({
      recipe,
      availableFields: ["主要担保方式名称", "最新风险五级分类", "贷款余额(万元)", "贷款余额（万元）", "合同流水号"],
      selectedFieldNames: ["贷款余额（万元）"],
      dataSourceName: "loan-sample.csv",
    });
    expect(compiled).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({
        fieldBindings: expect.objectContaining({ amount: "贷款余额（万元）" }),
      }),
    }));
  });

  it("compiles the overall risk Skill into one schema-ready JSON result", () => {
    const compiled = compileSkillAnalysisRecipe({
      recipe: overallRiskRecipe,
      availableFields: ["最新风险五级分类", "贷款余额(万元)", "合同流水号"],
      selectedFieldNames: ["最新风险五级分类", "贷款余额(万元)", "合同流水号"],
      dataSourceName: "信贷风险.csv",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.fieldBindings).toEqual({
      fiveLevelClassification: "最新风险五级分类",
      riskClassificationResult: null,
      loanBalance: "贷款余额(万元)",
      contractAmount: null,
      contractSerial: "合同流水号",
    });
    expect(compiled.value.script).toMatch(/^# cycle-probe:skill-analysis-recipe-v1\n# recipe-kind: overall-risk-distribution-v1/);
    expect(compiled.value.script.length).toBeLessThan(12_000);
    const rows = [
      { "最新风险五级分类": "正常", "贷款余额(万元)": "100.5", "合同流水号": "C1" },
      { "最新风险五级分类": "正常", "贷款余额(万元)": "100.5", "合同流水号": "C1" },
      { "最新风险五级分类": "关注", "贷款余额(万元)": "200", "合同流水号": "C2" },
      { "最新风险五级分类": "0300--次级", "贷款余额(万元)": "300", "合同流水号": "C3" },
      { "最新风险五级分类": "", "贷款余额(万元)": "999", "合同流水号": "C4" },
    ];
    const stdout = execFileSync("python3", ["-I", "-S", "-c", compiled.value.script], {
      input: JSON.stringify(rows),
      encoding: "utf8",
    });
    const result = JSON.parse(stdout) as Record<string, any>;
    expect(result).toMatchObject({
      dataSourceName: "信贷风险.csv",
      sourceFields: {
        fiveLevelClassification: "最新风险五级分类",
        riskClassificationResult: null,
        loanBalance: "贷款余额(万元)",
        loanBalanceUnit: "万元",
        contractAmount: null,
        contractAmountUnit: null,
        contractSerial: "合同流水号",
      },
      countBasis: "contract_serial",
      countBasisField: "合同流水号",
      fallbackCode: null,
      analyzedRecordCount: 3,
      excludedRecordCount: 1,
      totals: { count: 3, loanBalance: 600.5, contractAmount: null },
      validation: {
        countReconciled: true,
        loanBalanceReconciled: true,
        contractAmountReconciled: true,
      },
    });
    expect(result.fiveLevelDistribution.map((item: any) => item.category)).toEqual(["正常", "关注", "次级", "可疑", "损失"]);
    expect(result.nonperformingSummary).toMatchObject({ category: "不良类", count: 1, loanBalance: 300 });
    expect(result.riskResultDistribution).toEqual([]);
  });

  it("falls back to valid rows when overall risk contract serials conflict", () => {
    const compiled = compileSkillAnalysisRecipe({
      recipe: overallRiskRecipe,
      availableFields: ["最新风险五级分类", "贷款余额(万元)", "合同流水号"],
      dataSourceName: "信贷风险.csv",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const stdout = execFileSync("python3", ["-I", "-S", "-c", compiled.value.script], {
      input: JSON.stringify([
        { "最新风险五级分类": "正常", "贷款余额(万元)": "100", "合同流水号": "C1" },
        { "最新风险五级分类": "关注", "贷款余额(万元)": "200", "合同流水号": "C1" },
      ]),
      encoding: "utf8",
    });
    expect(JSON.parse(stdout)).toMatchObject({
      countBasis: "valid_rows",
      countBasisField: null,
      fallbackCode: "conflicting_contract_records",
      analyzedRecordCount: 2,
      totals: { count: 2, loanBalance: 300 },
    });
  });
});
