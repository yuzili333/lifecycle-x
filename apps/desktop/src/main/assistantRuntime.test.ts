import { describe, expect, it } from "vitest";
import { buildOverallRiskDistributionMarkdown, inferReportTitle, isReportGenerationContent, shouldAutoStartPythonReport } from "./assistantRuntime";

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
      { dataSourceLabel: "测试数据源", version: 1 },
    );

    expect(markdown).toContain("整体风险分类分布报告 v1");
    expect(markdown).toContain("| 关注 | 1 | 33.33% | 50 | 28.57% |");
    expect(markdown).toContain("不良率：33.33%（笔数），14.29%（金额）");
    expect(markdown).toContain("正常3+关注风险边界：66.67%（笔数），85.71%（金额）");
  });
});
