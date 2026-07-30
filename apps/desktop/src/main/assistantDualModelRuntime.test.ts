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

  it("sends an explicit report regeneration request to the model instead of stale guidance", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-report-regeneration-"));
    const dbPath = join(temp, "assistant.sqlite");
    const runtime = new AssistantRuntime({
      dbPath,
      csvSqlitePath: createCsvMetadataDatabase(temp),
      toolLogPath: join(temp, "tools.jsonl"),
      getModelApiKey: async () => "test-key",
      emit: () => undefined,
    });
    const conversation = runtime.createConversation("user-1", "报告任务");
    const now = new Date().toISOString();
    const checkpoint = {
      checkpointId: "checkpoint-stale-python-error",
      workflowId: "workflow-stale-python-error",
      conversationId: conversation.id,
      status: "recoverable_error",
      completedStepIds: [],
      pendingStepIds: ["python_analysis"],
      activeDatasetIds: [],
      latestSuccessfulToolCallIds: { sql_query: "sql-previous" },
      artifactIds: ["workflow-dataset:previous"],
      pendingGuidance: {
        guidanceId: "guidance-stale-python-error",
        workflowId: "workflow-stale-python-error",
        conversationId: conversation.id,
        type: "tool_error",
        title: "Python 分析执行失败",
        message: "请补充信息后继续。",
        requiredInputs: [],
        actions: [],
        blocking: true,
        resumeToken: "resume-stale-python-error",
        createdAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
    const db = new Database(dbPath);
    db.prepare(`
      insert into agent_workflow_checkpoints
        (checkpoint_id, workflow_id, conversation_id, status, checkpoint_json, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.checkpointId,
      checkpoint.workflowId,
      checkpoint.conversationId,
      checkpoint.status,
      JSON.stringify(checkpoint),
      checkpoint.createdAt,
      checkpoint.updatedAt,
    );
    db.close();

    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      return toolCallResponse("plan-report-regeneration", "submit_agent_execution_plan", {
        outcome: "respond",
        summary: "已识别重新生成报告请求。",
        responseText: "已根据当前会话历史识别重新生成报告任务。",
        requestedOutputs: [],
        steps: [],
      });
    }));

    const result = await runtime.sendMessage({
      userId: "user-1",
      conversationId: conversation.id,
      clientRequestId: "report-regeneration",
      prompt: "重新生成报告",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      approvalMode: "full_access",
    });
    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    const message = runtime.getConversationMessages("user-1", conversation.id).at(-1);

    expect(requests).toHaveLength(1);
    expect(run.status).toBe("completed");
    expect(message?.content).toBe("已根据当前会话历史识别重新生成报告任务。");
    expect(message?.content).not.toContain("我没有识别到可以直接执行");
  });

  it("registers failed and blocked model-planned steps in tool_calls", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-terminal-tool-records-"));
    const runtime = runtimeFor(temp, createCsvMetadataDatabase(temp));
    const rawModelExplanation = "当前步骤需要先确认很多内部条件。".repeat(200);
    const responses = [
      toolCallResponse("plan-terminal-records", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "分析数据并生成报告。",
        requestedOutputs: ["analysis", "report"],
        steps: [
          {
            stepId: "analysis",
            toolKind: "python_analysis",
            purpose: "分析分类分布",
            dependencies: [],
            inputResolution: "conversation_history",
            expectedOutput: "分析 Artifact",
          },
          {
            stepId: "report",
            toolKind: "report_generation",
            purpose: "根据分析结果生成报告",
            dependencies: ["analysis"],
            inputResolution: "current_run",
            expectedOutput: "Markdown 报告 Artifact",
          },
        ],
      }),
      nonStreamTextResponse(rawModelExplanation),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      return response;
    }));

    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "terminal-tool-records",
      prompt: "根据已有结果分析并生成报告",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      approvalMode: "full_access",
    });
    const run = await waitForTerminalRun(runtime, "user-1", result.assistantMessage.id);
    const records = (await runtime.listConversationToolCalls("user-1", result.conversation.id))
      .filter((record) => record.messageId === result.assistantMessage.id);

    expect(run.status).toBe("failed");
    expect(records.map((record) => [record.toolKind, record.status])).toEqual([
      ["python_analysis", "failed"],
      ["report_generation", "blocked"],
    ]);
    expect(records[0].error?.message).toBe("Python 分析未返回可执行参数，步骤执行失败。");
    expect(records[0].error?.message).not.toContain(rawModelExplanation.slice(0, 100));
    expect(records[1].error?.message).toBe("生成报告因上游步骤 analysis 失败而未执行。");
    expect(records.every((record) => record.metadata?.plannedByModel === true)).toBe(true);
    const repeatedRecords = (await runtime.listConversationToolCalls("user-1", result.conversation.id))
      .filter((record) => record.messageId === result.assistantMessage.id);
    expect(repeatedRecords).toHaveLength(2);
    const toolState = await runtime.getConversationToolState("user-1", result.conversation.id);
    expect(toolState.toolCalls.filter((record) => record.messageId === result.assistantMessage.id)).toHaveLength(2);
  });

  it("continues report generation with a successful sibling chart when one chart step fails", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-optional-chart-report-"));
    const runtime = runtimeFor(temp, createCsvMetadataDatabase(temp));
    const responses = [
      toolCallResponse("plan-optional-chart", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "查询、分析、绘图并生成报告。",
        requestedOutputs: ["query", "analysis", "chart", "report"],
        steps: [
          {
            stepId: "query",
            toolKind: "sql_query",
            purpose: "查询分类明细",
            dependencies: [],
            inputResolution: "selected_data_source",
            expectedOutput: "查询 Artifact",
          },
          {
            stepId: "analysis",
            toolKind: "python_analysis",
            purpose: "计算分类笔数",
            dependencies: ["query"],
            inputResolution: "current_run",
            expectedOutput: "分析 Artifact",
          },
          {
            stepId: "chart_count",
            toolKind: "chart_rendering",
            purpose: "绘制分类饼图",
            dependencies: ["analysis"],
            inputResolution: "current_run",
            expectedOutput: "图表 Artifact",
          },
          {
            stepId: "chart_balance",
            toolKind: "chart_rendering",
            purpose: "绘制贷款余额柱状图",
            dependencies: ["analysis"],
            inputResolution: "current_run",
            expectedOutput: "图表 Artifact",
          },
          {
            stepId: "report",
            toolKind: "report_generation",
            purpose: "生成分类分析报告",
            dependencies: ["analysis", "chart_count", "chart_balance"],
            inputResolution: "current_run",
            expectedOutput: "Markdown 报告 Artifact",
          },
        ],
      }),
      nonStreamToolCallResponse("sql-optional-chart", "request_sql_query_execution", {
        sql: "select '正常' as category, 10 as count",
      }),
      nonStreamToolCallResponse("python-optional-chart", "request_python_analysis_execution", {
        script: "import json, sys\nrows = json.load(sys.stdin)\nprint(json.dumps(rows, ensure_ascii=False))",
      }),
      nonStreamTextResponse("工具 Schema 与饼图类型冲突，未返回工具调用。"),
      nonStreamToolCallResponse("chart-balance", "request_chart_rendering", {
        title: "最新风险五级分类贷款余额分布",
        chartType: "bar",
        dimensionFields: ["category"],
        measureFields: ["count"],
      }),
      textResponse([
        "# 分类分析报告",
        "",
        "## 分析结果",
        "",
        "正常类共 10 笔。",
        "",
        "## 可视化图表",
        "",
        "```visualization",
        JSON.stringify({ data: { mode: "artifact", artifactId: "stale-chart-artifact" } }),
        "```",
        "",
        "## 分析结论",
        "",
        "样本以正常类为主。",
      ].join("\n")),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      return response;
    }));

    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "optional-chart-report",
      prompt: "分析分类数据，绘制饼图并生成报告",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(category text, count integer)",
      approvalMode: "full_access",
    });
    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "partial");
    const records = (await runtime.listConversationToolCalls("user-1", result.conversation.id))
      .filter((record) => record.messageId === result.assistantMessage.id);
    const chartRecord = records.find((record) => record.toolKind === "chart_rendering");
    const reportRecord = records.find((record) => record.toolKind === "report_generation");
    const reportArtifactId = reportRecord?.result?.primaryArtifactId ?? reportRecord?.outputArtifactIds?.[0];
    const reportArtifact = reportArtifactId
      ? await runtime.getConversationToolArtifact("user-1", result.conversation.id, reportArtifactId)
      : null;

    expect(run.completedStepIds).toEqual(["query", "analysis", "chart_balance", "report"]);
    expect(run.failedStepIds).toEqual(["chart_count"]);
    expect(chartRecord?.status).toBe("failed");
    expect(reportRecord?.status).toBe("completed");
    expect(reportArtifact?.content).toContain("正常类共 10 笔");
    expect(reportArtifact?.content).not.toContain("stale-chart-artifact");
    expect(reportArtifact?.content).toContain("assistant-chart-spec:chart-balance");
    expect(reportArtifact?.content).toContain("## 可视化图表");
    expect(responses).toHaveLength(0);
  });

  it("retries report parameter generation once after a provider failure", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-report-provider-retry-"));
    const runtime = runtimeFor(temp, createCsvMetadataDatabase(temp));
    const responses: Array<Response | Error> = [
      toolCallResponse("plan-report-retry", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "查询并生成报告。",
        requestedOutputs: ["query", "report"],
        steps: [
          {
            stepId: "query",
            toolKind: "sql_query",
            purpose: "查询报告数据",
            dependencies: [],
            inputResolution: "selected_data_source",
            expectedOutput: "查询 Artifact",
          },
          {
            stepId: "report",
            toolKind: "report_generation",
            purpose: "生成分析报告",
            dependencies: ["query"],
            inputResolution: "current_run",
            expectedOutput: "Markdown 报告 Artifact",
          },
        ],
      }),
      nonStreamToolCallResponse("sql-report-retry", "request_sql_query_execution", {
        sql: "select '正常' as category, 10 as count",
      }),
      new Error("transient provider failure"),
      new Error("transient provider failure after provider retry"),
      textResponse("# 分类分析报告\n\n## 分析结果\n\n正常类共 10 笔。"),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      if (response instanceof Error) throw response;
      return response;
    }));

    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "report-provider-retry",
      prompt: "查询并生成报告",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(category text, count integer)",
      approvalMode: "full_access",
    });
    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    const records = (await runtime.listConversationToolCalls("user-1", result.conversation.id))
      .filter((record) => record.messageId === result.assistantMessage.id);

    expect(run.completedStepIds).toEqual(["query", "report"]);
    expect(run.events).toContainEqual(expect.objectContaining({
      phase: "fallback",
      detail: expect.objectContaining({
        fallbackReason: "report_provider_request_failed",
        stepId: "report",
      }),
    }));
    expect(records.find((record) => record.toolKind === "report_generation")?.status).toBe("completed");
    expect(responses).toHaveLength(0);
  });

  it("retries SQL parameter generation once after a provider transport failure", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-sql-provider-retry-"));
    const runtime = runtimeFor(temp, createCsvMetadataDatabase(temp));
    const responses: Array<Response | Error> = [
      toolCallResponse("plan-sql-retry", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "查询数据。",
        requestedOutputs: ["query"],
        steps: [
          {
            stepId: "query",
            toolKind: "sql_query",
            purpose: "查询数据",
            dependencies: [],
            inputResolution: "selected_data_source",
            expectedOutput: "查询 Artifact",
          },
        ],
      }),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
      nonStreamToolCallResponse("sql-after-provider-retry", "request_sql_query_execution", {
        sql: "select 1 as value",
      }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      if (response instanceof Error) throw response;
      return response;
    }));

    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "sql-provider-retry",
      prompt: "查询数据",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(value integer)",
      approvalMode: "full_access",
    });
    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    const records = (await runtime.listConversationToolCalls("user-1", result.conversation.id))
      .filter((record) => record.messageId === result.assistantMessage.id);

    expect(run.completedStepIds).toEqual(["query"]);
    expect(run.events).toContainEqual(expect.objectContaining({
      phase: "fallback",
      detail: expect.objectContaining({
        fallbackReason: "sql_query_provider_request_failed",
        providerErrorCode: "PROVIDER_REQUEST_FAILED",
        stepId: "query",
      }),
    }));
    expect(records.filter((record) => record.toolKind === "sql_query")).toHaveLength(1);
    expect(records.find((record) => record.toolKind === "sql_query")?.status).toBe("completed");
    expect(responses).toHaveLength(0);
  });

  it("retries SQL parameter generation once when the model returns plain text instead of a tool call", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-sql-tool-call-retry-"));
    const runtime = runtimeFor(temp, createCsvMetadataDatabase(temp));
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      toolCallResponse("plan-sql-tool-call-retry", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "查询数据。",
        requestedOutputs: ["query"],
        steps: [{
          stepId: "query",
          toolKind: "sql_query",
          purpose: "查询数据",
          dependencies: [],
          inputResolution: "selected_data_source",
          expectedOutput: "查询 Artifact",
        }],
      }),
      nonStreamTextResponse("我将根据字段生成 SQL 查询。"),
      nonStreamToolCallResponse("sql-after-tool-call-retry", "request_sql_query_execution", {
        sql: "select 1 as value",
      }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      return response;
    }));

    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "sql-tool-call-retry",
      prompt: "查询数据",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(value integer)",
      approvalMode: "full_access",
    });
    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    const records = (await runtime.listConversationToolCalls("user-1", result.conversation.id))
      .filter((record) => record.messageId === result.assistantMessage.id);

    expect(run.completedStepIds).toEqual(["query"]);
    expect(run.events).toContainEqual(expect.objectContaining({
      phase: "fallback",
      detail: expect.objectContaining({
        fallbackReason: "sql_query_tool_call_required",
        stepId: "query",
      }),
    }));
    expect(requests.slice(1).every((request) =>
      (request.tool_choice as { function?: { name?: string } } | undefined)?.function?.name ===
        "request_sql_query_execution"
    )).toBe(true);
    expect(records.filter((record) => record.toolKind === "sql_query")).toHaveLength(1);
    expect(records[0]?.status).toBe("completed");
  });

  it("preserves the provider error when the report retry also fails", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-report-provider-failed-"));
    const runtime = runtimeFor(temp, createCsvMetadataDatabase(temp));
    const responses: Array<Response | Error> = [
      toolCallResponse("plan-report-failed", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "查询并生成报告。",
        requestedOutputs: ["query", "report"],
        steps: [
          {
            stepId: "query",
            toolKind: "sql_query",
            purpose: "查询报告数据",
            dependencies: [],
            inputResolution: "selected_data_source",
            expectedOutput: "查询 Artifact",
          },
          {
            stepId: "report",
            toolKind: "report_generation",
            purpose: "生成分析报告",
            dependencies: ["query"],
            inputResolution: "current_run",
            expectedOutput: "Markdown 报告 Artifact",
          },
        ],
      }),
      nonStreamToolCallResponse("sql-report-failed", "request_sql_query_execution", {
        sql: "select '正常' as category, 10 as count",
      }),
      new Error("first provider failure"),
      new Error("first provider failure after provider retry"),
      new Error("second provider failure"),
      new Error("second provider failure after provider retry"),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected model request");
      if (response instanceof Error) throw response;
      return response;
    }));

    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "report-provider-failed",
      prompt: "查询并生成报告",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(category text, count integer)",
      approvalMode: "full_access",
    });
    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "partial");
    const records = (await runtime.listConversationToolCalls("user-1", result.conversation.id))
      .filter((record) => record.messageId === result.assistantMessage.id);
    const reportRecord = records.find((record) => record.toolKind === "report_generation");

    expect(run.failedStepIds).toEqual(["report"]);
    expect(reportRecord?.status).toBe("failed");
    expect(reportRecord?.error?.message).toContain("模型服务请求失败");
    expect(reportRecord?.error?.message).not.toContain("未返回可执行参数");
    expect(responses).toHaveLength(0);
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

  it("repairs Python syntax once before creating or executing the tool call", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-dual-model-python-syntax-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const toolLogPath = join(temp, "tools.jsonl");
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      toolCallResponse("plan", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "查询并分析合同金额。",
        requestedOutputs: ["query", "analysis"],
        steps: [
          {
            stepId: "query",
            toolKind: "sql_query",
            purpose: "查询合同金额明细",
            dependencies: [],
            inputResolution: "selected_data_source",
            expectedOutput: "查询 Artifact",
          },
          {
            stepId: "analysis",
            toolKind: "python_analysis",
            purpose: "汇总合同金额",
            dependencies: ["query"],
            inputResolution: "current_run",
            expectedOutput: "分析 Artifact",
          },
        ],
      }),
      nonStreamToolCallResponse("sql", "request_sql_query_execution", {
        sql: "select 1 as \"合同金额(万元)\"",
      }),
      nonStreamToolCallResponse("python-invalid", "request_python_analysis_execution", {
        script: "contract_amount_field = '合同金额(万元')\nprint(contract_amount_field)",
      }),
      nonStreamToolCallResponse("python-repaired", "request_python_analysis_execution", {
        script: "import json, sys\nrows = json.load(sys.stdin)\nfield = '合同金额(万元)'\nprint(json.dumps({'total': sum(row.get(field, 0) for row in rows)}, ensure_ascii=False))",
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
      clientRequestId: "python-syntax-repair",
      prompt: "查询并汇总合同金额",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(\"合同金额(万元)\" real)",
      approvalMode: "full_access",
    });

    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    expect(run.completedStepIds).toEqual(["query", "analysis"]);
    expect(requests.map((request) => request.model)).toEqual([
      "reasoning-model",
      "execution-model",
      "execution-model",
      "execution-model",
    ]);
    expect(run.events).toContainEqual(expect.objectContaining({
      phase: "fallback",
      detail: expect.objectContaining({ fallbackReason: "python_syntax_preflight_failed" }),
    }));
    const logs = readFileSync(toolLogPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const pythonExecutionStarts = logs.filter((log) => log.kind === "python" && log.phase === "execution-start");
    expect(pythonExecutionStarts).toHaveLength(1);
    expect(JSON.stringify(pythonExecutionStarts)).not.toContain("合同金额(万元')");
  });

  it("repairs one Python Decimal runtime type error with the execution model", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-dual-model-python-decimal-"));
    const csvPath = createCsvMetadataDatabase(temp);
    const toolLogPath = join(temp, "tools.jsonl");
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      toolCallResponse("plan", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "查询并汇总贷款余额。",
        requestedOutputs: ["query", "analysis"],
        steps: [
          {
            stepId: "query",
            toolKind: "sql_query",
            purpose: "查询贷款余额",
            dependencies: [],
            inputResolution: "selected_data_source",
            expectedOutput: "查询 Artifact",
          },
          {
            stepId: "analysis",
            toolKind: "python_analysis",
            purpose: "计算贷款余额占比",
            dependencies: ["query"],
            inputResolution: "current_run",
            expectedOutput: "分析 Artifact",
          },
        ],
      }),
      nonStreamToolCallResponse("sql", "request_sql_query_execution", {
        sql: "select 100 as \"贷款余额(万元)\"",
      }),
      nonStreamToolCallResponse("python-type-error", "request_python_analysis_execution", {
        script: [
          "import json, sys",
          "from decimal import Decimal",
          "rows = json.load(sys.stdin)",
          "amount = float(rows[0]['贷款余额(万元)'])",
          "total = Decimal('100')",
          "print(amount / total)",
        ].join("\n"),
      }),
      nonStreamToolCallResponse("python-repaired", "request_python_analysis_execution", {
        script: [
          "import json, sys",
          "from decimal import Decimal",
          "rows = json.load(sys.stdin)",
          "amount = Decimal(str(rows[0]['贷款余额(万元)']))",
          "total = Decimal('100')",
          "print(json.dumps({'amountRate': float(amount / total)}, ensure_ascii=False))",
        ].join("\n"),
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
      clientRequestId: "python-decimal-repair",
      prompt: "查询并分析贷款余额占比",
      modelName: "reasoning-model",
      executionModelName: "execution-model",
      dualModelOrchestrationEnabled: true,
      dataSourceLabel: "测试数据源",
      schemaContextMarkdown: "table test(\"贷款余额(万元)\" real)",
      approvalMode: "full_access",
    });

    const run = await waitForRun(runtime, "user-1", result.assistantMessage.id, "completed");
    expect(run.completedStepIds).toEqual(["query", "analysis"]);
    expect(requests.map((request) => request.model)).toEqual([
      "reasoning-model",
      "execution-model",
      "execution-model",
      "execution-model",
    ]);
    expect(run.events).toContainEqual(expect.objectContaining({
      phase: "fallback",
      detail: expect.objectContaining({ fallbackReason: "python_runtime_error" }),
    }));
    const logs = readFileSync(toolLogPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logs.filter((log) => log.kind === "python" && log.phase === "execution-start")).toHaveLength(2);
    expect(logs.filter((log) => log.kind === "python" && log.phase === "execution-error")).toHaveLength(1);
    expect(logs.filter((log) => log.kind === "python" && log.phase === "execution-complete")).toHaveLength(1);
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

  it("passes the complete Python analysis artifact to report generation", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-dual-model-report-context-"));
    const runtime = new AssistantRuntime({
      dbPath: join(temp, "assistant.sqlite"),
      csvSqlitePath: createCsvMetadataDatabase(temp),
      toolLogPath: join(temp, "tools.jsonl"),
      getModelApiKey: async () => "test-key",
      emit: () => undefined,
    });
    const conversation = runtime.createConversation("user-1");
    const internals = runtime as unknown as {
      toolResultRegistry: {
        register: (record: Record<string, unknown>) => Promise<void>;
      };
      toolArtifactManager: {
        createArtifact: (record: Record<string, unknown>) => Promise<void>;
      };
      buildDualModelContext: (
        input: Record<string, unknown>,
        conversation: Record<string, unknown>,
        role: "execution",
        step: Record<string, unknown>,
        tokenBudget?: number,
        messageId?: string,
      ) => Promise<string>;
    };
    const branchDistribution = Array.from({ length: 35 }, (_, index) => ({
      branchName: index === 34 ? "LAST_REAL_BRANCH_MARKER" : `分行${index + 1}`,
      totalCount: index + 1,
    }));
    const analysis = {
      deduplicatedRecordCount: branchDistribution.reduce((total, row) => total + row.totalCount, 0),
      branchDistribution,
      validation: {
        distinctBranchCount: 35,
        distributionRowCount: 35,
        branchSetReconciled: true,
        countReconciled: true,
        balanceReconciled: true,
      },
    };
    const artifactId = "assistant-python-analysis:full-report-context";
    await internals.toolArtifactManager.createArtifact({
      artifactId,
      artifactType: "report_summary",
      contentType: "json",
      content: JSON.stringify({ stdout: JSON.stringify(analysis), stderr: null }, null, 2),
      metadata: {},
    });
    const now = new Date().toISOString();
    await internals.toolResultRegistry.register({
      toolCallId: "python-report-context-source",
      conversationId: conversation.id,
      messageId: "previous-assistant-message",
      userId: "user-1",
      toolKind: "python_analysis",
      toolName: "request_python_analysis_execution",
      status: "completed",
      request: { userRequest: "按分行分析资产质量" },
      result: {
        resultId: "python-result",
        toolKind: "python_analysis",
        artifactIds: [artifactId],
        summary: "Python 分析完成。",
        createdAt: now,
        metadata: {
          resultPreview: JSON.stringify(analysis).slice(0, 2_000),
        },
      },
      outputArtifactIds: [artifactId],
      version: 1,
      isLatestSuccessful: true,
      createdAt: now,
      updatedAt: now,
    });

    const context = await internals.buildDualModelContext({
      userId: "user-1",
      prompt: "生成各分行资产质量报告",
      dataSourceLabel: "信贷风险.csv",
      approvalMode: "full_access",
    }, conversation as unknown as Record<string, unknown>, "execution", {
      stepId: "report",
      toolKind: "report_generation",
      purpose: "生成各分行资产质量报告",
      dependencies: ["python"],
      inputResolution: "history_artifact",
      expectedOutput: "Markdown 报告",
    }, 8_000, "new-assistant-message");

    expect(context).toContain("LAST_REAL_BRANCH_MARKER");
    expect(context).toContain("\"distributionRowCount\":35");
    expect(context).not.toContain("...[truncated");
  });

  it("keeps tool execution failures in tool_calls without rendering a recovery card", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-tool-error-message-"));
    const runtime = runtimeFor(temp, createCsvMetadataDatabase(temp));
    const result = await runtime.sendMessage({
      userId: "user-1",
      clientRequestId: "python-tool-error-without-card",
      prompt: "```python\nraise ValueError('expected test failure')\n```",
      modelName: "reasoning-model",
      dualModelOrchestrationEnabled: false,
      approvalMode: "full_access",
    });
    const message = await waitForMessageStatus(
      runtime,
      "user-1",
      result.conversation.id,
      result.assistantMessage.id,
      "completed",
    );

    expect(message.content).toContain("tool_calls");
    expect(message.blocks.some((block) => block.type === "card" || Boolean(block.guidance))).toBe(false);
    expect(message.blocks.some((block) => block.toolStatus === "error")).toBe(true);
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

  it("emits conversation-scoped CSV progress using the renderer attachment id", () => {
    const temp = mkdtempSync(join(tmpdir(), "cycle-probe-csv-progress-"));
    const events: AssistantStreamEvent[] = [];
    const runtime = new AssistantRuntime({
      dbPath: join(temp, "assistant.sqlite"),
      csvSqlitePath: createCsvMetadataDatabase(temp),
      toolLogPath: join(temp, "tools.jsonl"),
      getModelApiKey: async () => "test-key",
      emit: (event) => events.push(event),
    });
    const conversation = runtime.createConversation("user-1");

    const attachment = runtime.importConversationCsv({
      clientAttachmentId: "local-attachment-1",
      userId: "user-1",
      conversationId: conversation.id,
      fileName: "risk.csv",
      fileSizeBytes: 24,
      fileBuffer: new TextEncoder().encode("分类,金额\n正常,10\n关注,20\n"),
    });
    const progress = events.filter((event) => event.type === "chat-csv-progress");

    expect(attachment.status).toBe("ready");
    expect(progress[0]).toMatchObject({
      type: "chat-csv-progress",
      userId: "user-1",
      conversationId: conversation.id,
      attachmentId: "local-attachment-1",
      phase: "validating",
      percent: 20,
    });
    expect(progress.at(-1)).toMatchObject({
      phase: "ready",
      percent: 100,
      processedRows: 2,
      totalRows: 2,
    });
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

function nonStreamTextResponse(content: string) {
  return new Response(JSON.stringify({
    choices: [{
      message: { content },
      finish_reason: "stop",
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

async function waitForMessageStatus(
  runtime: AssistantRuntime,
  userId: string,
  conversationId: string,
  messageId: string,
  status: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const message = runtime.getConversationMessages(userId, conversationId)
      .find((candidate) => candidate.id === messageId);
    if (message?.status === status) return message;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`message did not reach ${status}`);
}
