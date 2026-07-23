import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { AgentTurnOrchestrator, SQLiteAgentProgressStore, currentDurations } from "./index";
import { validatePlannerDecision } from "./planner";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

describe("dual-model agent orchestration", () => {
  it("accepts a dependency-ordered plan without executable parameters", () => {
    const result = validatePlannerDecision({
      outcome: "execute",
      summary: "先查询，再分析并绘图。",
      requestedOutputs: ["query", "analysis", "chart"],
      steps: [
        { stepId: "query", toolKind: "sql_query", purpose: "查询明细", dependencies: [], inputResolution: "selected_data_source", expectedOutput: "数据集" },
        { stepId: "analysis", toolKind: "python_analysis", purpose: "计算占比", dependencies: ["query"], inputResolution: "current_run", expectedOutput: "分析结果" },
        { stepId: "chart", toolKind: "chart_rendering", purpose: "绘制图表", dependencies: ["analysis"], inputResolution: "current_run", expectedOutput: "图表" },
      ],
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.decision.steps.map((step) => step.toolKind)).toEqual(["sql_query", "python_analysis", "chart_rendering"]);
  });

  it("rejects scripts, missing explicit output tools and dependency cycles", () => {
    const result = validatePlannerDecision({
      outcome: "execute",
      summary: "非法计划",
      requestedOutputs: ["chart"],
      steps: [
        { stepId: "a", toolKind: "sql_query", purpose: "查询", dependencies: ["b"], inputResolution: "selected_data_source", expectedOutput: "数据", sql: "select 1" },
        { stepId: "b", toolKind: "python_analysis", purpose: "分析", dependencies: ["a"], inputResolution: "current_run", expectedOutput: "结果" },
      ],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.join(" ")).toContain("不得包含脚本");
      expect(result.errors.join(" ")).toContain("循环依赖");
      expect(result.errors.join(" ")).toContain("缺少 chart_rendering");
    }
  });

  it("persists progress, pauses active timing for approval and completes the same run", () => {
    const db = new Database(":memory:");
    const store = new SQLiteAgentProgressStore(db);
    store.migrate();
    const emitted: string[] = [];
    const orchestrator = new AgentTurnOrchestrator(store, (event) => emitted.push(event.phase));
    orchestrator.start({
      runId: "run-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      userId: "user-1",
      attempt: 1,
      reasoningModelName: "reasoning",
      executionModelName: "execution",
    });
    const plan = {
      outcome: "execute" as const,
      summary: "执行查询",
      requestedOutputs: ["query" as const],
      steps: [{ stepId: "query", toolKind: "sql_query" as const, purpose: "查询", dependencies: [], inputResolution: "selected_data_source" as const, expectedOutput: "数据集" }],
    };
    orchestrator.planReady("run-1", plan);
    orchestrator.preparingStep("run-1", plan.steps[0]);
    orchestrator.waitingApproval("run-1", plan.steps[0], "tool-1");
    expect(store.get("run-1")?.status).toBe("waiting_approval");
    orchestrator.resumeAfterApproval("run-1", plan.steps[0], "tool-1");
    orchestrator.stepCompleted("run-1", plan.steps[0], "tool-1");
    orchestrator.finish("run-1", "完成");
    const completed = store.get("run-1")!;
    expect(completed.status).toBe("completed");
    expect(completed.completedStepIds).toEqual(["query"]);
    expect(completed.events.map((event) => event.phase)).toEqual(emitted);
    expect(completed.waitingDurationMs).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it("calculates active and waiting segments independently", () => {
    const run = {
      activeDurationMs: 500,
      waitingDurationMs: 700,
      activeStartedAt: new Date(1_000).toISOString(),
      waitingStartedAt: undefined,
    } as Parameters<typeof currentDurations>[0];
    expect(currentDurations(run, 2_500)).toEqual({ activeDurationMs: 2_000, waitingDurationMs: 700 });
  });
});
