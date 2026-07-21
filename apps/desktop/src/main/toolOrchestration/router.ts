import type { AgentOutputGoal, AgentToolIntent, ConversationToolState, ToolIntentItem, ToolIntentModelAdapter, ToolIntentResult, ToolKind, ToolResultRegistry } from "./types";

type RouterConfig = {
  resultRegistry: ToolResultRegistry;
  intentModelAdapter?: ToolIntentModelAdapter;
};

export class ToolIntentRouter {
  constructor(private readonly config: RouterConfig) {}

  async detect(input: { conversationId: string; userMessage: string }): Promise<ToolIntentResult> {
    const state = await this.config.resultRegistry.getConversationState(input.conversationId);
    if (this.config.intentModelAdapter) {
      const modelResult = await this.config.intentModelAdapter.detectIntent({ ...input, state });
      return {
        ...modelResult,
        agentIntent: enforceExplicitOutputGoals(input.userMessage, modelResult.agentIntent ?? agentIntentFromIntents(input.userMessage, modelResult.intents, state)),
      };
    }
    return detectWithRules(input.conversationId, input.userMessage, state);
  }
}

export function detectWithRules(conversationId: string, userMessage: string, state?: ConversationToolState | null): ToolIntentResult {
  const text = userMessage.trim();
  const intents: ToolIntentItem[] = [];
  const explicitInputRefs = extractExplicitInputRefs(text);
  const isRefine = /(改成|改为|调整|增加|删除|排除|重新|再查|继续修改|基于.*版本|上一版|第一次|第二次|v\d+)/i.test(text);
  const referencesPriorResult = /(sql\s*查询结果|查询数据结果|查询结果数据|查询结果|上一轮|上一次|刚才|最近|工具调用结果|结果数据)/i.test(text);
  const referencesAnalysisResult = /(数据分析结果|分析结果|python\s*分析结果|工具分析结果|上一轮分析|最近分析|当前分析|当前结果|刚才的结果|上一轮结果)/i.test(text);
  const explicitlyRequestsNewQuery = /(重新查询|重新查|再查询|再查|重新检索|重新获取|重新读取)/i.test(text);
  const hasSqlArtifact = hasUsableArtifact(state?.latestSuccessfulSqlToolCallId, state?.latestSuccessfulSqlArtifactIds);
  const hasPythonArtifact = hasUsableArtifact(state?.latestSuccessfulPythonToolCallId, state?.latestSuccessfulPythonArtifactIds);
  const hasChartArtifact = hasUsableArtifact(state?.latestSuccessfulChartToolCallId, state?.latestSuccessfulChartArtifactIds);

  const explicitGoals = explicitGoalsFromText(text);
  const rawWantsQuery = explicitGoals.query || /(统计.*数据|数据源|数据库|SQL|sql)/i.test(text);
  const wantsChart = explicitGoals.chart;
  const wantsReport = explicitGoals.report;
  const canAnalyzeFromHistory = hasSqlArtifact && !explicitlyRequestsNewQuery;
  const canChartFromHistory = (hasPythonArtifact || hasSqlArtifact) && !explicitlyRequestsNewQuery;
  const canReportFromHistory = (hasPythonArtifact || hasChartArtifact || hasSqlArtifact) && !explicitlyRequestsNewQuery;
  const wantsQuery = rawWantsQuery && (!referencesPriorResult || explicitlyRequestsNewQuery) && !(canAnalyzeFromHistory && !wantsChart && !wantsReport);
  const wantsPython =
    (explicitGoals.analysis || /(Python|python)/i.test(text)) &&
    !onlyChartOrReport(text) &&
    !((wantsReport || wantsChart) && (referencesAnalysisResult || canChartFromHistory || canReportFromHistory) && !wantsQuery);

  if (wantsQuery) {
    intents.push(intent("sql_query", isRefine ? "refine" : "create", text, [], explicitInputRefs, 0.92));
  }
  if (wantsPython) {
    const dependsOn: ToolKind[] = wantsQuery ? ["sql_query"] : [];
    intents.push(intent("python_analysis", isRefine ? "refine" : "create", text, dependsOn, explicitInputRefs, 0.9));
  }
  if (wantsChart) {
    const dependsOn: ToolKind[] = wantsPython ? ["python_analysis"] : wantsQuery ? ["sql_query"] : [];
    intents.push(intent("chart_rendering", isRefine ? "refine" : "create", text, dependsOn, explicitInputRefs, 0.9));
  }
  if (wantsReport) {
    const dependsOn: ToolKind[] = wantsChart ? ["chart_rendering"] : wantsPython ? ["python_analysis"] : wantsQuery ? ["sql_query"] : [];
    intents.push(intent("report_generation", isRefine ? "refine" : "create", text, dependsOn, explicitInputRefs, 0.88));
  }

  const result = {
    conversationId,
    userMessage,
    intents,
    agentIntent: enforceExplicitOutputGoals(text, agentIntentFromIntents(text, intents, state)),
    requiresClarification: intents.length === 0,
    clarificationQuestion: intents.length === 0 ? "请说明需要查询、分析、绘图还是生成报告。" : undefined,
    confidence: intents.length > 0 ? Math.min(...intents.map((item) => item.confidence)) : 0.2,
  };
  return result;
}

