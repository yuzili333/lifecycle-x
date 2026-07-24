import {
  createStreamingModelAdapter,
  type ConversationMessage,
  type JsonSchema,
  type ModelRequestOptions,
  type ModelStreamEvent,
  type ToolDefinition,
} from "../streamingModelAdapter";
import { TOOL_NAMES, TOOL_SCHEMAS, type ToolKind } from "../toolOrchestration";
import type { PlannerDecision, PlannerStep } from "./types";
import { taskRouteSchema } from "./taskRouter";

export type ModelEndpointConfig = {
  providerName: string;
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  firstEventTimeoutMs?: number;
  requestOptions?: ModelRequestOptions;
  profileName?: string;
  modelRole?: "reasoning" | "execution";
  orchestrationPhase?: string;
};

export type TaskRouterAdapterInput = {
  conversationId: string;
  messageId: string;
  messages: ConversationMessage[];
  signal?: AbortSignal;
  repairErrors?: string[];
  onEvent?: (event: ModelStreamEvent) => void;
  onSummaryDelta?: (delta: string) => void;
};

export type TaskRouterAdapterOutput = {
  route?: unknown;
  content: string;
  traceId?: string;
  error?: string;
  errorCode?: string;
  errorCause?: string;
};

export class TaskRouterAdapter {
  constructor(private readonly config: ModelEndpointConfig) {}

  async route(input: TaskRouterAdapterInput): Promise<TaskRouterAdapterOutput> {
    const adapter = createStreamingModelAdapter({ ...this.config, toolExecutionMode: "serial", maxToolRounds: 1 });
    let capturedRoute: unknown;
    let content = "";
    let traceId: string | undefined;
    let error: string | undefined;
    let errorCode: string | undefined;
    let errorCause: string | undefined;
    let streamedSummary = "";
    adapter.registerTool({
      name: "submit_task_route",
      description: "提交结构化任务路由。只判断任务类型、复杂度和所需能力，不生成 SQL、Python、图表配置或报告正文。",
      inputSchema: taskRouteSchema,
      riskLevel: "low",
      handler: async (value) => {
        capturedRoute = value;
        return { accepted: true };
      },
    });
    const messages = input.repairErrors?.length
      ? [...input.messages, message("user", `上一版路由不合法，只修复这些问题并重新调用 submit_task_route：${input.repairErrors.join("；")}`)]
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
      timeoutMs: this.config.timeoutMs,
      requestOptions: this.config.requestOptions,
      metadata: { modelRole: "execution", executionProfile: "router", orchestrationPhase: "routing" },
    })) {
      traceId = event.traceId ?? traceId;
      input.onEvent?.(event);
      if (event.type === "text-delta") {
        const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
        content += delta;
        input.onSummaryDelta?.(delta);
      } else if (event.type === "tool-call-delta") {
        const argumentsText = typeof event.payload.argumentsText === "string" ? event.payload.argumentsText : "";
        const summary = extractPartialJsonStringField(argumentsText, "userVisibleSummary");
        if (summary.length > streamedSummary.length) {
          input.onSummaryDelta?.(summary.slice(streamedSummary.length));
          streamedSummary = summary;
        }
      } else if (event.type === "stream-error") {
        const serialized = event.payload.error as { code?: string; message?: string; cause?: string } | undefined;
        error = serialized?.message ?? "任务路由模型调用失败。";
        errorCode = serialized?.code;
        errorCause = serialized?.cause;
      }
    }
    return { route: capturedRoute, content, traceId, error, errorCode, errorCause };
  }
}

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
  errorCode?: string;
  errorCause?: string;
  reasoningObserved: boolean;
};

export class ReasoningPlannerAdapter {
  constructor(private readonly config: ModelEndpointConfig) {}

  async plan(input: PlannerAdapterInput): Promise<PlannerAdapterOutput> {
    const adapter = createStreamingModelAdapter({ ...this.config, toolExecutionMode: "serial", maxToolRounds: 1 });
    let capturedDecision: unknown;
    let content = "";
    let traceId: string | undefined;
    let error: string | undefined;
    let errorCode: string | undefined;
    let errorCause: string | undefined;
    let reasoningObserved = false;
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
      firstEventTimeoutMs: this.config.firstEventTimeoutMs,
      requestOptions: this.config.requestOptions,
      metadata: {
        modelRole: this.config.modelRole ?? "reasoning",
        orchestrationPhase: this.config.orchestrationPhase ?? "planning",
        ...(this.config.profileName ? { executionProfile: this.config.profileName } : {}),
      },
    })) {
      traceId = event.traceId ?? traceId;
      input.onEvent?.(event);
      if (event.type === "model-observation" && event.payload.phase === "reasoning-progress") {
        reasoningObserved = true;
      }
      if (event.type === "text-delta") {
        const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
        content += delta;
        input.onContentDelta?.(delta);
      }
      if (event.type === "stream-error") {
        const serialized = event.payload.error as { code?: string; message?: string; cause?: string } | undefined;
        error = serialized?.message ?? "规划调用失败。";
        errorCode = serialized?.code;
        errorCause = serialized?.cause;
      }
    }
    return { decision: capturedDecision, content, traceId, error, errorCode, errorCause, reasoningObserved };
  }
}

