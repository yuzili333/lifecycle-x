import { describe, expect, it } from "vitest";
import { shouldAutoStartPythonReport } from "./assistantRuntime";

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
