import type {
  AgentOutputGoal,
  ConversationToolState,
  ToolExecutionPlan,
  ToolExecutionPlanStep,
  ToolInputStrategy,
  ToolIntentResult,
  ToolKind,
  ToolPlanValidationResult,
  ToolStepInputResolution,
} from "./types";
import { TOOL_NAMES } from "./types";
import { createId, nowIso, toolError, unique } from "./utils";

export class ToolPlanBuilder {
  build(input: {
    conversationId: string;
    userId: string;
    userMessage: string;
    userMessageId?: string;
    intentResult: ToolIntentResult;
    toolState?: ConversationToolState | null;
    selectedDataSourceAvailable?: boolean;
    activeTableCount?: number;
    planningStartedAtMs?: number;
  }): ToolExecutionPlan {
    const createdAt = nowIso();
    const requestedOutputs = requestedOutputsFromIntent(input.intentResult);
    const requestType = requestedOutputs.length > 1 ? "compound" : "single_tool";
    const hasReusableSql = Boolean(input.toolState?.latestSuccessfulSqlToolCallId && input.toolState.latestSuccessfulSqlArtifactIds?.length);
    const needsSql = requestedOutputs.some((goal) => goal === "analysis" || goal === "chart" || goal === "report");
    const shouldAutoAddSql =
      needsSql &&
      !hasReusableSql &&
      input.selectedDataSourceAvailable === true &&
      input.activeTableCount !== 0 &&
      !input.intentResult.intents.some((intent) => intent.toolKind === "sql_query");
    const sourceIntents = shouldAutoAddSql
      ? [{
          toolKind: "sql_query" as ToolKind,
          action: "create" as const,
          purpose: "自动补充 SQL 查询结果作为后续工具输入。",
          dependsOn: [],
          confidence: 1,
        }, ...input.intentResult.intents]
      : input.intentResult.intents;
    const steps: ToolExecutionPlanStep[] = sourceIntents.map((intent) => ({
      stepId: createId("step"),
      toolKind: intent.toolKind,
      toolName: TOOL_NAMES[intent.toolKind],
      purpose: intent.purpose,
      dependencies: [],
      inputStrategy: inputStrategyFor(intent.toolKind, intent.dependsOn ?? [], intent.explicitInputRefs),
      inputResolution: inputResolutionFor(intent.toolKind, intent.dependsOn ?? [], intent.explicitInputRefs, {
        autoSqlFallback: shouldAutoAddSql && intent.toolKind === "sql_query",
        hasReusableSql,
      }),
      status: "planned",
      explicitInputRefs: intent.explicitInputRefs,
      requestedChanges: intent.requestedChanges,
    }));

    for (const step of steps) {
      const intent = sourceIntents.find((item) => item.toolKind === step.toolKind);
      const dependencyKinds = unique([
        ...(intent?.dependsOn ?? []),
        ...(shouldAutoAddSql && step.toolKind !== "sql_query" && dependsOnSql(step.toolKind) ? ["sql_query" as ToolKind] : []),
      ]);
      step.dependencies = unique(
        dependencyKinds
          .map((dependencyKind) => steps.find((candidate) => candidate.toolKind === dependencyKind)?.stepId)
          .filter((stepId): stepId is string => Boolean(stepId)),
      );
      if (step.dependencies.length > 0 && step.inputResolution !== "explicit") {
        step.inputResolution = "current_round_result";
      }
    }

    return {
      planId: createId("plan"),
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      userId: input.userId,
      userMessage: input.userMessage,
      requestType,
      requestedOutputs,
      steps,
      status: input.intentResult.requiresClarification ? "draft" : "ready",
      metrics: {
        conversationId: input.conversationId,
        messageId: input.userMessageId,
        requestType,
        requestedToolCount: input.intentResult.intents.length,
        plannedToolCount: steps.length,
        promptCharacterCount: input.userMessage.length,
        planningDurationMs: Math.max(0, Date.now() - (input.planningStartedAtMs ?? Date.now())),
        planningModelCallCount: input.intentResult.agentIntent ? 1 : 0,
        explicitChartRequested: Boolean(input.intentResult.agentIntent?.explicitGoals.chart),
        chartToolIncluded: steps.some((step) => step.toolKind === "chart_rendering"),
        sqlDependencyAutoAdded: shouldAutoAddSql,
        reusedExistingSqlResult: hasReusableSql && needsSql && !steps.some((step) => step.toolKind === "sql_query"),
        createdAt,
      },
      createdAt,
      updatedAt: createdAt,
    };
  }
}

export class ToolPlanValidator {
  validate(plan: ToolExecutionPlan) {
    const result = this.validateDetailed(plan);
    if (!result.valid) {
      const message = result.errors[0] ?? "工具执行计划无效。";
      if (message.includes("循环")) {
        throw toolError("TOOL_DEPENDENCY_CYCLE", message, { conversationId: plan.conversationId, planId: plan.planId });
      }
      throw toolError("TOOL_PLAN_INVALID", message, { conversationId: plan.conversationId, planId: plan.planId });
    }
    return true;
  }

