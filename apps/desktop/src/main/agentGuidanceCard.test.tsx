import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentGuidanceCard, MissingParameterCard, NextActionCard, WorkflowRecoveryCard } from "../renderer/src/components/agent-guidance";
import type { AgentGuidance } from "./agentGuidance";

const createdAt = "2026-07-17T00:00:00.000Z";

function guidance(patch: Partial<AgentGuidance> = {}): AgentGuidance {
  return {
    guidanceId: "guidance-1",
    workflowId: "workflow-1",
    conversationId: "conversation-1",
    type: "parameter_request",
    title: "缺少分析字段",
    message: "当前缺少用于分组的风险分类字段。",
    requiredInputs: [
      {
        key: "classification_field",
        label: "分类字段",
        type: "field",
        required: true,
        description: "请选择五级分类、十二级分类或风险等级。",
        candidates: [
          { value: "risk_level", label: "风险等级", description: "loan.csv · TEXT", confidence: 0.9 },
          { value: "latest_risk", label: "最新风险分类", description: "loan.csv · TEXT", confidence: 0.8 },
        ],
      },
    ],
    actions: [
      { actionId: "action-select", type: "select_fields", label: "选择字段", primary: true },
      { actionId: "action-cancel", type: "cancel_workflow", label: "取消本轮任务", destructive: true },
    ],
    blocking: true,
    resumeToken: "resume-1",
    createdAt,
    ...patch,
  };
}

describe("AgentGuidanceCard", () => {
  it("renders missing parameter details without action buttons", () => {
    const html = renderToString(<AgentGuidanceCard guidance={guidance()} />);

    expect(html).toContain("缺少分析字段");
    expect(html).toContain("等待用户补充");
    expect(html).toContain("可恢复");
    expect(html).toContain("风险等级");
    expect(html).toContain("最新风险分类");
    expect(html).not.toContain("选择字段");
    expect(html).not.toContain("取消本轮任务");
  });

  it("reuses the base card for missing parameter, recovery, and next action cards", () => {
    const html = renderToString(
      <>
        <MissingParameterCard guidance={guidance({ type: "parameter_request", title: "工具参数需要修复" })} />
        <WorkflowRecoveryCard guidance={guidance({ type: "error_recovery", title: "工作流遇到可恢复问题" })} />
        <NextActionCard guidance={guidance({ type: "next_action", title: "数据查询完成", blocking: false, resumeToken: undefined })} />
      </>,
    );

    expect(html).toContain("工具参数需要修复");
    expect(html).toContain("工作流遇到可恢复问题");
    expect(html).toContain("数据查询完成");
    expect(html).toContain("可继续操作");
  });
});
