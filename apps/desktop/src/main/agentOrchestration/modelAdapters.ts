import { createStreamingModelAdapter, type ConversationMessage, type JsonSchema, type ModelStreamEvent, type ToolDefinition } from "../streamingModelAdapter";
import { TOOL_NAMES, TOOL_SCHEMAS, type ToolKind } from "../toolOrchestration";
import type { PlannerDecision, PlannerStep } from "./types";

export type ModelEndpointConfig = {
  providerName: string;
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

export type PlannerAdapterInput = {
  conversationId: string;
  messageId: string;
  messages: ConversationMessage[];
  signal?: AbortSignal;
  timeoutMs?: number;
  repairErrors?: string[];
  onEvent?: (event: ModelStreamEvent) => void;
  onContentDelta?: (delta: string) => void;
};

export type PlannerAdapterOutput = {
  decision?: unknown;
  content: string;
  traceId?: string;
  error?: string;
};

export class ReasoningPlannerAdapter {
  constructor(private readonly config: ModelEndpointConfig) {}

  async plan(input: PlannerAdapterInput): Promise<PlannerAdapterOutput> {
    const adapter = createStreamingModelAdapter({ ...this.config, toolExecutionMode: "serial", maxToolRounds: 1 });
    let capturedDecision: unknown;
    let content = "";
    let traceId: string | undefined;
    let error: string | undefined;
    adapter.registerTool({
      name: "submit_agent_execution_plan",
      description: "提交本轮结构化执行计划。只描述目标、工具、依赖、输入来源和预期产物；禁止生成 SQL、Python 脚本或虚构结果。",
      inputSchema: plannerDecisionSchema,
      riskLevel: "low",
      handler: async (value) => {
        capturedDecision = value;
        return { accepted: true };
      },
    });
    const messages = input.repairErrors?.length
      ? [...input.messages, message("user", `上一版计划未通过校验，请只修复这些问题并重新调用 submit_agent_execution_plan：${input.repairErrors.join("；")}`)]
      : input.messages;
    for await (const event of adapter.streamChat({
      conversationId: input.conversationId,
      messageId: input.messageId,
      messages,
      model: this.config.model,
      contentType: "text",
      maxToolRounds: 1,
      stopAfterToolExecution: true,
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? this.config.timeoutMs,
      metadata: { modelRole: "reasoning", orchestrationPhase: "planning" },
    })) {
      traceId = event.traceId ?? traceId;
      input.onEvent?.(event);
      if (event.type === "text-delta") {
        const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
        content += delta;
        input.onContentDelta?.(delta);
      }
      if (event.type === "stream-error") {
        const serialized = event.payload.error as { message?: string } | undefined;
        error = serialized?.message ?? "推理模型调用失败。";
      }
    }
    return { decision: capturedDecision, content, traceId, error };
  }
}

export type ExecutionAdapterInput = {
  conversationId: string;
  messageId: string;
  step: PlannerStep;
  messages: ConversationMessage[];
  tool: ToolDefinition;
  signal?: AbortSignal;
  onEvent?: (event: ModelStreamEvent) => void;
};

export type ExecutionAdapterOutput = {
  invoked: boolean;
  output?: unknown;
  toolCallId?: string;
  content: string;
  traceId?: string;
  error?: string;
};

export class ExecutionParameterAdapter {
  constructor(private readonly config: ModelEndpointConfig) {}

  async execute(input: ExecutionAdapterInput): Promise<ExecutionAdapterOutput> {
    const adapter = createStreamingModelAdapter({ ...this.config, toolExecutionMode: "serial", maxToolRounds: 1 });
    adapter.registerTool(input.tool);
    let invoked = false;
    let output: unknown;
    let toolCallId: string | undefined;
    let content = "";
    let traceId: string | undefined;
    let error: string | undefined;
    for await (const event of adapter.streamChat({
      conversationId: input.conversationId,
      messageId: input.messageId,
      messages: input.messages,
      model: this.config.model,
      contentType: "text",
      maxToolRounds: 1,
      stopAfterToolExecution: true,
      signal: input.signal,
      timeoutMs: this.config.timeoutMs,
      metadata: { modelRole: "execution", orchestrationPhase: "parameter_generation", stepId: input.step.stepId, toolKind: input.step.toolKind },
    })) {
      traceId = event.traceId ?? traceId;
      input.onEvent?.(event);
      if (event.type === "tool-call-start") {
        invoked = true;
        toolCallId = event.toolCallId;
      } else if (event.type === "text-delta") {
        content += typeof event.payload.delta === "string" ? event.payload.delta : "";
      } else if (event.type === "tool-execution-result") {
        const result = event.payload.result as { output?: unknown } | undefined;
        output = result?.output;
      } else if (event.type === "tool-execution-error" || event.type === "stream-error") {
        const serialized = event.type === "stream-error"
          ? event.payload.error as { message?: string } | undefined
          : (event.payload.result as { error?: { message?: string } } | undefined)?.error;
        error = serialized?.message ?? "执行模型参数生成失败。";
      }
    }
    return { invoked, output, toolCallId, content, traceId, error };
  }
}

export function executionToolName(toolKind: ToolKind) {
  return TOOL_NAMES[toolKind];
}

export function executionToolSchema(toolKind: ToolKind) {
  return TOOL_SCHEMAS[toolKind];
}

export function buildPlannerSystemPrompt() {
  return [
    "你是数据探针 Agent 的推理编排模型，只负责意图识别和任务规划。",
    "需要工具时必须调用 submit_agent_execution_plan；不得生成 SQL、Python 脚本、图表配置、报告正文或虚构数据。",
    "工具顺序只能由用户目标和可复用 Artifact 决定：查询使用 sql_query，统计分析使用 python_analysis，绘图使用 chart_rendering，报告使用 report_generation。",
    "显式要求图表或报告时，计划必须包含对应步骤；需要新数据时在其前加入查询，需要计算时加入分析。",
    "能够复用历史 Artifact 时不要重复查询。信息不足时 outcome=clarify，并给出结合当前上下文的具体补充建议。",
    "无需工具的普通问答可以直接输出自然语言，不要调用计划工具。",
    "不要输出内部思维链；summary 只写可向用户展示的简短决策依据。",
  ].join("\n");
}

export function buildExecutionSystemPrompt(step: PlannerStep, tool: ToolDefinition) {
  const canonicalParameterRule = step.toolKind === "sql_query"
    ? "必须提供非空 sql；不要使用 script 别名。"
    : step.toolKind === "python_analysis"
      ? "必须提供非空 script，并仅使用上游结果摘要中存在的真实字段。"
      : step.toolKind === "chart_rendering"
        ? "优先提供声明式 title、chartType、dimensionFields、measureFields；维度或指标至少有一项，字段必须来自上游结果摘要。"
        : "必须提供非空 markdown；正文只能使用上游分析摘要和 Artifact 中已经存在的结论。";
  return [
    "你是数据探针 Agent 的执行模型，只为当前一个确定步骤生成工具参数。",
    `当前步骤：${step.purpose}`,
    `预期产物：${step.expectedOutput}`,
    `唯一允许调用的工具：${tool.name}`,
    "必须调用该工具一次；不得改变执行计划、增加分析维度或输出用户未要求的内容。",
    "参数必须严格符合工具 Schema，并使用上下文中的真实表名、字段名和 Artifact ID。",
    canonicalParameterRule,
    "SQL 仅允许单条只读查询；复合分析任务的 SQL 返回后续需要的明细字段，统计、占比和排序交给 Python。",
    "Python 只能使用标准库和已授权输入 Artifact，不得连接业务数据库或构造模拟数据。",
    "不要在普通文本中输出脚本或参数。",
  ].join("\n");
}

export function plannerMessages(systemContext: string, userPrompt: string): ConversationMessage[] {
  return [message("system", `${buildPlannerSystemPrompt()}\n\n${systemContext}`), message("user", userPrompt)];
}

export function executionMessages(systemContext: string, userPrompt: string, step: PlannerStep, tool: ToolDefinition): ConversationMessage[] {
  return [message("system", `${buildExecutionSystemPrompt(step, tool)}\n\n${systemContext}`), message("user", userPrompt)];
}

function message(role: ConversationMessage["role"], content: string): ConversationMessage {
  return { id: `agent-${role}-${Math.random().toString(36).slice(2)}`, role, content, createdAt: new Date().toISOString() };
}

const plannerStepSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["stepId", "toolKind", "purpose", "dependencies", "inputResolution", "expectedOutput"],
  properties: {
    stepId: { type: "string" },
    toolKind: { type: "string", enum: ["sql_query", "python_analysis", "chart_rendering", "report_generation"] },
    purpose: { type: "string" },
    dependencies: { type: "array", items: { type: "string" } },
    inputResolution: { type: "string", enum: ["selected_data_source", "current_run", "conversation_history", "artifact_lineage"] },
    expectedOutput: { type: "string" },
  },
};

const plannerDecisionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary", "requestedOutputs", "steps"],
  properties: {
    outcome: { type: "string", enum: ["execute", "respond", "clarify"] },
    summary: { type: "string" },
    responseText: { type: "string" },
    requestedOutputs: { type: "array", items: { type: "string", enum: ["query", "analysis", "chart", "report"] } },
    steps: { type: "array", items: plannerStepSchema },
  },
};

export function isPlannerDecision(value: unknown): value is PlannerDecision {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