export class AnalysisPlanningAdapter {
  constructor(private readonly config: ModelEndpointConfig) {}

  async plan(input: PlannerAdapterInput): Promise<PlannerAdapterOutput> {
    const adapter = createStreamingModelAdapter({ ...this.config, toolExecutionMode: "serial", maxToolRounds: 0 });
    let content = "";
    let traceId: string | undefined;
    let error: string | undefined;
    let errorCode: string | undefined;
    let errorCause: string | undefined;
    let reasoningObserved = false;
    for await (const event of adapter.streamChat({
      conversationId: input.conversationId,
      messageId: input.messageId,
      messages: input.messages,
      model: this.config.model,
      contentType: "text",
      maxToolRounds: 0,
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? this.config.timeoutMs,
      firstEventTimeoutMs: this.config.firstEventTimeoutMs,
      requestOptions: this.config.requestOptions,
      metadata: {
        modelRole: "reasoning",
        orchestrationPhase: "analysis_planning",
        thinkingProfile: this.config.profileName,
      },
    })) {
      traceId = event.traceId ?? traceId;
      input.onEvent?.(event);
      if (event.type === "model-observation" && event.payload.phase === "reasoning-progress") {
        reasoningObserved = true;
      }
      if (event.type === "text-delta") {
        const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
        content += delta;
        input.onContentDelta?.(delta);
      } else if (event.type === "stream-error") {
        const serialized = event.payload.error as { code?: string; message?: string; cause?: string } | undefined;
        error = serialized?.message ?? "规划调用失败。";
        errorCode = serialized?.code;
        errorCause = serialized?.cause;
      }
    }
    return { content, traceId, error, errorCode, errorCause, reasoningObserved };
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
  onReportDelta?: (delta: string) => void;
};

export type ExecutionAdapterOutput = {
  invoked: boolean;
  output?: unknown;
  toolCallId?: string;
  content: string;
  traceId?: string;
  error?: string;
  errorCode?: string;
  errorStage?: "provider" | "schema" | "handler";
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
    let errorCode: string | undefined;
    let errorStage: ExecutionAdapterOutput["errorStage"];
    let streamedReport = "";
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
      requestOptions: this.config.requestOptions,
      metadata: {
        modelRole: "execution",
        orchestrationPhase: "parameter_generation",
        executionProfile: this.config.profileName,
        stepId: input.step.stepId,
        toolKind: input.step.toolKind,
      },
    })) {
      traceId = event.traceId ?? traceId;
      input.onEvent?.(event);
      if (event.type === "tool-call-start") {
        invoked = true;
        toolCallId = event.toolCallId;
      } else if (event.type === "tool-call-delta" && input.step.toolKind === "report_generation") {
        const argumentsText = typeof event.payload.argumentsText === "string" ? event.payload.argumentsText : "";
        const markdown = extractPartialJsonStringField(argumentsText, "markdown");
        if (markdown.length > streamedReport.length) {
          input.onReportDelta?.(markdown.slice(streamedReport.length));
          streamedReport = markdown;
        }
      } else if (event.type === "text-delta") {
        content += typeof event.payload.delta === "string" ? event.payload.delta : "";
      } else if (event.type === "tool-execution-result") {
        const result = event.payload.result as { output?: unknown } | undefined;
        output = result?.output;
      } else if (event.type === "tool-execution-error" || event.type === "stream-error") {
        const serialized = event.type === "stream-error"
          ? event.payload.error as { code?: string; message?: string } | undefined
          : (event.payload.result as { error?: { code?: string; message?: string } } | undefined)?.error;
        error = serialized?.message ?? "工具参数生成失败。";
        errorCode = serialized?.code;
        errorStage = event.type === "stream-error"
          ? "provider"
          : serialized?.code === "TOOL_INPUT_INVALID" ? "schema" : "handler";
      }
    }
    return { invoked, output, toolCallId, content, traceId, error, errorCode, errorStage };
  }
}

