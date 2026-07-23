import type { JsonSchema } from "../streamingModelAdapter";
import type { ToolKind } from "../toolOrchestration";
import type { PlannerDecision, PlannerRequestedOutput, PlannerStep } from "./types";

export type AnalysisPlanStepType = "schema" | "sql" | "python" | "chart" | "validation" | "report";

export type AnalysisPlan = {
  goal: string;
  businessDefinitions: Array<{ metric: string; definition: string; source?: string }>;
  requiredData: Array<{ source?: string; table: string; fields: string[]; purpose: string }>;
  steps: Array<{ id: string; type: AnalysisPlanStepType; purpose: string; dependsOn?: string[] }>;
  validationRules: Array<{ id: string; description: string; severity: "info" | "warning" | "error" }>;
  reportOutline: string[];
  assumptions: string[];
  unresolvedAmbiguities: string[];
};

export type AnalysisPlanValidation =
  | { valid: true; plan: AnalysisPlan }
  | { valid: false; errors: string[] };

const stepTypes = new Set<AnalysisPlanStepType>(["schema", "sql", "python", "chart", "validation", "report"]);
const severities = new Set(["info", "warning", "error"] as const);

export const analysisPlanSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "goal", "businessDefinitions", "requiredData", "steps", "validationRules",
    "reportOutline", "assumptions", "unresolvedAmbiguities",
  ],
  properties: {
    goal: { type: "string", minLength: 1 },
    businessDefinitions: {
      type: "array",
      items: {
        type: "object",
        required: ["metric", "definition"],
        properties: {
          metric: { type: "string", minLength: 1 },
          definition: { type: "string", minLength: 1 },
          source: { type: "string" },
        },
      },
    },
    requiredData: {
      type: "array",
      items: {
        type: "object",
        required: ["table", "fields", "purpose"],
        properties: {
          source: { type: "string" },
          table: { type: "string", minLength: 1 },
          fields: { type: "array", items: { type: "string", minLength: 1 } },
          purpose: { type: "string", minLength: 1 },
        },
      },
    },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "type", "purpose"],
        properties: {
          id: { type: "string", minLength: 1 },
          type: { type: "string", enum: Array.from(stepTypes) },
          purpose: { type: "string", minLength: 1 },
          dependsOn: { type: "array", items: { type: "string", minLength: 1 } },
        },
      },
    },
    validationRules: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "description", "severity"],
        properties: {
          id: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 },
          severity: { type: "string", enum: Array.from(severities) },
        },
      },
    },
    reportOutline: { type: "array", items: { type: "string", minLength: 1 } },
    assumptions: { type: "array", items: { type: "string", minLength: 1 } },
    unresolvedAmbiguities: { type: "array", items: { type: "string", minLength: 1 } },
  },
};

export function validateAnalysisPlan(value: unknown): AnalysisPlanValidation {
  if (!isRecord(value)) return { valid: false, errors: ["AnalysisPlan 必须是对象。"] };
  const errors: string[] = [];
  const goal = text(value.goal);
  if (!goal) errors.push("goal 不能为空。");
  const businessDefinitions = parseRecords(value.businessDefinitions, "businessDefinitions", errors, (item, path) => {
    const metric = text(item.metric);
    const definition = text(item.definition);
    if (!metric || !definition) errors.push(`${path} 需要 metric 和 definition。`);
    return metric && definition ? { metric, definition, ...(text(item.source) ? { source: text(item.source) } : {}) } : null;
  });
  const requiredData = parseRecords(value.requiredData, "requiredData", errors, (item, path) => {
    const table = text(item.table);
    const purpose = text(item.purpose);
    const fields = textArray(item.fields);
    if (!table || !purpose || !Array.isArray(item.fields)) errors.push(`${path} 需要 table、fields 和 purpose。`);
    return table && purpose && Array.isArray(item.fields)
      ? { ...(text(item.source) ? { source: text(item.source) } : {}), table, fields, purpose }
      : null;
  });
  const steps = parseRecords(value.steps, "steps", errors, (item, path) => {
    const id = stableStepId(text(item.id));
    const type = item.type as AnalysisPlanStepType;
    const purpose = text(item.purpose);
    const dependsOn = item.dependsOn === undefined ? [] : textArray(item.dependsOn);
    if (!id || !stepTypes.has(type) || !purpose || (item.dependsOn !== undefined && !Array.isArray(item.dependsOn))) {
      errors.push(`${path} 的 id、type、purpose 或 dependsOn 不合法。`);
      return null;
    }
    return { id, type, purpose, ...(dependsOn.length ? { dependsOn: dependsOn.map(stableStepId) } : {}) };
  });
  if (!Array.isArray(value.steps) || steps.length === 0) errors.push("steps 至少需要一项。");
  const stepIds = new Set<string>();
  for (const step of steps) {
    if (stepIds.has(step.id)) errors.push(`步骤 id 重复：${step.id}。`);
    stepIds.add(step.id);
  }
  for (const step of steps) {
    for (const dependency of step.dependsOn ?? []) {
      if (!stepIds.has(dependency)) errors.push(`步骤 ${step.id} 引用了不存在的依赖 ${dependency}。`);
    }
  }
  if (hasCycle(steps)) errors.push("AnalysisPlan 步骤存在循环依赖。");
  const derivedAnalysisPattern = /统计|汇总|计数|占比|比率|比例|排序|排名|派生|集中度|趋势/;
  const requiresDerivedAnalysis = businessDefinitions.some((item) =>
    derivedAnalysisPattern.test(`${item.metric} ${item.definition}`)
  ) || steps.some((step) => derivedAnalysisPattern.test(step.purpose));
  const hasSqlStep = steps.some((step) => step.type === "sql");
  const hasPythonStep = steps.some((step) => step.type === "python");
  const hasDerivedOutputStep = steps.some((step) => step.type === "chart" || step.type === "report");
  if (requiresDerivedAnalysis && hasSqlStep && hasDerivedOutputStep && !hasPythonStep) {
    errors.push("查询后需要统计、占比或派生指标并生成图表/报告时，必须使用 python 步骤完成计算，不能用第二个 sql 步骤替代。");
  }
  for (const step of steps) {
    if (step.type === "sql" && (step.dependsOn?.length ?? 0) > 0 && derivedAnalysisPattern.test(step.purpose)) {
      errors.push(`步骤 ${step.id} 是依赖上游结果的统计计算，应使用 python 类型而不是 sql。`);
    }
  }
  const validationRules = parseRecords(value.validationRules, "validationRules", errors, (item, path) => {
    const id = text(item.id);
    const description = text(item.description);
    const severity = item.severity as "info" | "warning" | "error";
    if (!id || !description || !severities.has(severity)) {
      errors.push(`${path} 的 id、description 或 severity 不合法。`);
      return null;
    }
    return { id, description, severity };
  });
  const reportOutline = requiredTextArray(value.reportOutline, "reportOutline", errors);
  const assumptions = requiredTextArray(value.assumptions, "assumptions", errors);
  const unresolvedAmbiguities = requiredTextArray(value.unresolvedAmbiguities, "unresolvedAmbiguities", errors);
  if (errors.length) return { valid: false, errors };
  return {
    valid: true,
    plan: {
      goal,
      businessDefinitions,
      requiredData,
      steps,
      validationRules,
      reportOutline,
      assumptions,
      unresolvedAmbiguities,
    },
  };
}

