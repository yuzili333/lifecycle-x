import { describe, expect, it, vi } from "vitest";
import {
  AnalysisPlanningAdapter,
  analysisPlanToPlannerDecision,
  buildAnalysisPlanSystemPrompt,
  compressReasoningContext,
  conservativeTaskRoute,
  executionToolSchema,
  extractPartialJsonStringField,
  isOptimizationEnabledForScope,
  parseAnalysisPlanContent,
  resolveThinkingOptimizationConfig,
  routeToPlannerDecision,
  thinkingDecisionForComplexity,
  toAgentBusinessEvent,
  upgradeThinkingDecision,
  validateAgentBusinessEvent,
  validateTaskRoute,
  type AgentProgressEvent,
} from ".";

describe("thinking optimization", () => {
  it("gives the planning model the exact nested AnalysisPlan contract", () => {
    const prompt = buildAnalysisPlanSystemPrompt();

    expect(prompt).toContain('"businessDefinitions":[{"metric":"指标名","definition":"口径定义"');
    expect(prompt).toContain('"requiredData":[{"source":"可选来源","table":"真实表或数据集名称","fields":["真实字段名"],"purpose":"用途"}]');
    expect(prompt).toContain('"validationRules":[{"id":"rule_1","description":"校验说明","severity":"error"}]');
    expect(prompt).toContain("所有数组字段都必须存在");
    expect(prompt).toContain("多个候选数据集且用户未指定时默认选择最近更新的数据集");
  });

  it.each([
    ["查看表结构", "L0", false],
    ["查询贷款余额最高的 10 条数据", "L1", false],
    ["查询后分析占比并生成图表", "L2", true],
    ["分析结果异常的根因并交叉验证", "L3", true],
    ["对跨机构风险迁徙做深度分析", "L4", true],
  ] as const)("routes %s as %s", (prompt, complexity, requiresKimi) => {
    const route = conservativeTaskRoute(prompt);
    expect(route.complexity).toBe(complexity);
    expect(route.requiresKimi).toBe(requiresKimi);
    expect(validateTaskRoute(route)).toEqual({ valid: true, route });
  });

  it("selects bounded Kimi profiles for L0-L4 and keeps Qwen-only tasks out of Kimi", () => {
    const config = resolveThinkingOptimizationConfig({}, {});
    expect(thinkingDecisionForComplexity("L0", config)).toMatchObject({ useKimi: false, profile: "fast" });
    expect(thinkingDecisionForComplexity("L1", config)).toMatchObject({ useKimi: false, profile: "fast" });
    expect(thinkingDecisionForComplexity("L2", config)).toMatchObject({
      useKimi: true,
      profile: "standard",
      request: { enableThinking: true, thinkingBudget: 512 },
    });
    expect(thinkingDecisionForComplexity("L3", config)).toMatchObject({
      useKimi: true,
      profile: "analytical",
      request: { thinkingBudget: 1_024 },
      maxAutoUpgradeBudget: 2_048,
    });
    expect(thinkingDecisionForComplexity("L4", config)).toMatchObject({
      useKimi: true,
      profile: "deep",
      request: { thinkingBudget: 4_096 },
    });
  });

  it("enforces environment validation, hard budget caps and deterministic rollout", () => {
    const config = resolveThinkingOptimizationConfig({}, {
      CYCLE_PROBE_MAX_THINKING_BUDGET: "1024",
      CYCLE_PROBE_MAX_CUMULATIVE_THINKING_BUDGET: "2048",
      CYCLE_PROBE_MAX_KIMI_CALLS_PER_TASK: "1",
      CYCLE_PROBE_THINKING_ROLLOUT_PERCENTAGE: "25",
      CYCLE_PROBE_RAW_REASONING_VISIBLE: "true",
    });
    expect(config.maxThinkingBudget).toBe(1_024);
    expect(config.maxCumulativeThinkingBudget).toBe(2_048);
    expect(config.maxKimiCallsPerTask).toBe(1);
    expect(config.rawReasoningVisible).toBe(false);
    expect(thinkingDecisionForComplexity("L4", config).request.thinkingBudget).toBe(1_024);
    const scope = { userId: "u1", conversationId: "c1", taskId: "t1" };
    expect(isOptimizationEnabledForScope(config, scope)).toBe(isOptimizationEnabledForScope(config, scope));
  });

  it("upgrades budgets only for controlled signals and never exceeds the configured ceiling", () => {
    const config = resolveThinkingOptimizationConfig({}, {
      CYCLE_PROBE_MAX_THINKING_BUDGET: "2048",
      CYCLE_PROBE_MAX_CUMULATIVE_THINKING_BUDGET: "2048",
    });
    const standard = thinkingDecisionForComplexity("L2", config);
    expect(upgradeThinkingDecision(standard, config, { tableCount: 3 }).request.thinkingBudget).toBe(1_024);
    const analytical = thinkingDecisionForComplexity("L3", config);
    expect(upgradeThinkingDecision(analytical, config, { resultConflict: true, toolCallCount: 4 }).request.thinkingBudget).toBe(2_048);
    expect(upgradeThinkingDecision(analytical, config, { crossPeriodAttribution: true }).request.thinkingBudget).toBe(2_048);
    expect(upgradeThinkingDecision(analytical, config, { firstDiagnosisUnresolved: true }).request.thinkingBudget).toBe(2_048);
  });

  it("validates AnalysisPlan JSON and maps stable tool steps to the existing state machine", () => {
    const validation = parseAnalysisPlanContent(JSON.stringify({
      goal: "分析分行风险分布并生成报告",
      businessDefinitions: [{ metric: "关注率", definition: "关注类合同数/合同总数" }],
      requiredData: [{ table: "loan_contracts", fields: ["branch_name", "latest_risk"], purpose: "分组统计" }],
      steps: [
        { id: "read-data", type: "sql", purpose: "查询明细" },
        { id: "analyze", type: "python", purpose: "计算占比", dependsOn: ["read-data"] },
        { id: "validate", type: "validation", purpose: "校验合计", dependsOn: ["analyze"] },
        { id: "report", type: "report", purpose: "生成报告", dependsOn: ["validate"] },
      ],
      validationRules: [{ id: "sum", description: "分类合计等于样本总数", severity: "error" }],
      reportOutline: ["分析结论"],
      assumptions: [],
      unresolvedAmbiguities: [],
    }));
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;
    const decision = analysisPlanToPlannerDecision(validation.plan);
    expect(decision.steps.map((step) => step.stepId)).toEqual(["read-data", "analyze", "report"]);
    expect(decision.steps.at(-1)?.dependencies).toEqual(["analyze"]);
  });

  it("rejects a second SQL step used in place of Python derived analysis", () => {
    const validation = parseAnalysisPlanContent(JSON.stringify({
      goal: "查询数据、计算占比并生成图表报告",
      businessDefinitions: [{ metric: "风险占比", definition: "风险合同数除以行业合同总数" }],
      requiredData: [{ table: "risk_data", fields: ["industry", "risk_level"], purpose: "读取分析明细" }],
      steps: [
        { id: "query", type: "sql", purpose: "筛选所需明细" },
        { id: "ratio", type: "sql", purpose: "计算各行业风险占比", dependsOn: ["query"] },
        { id: "chart", type: "chart", purpose: "绘制占比图表", dependsOn: ["ratio"] },
        { id: "report", type: "report", purpose: "生成报告", dependsOn: ["chart"] },
      ],
      validationRules: [],
      reportOutline: [],
      assumptions: [],
      unresolvedAmbiguities: [],
    }));

    expect(validation.valid).toBe(false);
    if (validation.valid) return;
    expect(validation.errors).toContain(
      "查询后需要统计、占比或派生指标并生成图表/报告时，必须使用 python 步骤完成计算，不能用第二个 sql 步骤替代。",
    );
    expect(validation.errors).toContain("步骤 ratio 是依赖上游结果的统计计算，应使用 python 类型而不是 sql。");
  });

  it("builds a minimal Qwen plan for simple routes", () => {
    const route = conservativeTaskRoute("查询贷款余额最高的 10 条数据");
    const decision = routeToPlannerDecision(route);
    expect(decision.steps).toHaveLength(1);
    expect(decision.steps[0]).toMatchObject({ toolKind: "sql_query", dependencies: [] });
  });

  it("compresses reasoning context by priority and reports omitted sections", () => {
    const compressed = compressReasoningContext([
      { name: "constraints", priority: 100, content: "只读约束".repeat(20) },
      { name: "fields", priority: 90, content: "字段映射".repeat(20) },
      { name: "history", priority: 1, content: "无关历史".repeat(2_000) },
    ], 200);
    expect(compressed.estimatedTokens).toBeLessThanOrEqual(200);
    expect(compressed.includedSections).toContain("constraints");
    expect(compressed.omittedSections).toContain("history");
    expect(compressed.truncated).toBe(true);
  });

  it("maps persisted progress to validated provider-independent business events", () => {
    const progress: AgentProgressEvent = {
      eventId: "event-1",
      runId: "task-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      phase: "accepted",
      status: "running",
      summary: "已接收分析任务",
      createdAt: "2026-07-23T00:00:00.000Z",
    };
    const event = toAgentBusinessEvent(progress);
    expect(event.type).toBe("task.accepted");
    expect(validateAgentBusinessEvent(event)).toBe(true);
  });

  it("extracts only Markdown deltas from streamed report tool arguments", () => {
    const partial = '{"userRequest":"生成报告","markdown":"# 报告\\n第一';
    expect(extractPartialJsonStringField(partial, "markdown")).toBe("# 报告\n第一");
  });

  it("distinguishes sustained reasoning overrun from a first-event timeout", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"正在分析"}}]}\n\n'));
        const abort = () => controller.error(new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } })));
    const adapter = new AnalysisPlanningAdapter({
      providerName: "siliconflow",
      baseURL: "https://example.local/v1",
      apiKey: "test-key",
      model: "kimi-model",
      timeoutMs: 20,
      firstEventTimeoutMs: 1_000,
      requestOptions: { enableThinking: true, thinkingBudget: 512, stream: true, temperature: 0, maxTokens: 4_096 },
    });

    const output = await adapter.plan({
      conversationId: "conversation-1",
      messageId: "message-1",
      messages: [{
        id: "user-1",
        role: "user",
        content: "分析风险",
        createdAt: new Date().toISOString(),
      }],
    });
    vi.unstubAllGlobals();

    expect(output.reasoningObserved).toBe(true);
    expect(output.errorCode).toBe("PROVIDER_TIMEOUT");
  });

  it("keeps execution-model schemas compact and leaves known context to the client", () => {
    const sql = executionToolSchema("sql_query");
    const python = executionToolSchema("python_analysis");
    const chart = executionToolSchema("chart_rendering");
    const report = executionToolSchema("report_generation");

    expect(sql.required).toEqual(["sql"]);
    expect(python.required).toEqual(["script"]);
    expect(chart.required).toEqual(["title", "chartType", "dimensionFields", "measureFields"]);
    expect(chart.properties).not.toHaveProperty("visualizationSpec");
    expect(report.required).toEqual(["title", "markdown"]);
    for (const schema of [sql, python, chart, report]) {
      expect(schema.properties).not.toHaveProperty("userRequest");
      expect(schema.properties).not.toHaveProperty("purpose");
      expect(schema.additionalProperties).toBe(false);
    }
  });
});
