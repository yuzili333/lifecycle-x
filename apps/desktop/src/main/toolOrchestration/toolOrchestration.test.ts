import { describe, expect, it } from "vitest";
import {
  InMemoryArtifactManager,
  InMemoryToolResultRegistry,
  SQLiteArtifactManager,
  SQLiteToolResultRegistry,
  createToolOrchestrationModule,
  createOrchestrationToolDefinitions,
  ToolInputResolver,
  ToolExecutionEngine,
  TOOL_NAMES,
  type ToolBridgeContext,
  type ToolBridgeOutput,
  type ToolCallRecord,
  type ToolOrchestrationModuleConfig,
} from ".";

function moduleWithBridges(patch: Partial<ToolOrchestrationModuleConfig> = {}) {
  const resultRegistry = new InMemoryToolResultRegistry();
  const artifactManager = new InMemoryArtifactManager();
  const bridge = (prefix: string) => ({
    execute: async (_input: unknown, context: ToolBridgeContext): Promise<ToolBridgeOutput> => ({
      status: "completed",
      artifactIds: [`${prefix}-artifact-v${context.version}`],
      primaryArtifactId: `${prefix}-artifact-v${context.version}`,
      summary: `${prefix} v${context.version} completed`,
      metadata: { resolvedInput: context.resolvedInput },
    }),
  });
  const config: ToolOrchestrationModuleConfig = {
    resultRegistry,
    artifactManager,
    sqlBridge: bridge("sql"),
    pythonBridge: bridge("python"),
    chartBridge: bridge("chart"),
    reportBridge: bridge("report"),
    ...patch,
  };
  return { tools: createToolOrchestrationModule(config), resultRegistry, artifactManager };
}