export function parseAnalysisPlanContent(content: string): AnalysisPlanValidation {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!normalized) return { valid: false, errors: ["规划服务未返回 AnalysisPlan 内容。"] };
  try {
    return validateAnalysisPlan(JSON.parse(normalized));
  } catch {
    return { valid: false, errors: ["规划服务返回的 AnalysisPlan 不是合法 JSON。"] };
  }
}

export function analysisPlanToPlannerDecision(plan: AnalysisPlan): PlannerDecision {
  const toolSteps = plan.steps.filter((step) => toolKindForAnalysisStep(step.type));
  const mappedIds = new Set(toolSteps.map((step) => step.id));
  const steps: PlannerStep[] = toolSteps.map((step, index) => {
    const toolKind = toolKindForAnalysisStep(step.type)!;
    const dependencies = resolveToolDependencies(step.id, plan.steps, mappedIds);
    return {
      stepId: step.id,
      toolKind,
      purpose: step.purpose,
      dependencies,
      inputResolution: dependencies.length > 0 ? "current_run" : index === 0 ? "selected_data_source" : "artifact_lineage",
      expectedOutput: expectedOutput(toolKind),
    };
  });
  const requestedOutputs = Array.from(new Set(steps.map((step) => requestedOutput(step.toolKind))));
  return {
    outcome: steps.length ? "execute" : "clarify",
    summary: plan.goal,
    responseText: steps.length ? undefined : `当前分析计划没有可执行的数据工具步骤。${plan.unresolvedAmbiguities.join("；")}`,
    requestedOutputs,
    steps,
  };
}

function resolveToolDependencies(stepId: string, allSteps: AnalysisPlan["steps"], mappedIds: Set<string>) {
  const byId = new Map(allSteps.map((step) => [step.id, step]));
  const resolved = new Set<string>();
  const visit = (id: string) => {
    const step = byId.get(id);
    for (const dependency of step?.dependsOn ?? []) {
      if (mappedIds.has(dependency)) resolved.add(dependency);
      else visit(dependency);
    }
  };
  visit(stepId);
  return Array.from(resolved);
}

function toolKindForAnalysisStep(type: AnalysisPlanStepType): ToolKind | null {
  if (type === "sql") return "sql_query";
  if (type === "python") return "python_analysis";
  if (type === "chart") return "chart_rendering";
  if (type === "report") return "report_generation";
  return null;
}

function expectedOutput(toolKind: ToolKind) {
  if (toolKind === "sql_query") return "只读查询结果 Artifact";
  if (toolKind === "python_analysis") return "结构化分析结果 Artifact";
  if (toolKind === "chart_rendering") return "图表 Artifact";
  return "Markdown 报告 Artifact";
}

function requestedOutput(toolKind: ToolKind): PlannerRequestedOutput {
  if (toolKind === "sql_query") return "query";
  if (toolKind === "python_analysis") return "analysis";
  if (toolKind === "chart_rendering") return "chart";
  return "report";
}

function stableStepId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}

function requiredTextArray(value: unknown, path: string, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组。`);
    return [];
  }
  return textArray(value);
}

function textArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function parseRecords<T>(
  value: unknown,
  path: string,
  errors: string[],
  parser: (item: Record<string, unknown>, path: string) => T | null,
) {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组。`);
    return [] as T[];
  }
  return value.flatMap((item, index) => {
    if (!isRecord(item)) {
      errors.push(`${path}[${index}] 必须是对象。`);
      return [];
    }
    const parsed = parser(item, `${path}[${index}]`);
    return parsed ? [parsed] : [];
  });
}

function hasCycle(steps: AnalysisPlan["steps"]) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) if (visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return steps.some((step) => visit(step.id));
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