export function executionToolName(toolKind: ToolKind) {
  return TOOL_NAMES[toolKind];
}

export function executionToolSchema(toolKind: ToolKind) {
  return EXECUTION_PARAMETER_SCHEMAS[toolKind];
}

export function executionToolDescription(toolKind: ToolKind) {
  if (toolKind === "sql_query") {
    return "为当前步骤提交一条只读 SQL。只生成 sql；用户需求、步骤目的、数据源和审批上下文由客户端注入。";
  }
  if (toolKind === "python_analysis") {
    return "为当前步骤提交受控 Python 脚本。只生成 script；数据与 Artifact 血缘由客户端注入。";
  }
  if (toolKind === "chart_rendering") {
    return "为当前步骤提交声明式图表参数。只生成标题、图表类型、维度、指标及可选排序/颜色字段；禁止生成 VisualizationSpec、ECharts option、内联数据和 Artifact 参数。";
  }
  return "为当前步骤提交报告标题和 Markdown 正文；Artifact 与图表引用由客户端注入。";
}

const EXECUTION_PARAMETER_SCHEMAS: Record<ToolKind, JsonSchema> = {
  sql_query: {
    type: "object",
    additionalProperties: false,
    required: ["sql"],
    properties: {
      sql: {
        type: "string",
        minLength: 1,
        description: "单条只读 SQL。只查询当前步骤所需的真实明细字段；统计、占比和排序由后续 Python 步骤完成。",
      },
    },
  },
  python_analysis: {
    type: "object",
    additionalProperties: false,
    required: ["script"],
    properties: {
      script: {
        type: "string",
        minLength: 1,
        description: "使用标准库、只读取当前步骤已注入数据的 Python 脚本。",
      },
    },
  },
  chart_rendering: {
    type: "object",
    additionalProperties: false,
    required: ["title", "chartType", "dimensionFields", "measureFields"],
    properties: {
      title: { type: "string", minLength: 1, description: "图表标题。" },
      chartType: {
        type: "string",
        enum: ["kpi", "line", "area", "bar", "horizontal_bar", "stacked_bar", "bar_line_combo", "scatter", "bubble", "heatmap", "histogram", "pareto", "funnel", "waterfall", "table"],
        description: "图表类型。横向条形图必须使用 horizontal_bar。",
      },
      dimensionFields: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 1 },
        description: "上游结果摘要中真实存在的类别或分组字段。",
      },
      measureFields: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 1 },
        description: "上游结果摘要中真实存在的数值、数量、金额、占比或比率字段。",
      },
      sortBy: { type: "string", minLength: 1 },
      sortDirection: { type: "string", enum: ["asc", "desc"] },
      colorBy: { type: "string", minLength: 1 },
    },
  },
  report_generation: {
    type: "object",
    additionalProperties: false,
    required: ["title", "markdown"],
    properties: {
      title: { type: "string", minLength: 1 },
      markdown: {
        type: "string",
        minLength: 1,
        description: "仅依据当前步骤已注入 Artifact 摘要生成的完整 Markdown 报告正文。不得生成 evidenceCardId、证据 JSON 或工具血缘；系统会在落库时插入真实溯据卡。",
      },
    },
  },
};

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

export function buildTaskRouterSystemPrompt() {
  return [
    "你是数据探针 Agent 的快速任务路由模型，必须调用 submit_task_route。",
    "L0=元数据查看或确定性格式操作；L1=单表单步骤查询；L2=查询后分析、图表或报告等常规多步骤任务；L3=歧义、异常归因、多轮验证或复杂编排；L4=用户明确要求深度分析或高风险专题研究。",
    "L0/L1 的 requiresKimi 必须为 false；L2-L4 必须为 true。",
    "只标记用户明确要求或安全执行所必需的 SQL、Python、图表、报告能力，不得自行扩展任务。",
    "userVisibleSummary 使用一句面向用户的任务理解摘要，不包含内部 Prompt、Schema 全文、脚本或敏感字段。",
    "confidence 使用 0 到 1。存在歧义时写入 ambiguities，并准确标记是否阻塞。",
    "上下文已给出当前数据源或 activeDataset 时，不得把“存在多个数据集”标记为阻塞歧义；用户未指定具体数据集时默认使用最近更新的数据集。",
    "禁止生成 SQL、Python、图表配置、Markdown 报告或虚构结果。",
  ].join("\n");
}

export function taskRouterMessages(systemContext: string, userPrompt: string): ConversationMessage[] {
  return [message("system", `${buildTaskRouterSystemPrompt()}\n\n${systemContext}`), message("user", userPrompt)];
}

