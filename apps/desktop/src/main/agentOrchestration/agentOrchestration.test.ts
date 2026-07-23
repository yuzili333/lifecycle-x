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
    orchestrator.routing("run-1");
    orchestrator.routeCompleted("run-1", {
      taskType: "single_query",
      complexity: "L1",
      requiresKimi: false,
      requiresSql: true,
      requiresPython: false,
      requiresChart: false,
      requiresReport: false,
      ambiguities: [],
      userVisibleSummary: "执行只读查询",
      confidence: 0.99,
    }, {
      useKimi: false,
      complexity: "L1",
      profile: "fast",
      request: { enableThinking: false, stream: true, temperature: 0, maxTokens: 2_048 },
      maxAutoUpgradeBudget: 0,
      reason: "test",
    });
    orchestrator.planReady("run-1", plan);
    orchestrator.preparingStep("run-1", plan.steps[0]);
    orchestrator.waitingApproval("run-1", plan.steps[0], "tool-1");
    expect(store.get("run-1")?.status).toBe("waiting_approval");
    orchestrator.resumeAfterApproval("run-1", plan.steps[0], "tool-1");
    orchestrator.validationCompleted("run-1", plan.steps[0], true, [], "tool-1");
    orchestrator.stepCompleted("run-1", plan.steps[0], "tool-1");
    orchestrator.finish("run-1", "完成");
    const completed = store.get("run-1")!;
    expect(completed.status).toBe("completed");
    expect(emitted[0]).toBe("accepted");
    expect(completed.events[0]?.businessEventType).toBe("task.accepted");
    expect(completed.events.find((event) => event.phase === "routing_completed")?.detail?.routerLatencyMs).toEqual(expect.any(Number));
    expect(completed.events.find((event) => event.phase === "preparing_step")?.detail?.firstToolStartLatencyMs).toEqual(expect.any(Number));
    expect(completed.events.find((event) => event.phase === "step_completed")?.detail?.firstResultPreviewLatencyMs).toEqual(expect.any(Number));
    expect(completed.events.at(-1)?.detail?.totalTaskLatencyMs).toEqual(expect.any(Number));
    expect(completed.events.at(-1)?.detail?.qualityMetrics).toMatchObject({
      sqlFirstPassSuccess: true,
      sqlAutoRepairCount: 0,
      validationPassRate: 1,
      kimiInvocationCount: 0,
    });
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

  it("emits a distinct planning.started business event before planning progress", () => {
    const db = new Database(":memory:");
    const store = new SQLiteAgentProgressStore(db);
    store.migrate();
    const orchestrator = new AgentTurnOrchestrator(store, () => undefined);
    orchestrator.start({
      runId: "run-planning",
      conversationId: "conversation-1",
      messageId: "message-1",
      userId: "user-1",
      attempt: 1,
      reasoningModelName: "kimi",
      executionModelName: "qwen",
    });
    orchestrator.planning("run-planning", {
      useKimi: true,
      complexity: "L2",
      profile: "standard",
      request: { enableThinking: true, thinkingBudget: 512, stream: true, temperature: 0, maxTokens: 4_096 },
      maxAutoUpgradeBudget: 1_024,
      reason: "test",
    });
    orchestrator.planningProgress("run-planning", "正在规划数据查询");

    const planningEvents = store.get("run-planning")?.events.filter((event) => event.phase === "planning") ?? [];
    expect(planningEvents.map((event) => event.businessEventType)).toEqual(["planning.started", "planning.progress"]);
    db.close();
  });
});
