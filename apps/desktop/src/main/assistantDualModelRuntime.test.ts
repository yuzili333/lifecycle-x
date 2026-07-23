import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantRuntime, type AssistantStreamEvent } from "./assistantRuntime";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

describe("AssistantRuntime dual-model flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
      toolCallResponse("sql-call", "request_sql_query_execution", {
        userRequest: "查询一条数据",
        purpose: "验证双模型执行链路",
        sql: "select 1 as value",
      }, true),
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

    const responses = [
      toolCallResponse("invalid-plan", "submit_agent_execution_plan", {
        outcome: "execute",
        summary: "缺少步骤的非法计划",
        requestedOutputs: ["query"],
        steps: [],
      }),
      textResponse("模型说明：当前信息不足，无法形成合法执行计划。"),
    ];
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
      toolCallResponse("sql-call", "request_sql_query_execution", {
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
});

function toolCallResponse(id: string, name: string, input: Record<string, unknown>, omitName = false) {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { ...(!omitName ? { name } : {}), arguments: JSON.stringify(input) } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