describe("tool orchestration", () => {
  it("detects independent and combined tool intents", async () => {
    const { tools } = moduleWithBridges();

    await expect(tools.detectIntent({ conversationId: "c1", userMessage: "查询今年以来即将到期的客户" }))
      .resolves.toMatchObject({ intents: [{ toolKind: "sql_query" }] });
    await expect(tools.detectIntent({ conversationId: "c1", userMessage: "分析上一轮结果中的风险评分分布" }))
      .resolves.toMatchObject({ intents: [{ toolKind: "python_analysis" }] });
    await expect(tools.detectIntent({ conversationId: "c1", userMessage: "把刚才的数据画成横向柱状图" }))
      .resolves.toMatchObject({ intents: [{ toolKind: "chart_rendering" }] });

    const priorResultAnalysis = await tools.detectIntent({
      conversationId: "c1",
      userMessage: "根据查询数据结果汇总分行 #一级分行名称 的最新风险分类为“关注”的合同总数以及全部分行的占比。",
    });
    expect(priorResultAnalysis.intents.map((item) => item.toolKind)).toEqual(["python_analysis"]);
    await expect(tools.detectIntent({ conversationId: "c1", userMessage: "请根据分析结果生成报告" }))
      .resolves.toMatchObject({ intents: [{ toolKind: "report_generation" }] });

    const combined = await tools.detectIntent({
      conversationId: "c1",
      userMessage: "查询近 6 个月逾期客户，分析风险特征，画图并生成报告",
    });
    expect(combined.intents.map((item) => item.toolKind)).toEqual(["sql_query", "python_analysis", "chart_rendering", "report_generation"]);
    expect(combined.intents.find((item) => item.toolKind === "report_generation")?.dependsOn).toEqual(["chart_rendering"]);
  });

  it("builds dependency ordered plans without global fixed order", async () => {
    const { tools } = moduleWithBridges();
    const chartPlan = await tools.buildPlan({
      conversationId: "c2",
      userId: "u",
      userMessage: "把刚才的数据画成横向柱状图",
    });
    expect(chartPlan.steps).toHaveLength(1);
    expect(chartPlan.steps[0].toolKind).toBe("chart_rendering");
    expect(chartPlan.steps[0].dependencies).toEqual([]);

    const priorResultPlan = await tools.buildPlan({
      conversationId: "c2",
      userId: "u",
      userMessage: "根据查询数据结果汇总分行 #一级分行名称 的最新风险分类为“关注”的合同总数以及全部分行的占比。",
    });
    expect(priorResultPlan.steps).toHaveLength(1);
    expect(priorResultPlan.steps[0].toolKind).toBe("python_analysis");
    expect(priorResultPlan.steps[0].dependencies).toEqual([]);
    expect(priorResultPlan.steps[0].inputStrategy).toBe("latest_sql");

    const reportFromAnalysisPlan = await tools.buildPlan({
      conversationId: "c2",
      userId: "u",
      userMessage: "请根据分析结果生成报告",
    });
    expect(reportFromAnalysisPlan.steps).toHaveLength(1);
    expect(reportFromAnalysisPlan.steps[0].toolKind).toBe("report_generation");
    expect(reportFromAnalysisPlan.steps[0].dependencies).toEqual([]);
    expect(reportFromAnalysisPlan.steps[0].inputStrategy).toBe("latest_python");

    const fullPlan = await tools.buildPlan({
      conversationId: "c2",
      userId: "u",
      userMessage: "查询近 6 个月逾期客户，分析风险特征，画图并生成报告",
    });
    expect(() => tools.validatePlan(fullPlan)).not.toThrow();
    expect(fullPlan.steps.map((item) => item.toolKind)).toEqual(["sql_query", "python_analysis", "chart_rendering", "report_generation"]);
    expect(fullPlan.steps[1].dependencies).toEqual([fullPlan.steps[0].stepId]);
  });

  it("updates latest successful state, versions and lineage while failed calls do not overwrite", async () => {
    let failNextSql = false;
    const { tools } = moduleWithBridges({
      sqlBridge: {
        execute: async (_input, context) => {
          if (failNextSql) {
            throw new Error("sql failed");
          }
          return {
            status: "completed",
            artifactIds: [`sql-dataset-v${context.version}`],
            primaryArtifactId: `sql-dataset-v${context.version}`,
            summary: `sql v${context.version}`,
          };
        },
      },
    });

    await tools.executeSingleTool({ conversationId: "c3", userId: "u", userMessage: "查询逾期客户", toolKind: "sql_query" });
    const latestV1 = await tools.getLatestSqlResult("c3");
    expect(latestV1?.version).toBe(1);
    expect(latestV1?.outputArtifactIds).toEqual(["sql-dataset-v1"]);

    failNextSql = true;
    await tools.executeSingleTool({ conversationId: "c3", userId: "u", userMessage: "把逾期天数改成 60 天后重新查", toolKind: "sql_query" });
    const latestAfterFailure = await tools.getLatestSqlResult("c3");
    const failedV2 = (await tools.listToolCalls("c3")).find((item) => item.version === 2);
    expect(latestAfterFailure?.toolCallId).toBe(latestV1?.toolCallId);
    expect(failedV2?.status).toBe("failed");
    expect(failedV2?.metadata).toMatchObject({
      previousToolCallId: latestV1?.toolCallId,
      changedRequestKeys: ["userRequest", "purpose"],
      requestDeltaSummary: "相对上一版本调整了 userRequest, purpose。",
    });
  });

  it("resolves default inputs and explicit historical versions", async () => {
    const memoryWrites: Array<{ type: string; toolCallId?: string; artifactIds?: string[]; version?: number }> = [];
    const { tools } = moduleWithBridges({
      memoryBridge: {
        write: async (input) => {
          memoryWrites.push(input);
        },
      },
    });
    await tools.executeSingleTool({ conversationId: "c4", userId: "u", userMessage: "查询逾期客户", toolKind: "sql_query" });
    await tools.executeSingleTool({ conversationId: "c4", userId: "u", userMessage: "分析上一轮结果", toolKind: "python_analysis" });

    const chartInput = await tools.resolveToolInput({ conversationId: "c4", toolKind: "chart_rendering" });
    expect(chartInput.sourceToolKind).toBe("python_analysis");
    expect(chartInput.sourceArtifactIds).toEqual(["python-artifact-v1"]);

    await tools.executeSingleTool({ conversationId: "c4", userId: "u", userMessage: "重新查询风险客户", toolKind: "sql_query" });
    const explicit = await tools.resolveToolInput({ conversationId: "c4", toolKind: "python_analysis", explicitInputRefs: ["v1"] });
    expect(explicit.sourceToolKind).toBe("sql_query");
    expect(explicit.sourceArtifactIds).toEqual(["sql-artifact-v1"]);

    const latest = await tools.resolveToolInput({ conversationId: "c4", toolKind: "python_analysis", explicitInputRefs: ["latest"] });
    expect(latest.mode).toBe("latest_result");
    expect(latest.sourceArtifactIds).toEqual(["sql-artifact-v2"]);

    const multiArtifactReportInput = await tools.resolveToolInput({
      conversationId: "c4",
      toolKind: "report_generation",
      explicitInputRefs: ["sql-artifact-v1", "python-artifact-v1"],
    });
    expect(multiArtifactReportInput.mode).toBe("explicit");
    expect(multiArtifactReportInput.sourceArtifactIds).toEqual(["sql-artifact-v1", "python-artifact-v1"]);

    const sqlV1 = (await tools.listToolCalls("c4")).find((record) => record.toolKind === "sql_query" && record.version === 1);
    expect(sqlV1).toBeTruthy();
    await tools.selectHistoricalResult({ conversationId: "c4", toolKind: "sql_query", toolCallId: sqlV1!.toolCallId });
    expect(memoryWrites.find((item) => item.type === "sql_query_selected")).toMatchObject({
      toolCallId: sqlV1!.toolCallId,
      artifactIds: ["sql-artifact-v1"],
      version: 1,
    });
    const selectedReportInput = await tools.resolveToolInput({ conversationId: "c4", toolKind: "report_generation" });
    expect(selectedReportInput.mode).toBe("selected_result");
    expect(selectedReportInput.sourceArtifactIds).toEqual(["python-artifact-v1", "sql-artifact-v1"]);
  });

  it("executes SQL to Python to chart to report and records report artifacts", async () => {
    const { tools } = moduleWithBridges();
    const plan = await tools.buildPlan({
      conversationId: "c5",
      userId: "u",
      userMessage: "查询近 6 个月逾期客户，分析风险特征，画图并生成报告",
    });

    const result = await tools.executePlan(plan);
    expect(result.status).toBe("completed");
    expect(await tools.getLatestSqlResult("c5")).toMatchObject({ version: 1, isLatestSuccessful: true });
    expect(await tools.getLatestPythonResult("c5")).toMatchObject({ outputArtifactIds: ["python-artifact-v1"] });
    expect(await tools.getLatestChartResult("c5")).toMatchObject({ outputArtifactIds: ["chart-artifact-v1"] });
    expect(await tools.getLatestReportResult("c5")).toMatchObject({ outputArtifactIds: ["report-artifact-v1"] });
    const report = await tools.getLatestReportResult("c5");
    expect(report?.parentToolCallIds).toHaveLength(1);
    expect(report?.sourceArtifactIds).toEqual(["chart-artifact-v1"]);
  });

  it("passes model tool request fields to bridges as top-level input", async () => {
    let receivedSql: string | undefined;
    const { tools } = moduleWithBridges({
      sqlBridge: {
        execute: async (input, context) => {
          receivedSql = input.sql;
          return {
            status: "completed",
            artifactIds: [`sql-artifact-v${context.version}`],
            summary: "sql completed",
          };
        },
      },
    });

    await tools.executeSingleTool({
      conversationId: "c7",
      userId: "u",
      userMessage: "执行只读查询",
      toolKind: "sql_query",
      request: { sql: "select 1", dataSourceId: "ds_1" },
    });

    expect(receivedSql).toBe("select 1");
  });

  it("does not continue dependent steps when an upstream tool is waiting for approval", async () => {
    let pythonExecuted = false;
    let sqlBridgeCalls = 0;
    const { tools } = moduleWithBridges({
      sqlBridge: {
        execute: async (input) => {
          sqlBridgeCalls += 1;
          if ((input as { approvalStatus?: string }).approvalStatus === "approved") {
            return {
              status: "completed",
              artifactIds: ["sql-approved-artifact"],
              summary: "sql approved",
            };
          }
          return {
            status: "waiting_approval",
            artifactIds: [],
            summary: "sql waiting approval",
          };
        },
      },
      pythonBridge: {
        execute: async () => {
          pythonExecuted = true;
          return { status: "completed", artifactIds: ["python-artifact"] };
        },
      },
    });
    const plan = await tools.buildPlan({
      conversationId: "c8",
      userId: "u",
      userMessage: "查询逾期客户并分析风险特征",
    });

    const result = await tools.executePlan(plan);
    const calls = await tools.listToolCalls("c8");

    expect(result.status).toBe("waiting_approval");
    expect(pythonExecuted).toBe(false);
    const sqlCall = calls.find((call) => call.toolKind === "sql_query");
    expect(sqlCall?.status).toBe("waiting_approval");
    expect(calls.find((call) => call.toolKind === "python_analysis")?.status).toBe("blocked");

    const resumed = await tools.resolveWaitingApproval({ toolCallId: sqlCall!.toolCallId, approved: true, userId: "u" });
    expect(sqlBridgeCalls).toBe(2);
    expect(resumed).toMatchObject({
      toolCallId: sqlCall!.toolCallId,
      status: "completed",
      outputArtifactIds: ["sql-approved-artifact"],
      isLatestSuccessful: true,
    });
    expect(await tools.getLatestSqlResult("c8")).toMatchObject({
      toolCallId: sqlCall!.toolCallId,
      outputArtifactIds: ["sql-approved-artifact"],
    });
  });

  it("exports four independent model tool definitions", () => {
    const { resultRegistry, artifactManager } = moduleWithBridges();
    const engine = new ToolExecutionEngine({
      resultRegistry,
      artifactManager,
      sqlBridge: { execute: async () => ({ status: "completed", artifactIds: [], summary: "sql" }) },
      pythonBridge: { execute: async () => ({ status: "completed", artifactIds: [], summary: "python" }) },
      chartBridge: { execute: async () => ({ status: "completed", artifactIds: [], summary: "chart" }) },
      reportBridge: { execute: async () => ({ status: "completed", artifactIds: [], summary: "report" }) },
    });
    const definitions = createOrchestrationToolDefinitions({
      engine,
      conversationId: "c6",
      userId: "u",
      userMessage: "查询并分析",
    });

    expect(definitions.map((tool) => tool.name)).toEqual([
      "request_sql_query_execution",
      "request_python_analysis_execution",
      "request_chart_rendering",
      "request_markdown_report_generation",
    ]);
    expect(definitions.find((tool) => tool.name === "request_sql_query_execution")?.riskLevel).toBe("high");
    expect(definitions.every((tool) => tool.inputSchema.type === "object")).toBe(true);
  });

  it("persists tool state and artifacts across SQLite registry instances", async () => {
    const db = new FakeToolSqliteDb();
    const registry = new SQLiteToolResultRegistry(db);
    const artifacts = new SQLiteArtifactManager(db);
    const createdAt = new Date().toISOString();
    const sqlV1 = toolRecord({
      toolCallId: "sql-v1",
      toolKind: "sql_query",
      outputArtifactIds: ["dataset-v1"],
      version: 1,
      createdAt,
    });
    await registry.register(sqlV1);
    await registry.markLatestSuccessful("c-sqlite", "sql-v1");
    await artifacts.createArtifact({
      artifactId: "report-artifact-v1",
      artifactType: "report_markdown",
      contentType: "markdown",
      title: "风险报告",
      content: "# 风险报告\n\n已生成。",
      metadata: { toolCallId: "report-v1" },
    });

    const restoredRegistry = new SQLiteToolResultRegistry(db);
    const restoredArtifacts = new SQLiteArtifactManager(db);
    expect(await restoredRegistry.getLatestSuccessful("c-sqlite", "sql_query")).toMatchObject({
      toolCallId: "sql-v1",
      outputArtifactIds: ["dataset-v1"],
      isLatestSuccessful: true,
    });
    await restoredRegistry.register(toolRecord({
      toolCallId: "sql-v2",
      toolKind: "sql_query",
      outputArtifactIds: ["dataset-v2"],
      version: 2,
      createdAt: new Date(Date.parse(createdAt) + 500).toISOString(),
    }));
    await restoredRegistry.markLatestSuccessful("c-sqlite", "sql-v2");
    await restoredRegistry.selectResult("c-sqlite", "sql_query", "sql-v1");
    const selectedState = await new SQLiteToolResultRegistry(db).getConversationState("c-sqlite");
    expect(selectedState.selectedSqlToolCallId).toBe("sql-v1");
    expect(selectedState.latestSuccessfulSqlToolCallId).toBe("sql-v2");
    await expect(new ToolInputResolver(new SQLiteToolResultRegistry(db)).resolve({
      conversationId: "c-sqlite",
      toolKind: "python_analysis",
    })).resolves.toMatchObject({
      mode: "selected_result",
      sourceToolKind: "sql_query",
      sourceToolCallId: "sql-v1",
      sourceArtifactIds: ["dataset-v1"],
    });
    await restoredRegistry.register(toolRecord({
      toolCallId: "sql-v3",
      toolKind: "sql_query",
      status: "failed",
      outputArtifactIds: [],
      version: 3,
      createdAt: new Date(Date.parse(createdAt) + 1000).toISOString(),
    }));
    expect((await restoredRegistry.getLatestSuccessful("c-sqlite", "sql_query"))?.toolCallId).toBe("sql-v2");
    expect(await restoredArtifacts.getArtifact("report-artifact-v1")).toMatchObject({
      artifactId: "report-artifact-v1",
      content: "# 风险报告\n\n已生成。",
    });
  });

  it("blocks deleting upstream artifacts that are referenced by downstream lineage", async () => {
    const { tools, artifactManager } = moduleWithBridges();
    await tools.executeSingleTool({ conversationId: "c9", userId: "u", userMessage: "查询逾期客户", toolKind: "sql_query" });
    await tools.executeSingleTool({ conversationId: "c9", userId: "u", userMessage: "分析上一轮结果", toolKind: "python_analysis" });
    await artifactManager.createArtifact({
      artifactId: "sql-artifact-v1",
      artifactType: "dataset",
      contentType: "json",
      content: { rowCount: 1 },
    });
    await artifactManager.createArtifact({
      artifactId: "orphan-report",
      artifactType: "report_markdown",
      contentType: "markdown",
      content: "# Orphan",
    });

    await expect(tools.listArtifactDependencies({ conversationId: "c9", artifactId: "sql-artifact-v1" })).resolves.toMatchObject([
      {
        artifactId: "sql-artifact-v1",
        dependentToolKind: "python_analysis",
        dependentArtifactIds: ["python-artifact-v1"],
      },
    ]);
    await expect(tools.deleteArtifactSafely({ conversationId: "c9", artifactId: "sql-artifact-v1" })).rejects.toMatchObject({
      code: "TOOL_RESULT_INCOMPATIBLE",
    });
    await expect(tools.deleteArtifactSafely({ conversationId: "c9", artifactId: "orphan-report" })).resolves.toBe(true);
    await expect(artifactManager.getArtifact("orphan-report")).resolves.toBeNull();
  });
});

