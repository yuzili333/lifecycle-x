import type { ToolExecutionPlan, ToolExecutionPlanStep, ToolInputStrategy, ToolIntentResult, ToolKind } from "./types";
import { TOOL_NAMES } from "./types";
import { createId, nowIso, toolError, unique } from "./utils";

export class ToolPlanBuilder {
  build(input: { conversationId: string; userId: string; userMessage: string; userMessageId?: string; intentResult: ToolIntentResult }): ToolExecutionPlan {
    const createdAt = nowIso();
    const steps: ToolExecutionPlanStep[] = input.intentResult.intents.map((intent) => ({
      stepId: createId("step"),
      toolKind: intent.toolKind,
      toolName: TOOL_NAMES[intent.toolKind],
      purpose: intent.purpose,
      dependencies: [],
      inputStrategy: inputStrategyFor(intent.toolKind, intent.dependsOn ?? [], intent.explicitInputRefs),
      status: "planned",
      explicitInputRefs: intent.explicitInputRefs,
      requestedChanges: intent.requestedChanges,
    }));

    for (const step of steps) {
      const intent = input.intentResult.intents.find((item) => item.toolKind === step.toolKind);
      step.dependencies = unique(
        (intent?.dependsOn ?? [])
          .map((dependencyKind) => steps.find((candidate) => candidate.toolKind === dependencyKind)?.stepId)
          .filter((stepId): stepId is string => Boolean(stepId)),
      );
    }

    return {
      planId: createId("plan"),
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      userId: input.userId,
      userMessage: input.userMessage,
      steps,
      status: input.intentResult.requiresClarification ? "draft" : "ready",
      createdAt,
      updatedAt: createdAt,
    };
  }
}

export class ToolPlanValidator {
  validate(plan: ToolExecutionPlan) {
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