export function enforceExplicitOutputGoals(userMessage: string, intent: AgentToolIntent): AgentToolIntent {
  const explicit = explicitGoalsFromText(userMessage);
  const next: AgentToolIntent = {
    ...intent,
    goals: { ...intent.goals },
    explicitGoals: { ...intent.explicitGoals },
    dataRequirements: { ...intent.dataRequirements },
  };
  for (const goal of ["query", "analysis", "chart", "report"] as AgentOutputGoal[]) {
    if (explicit[goal]) {
      next.goals[goal] = true;
      next.explicitGoals[goal] = true;
    }
  }
  next.dataRequirements.requiresSqlResult = next.goals.analysis || next.goals.chart || next.goals.report;
  const outputCount = (Object.values(next.explicitGoals).filter(Boolean).length || Object.values(next.goals).filter(Boolean).length);
  next.requestType = outputCount > 1 ? "compound" : "single_tool";
  return next;
}

function hasUsableArtifact(toolCallId?: string, artifactIds?: string[]) {
  return Boolean(toolCallId && artifactIds && artifactIds.length > 0);
}

function agentIntentFromIntents(userMessage: string, intents: ToolIntentItem[], state?: ConversationToolState | null): AgentToolIntent {
  const goals: Record<AgentOutputGoal, boolean> = {
    query: intents.some((item) => item.toolKind === "sql_query"),
    analysis: intents.some((item) => item.toolKind === "python_analysis"),
    chart: intents.some((item) => item.toolKind === "chart_rendering"),
    report: intents.some((item) => item.toolKind === "report_generation"),
  };
  const explicitGoals = explicitGoalsFromText(userMessage);
  const hasSql = hasUsableArtifact(state?.latestSuccessfulSqlToolCallId, state?.latestSuccessfulSqlArtifactIds);
  return {
    requestType: Object.values(explicitGoals).filter(Boolean).length > 1 || intents.length > 1 ? "compound" : "single_tool",
    goals,
    explicitGoals,
    dataRequirements: {
      requiresSqlResult: goals.analysis || goals.chart || goals.report,
      canReuseExistingSqlResult: hasSql,
    },
    analysisGoal: goals.analysis ? userMessage : undefined,
    chartGoal: goals.chart ? userMessage : undefined,
    reportGoal: goals.report ? userMessage : undefined,
    unresolvedInputs: [],
  };
}

function explicitGoalsFromText(text: string): Record<AgentOutputGoal, boolean> {
  return {
    query: /(查询|筛选|检索|找出|读取|查找|抽取|提取|列出|明细|SQL|sql)/i.test(text),
    analysis: /(分析|计算|统计|计数|总计|数量|笔数|条数|个数|多少\s*(例|笔|条|个)?|各有多少|共有多少|占比|比例|比率|集中度|特征|排序|排名)/i.test(text),
    chart: /(绘制|画图|绘图|画出|画一个|图表|柱状图|条形图|折线图|趋势图|饼图|热力图|散点图|分布图|结构图|比率图|占比图|排名图|变化趋势|KPI|可视化|渲染成图|展示成图|变成.{0,12}图|改为.{0,12}图)/i.test(text),
    report: /(报告|生成报告|分析报告|Markdown|markdown|汇报|总结成文档|整理成文档)/i.test(text),
  };
}

function intent(toolKind: ToolKind, action: ToolIntentItem["action"], purpose: string, dependsOn: ToolKind[], explicitInputRefs: string[], confidence: number): ToolIntentItem {
  return {
    toolKind,
    action,
    purpose,
    dependsOn,
    explicitInputRefs: explicitInputRefs.length > 0 ? explicitInputRefs : undefined,
    requestedChanges: action === "refine" ? { instruction: purpose } : undefined,
    confidence,
  };
}

function onlyChartOrReport(text: string) {
  return /(画|图|报告)/.test(text) && !/(分析|计算|统计|占比|比例|分布|集中度|特征)/.test(text);
}

function extractExplicitInputRefs(text: string) {
  const refs = new Set<string>();
  for (const match of text.matchAll(/\b(?:toolCallId|tool|调用|SQL|Python|图表|报告)?\s*(v\d+|[a-z]+_[a-z0-9-]{6,}|artifact[_:-][a-z0-9-]+)/gi)) {
    refs.add(match[1]);
  }
  if (/第一次|第一轮|v1/i.test(text)) {
    refs.add("v1");
  }
  if (/第二次|第二轮|v2/i.test(text)) {
    refs.add("v2");
  }
  if (/上一版|上一轮|刚才|最近/i.test(text)) {
    refs.add("latest");
  }
  return Array.from(refs);
}
