import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantRuntime, planningFallbackProgressSummary, resolveDefaultDataSourceAmbiguities, type AssistantStreamEvent } from "./assistantRuntime";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

describe("AssistantRuntime dual-model flow", () => {
  beforeEach(() => {
    vi.stubEnv("CYCLE_PROBE_DYNAMIC_ROUTING_ENABLED", "false");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("describes the concrete planning fallback reason in progress", () => {
    expect(planningFallbackProgressSummary("reasoning_overrun", 90_000))
      .toBe("已返回推理内容，但未在 90 秒规划总预算内完成合法计划，正在生成降级计划。");
    expect(planningFallbackProgressSummary("invalid_analysis_plan", 90_000))
      .toBe("返回的计划未通过结构校验，正在生成降级计划。");
  });

  it("uses the resolved latest data source instead of keeping a data-source ambiguity", () => {
    const route = {
      taskType: "multi_step_analysis" as const,
      complexity: "L2" as const,
      requiresKimi: true,
      requiresSql: true,
      requiresPython: true,
      requiresChart: false,
      requiresReport: true,
      ambiguities: [
        { field: "数据集", description: "存在多个 SQL 结果集，需要选择一个。", blocking: true },
        { field: "统计口径", description: "合同数量口径不明确。", blocking: false },
      ],
      userVisibleSummary: "查询并分析数据。",
      confidence: 0.8,
    };

    expect(resolveDefaultDataSourceAmbiguities(route, true).ambiguities).toEqual([
      { field: "统计口径", description: "合同数量口径不明确。", blocking: false },
    ]);
    expect(resolveDefaultDataSourceAmbiguities(route, false)).toBe(route);
  });

  it("plans with the reasoning model and executes SQL with the execution model", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-dual-model-"));
    const csvPath = join(temp, "csv.sqlite");
    const csvDb = new Database(csvPath);
    csvDb.exec(`
      create table csv_dataset_tables (
        data_source_id text, table_id text, sqlite_table_name text, display_name text,
        aliases_json text, updated_at text
      );
      create table csv_dataset_columns (
        data_source_id text, name text, sqlite_column_name text, ordinal_index integer,
        physical_name text, business_field_id text, display_name_zh text
      );
    `);
    csvDb.close();

    const requests: Array<{
      model?: string;
      messages?: Array<{ role?: string; content?: string }>;
      tools?: Array<{ function?: { name?: string; parameters?: { required?: string[] } } }>;
    }> = [];
    const responses = [
      toolCallResponse("plan-call", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "执行一项只读 SQL 查询。",
        requestedOutputs: ["query"],
        steps: [{
          stepId: "query",
          toolKind: "sql_query",
          purpose: "查询一条真实 SQLite 结果",
          dependencies: [],
          inputResolution: "selected_data_source",
          expectedOutput: "SQL 查询结果 Artifact",
        }],
      }, true),
      nonStreamToolCallResponse("sql-call", "request_sql_query_execution", {
        sql: "select 1 as value",
      }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      return response;
    }));

    const events: AssistantStreamEvent[] = [];
    const runtime = new AssistantRuntime({
      dbPath: join(temp, "assistant.sqlite"),
      csvSqlitePath: csvPath,
      toolLogPath: join(temp, "tools.jsonl"),
      getModelApiKey: async () => "test-key",
      emit: (event) => events.push(event),
    });
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "request-1",
      prompt: "查询一条数据",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "EXECUTOR_ONLY_SCHEMA_MARKER",
      approvalMode: "full_access",
    });
    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    expect(run.reasoningModelName).toBe("reasoning-model");
    expect(run.executionModelName).toBe("execution-model");
    expect(run.completedStepIds).toEqual(["query"]);
    expect(requests.map((request) => request.model)).toEqual(["reasoning-model", "execution-model"]);
    expect(requests[0].tools?.map((tool) => tool.function?.name)).toEqual(["submit_agent_execution_plan"]);
    expect(requests[1].tools?.map((tool) => tool.function?.name)).toEqual(["request_sql_query_execution"]);
    expect(requests[1].tools?.[0].function?.parameters?.required).toContain("sql");
    expect(JSON.stringify(requests[0])).toContain("当前数据源：测试数据源");
    expect(JSON.stringify(requests[0])).not.toContain("EXECUTOR_ONLY_SCHEMA_MARKER");
    expect(JSON.stringify(requests[0])).not.toContain("审批权限");
    expect(JSON.stringify(requests[1])).toContain("EXECUTOR_ONLY_SCHEMA_MARKER");
    expect(events.some((event) => event.type === "agent-progress" && event.event.phase === "plan_ready")).toBe(true);
    expect(events.some((event) => event.type === "agent-progress" && event.event.phase === "step_completed")).toBe(true);
    expect(runtime.getConversationMessages("user-1", result.conversation.id).at(-1)?.content).toContain("1 项任务已完成");
  });

  it("executes SQL, Python, and chart with compact parameters and client-injected context", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-dual-model-compact-tools-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const toolLogPath = join(temp, "tools.jsonl");
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      toolCallResponse("plan", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "查询、分析并绘图。",
        requestedOutputs: ["query", "analysis", "chart"],
        steps: [
          {
            stepId: "query",
            toolKind: "sql_query",
            purpose: "查询真实明细",
            dependencies: [],
            inputResolution: "selected_data_source",
            expectedOutput: "查询 Artifact",
          },
          {
            stepId: "analysis",
            toolKind: "python_analysis",
            purpose: "计算分类占比",
            dependencies: ["query"],
            inputResolution: "current_run",
            expectedOutput: "分析 Artifact",
          },
          {
            stepId: "chart",
            toolKind: "chart_rendering",
            purpose: "绘制分类占比图",
            dependencies: ["analysis"],
            inputResolution: "current_run",
            expectedOutput: "图表 Artifact",
          },
        ],
      }),
      nonStreamToolCallResponse("sql", "request_sql_query_execution", {
        sql: "select 'A' as category, 0.5 as rate",
      }),
      nonStreamToolCallResponse("python", "request_python_analysis_execution", {
        script: "print('# 分类占比\\n\\n| category | rate |\\n|---|---:|\\n| A | 50% |')",
      }),
      nonStreamToolCallResponse("chart", "request_chart_rendering", {
        title: "分类占比",
        chartType: "bar",
        dimensionFields: ["category"],
        measureFields: ["rate"],
        sortDirection: "desc",
      }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      return response;
    }));
    const runtime = new AssistantRuntime({
      dbPath: join(temp, "assistant.sqlite"),
      csvSqlitePath: csvPath,
      toolLogPath,
      getModelApiKey: async () => "test-key",
      emit: () => undefined,
    });
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "compact-tools",
      prompt: "查询数据，计算分类占比并绘制条形图",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(category text, rate real)",
      approvalMode: "full_access",
    });

    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    expect(run.completedStepIds).toEqual(["query", "analysis", "chart"]);
    const executionRequests = requests.slice(1);
    expect(executionRequests.map((request) =>
      (request.tools as Array<{ function?: { parameters?: { required?: string[]; properties?: Record<string, unknown> } } }>)[0]
        .function?.parameters?.required,
    )).toEqual([
      ["sql"],
      ["script"],
      ["title", "chartType", "dimensionFields", "measureFields"],
    ]);
    const chartSchema = (executionRequests[2].tools as Array<{ function?: { parameters?: { properties?: Record<string, unknown> } } }>)[0]
      .function?.parameters;
    expect(chartSchema?.properties).not.toHaveProperty("visualizationSpec");
    const logs = readFileSync(toolLogPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const parameterLogs = logs.filter((log) => log.phase === "tool-parameter-validation");
    expect(parameterLogs.filter((log) => log.status === "success")).toHaveLength(3);
    expect(JSON.stringify(parameterLogs)).not.toContain("select 'A'");
  });

  it("returns the model text instead of creating a local fallback plan", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-dual-model-text-"));
    const csvPath = join(temp, "csv.sqlite");
    const csvDb = new Database(csvPath);
    csvDb.exec(`
      create table csv_dataset_tables (
        data_source_id text, table_id text, sqlite_table_name text, display_name text,
        aliases_json text, updated_at text
      );
      create table csv_dataset_columns (
        data_source_id text, name text, sqlite_column_name text, ordinal_index integer,
        physical_name text, business_field_id text, display_name_zh text
      );
    `);
    csvDb.close();

    const responses = [textResponse("模型说明：当前信息不足，无法形成合法执行计划。")];
    vi.stubGlobal("fetch", vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      return response;
    }));

    const runtime = new AssistantRuntime({
      dbPath: join(temp, "assistant.sqlite"),
      csvSqlitePath: csvPath,
      toolLogPath: join(temp, "tools.jsonl"),
      getModelApiKey: async () => "test-key",
      emit: () => undefined,
    });
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "request-text-1",
      prompt: "查询数据",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      approvalMode: "full_access",
    });

    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    expect(run.plan).toBeUndefined();
    expect(run.events.some((event) => event.summary.includes("本地高置信规则"))).toBe(false);
    expect(runtime.getConversationMessages("user-1", result.conversation.id).at(-1)?.content)
      .toBe("模型说明：当前信息不足，无法形成合法执行计划。");
  });

  it("fails locally invalid tool parameters without model repair or reasoning fallback", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-dual-model-invalid-parameters-"));
    const csvPath = join(temp, "csv.sqlite");
    const csvDb = new Database(csvPath);
    csvDb.exec(`
      create table csv_dataset_tables (
        data_source_id text, table_id text, sqlite_table_name text, display_name text,
        aliases_json text, updated_at text
      );
      create table csv_dataset_columns (
        data_source_id text, name text, sqlite_column_name text, ordinal_index integer,
        physical_name text, business_field_id text, display_name_zh text
      );
    `);
    csvDb.close();

    const requests: Array<{ model?: string }> = [];
    const responses = [
      toolCallResponse("plan-call", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "执行查询。",
        requestedOutputs: ["query"],
        steps: [{
          stepId: "query",
          toolKind: "sql_query",
          purpose: "查询数据",
          dependencies: [],
          inputResolution: "selected_data_source",
          expectedOutput: "查询结果",
        }],
      }),
      nonStreamToolCallResponse("sql-call", "request_sql_query_execution", {
        userRequest: "查询数据",
        purpose: "查询数据",
      }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      const response = responses.shift();
      if (!response) throw new Error("unexpected model repair request");
      return response;
    }));

    const runtime = new AssistantRuntime({
      dbPath: join(temp, "assistant.sqlite"),
      csvSqlitePath: csvPath,
      toolLogPath: join(temp, "tools.jsonl"),
      getModelApiKey: async () => "test-key",
      emit: () => undefined,
    });
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "request-invalid-parameters",
      prompt: "查询数据",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      approvalMode: "full_access",
    });

    const run = await waitForTerminalRun(runtime, "user-1", result.assistantMessage.id);
    expect(run.status).toBe("failed");
    expect(run.failedStepIds).toEqual(["query"]);
    expect(requests.map((request) => request.model)).toEqual(["reasoning-model", "execution-model"]);
    expect(run.events.some((event) => event.phase === "validating_parameters" && event.stepId === "query")).toBe(true);
    expect(run.events.some((event) => event.phase === "fallback" && /参数/.test(event.summary))).toBe(false);
  });

  it("passes compact upstream result fields to chart execution without upstream scripts", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-dual-model-chart-context-"));
    const csvPath = join(temp, "csv.sqlite");
    const csvDb = new Database(csvPath);
    csvDb.exec(`
      create table csv_dataset_tables (
        data_source_id text, table_id text, sqlite_table_name text, display_name text,
        aliases_json text, updated_at text
      );
      create table csv_dataset_columns (
        data_source_id text, name text, sqlite_column_name text, ordinal_index integer,
        physical_name text, business_field_id text, display_name_zh text
      );
    `);
    csvDb.close();

    const runtime = new AssistantRuntime({
      dbPath: join(temp, "assistant.sqlite"),
      csvSqlitePath: csvPath,
      toolLogPath: join(temp, "tools.jsonl"),
      getModelApiKey: async () => "test-key",
      emit: () => undefined,
    });
    const conversation = runtime.createConversation("user-1");
    const registry = (runtime as unknown as {
      toolResultRegistry: {
        register: (record: Record<string, unknown>) => Promise<void>;
      };
      buildDualModelContext: (
        input: Record<string, unknown>,
        conversation: Record<string, unknown>,
        role: "execution",
        step: Record<string, unknown>,
      ) => Promise<string>;
    });
    const now = new Date().toISOString();
    await registry.toolResultRegistry.register({
      toolCallId: "sql-context-source",
      conversationId: conversation.id,
      userId: "user-1",
      toolKind: "sql_query",
      toolName: "request_sql_query_execution",
      status: "completed",
      request: {
        userRequest: "查询行业风险数据",
        purpose: "提供图表输入",
        sql: "select 'DO_NOT_INJECT_THIS_SQL_SCRIPT' as secret_script_marker",
      },
      result: {
        resultId: "sql-result",
        toolKind: "sql_query",
        artifactIds: ["workflow-dataset:chart-source"],
        summary: "查询完成，共 6 条记录。",
        createdAt: now,
        metadata: {
          selectedFieldNames: ["客户所属国标行业名称", "不良+关注率"],
          resultPreview: JSON.stringify({
            rowCount: 6,
            previewRows: [{ 客户所属国标行业名称: "F51--批发业", "不良+关注率": 0.25 }],
          }),
        },
      },
      outputArtifactIds: ["workflow-dataset:chart-source"],
      version: 1,
      isLatestSuccessful: true,
      createdAt: now,
      updatedAt: now,
    });

    const context = await registry.buildDualModelContext({
      userId: "user-1",
      prompt: "绘制行业不良+关注率条形图",
      dataSourceLabel: "行业风险.csv",
      schemaContextMarkdown: "FULL_SOURCE_SCHEMA_SHOULD_NOT_BE_IN_CHART_CONTEXT",
      approvalMode: "full_access",
    }, conversation as unknown as Record<string, unknown>, "execution", {
      stepId: "chart",
      toolKind: "chart_rendering",
      purpose: "绘制行业不良+关注率条形图",
      dependencies: [],
      inputResolution: "history_artifact",
      expectedOutput: "图表 Artifact",
    });

    expect(context).toContain("客户所属国标行业名称");
    expect(context).toContain("不良+关注率");
    expect(context).toContain("workflow-dataset:chart-source");
    expect(context).not.toContain("DO_NOT_INJECT_THIS_SQL_SCRIPT");
    expect(context).not.toContain("FULL_SOURCE_SCHEMA_SHOULD_NOT_BE_IN_CHART_CONTEXT");
  });

  it("records context compression observability without logging omitted content", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-thinking-context-observation-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const toolLogPath = join(temp, "tools.jsonl");
    const runtime = new AssistantRuntime({
      dbPath: join(temp, "assistant.sqlite"),
      csvSqlitePath: csvPath,
      toolLogPath,
      getModelApiKey: async () => "test-key",
      emit: () => undefined,
    });
    const conversation = runtime.createConversation("user-1");
    const internals = runtime as unknown as {
      buildDualModelContext: (
        input: Record<string, unknown>,
        conversation: Record<string, unknown>,
        role: "reasoning",
        step: undefined,
        tokenBudget: number,
        messageId: string,
      ) => Promise<string>;
    };
    const omittedMarker = "SENSITIVE_HISTORY_MARKER";
    const context = await internals.buildDualModelContext({
      userId: "user-1",
      clientRequestId: "context-observation",
      prompt: `分析目标${omittedMarker}${"很长的任务描述".repeat(500)}`,
      dataSourceLabel: "测试数据源",
      approvalMode: "full_access",
      selectedFieldRefs: [],
    }, conversation as unknown as Record<string, unknown>, "reasoning", undefined, 256, "assistant-message");
    const logs = readFileSync(toolLogPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const observation = logs.find((log) => log.phase === "reasoning-context-compressed");

    expect(context).toContain("[上下文已按 Token 预算裁剪]");
    expect(observation?.detail).toMatchObject({
      tokenBudget: 256,
      estimatedTokens: expect.any(Number),
      includedSections: ["task_constraints"],
    });
    expect(JSON.stringify(observation)).not.toContain(omittedMarker);
    expect(JSON.stringify(observation)).not.toContain("很长的任务描述");
  });

  it("injects the newest selected temporary CSV as the current planning data source", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-latest-temp-source-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const runtime = runtimeFor(temp, csvPath);
    const conversation = runtime.createConversation("user-1");
    const older = runtime.importConversationCsv({
      userId: "user-1",
      conversationId: conversation.id,
      fileName: "older.csv",
      fileSizeBytes: 12,
      fileBuffer: new TextEncoder().encode("字段\n旧值\n"),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const latest = runtime.importConversationCsv({
      userId: "user-1",
      conversationId: conversation.id,
      fileName: "latest.csv",
      fileSizeBytes: 12,
      fileBuffer: new TextEncoder().encode("字段\n新值\n"),
    });
    const internals = runtime as unknown as {
      buildDualModelContext: (
        input: Record<string, unknown>,
        conversation: Record<string, unknown>,
        role: "reasoning",
        step: undefined,
        tokenBudget: number,
        messageId: string,
      ) => Promise<string>;
    };

    const context = await internals.buildDualModelContext({
      userId: "user-1",
      clientRequestId: "latest-source-context",
      prompt: "分析当前数据",
      selectedTempDataSourceIds: [older.tempDataSourceId, latest.tempDataSourceId],
      approvalMode: "full_access",
      selectedFieldRefs: [],
    }, conversation as unknown as Record<string, unknown>, "reasoning", undefined, 2_000, "assistant-message");

    expect(context).toContain("当前数据源：latest.csv");
    expect(context).toContain("默认使用最近更新的数据集");
    expect(context).not.toContain("当前数据源：未选择");
  });

  it("routes an L1 query through Qwen and skips Kimi Thinking", async () => {
    vi.stubEnv("CYCLE_PROBE_DYNAMIC_ROUTING_ENABLED", "true");
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-thinking-l1-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      toolCallResponse("route", "submit_task_route", {
        taskType: "single_query",
        complexity: "L1",
        requiresKimi: false,
        requiresSql: true,
        requiresPython: false,
        requiresChart: false,
        requiresReport: false,
        ambiguities: [],
        userVisibleSummary: "读取一条真实数据。",
        confidence: 0.98,
      }),
      nonStreamToolCallResponse("sql", "request_sql_query_execution", {
        sql: "select 1 as value",
      }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      return response;
    }));
    const runtime = runtimeFor(temp, csvPath);
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "thinking-l1",
      prompt: "查询一条数据",
      modelName: "kimi-model",
      executionModelName: "qwen-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(value integer)",
      approvalMode: "full_access",
    });

    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    expect(run.route?.complexity).toBe("L1");
    expect(run.thinkingDecision?.useKimi).toBe(false);
    expect(requests.map((request) => request.model)).toEqual(["qwen-model", "qwen-model"]);
    expect(requests.every((request) => request.enable_thinking === false)).toBe(true);
    expect(requests.every((request) => !("thinking_budget" in request))).toBe(true);
  });

  it("routes an L0 metadata question directly through Qwen without Kimi or tools", async () => {
    vi.stubEnv("CYCLE_PROBE_DYNAMIC_ROUTING_ENABLED", "true");
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-thinking-l0-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      toolCallResponse("route", "submit_task_route", {
        taskType: "metadata",
        complexity: "L0",
        requiresKimi: false,
        requiresSql: false,
        requiresPython: false,
        requiresChart: false,
        requiresReport: false,
        ambiguities: [],
        userVisibleSummary: "说明当前字段含义。",
        confidence: 0.99,
      }),
      textResponse("该字段表示合同当前状态。"),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      return response;
    }));
    const runtime = runtimeFor(temp, csvPath);
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "thinking-l0",
      prompt: "说明当前字段含义",
      modelName: "kimi-model",
      executionModelName: "qwen-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(value integer)",
      approvalMode: "full_access",
    });

    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    expect(run.route?.complexity).toBe("L0");
    expect(run.thinkingDecision?.useKimi).toBe(false);
    expect(run.plan).toBeUndefined();
    expect(requests.map((request) => request.model)).toEqual(["qwen-model", "qwen-model"]);
    expect(requests.every((request) => request.enable_thinking === false)).toBe(true);
    expect(runtime.getConversationMessages("user-1", result.conversation.id).at(-1)?.content)
      .toBe("该字段表示合同当前状态。");
  });

  it("does not replace a failed model intent request with a local conservative route", async () => {
    vi.stubEnv("CYCLE_PROBE_DYNAMIC_ROUTING_ENABLED", "true");
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-router-provider-failure-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      throw new TypeError("fetch failed");
    }));
    const runtime = runtimeFor(temp, csvPath);
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "router-provider-failure",
      prompt: "查询并分析数据，绘制条形图并输出报告",
      modelName: "kimi-model",
      executionModelName: "qwen-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      approvalMode: "full_access",
    });

    const run = await waitForTerminalRun(runtime, "user-1", result.assistantMessage.id);
    const message = runtime.getConversationMessages("user-1", result.conversation.id).at(-1);
    expect(run.status).toBe("failed");
    expect(run.error?.phase).toBe("routing");
    expect(run.route).toBeUndefined();
    expect(requests.every((request) => request.model === "qwen-model")).toBe(true);
    expect(run.events.some((event) => event.summary.includes("保守策略"))).toBe(false);
    expect(message?.status).toBe("error");
    expect(message?.content).toBe("模型服务连接失败，未能完成任务意图识别，请检查网络后重试。");
    expect(message?.content).not.toContain("请补充数据范围或预期产物");
  });

  it("uses Kimi 512 Thinking for L2 and keeps Qwen execution Thinking disabled", async () => {
    vi.stubEnv("CYCLE_PROBE_DYNAMIC_ROUTING_ENABLED", "true");
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-thinking-l2-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      toolCallResponse("route", "submit_task_route", {
        taskType: "multi_step_analysis",
        complexity: "L2",
        requiresKimi: true,
        requiresSql: true,
        requiresPython: false,
        requiresChart: false,
        requiresReport: false,
        ambiguities: [],
        userVisibleSummary: "读取数据并形成受控分析计划。",
        confidence: 0.95,
      }),
      textResponse(JSON.stringify({
        goal: "读取真实数据",
        businessDefinitions: [],
        requiredData: [{ table: "test", fields: ["value"], purpose: "查询" }],
        steps: [{ id: "query", type: "sql", purpose: "读取真实数据" }],
        validationRules: [],
        reportOutline: [],
        assumptions: [],
        unresolvedAmbiguities: [],
      })),
      nonStreamToolCallResponse("sql", "request_sql_query_execution", {
        sql: "select 1 as value",
      }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      return response;
    }));
    const runtime = runtimeFor(temp, csvPath);
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "thinking-l2",
      prompt: "查询并分析一条数据",
      modelName: "kimi-model",
      executionModelName: "qwen-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(value integer)",
      approvalMode: "full_access",
    });

    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    expect(run.route?.complexity).toBe("L2");
    expect(run.analysisPlan?.goal).toBe("读取真实数据");
    expect(requests.map((request) => request.model)).toEqual(["qwen-model", "kimi-model", "qwen-model"]);
    expect(requests[0]).toMatchObject({ enable_thinking: false });
    expect(requests[1]).toMatchObject({ enable_thinking: true, thinking_budget: 512 });
    expect(requests[2]).toMatchObject({ enable_thinking: false });
    expect(requests[2]).not.toHaveProperty("thinking_budget");
  });

  it.each([
    {
      name: "L3 root-cause analysis",
      prompt: "分析查询结果异常的根因并交叉验证",
      taskType: "root_cause_analysis",
      complexity: "L3",
      budget: 1_024,
    },
    {
      name: "L4 deep research",
      prompt: "对跨机构风险迁徙开展深度分析",
      taskType: "deep_research",
      complexity: "L4",
      budget: 4_096,
    },
  ] as const)("uses the configured Kimi profile for $name", async ({ prompt, taskType, complexity, budget }) => {
    vi.stubEnv("CYCLE_PROBE_DYNAMIC_ROUTING_ENABLED", "true");
    const temp = mkdtempSync(join(tmpdir(), `cycle-probe-thinking-${complexity.toLowerCase()}-`));
    const csvPath = createCsvMetadataDatabase(temp);
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      toolCallResponse("route", "submit_task_route", {
        taskType,
        complexity,
        requiresKimi: true,
        requiresSql: true,
        requiresPython: false,
        requiresChart: false,
        requiresReport: false,
        ambiguities: [],
        userVisibleSummary: "读取真实数据并规划验证路径。",
        confidence: 0.96,
      }),
      textResponse(JSON.stringify({
        goal: prompt,
        businessDefinitions: [],
        requiredData: [{ table: "test", fields: ["value"], purpose: "验证" }],
        steps: [{ id: "query", type: "sql", purpose: "读取真实数据" }],
        validationRules: [],
        reportOutline: [],
        assumptions: [],
        unresolvedAmbiguities: [],
      })),
      nonStreamToolCallResponse("sql", "request_sql_query_execution", {
        sql: "select 1 as value",
      }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      return response;
    }));
    const runtime = runtimeFor(temp, csvPath);
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: `thinking-${complexity}`,
      prompt,
      modelName: "kimi-model",
      executionModelName: "qwen-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(value integer)",
      approvalMode: "full_access",
    });

    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    expect(run.route?.complexity).toBe(complexity);
    expect(run.thinkingDecision?.request.thinkingBudget).toBe(budget);
    expect(requests[1]).toMatchObject({
      model: "kimi-model",
      enable_thinking: true,
      thinking_budget: budget,
    });
    expect(requests[2]).toMatchObject({ model: "qwen-model", enable_thinking: false });
  });

  it("uses one real Qwen fallback planning call when Kimi cannot produce a valid AnalysisPlan", async () => {
    vi.stubEnv("CYCLE_PROBE_DYNAMIC_ROUTING_ENABLED", "true");
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-thinking-qwen-fallback-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      toolCallResponse("route", "submit_task_route", {
        taskType: "multi_step_analysis",
        complexity: "L2",
        requiresKimi: true,
        requiresSql: true,
        requiresPython: false,
        requiresChart: false,
        requiresReport: false,
        ambiguities: [],
        userVisibleSummary: "读取真实数据并规划分析。",
        confidence: 0.9,
      }),
      textResponse("{invalid-plan"),
      textResponse("{still-invalid"),
      toolCallResponse("fallback-plan", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "以只读方式查询真实数据。",
        requestedOutputs: ["query"],
        steps: [{
          stepId: "query",
          toolKind: "sql_query",
          purpose: "查询真实数据",
          dependencies: [],
          inputResolution: "selected_data_source",
          expectedOutput: "查询 Artifact",
        }],
      }),
      nonStreamToolCallResponse("sql", "request_sql_query_execution", {
        sql: "select 1 as value",
      }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      return response;
    }));
    const runtime = runtimeFor(temp, csvPath);
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "thinking-qwen-fallback",
      prompt: "查询并分析真实数据",
      modelName: "kimi-model",
      executionModelName: "qwen-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(value integer)",
      approvalMode: "full_access",
    });

    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    expect(run.plan?.steps.map((step) => step.stepId)).toEqual(["query"]);
    expect(requests.map((request) => request.model)).toEqual([
      "qwen-model",
      "kimi-model",
      "kimi-model",
      "qwen-model",
      "qwen-model",
    ]);
    expect(requests[3]).toMatchObject({ enable_thinking: false });
    expect(requests[3]).not.toHaveProperty("thinking_budget");
    expect(run.events.some((event) =>
      event.phase === "fallback" && event.summary.includes("正在生成降级计划")
    )).toBe(true);
    expect(run.events.some((event) => /Qwen|Kimi|推理模型|执行模型/.test(event.summary))).toBe(false);
    expect(run.events.some((event) => event.summary.includes("本地预制"))).toBe(false);
  });

  it("reports a provider failure when Kimi and Qwen fallback planning both fail", async () => {
    vi.stubEnv("CYCLE_PROBE_DYNAMIC_ROUTING_ENABLED", "true");
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-planner-provider-failure-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const requests: Array<Record<string, unknown>> = [];
    let callIndex = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      callIndex += 1;
      if (callIndex === 1) {
        return toolCallResponse("route", "submit_task_route", {
          taskType: "multi_step_analysis",
          complexity: "L2",
          requiresKimi: true,
          requiresSql: true,
          requiresPython: true,
          requiresChart: true,
          requiresReport: true,
          ambiguities: [],
          userVisibleSummary: "查询、分析、绘图并生成报告。",
          confidence: 0.95,
        });
      }
      throw new TypeError("fetch failed");
    }));
    const runtime = runtimeFor(temp, csvPath);
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "planner-provider-failure",
      prompt: "查询并分析数据，绘制条形图并输出报告",
      modelName: "kimi-model",
      executionModelName: "qwen-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      approvalMode: "full_access",
    });

    const run = await waitForTerminalRun(runtime, "user-1", result.assistantMessage.id);
    const message = runtime.getConversationMessages("user-1", result.conversation.id).at(-1);
    expect(run.status).toBe("failed");
    expect(run.error?.phase).toBe("planning");
    expect(run.route?.complexity).toBe("L2");
    expect(run.plan).toBeUndefined();
    expect(requests.some((request) => request.model === "kimi-model")).toBe(true);
    expect(requests.filter((request) => request.model === "qwen-model").length).toBeGreaterThan(1);
    expect(message?.status).toBe("error");
    expect(message?.content).toBe("模型服务连接失败，未能完成分析计划，请检查网络后重试。");
    expect(message?.content).not.toContain("请补充数据范围或预期产物");
  });

  it("falls back to Qwen planning after a Kimi first-event timeout", async () => {
    vi.stubEnv("CYCLE_PROBE_DYNAMIC_ROUTING_ENABLED", "true");
    vi.stubEnv("CYCLE_PROBE_REASONER_FIRST_EVENT_TIMEOUT_MS", "1000");
    vi.stubEnv("CYCLE_PROBE_PLANNING_TIMEOUT_MS", "5000");
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-thinking-first-event-timeout-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const requests: Array<Record<string, unknown>> = [];
    let callIndex = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      callIndex += 1;
      if (callIndex === 1) {
        return toolCallResponse("route", "submit_task_route", {
          taskType: "multi_step_analysis",
          complexity: "L2",
          requiresKimi: true,
          requiresSql: true,
          requiresPython: false,
          requiresChart: false,
          requiresReport: false,
          ambiguities: [],
          userVisibleSummary: "读取真实数据并规划分析。",
          confidence: 0.92,
        });
      }
      if (callIndex === 2) {
        return await new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      if (callIndex === 3) {
        return toolCallResponse("fallback-plan", "submit_agent_execution_plan", {
          outcome: "execute",
          summary: "执行最小只读查询。",
          requestedOutputs: ["query"],
          steps: [{
            stepId: "query",
            toolKind: "sql_query",
            purpose: "读取真实数据",
            dependencies: [],
            inputResolution: "selected_data_source",
            expectedOutput: "查询 Artifact",
          }],
        });
      }
      if (callIndex === 4) {
        return nonStreamToolCallResponse("sql", "request_sql_query_execution", {
          sql: "select 1 as value",
        });
      }
      throw new Error("unexpected model request");
    }));
    const runtime = runtimeFor(temp, csvPath);
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "thinking-first-event-timeout",
      prompt: "查询并分析真实数据",
      modelName: "kimi-model",
      executionModelName: "qwen-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(value integer)",
      approvalMode: "full_access",
    });

    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    expect(requests.map((request) => request.model)).toEqual([
      "qwen-model",
      "kimi-model",
      "qwen-model",
      "qwen-model",
    ]);
    expect(run.events.some((event) =>
      event.phase === "fallback" && event.detail?.fallbackReason === "reasoner_first_event_timeout"
    )).toBe(true);
    expect(run.completedStepIds).toEqual(["query"]);
  });

  it("upgrades repeated SQL failure diagnosis from 1024 to 2048 only after an invalid diagnostic plan", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-thinking-sql-diagnostic-upgrade-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      textResponse("{invalid-diagnostic"),
      textResponse(JSON.stringify({
        goal: "修复字段类型不兼容的只读查询",
        businessDefinitions: [],
        requiredData: [{ table: "test", fields: ["value"], purpose: "确认字段类型" }],
        steps: [{ id: "repair-query", type: "sql", purpose: "按真实字段类型修复查询" }],
        validationRules: [],
        reportOutline: [],
        assumptions: [],
        unresolvedAmbiguities: [],
      })),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      const response = responses.shift();
      if (!response) throw new Error("unexpected diagnostic request");
      return response;
    }));
    const runtime = runtimeFor(temp, csvPath);
    const conversation = runtime.createConversation("user-1");
    const runId = "run-sql-diagnostic";
    const internals = runtime as unknown as {
      agentTurnOrchestrator: {
        start: (input: Record<string, unknown>) => unknown;
      };
      agentProgressStore: {
        get: (runId: string) => ReturnType<AssistantRuntime["getAgentRun"]>;
      };
      diagnoseRepeatedSqlFailure: (input: Record<string, unknown>) => Promise<string | null>;
    };
    internals.agentTurnOrchestrator.start({
      runId,
      conversationId: conversation.id,
      messageId: "assistant-message",
      userId: "user-1",
      attempt: 1,
      reasoningModelName: "kimi-model",
      executionModelName: "qwen-model",
    });

    const diagnostic = await internals.diagnoseRepeatedSqlFailure({
      runId,
      input: {
        userId: "user-1",
        prompt: "查询真实数据",
        modelName: "kimi-model",
        executionModelName: "qwen-model",
        approvalMode: "full_access",
      },
      conversation,
      messageId: "assistant-message",
      context: "当前数据源：test(value integer)",
      errorMessage: "datatype mismatch",
      apiKey: "test-key",
      signal: new AbortController().signal,
    });

    const run = internals.agentProgressStore.get(runId);
    expect(diagnostic).toContain("repair-query");
    expect(requests.map((request) => request.thinking_budget)).toEqual([1_024, 2_048]);
    expect(run?.kimiCallCount).toBe(2);
    expect(run?.cumulativeThinkingBudget).toBe(3_072);
    expect(run?.events.some((event) =>
      event.phase === "fallback" && event.detail?.thinkingBudget === 2_048
    )).toBe(true);
  });
});

