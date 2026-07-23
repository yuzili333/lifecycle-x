import type { JsonSchema } from "../streamingModelAdapter";
import type { PlannerDecision, PlannerRequestedOutput, PlannerStep } from "./types";
import type { TaskComplexity } from "./modelRuntimeConfig";

export type TaskType =
  | "metadata"
  | "single_query"
  | "multi_step_analysis"
  | "root_cause_analysis"
  | "deep_research"
  | "report_generation";

export type TaskRoute = {
  taskType: TaskType;
  complexity: TaskComplexity;
  requiresKimi: boolean;
  requiresSql: boolean;
  requiresPython: boolean;
  requiresChart: boolean;
  requiresReport: boolean;
  ambiguities: Array<{ field: string; description: string; blocking: boolean }>;
  userVisibleSummary: string;
  confidence: number;
};

export type TaskRouteValidation =
  | { valid: true; route: TaskRoute }
  | { valid: false; errors: string[] };

const taskTypes = new Set<TaskType>(["metadata", "single_query", "multi_step_analysis", "root_cause_analysis", "deep_research", "report_generation"]);
const complexities = new Set<TaskComplexity>(["L0", "L1", "L2", "L3", "L4"]);

export const taskRouteSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "taskType", "complexity", "requiresKimi", "requiresSql", "requiresPython",
    "requiresChart", "requiresReport", "ambiguities", "userVisibleSummary", "confidence",
  ],
  properties: {
    taskType: { type: "string", enum: Array.from(taskTypes) },
    complexity: { type: "string", enum: Array.from(complexities) },
    requiresKimi: { type: "boolean" },
    requiresSql: { type: "boolean" },
    requiresPython: { type: "boolean" },
    requiresChart: { type: "boolean" },
    requiresReport: { type: "boolean" },
    ambiguities: {
      type: "array",
      items: {
        type: "object",
        required: ["field", "description", "blocking"],
        properties: {
          field: { type: "string" },
          description: { type: "string" },
          blocking: { type: "boolean" },
        },
      },
    },
    userVisibleSummary: { type: "string", minLength: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

export function validateTaskRoute(value: unknown): TaskRouteValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["路由结果必须是对象。"] };
  const taskType = value.taskType as TaskType;
  const complexity = value.complexity as TaskComplexity;
  if (!taskTypes.has(taskType)) errors.push("taskType 不受支持。");
  if (!complexities.has(complexity)) errors.push("complexity 必须是 L0-L4。");
  const booleanKeys = ["requiresKimi", "requiresSql", "requiresPython", "requiresChart", "requiresReport"] as const;
  for (const key of booleanKeys) if (typeof value[key] !== "boolean") errors.push(`${key} 必须是布尔值。`);
  const ambiguities = Array.isArray(value.ambiguities)
    ? value.ambiguities.flatMap((item) => {
      if (!isRecord(item) || typeof item.field !== "string" || typeof item.description !== "string" || typeof item.blocking !== "boolean") {
        errors.push("ambiguities 项格式不合法。");
        return [];
      }
      return [{ field: item.field.trim(), description: item.description.trim(), blocking: item.blocking }];
    })
    : [];
  if (!Array.isArray(value.ambiguities)) errors.push("ambiguities 必须是数组。");
  const userVisibleSummary = typeof value.userVisibleSummary === "string" ? value.userVisibleSummary.trim() : "";
  if (!userVisibleSummary) errors.push("userVisibleSummary 不能为空。");
  const confidence = typeof value.confidence === "number" ? value.confidence : Number.NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) errors.push("confidence 必须在 0-1 之间。");
  if ((complexity === "L0" || complexity === "L1") && value.requiresKimi === true) errors.push("L0/L1 不得调用 Kimi。");
  if ((complexity === "L2" || complexity === "L3" || complexity === "L4") && value.requiresKimi !== true) errors.push("L2-L4 必须调用 Kimi。");
  if (errors.length) return { valid: false, errors };
  return {
    valid: true,
    route: {
      taskType,
      complexity,
      requiresKimi: value.requiresKimi as boolean,
      requiresSql: value.requiresSql as boolean,
      requiresPython: value.requiresPython as boolean,
      requiresChart: value.requiresChart as boolean,
      requiresReport: value.requiresReport as boolean,
      ambiguities,
      userVisibleSummary,
      confidence,
    },
  };
}