function toolRecord(patch: Partial<ToolCallRecord>): ToolCallRecord {
  const createdAt = patch.createdAt ?? new Date().toISOString();
  const toolKind = patch.toolKind ?? "sql_query";
  return {
    toolCallId: patch.toolCallId ?? `${toolKind}-v1`,
    conversationId: "c-sqlite",
    userId: "u",
    toolKind,
    toolName: TOOL_NAMES[toolKind],
    status: patch.status ?? "completed",
    request: { userRequest: "test", purpose: "test" },
    result: patch.result ?? {
      resultId: `result-${patch.toolCallId ?? toolKind}`,
      toolKind,
      artifactIds: patch.outputArtifactIds ?? [],
      primaryArtifactId: patch.outputArtifactIds?.[0],
      summary: "done",
      createdAt,
    },
    outputArtifactIds: patch.outputArtifactIds ?? [],
    version: patch.version ?? 1,
    isLatestSuccessful: patch.isLatestSuccessful ?? false,
    createdAt,
    updatedAt: patch.updatedAt ?? createdAt,
    completedAt: patch.completedAt ?? createdAt,
    ...patch,
  };
}

class FakeToolSqliteDb {
  readonly calls = new Map<string, Record<string, unknown>>();
  readonly states = new Map<string, Record<string, unknown>>();
  readonly artifacts = new Map<string, Record<string, unknown>>();