  validateDetailed(plan: ToolExecutionPlan): ToolPlanValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (plan.steps.length === 0) {
      errors.push("工具执行计划为空。");
    }
    if (plan.requestedOutputs?.includes("chart") && !plan.steps.some((step) => step.toolKind === "chart_rendering")) {
      errors.push("显式图表目标缺少 request_chart_rendering。");
    }
    if (plan.requestedOutputs?.includes("report") && !plan.steps.some((step) => step.toolKind === "report_generation")) {
      errors.push("显式报告目标缺少 request_markdown_report_generation。");
    }
    if (plan.requestedOutputs?.includes("chart") && plan.requestedOutputs.includes("report")) {
      const chartStep = plan.steps.find((step) => step.toolKind === "chart_rendering");
      const reportStep = plan.steps.find((step) => step.toolKind === "report_generation");
      if (chartStep && reportStep && !reportStep.dependencies.includes(chartStep.stepId)) {
        errors.push("图表和报告同时存在时，报告步骤必须依赖图表步骤。");
      }
    }
    for (const step of plan.steps) {
      if (step.toolKind === "sql_query") {
        continue;
      }
      const hasTraceableSqlInput =
        step.inputResolution === "explicit" ||
        step.inputResolution === "conversation_history" ||
        step.inputResolution === "artifact_lineage" ||
        stepDependsOnToolKind(plan, step, "sql_query");
      if (!hasTraceableSqlInput) {
        errors.push(`${step.toolName} 缺少可追溯 SQL 输入。`);
      }
    }
    const stepIds = new Set(plan.steps.map((step) => step.stepId));
    for (const step of plan.steps) {
      for (const dependency of step.dependencies) {
        if (!stepIds.has(dependency)) {
          errors.push(`步骤依赖不存在：${dependency}`);
        }
      }
    }
    try {
      this.topologicalSort(plan);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "工具执行计划存在循环依赖。");
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  assertLegacy(plan: ToolExecutionPlan) {
    if (plan.steps.length === 0) {
      throw toolError("TOOL_PLAN_INVALID", "工具执行计划为空。", { conversationId: plan.conversationId, planId: plan.planId });
    }
    const stepIds = new Set(plan.steps.map((step) => step.stepId));
    for (const step of plan.steps) {
      for (const dependency of step.dependencies) {
        if (!stepIds.has(dependency)) {
          throw toolError("TOOL_PLAN_INVALID", `步骤依赖不存在：${dependency}`, { conversationId: plan.conversationId, planId: plan.planId });
        }
      }
    }
    this.topologicalSort(plan);
    return true;
  }

  topologicalSort(plan: ToolExecutionPlan) {
    const steps = new Map(plan.steps.map((step) => [step.stepId, step]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const sorted: ToolExecutionPlanStep[] = [];

    const visit = (stepId: string) => {
      if (visited.has(stepId)) {
        return;
      }
      if (visiting.has(stepId)) {
        throw toolError("TOOL_DEPENDENCY_CYCLE", "工具执行计划存在循环依赖。", { conversationId: plan.conversationId, planId: plan.planId });
      }
      visiting.add(stepId);
      const step = steps.get(stepId);
      if (!step) {
        return;
      }
      step.dependencies.forEach(visit);
      visiting.delete(stepId);
      visited.add(stepId);
      sorted.push(step);
    };

    plan.steps.forEach((step) => visit(step.stepId));
    return sorted;
  }
}

export class ToolDependencyResolver {
  constructor(private readonly validator = new ToolPlanValidator()) {}

  order(plan: ToolExecutionPlan) {
    return this.validator.topologicalSort(plan);
  }
}

function inputStrategyFor(toolKind: ToolKind, dependsOn: ToolKind[], explicitInputRefs?: string[]): ToolInputStrategy {
  if (explicitInputRefs?.length) {
    return "explicit";
  }
  if (toolKind === "python_analysis") {
    return dependsOn.includes("sql_query") ? "none" : "latest_sql";
  }
  if (toolKind === "chart_rendering") {
    if (dependsOn.includes("python_analysis") || dependsOn.includes("sql_query")) {
      return "none";
    }
    return "latest_python";
  }
  if (toolKind === "report_generation") {
    if (dependsOn.length > 0) {
      return "none";
    }
    return "latest_python";
  }
  return "none";
}

function inputResolutionFor(
  toolKind: ToolKind,
  dependsOn: ToolKind[],
  explicitInputRefs: string[] | undefined,
  context: { autoSqlFallback: boolean; hasReusableSql: boolean },
): ToolStepInputResolution {
  if (explicitInputRefs?.length) {
    return "explicit";
  }
  if (context.autoSqlFallback) {
    return "auto_sql_fallback";
  }
  if (dependsOn.length > 0) {
    return "current_round_result";
  }
  if (toolKind !== "sql_query" && context.hasReusableSql) {
    return "conversation_history";
  }
  return "current_round_result";
}

function requestedOutputsFromIntent(intentResult: ToolIntentResult): AgentOutputGoal[] {
  const goals = intentResult.agentIntent?.explicitGoals ?? intentResult.agentIntent?.goals;
  if (goals) {
    return (["query", "analysis", "chart", "report"] as AgentOutputGoal[]).filter((goal) => goals[goal]);
  }
  const outputByTool: Record<ToolKind, AgentOutputGoal> = {
    sql_query: "query",
    python_analysis: "analysis",
    chart_rendering: "chart",
    report_generation: "report",
  };
  return unique(intentResult.intents.map((intent) => outputByTool[intent.toolKind]));
}

function dependsOnSql(toolKind: ToolKind) {
  return toolKind === "python_analysis" || toolKind === "chart_rendering" || toolKind === "report_generation";
}

function stepDependsOnToolKind(plan: ToolExecutionPlan, step: ToolExecutionPlanStep, toolKind: ToolKind) {
  const stepsById = new Map(plan.steps.map((candidate) => [candidate.stepId, candidate]));
  const visited = new Set<string>();
  const visit = (stepId: string): boolean => {
    if (visited.has(stepId)) {
      return false;
    }
    visited.add(stepId);
    const dependency = stepsById.get(stepId);
    if (!dependency) {
      return false;
    }
    if (dependency.toolKind === toolKind) {
      return true;
    }
    return dependency.dependencies.some(visit);
  };
  return step.dependencies.some(visit);
}