export function conservativeTaskRoute(userMessage: string): TaskRoute {
  const text = userMessage.trim();
  const deep = /深度分析|专题研究|根因研究|竞争性假设|决策支持/.test(text);
  const rootCause = /根因|归因|为什么|原因|异常.*解释|矛盾|交叉验证/.test(text);
  const report = /报告|report/i.test(text);
  const chart = /图表|绘图|画图|可视化|柱状图|条形图|折线图|饼图/.test(text);
  const python = /分析|占比|比例|比率|相关性|趋势|迁徙|集中度|同比|环比|统计/.test(text);
  const sql = /查询|筛选|数据|汇总|统计|排序|top\s*\d+|字段|表/.test(text) || python || chart || report;
  const metadata = /^(查看|列出|说明|解释).{0,12}(数据源|表结构|字段|字段含义)/.test(text);
  const toolCount = [sql, python, chart, report].filter(Boolean).length;
  const complexity: TaskComplexity = deep ? "L4" : rootCause ? "L3" : toolCount >= 2 ? "L2" : metadata ? "L0" : "L1";
  const taskType: TaskType = deep ? "deep_research" : rootCause ? "root_cause_analysis" : report ? "report_generation" : toolCount >= 2 ? "multi_step_analysis" : metadata ? "metadata" : "single_query";
  return {
    taskType,
    complexity,
    requiresKimi: complexity === "L2" || complexity === "L3" || complexity === "L4",
    requiresSql: sql && !metadata,
    requiresPython: python && !metadata,
    requiresChart: chart,
    requiresReport: report,
    ambiguities: [],
    userVisibleSummary: summaryForRoute({ metadata, sql, python, chart, report, rootCause, deep }),
    confidence: 0.55,
  };
}

export function routeToPlannerDecision(route: TaskRoute): PlannerDecision {
  if (!route.requiresSql && !route.requiresPython && !route.requiresChart && !route.requiresReport) {
    return {
      outcome: "respond",
      summary: route.userVisibleSummary,
      responseText: route.userVisibleSummary,
      requestedOutputs: [],
      steps: [],
    };
  }
  const steps: PlannerStep[] = [];
  const requestedOutputs: PlannerRequestedOutput[] = [];
  const append = (toolKind: PlannerStep["toolKind"], stepId: string, purpose: string, expectedOutput: string) => {
    const previous = steps.at(-1);
    steps.push({
      stepId,
      toolKind,
      purpose,
      dependencies: previous ? [previous.stepId] : [],
      inputResolution: previous ? "current_run" : "selected_data_source",
      expectedOutput,
    });
  };
  if (route.requiresSql) {
    requestedOutputs.push("query");
    append("sql_query", "query", "按用户条件读取必要的真实数据", "只读查询结果 Artifact");
  }
  if (route.requiresPython) {
    requestedOutputs.push("analysis");
    append("python_analysis", "analysis", "按用户明确口径完成统计分析", "结构化分析结果 Artifact");
  }
  if (route.requiresChart) {
    requestedOutputs.push("chart");
    append("chart_rendering", "chart", "将分析结果转换为用户指定图表", "图表 Artifact");
  }
  if (route.requiresReport) {
    requestedOutputs.push("report");
    append("report_generation", "report", "基于真实结果生成 Markdown 报告", "Markdown 报告 Artifact");
  }
  return { outcome: "execute", summary: route.userVisibleSummary, requestedOutputs, steps };
}

function summaryForRoute(input: { metadata: boolean; sql: boolean; python: boolean; chart: boolean; report: boolean; rootCause: boolean; deep: boolean }) {
  if (input.metadata) return "我会根据当前数据源上下文说明表或字段信息。";
  const actions = [
    input.sql ? "读取所需数据" : null,
    input.python ? "完成统计分析" : null,
    input.chart ? "生成图表" : null,
    input.report ? "整理报告" : null,
  ].filter(Boolean);
  const qualifier = input.deep ? "并进行深度研究" : input.rootCause ? "并分析异常原因" : "";
  return `我会${actions.join("、")}${qualifier}。`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