function createCsvMetadataDatabase(temp: string) {
  const csvPath = join(temp, "csv.sqlite");
  const csvDb = new Database(csvPath);
  csvDb.exec(`
    create table csv_dataset_tables (
      data_source_id text, table_id text, sqlite_table_name text, display_name text,
      aliases_json text, updated_at text
    );
    create table csv_dataset_columns (
      data_source_id text, name text, sqlite_column_name text, ordinal_index integer,
      physical_name text, business_field_id text, display_name_zh text
    );
  `);
  csvDb.close();
  return csvPath;
}

function runtimeFor(temp: string, csvPath: string) {
  return new AssistantRuntime({
    dbPath: join(temp, "assistant.sqlite"),
    csvSqlitePath: csvPath,
    toolLogPath: join(temp, "tools.jsonl"),
    getModelApiKey: async () => "test-key",
    emit: () => undefined,
  });
}

function toolCallResponse(id: string, name: string, input: Record<string, unknown>, omitName = false) {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { ...(!omitName ? { name } : {}), arguments: JSON.stringify(input) } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function nonStreamToolCallResponse(id: string, name: string, input: Record<string, unknown>) {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: "",
        tool_calls: [{ id, function: { name, arguments: JSON.stringify(input) } }],
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function textResponse(content: string) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function waitForRun(runtime: AssistantRuntime, userId: string, messageId: string, status: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = runtime.getAgentRun(userId, messageId);
    if (run?.status === status) return run;
    if (run?.status === "failed") throw new Error(run.error?.message ?? "run failed");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const run = runtime.getAgentRun(userId, messageId);
  throw new Error(`run did not reach ${status}: ${JSON.stringify(run)}`);
}

async function waitForTerminalRun(runtime: AssistantRuntime, userId: string, messageId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = runtime.getAgentRun(userId, messageId);
    if (run && ["completed", "partial", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run did not terminate: ${JSON.stringify(runtime.getAgentRun(userId, messageId))}`);
}