  exec(_sql: string) {}

  prepare(sql: string) {
    return {
      run: (...args: unknown[]) => this.run(sql, args),
      get: (...args: unknown[]) => this.get(sql, args),
      all: (...args: unknown[]) => this.all(sql, args),
    };
  }

  private run(sql: string, args: unknown[]) {
    if (sql.includes("tool_orchestration_calls")) {
      const [tool_call_id, conversation_id, user_id, tool_kind, status, record_json, created_at, updated_at, completed_at] = args;
      this.calls.set(String(tool_call_id), { tool_call_id, conversation_id, user_id, tool_kind, status, record_json, created_at, updated_at, completed_at });
    } else if (sql.includes("tool_orchestration_states")) {
      const [conversation_id, state_json, updated_at] = args;
      this.states.set(String(conversation_id), { conversation_id, state_json, updated_at });
    } else if (sql.includes("tool_orchestration_artifacts")) {
      const [artifact_id, artifact_type, title, content_type, content_json, metadata_json, created_at] = args;
      this.artifacts.set(String(artifact_id), { artifact_id, artifact_type, title, content_type, content_json, metadata_json, created_at });
    }
    return { changes: 1 };
  }

  private get(sql: string, args: unknown[]) {
    if (sql.includes("tool_orchestration_calls")) {
      return this.calls.get(String(args[0]));
    }
    if (sql.includes("tool_orchestration_states")) {
      return this.states.get(String(args[0]));
    }
    if (sql.includes("tool_orchestration_artifacts")) {
      return this.artifacts.get(String(args[0]));
    }
    return undefined;
  }

  private all(sql: string, args: unknown[]) {
    if (sql.includes("tool_orchestration_calls")) {
      return Array.from(this.calls.values())
        .filter((row) => row.conversation_id === args[0])
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    }
    return [];
  }
}
