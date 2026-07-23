import type { ToolKind } from "../toolOrchestration";
import type { PlannerDecision, PlannerRequestedOutput, PlannerStep } from "./types";

const TOOL_KINDS = new Set<ToolKind>(["sql_query", "python_analysis", "chart_rendering", "report_generation"]);
const REQUESTED_OUTPUTS = new Set<PlannerRequestedOutput>(["query", "analysis", "chart", "report"]);
const INPUT_RESOLUTIONS = new Set<PlannerStep["inputResolution"]>([
  "selected_data_source",
  "current_run",
  "conversation_history",
  "artifact_lineage",
]);

export type PlannerValidation = { valid: true; decision: PlannerDecision } | { valid: false; errors: string[] };

export function validatePlannerDecision(value: unknown): PlannerValidation {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ["规划结果必须是对象。"] };
  }
  const forbiddenPath = findForbiddenPlannerField(value);
  if (forbiddenPath) {
    errors.push(`规划结果不得包含脚本或工具执行参数：${forbiddenPath}。`);
  }
  const outcome = value.outcome;
  if (outcome !== "execute" && outcome !== "respond" && outcome !== "clarify") {
    errors.push("outcome 必须是 execute、respond 或 clarify。");
  }
  if (typeof value.summary !== "string" || !value.summary.trim()) {
    errors.push("summary 不能为空。");
  }
  const requestedOutputs = Array.isArray(value.requestedOutputs)
    ? value.requestedOutputs.filter((item): item is PlannerRequestedOutput => typeof item === "string" && REQUESTED_OUTPUTS.has(item as PlannerRequestedOutput))
    : [];
  if (!Array.isArray(value.requestedOutputs) || requestedOutputs.length !== value.requestedOutputs.length) {
    errors.push("requestedOutputs 包含不支持的目标。");
  }
  const rawSteps = Array.isArray(value.steps) ? value.steps : [];
  if (!Array.isArray(value.steps)) {
    errors.push("steps 必须是数组。");
  }
  const steps: PlannerStep[] = [];
  const stepIds = new Set<string>();
  for (const [index, rawStep] of rawSteps.entries()) {
    if (!isRecord(rawStep)) {
      errors.push(`steps[${index}] 必须是对象。`);
      continue;
    }
    const stepId = typeof rawStep.stepId === "string" ? rawStep.stepId.trim() : "";
    const toolKind = rawStep.toolKind as ToolKind;
    const purpose = typeof rawStep.purpose === "string" ? rawStep.purpose.trim() : "";
    const dependencies = Array.isArray(rawStep.dependencies)
      ? rawStep.dependencies.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [];
    const inputResolution = rawStep.inputResolution as PlannerStep["inputResolution"];
    const expectedOutput = typeof rawStep.expectedOutput === "string" ? rawStep.expectedOutput.trim() : "";
    if (!stepId || stepIds.has(stepId)) {
      errors.push(`steps[${index}].stepId 缺失或重复。`);
    } else {
      stepIds.add(stepId);
    }
    if (!TOOL_KINDS.has(toolKind)) {
      errors.push(`steps[${index}].toolKind 不受支持。`);
    }
    if (!purpose) {
      errors.push(`steps[${index}].purpose 不能为空。`);
    }
    if (!Array.isArray(rawStep.dependencies) || dependencies.length !== rawStep.dependencies.length) {
      errors.push(`steps[${index}].dependencies 必须是字符串数组。`);
    }
    if (!INPUT_RESOLUTIONS.has(inputResolution)) {
      errors.push(`steps[${index}].inputResolution 不受支持。`);
    }
    if (!expectedOutput) {
      errors.push(`steps[${index}].expectedOutput 不能为空。`);
    }
    if (stepId && TOOL_KINDS.has(toolKind) && purpose && INPUT_RESOLUTIONS.has(inputResolution) && expectedOutput) {
      steps.push({ stepId, toolKind, purpose, dependencies, inputResolution, expectedOutput });
    }
  }
  if (outcome === "execute" && steps.length === 0) {
    errors.push("execute 规划至少需要一个步骤。");
  }
  if (outcome !== "execute" && steps.length > 0) {
    errors.push("respond/clarify 规划不得包含工具步骤。");
  }
  if ((outcome === "respond" || outcome === "clarify") && (typeof value.responseText !== "string" || !value.responseText.trim())) {
    errors.push("respond/clarify 规划必须提供 responseText。");
  }
  for (const step of steps) {
    for (const dependency of step.dependencies) {
      if (!stepIds.has(dependency)) {
        errors.push(`步骤 ${step.stepId} 引用了不存在的依赖 ${dependency}。`);
      }
    }
  }
  if (hasDependencyCycle(steps)) {
    errors.push("规划步骤存在循环依赖。");
  }
  if (requestedOutputs.includes("chart") && !steps.some((step) => step.toolKind === "chart_rendering")) {
    errors.push("显式图表目标缺少 chart_rendering 步骤。");
  }
  if (requestedOutputs.includes("report") && !steps.some((step) => step.toolKind === "report_generation")) {
    errors.push("显式报告目标缺少 report_generation 步骤。");
  }
  if (errors.length > 0 || (outcome !== "execute" && outcome !== "respond" && outcome !== "clarify")) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    decision: {
      outcome,
      summary: String(value.summary).trim(),
      responseText: typeof value.responseText === "string" ? value.responseText.trim() : undefined,
      requestedOutputs,
      steps,
    },
  };
}

export function orderPlannerSteps(decision: PlannerDecision) {
  const byId = new Map(decision.steps.map((step) => [step.stepId, step]));
  const visited = new Set<string>();
  const ordered: PlannerStep[] = [];
  const visit = (step: PlannerStep) => {
    if (visited.has(step.stepId)) return;
    step.dependencies.forEach((dependency) => {
      const parent = byId.get(dependency);
      if (parent) visit(parent);
    });
    visited.add(step.stepId);
    ordered.push(step);
  };
  decision.steps.forEach(visit);
  return ordered;
}

function hasDependencyCycle(steps: PlannerStep[]) {
  const byId = new Map(steps.map((step) => [step.stepId, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (step: PlannerStep): boolean => {
    if (visited.has(step.stepId)) return false;
    if (visiting.has(step.stepId)) return true;
    visiting.add(step.stepId);
    for (const dependency of step.dependencies) {
      const parent = byId.get(dependency);
      if (parent && visit(parent)) return true;
    }
    visiting.delete(step.stepId);
    visited.add(step.stepId);
    return false;
  };
  return steps.some(visit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findForbiddenPlannerField(value: unknown, path = "plan"): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findForbiddenPlannerField(item, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, item] of Object.entries(value)) {
    if (/^(sql|script|python|markdown|visualizationSpec|toolArguments)$/i.test(key)) return `${path}.${key}`;
    const found = findForbiddenPlannerField(item, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}