export function buildAnalysisPlanSystemPrompt() {
  return [
    "你是数据探针 Agent 的复杂任务决策模型，只生成结构化 AnalysisPlan。",
    "最终 content 只能是一个 JSON 对象，必须严格使用以下结构；所有数组字段都必须存在，没有内容时输出空数组：",
    '{"goal":"任务目标","businessDefinitions":[{"metric":"指标名","definition":"口径定义","source":"可选来源"}],"requiredData":[{"source":"可选来源","table":"真实表或数据集名称","fields":["真实字段名"],"purpose":"用途"}],"steps":[{"id":"query","type":"sql","purpose":"步骤目的","dependsOn":[]}],"validationRules":[{"id":"rule_1","description":"校验说明","severity":"error"}],"reportOutline":[],"assumptions":[],"unresolvedAmbiguities":[]}',
    "businessDefinitions 每项必须包含 metric、definition；requiredData 每项必须包含 table、fields、purpose；validationRules 每项必须包含 id、description、severity。",
    "steps 至少一项，每项必须包含 id、type、purpose，dependsOn 必须是步骤 id 数组；type 仅允许 schema、sql、python、chart、validation、report。",
    "步骤 id 必须稳定、简短、唯一；依赖只能引用 steps 中已经定义的 id，禁止循环依赖。",
    "sql 只负责从真实数据源读取、筛选后续所需的明细字段；统计、汇总、计数、占比、比率、排序和派生指标必须使用 python。",
    "需要先查询再统计的任务只能包含一个明细 sql 步骤和后续 python 步骤，禁止用第二个 sql 重复读取同一批明细数据。",
    "图表或报告依赖查询结果中的统计指标时，steps 必须包含 python，并让 chart/report 依赖该 python 步骤或其下游步骤。",
    "不得生成 SQL、Python 脚本、VisualizationSpec、Markdown 正文或虚构数据。",
    "只规划用户明确要求的目标；已有可靠 Artifact 时优先复用。",
    "上下文存在当前数据源或 activeDataset 时直接使用；多个候选数据集且用户未指定时默认选择最近更新的数据集，不得因此要求用户再次确认。",
    "不要输出思维链、Markdown 代码围栏或 JSON 之外的解释。",
  ].join("\n");
}

export function analysisPlanMessages(systemContext: string, userPrompt: string, repairErrors?: string[]): ConversationMessage[] {
  const messages = [message("system", `${buildAnalysisPlanSystemPrompt()}\n\n${systemContext}`), message("user", userPrompt)];
  if (repairErrors?.length) {
    messages.push(message("user", `上一版 AnalysisPlan 不合法。只修复以下结构问题并重新输出完整 JSON：${repairErrors.join("；")}`));
  }
  return messages;
}

export function buildExecutionSystemPrompt(step: PlannerStep, tool: ToolDefinition) {
  const canonicalParameterRule = step.toolKind === "sql_query"
    ? "只生成非空 sql；userRequest、purpose、数据源和血缘参数由客户端注入，不要输出这些字段。"
    : step.toolKind === "python_analysis"
      ? "只生成非空 script，并仅使用上游结果摘要中存在的真实字段；Artifact 血缘由客户端注入。"
      : step.toolKind === "chart_rendering"
        ? "只提供 title、chartType、dimensionFields、measureFields 及可选排序/颜色字段；禁止生成 visualizationSpec、ECharts option 或内联数据。维度和指标必须来自上游结果摘要。"
        : "只提供 title 和非空 markdown；正文只能使用上游分析摘要和 Artifact 中已经存在的结论，引用关系由客户端注入。正文不得显示 Artifact ID、toolCallId、内部工具名称或“上游 Python 分析结果”等内部血缘信息，直接陈述分析结果并嵌入可视化节点。禁止使用 Markdown 图片语法或 HTML img 标签表示图表，图表仅由客户端注入的受控可视化节点展示。";
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

export function extractPartialJsonStringField(source: string, field: string) {
  const fieldIndex = source.search(new RegExp(`"${escapeRegExp(field)}"\\s*:\\s*"`));
  if (fieldIndex < 0) return "";
  const start = source.indexOf('"', source.indexOf(":", fieldIndex) + 1) + 1;
  let raw = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (!escaped && character === '"') break;
    raw += character;
    if (!escaped && character === "\\") escaped = true;
    else escaped = false;
  }
  try {
    return JSON.parse(`"${raw.replace(/\\$/, "")}"`) as string;
  } catch {
    return raw
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
