import { describe, expect, it } from "vitest";
import { buildOverallRiskDistributionMarkdown, inferReportTitle, isReportGenerationContent, shouldAutoStartPythonReport, shouldRouteSkillThroughModel, shouldStartOverallRiskWorkflowAfterModelText } from "./assistantRuntime";

describe("AssistantRuntime workflow intent", () => {
  it("starts Python report flow for one-shot SQL, chart, and report requests", () => {
    expect(
      shouldAutoStartPythonReport(
        "查询各分行“accounting_org_name”下存在最近风险等级“latest_risk_class”为“不良”的全字段数据，再根据查询到的数据统计最近风险结果“latest_risk_result”为“0300--次级”总计数量，按总计数量倒序排序后渲染成柱状图放入到报告中。",
      ),
    ).toBe(true);
  });

  it("does not start Python report flow for plain data lookup requests", () => {
    expect(shouldAutoStartPythonReport("查询最近风险等级为不良的前 20 条明细数据。")).toBe(false);
  });

  it("routes selected overall risk skill through model orchestration instead of local history fallback", () => {
    expect(shouldRouteSkillThroughModel("overall-risk-classification-distribution")).toBe(true);
    expect(shouldRouteSkillThroughModel(null)).toBe(false);
  });

  it("starts governed overall risk workflow when the model only acknowledges a new selected-data report request", () => {
    expect(
      shouldStartOverallRiskWorkflowAfterModelText(
        {
          skill: "overall-risk-classification-distribution",
          prompt: "据选择的数据源生成一份整体风险分类分布报告",
        },
        "我将基于当前已确认的数据集为您重新生成“整体风险分类分布”报告。首先查询所需的明细字段，交由 Python 统一计算。",
      ),
    ).toBe(true);
  });

  it("keeps selected overall risk report requests on the governed workflow even if model text contains SQL", () => {
    expect(
      shouldStartOverallRiskWorkflowAfterModelText(
        {
          skill: "overall-risk-classification-distribution",
          prompt: "据选择的数据源生成一份整体风险分类分布报告",
        },
        "```sql\nselect loan_balance_10k, contract_amount_10k from selected_source\n```",
      ),
    ).toBe(true);
  });

  it("does not start overall risk workflow for explicit historical report reuse", () => {
    expect(
      shouldStartOverallRiskWorkflowAfterModelText(
        {
          skill: "overall-risk-classification-distribution",
          prompt: "查看上一轮整体风险分类分布报告版本",
        },
        "我将打开已有报告版本。",
      ),
    ).toBe(false);
  });
});

describe("AssistantRuntime report artifact helpers", () => {
  it("detects markdown report content and infers stable report titles", () => {
    const content = "# 不良贷款分析报告\n\n## 分析结论\n杭州分行占比较高。";

    expect(isReportGenerationContent("查询不良贷款并输出分析报告。", content)).toBe(true);
    expect(isReportGenerationContent("只查询明细。", "查询结果如下。")).toBe(false);
    expect(inferReportTitle(content)).toBe("不良贷款分析报告");
  });

  it("builds overall risk distribution report with count and amount metrics", () => {
    const markdown = buildOverallRiskDistributionMarkdown(
      [
        { contract_id: "c1", 五级分类: "正常3", 十二级分类: "正常3", 贷款余额: 100 },
        { contract_id: "c2", 五级分类: "关注", 十二级分类: "关注1", 贷款余额: 50 },
        { contract_id: "c3", 五级分类: "次级", 十二级分类: "次级", 贷款余额: 25 },
      ],
      { dataSourceLabel: "测试数据源 / CSV", version: 1, generatedAt: "2026-07-15 10:00:00" },
    );

    expect(markdown).toContain("整体风险分类分布报告 v1");
    expect(markdown).toContain("- 数据源：测试数据源");
    expect(markdown).toContain("- 生成时间：2026-07-15 10:00:00");
    expect(markdown).not.toContain("用户选择数据源");
    expect(markdown).toContain("| 风险分类 | 笔数 | 笔数占比 | 贷款余额(万元) | 金额占比 |");
    expect(markdown).toContain("| 关注 | 1 | 33.33% | 50 | 28.57% |");
    expect(markdown).toContain("贷款余额(万元)合计");
    expect(markdown).toContain("不良率：33.33%（笔数），14.29%（金额）");
    expect(markdown).toContain("正常3+关注风险边界：66.67%（笔数），85.71%（金额）");
    expect(markdown).toContain("### 5.1 【笔数维度】");
    expect(markdown).toContain("### 5.2 【金额维度】");
    expect(markdown).toContain("### 5.3 【正常类维度】");
  });

  it("prefers latest_risk over risk classified date columns for risk distribution", () => {
    const markdown = buildOverallRiskDistributionMarkdown(
      [
        { contract_id: "c1", latest_risk_classified_at: "2025-12-12 17:32:40", latest_risk: "正常", loan_balance_10k: 100 },
        { contract_id: "c2", latest_risk_classified_at: "2025-12-13 09:10:11", latest_risk: "不良", loan_balance_10k: 50 },
      ],
      { dataSourceLabel: "测试数据源", version: 1 },
    );

    expect(markdown).toContain("| 正常 | 1 | 50.00% | 100 | 66.67% |");
    expect(markdown).toContain("| 不良 | 1 | 50.00% | 50 | 33.33% |");
    expect(markdown).not.toContain("| 2025-12-12");
  });

  it("recognizes latest_risk_result as the twelve-level classification field", () => {
    const markdown = buildOverallRiskDistributionMarkdown(
      [
        { contract_serial: "c1", latest_risk: "正常", latest_risk_result: "0103--正常3", loan_balance_10k: 100 },
        { contract_serial: "c2", latest_risk: "关注", latest_risk_result: "0201--关注1", loan_balance_10k: 50 },
      ],
      { dataSourceLabel: "测试数据源", version: 1 },
    );

    expect(markdown).toContain("十二级分类字段：latest_risk_result");
    expect(markdown).toContain("| 正常3 | 1 | 50.00% | 100 | 66.67% |");
    expect(markdown).toContain("| 关注1 | 1 | 50.00% | 50 | 33.33% |");
    expect(markdown).toContain("正常类维度口径为十二级分类 latest_risk_result 中含“正常1”“正常2”“正常3”的数据");
    expect(markdown).toContain("正常类总计 1 笔");
    expect(markdown).not.toContain("未识别十二级分类字段");
  });
});
