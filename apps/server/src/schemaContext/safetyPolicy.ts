import type { ContextTokenBudget, SchemaContextSafetyPolicy, ToolRequiredTaskType } from "./types.js";

export const TOOL_REQUIRED_TASK_TYPES: ToolRequiredTaskType[] = [
  "full_table_sum",
  "top_n_sorting",
  "group_by_statistics",
  "distinct_count",
  "complex_filtering",
  "correlation_analysis",
  "missing_value_statistics",
  "outlier_detection",
  "trend_analysis",
  "multi_table_join",
  "chart_generation",
  "medical_data_analysis",
  "financial_data_analysis",
  "scientific_data_analysis",
];

export const DEFAULT_SCHEMA_CONTEXT_SAFETY_POLICY: SchemaContextSafetyPolicy = {
  disallowFullDataInjection: true,
  requireToolForPreciseComputation: true,
  requireUserApprovalForSqlExecution: true,
  requireUserApprovalForPythonExecution: true,
  maskSensitiveFields: true,
  maxPreviewRowsPerTable: 5,
  forbiddenDirectAnswerTasks: TOOL_REQUIRED_TASK_TYPES,
};

export const DEFAULT_CONTEXT_BUDGET: Required<ContextTokenBudget> = {
  maxChars: 24_000,
  maxTables: 8,
  maxColumnsPerTable: 30,
  maxSampleRowsPerTable: 5,
  maxTopValuesPerColumn: 5,
  includeTailRows: false,
  includeRepresentativeRows: true,
  includeStatistics: true,
};

export const SCHEMA_CONTEXT_SYSTEM_INSTRUCTION = [
  "你可以看到用户数据源的结构化摘要，但不一定能看到完整数据。",
  "当用户的问题需要精确统计、筛选、聚合、计算、排序、去重、相关性分析、缺失值统计、异常值检测、趋势分析、多表关联或生成图表时，必须调用数据查询工具、SQL 工具、Python 工具或图表生成工具。",
  "不要基于 preview_rows 或 sample_rows 直接推断全量数据结论。",
  "回答中应说明分析基于哪个数据源、哪个表、哪些字段。",
  "如果当前 Context 不足以回答，应说明需要调用哪个工具或需要用户授权。",
].join("\n");

export function mergeTokenBudget(budget?: Partial<ContextTokenBudget>): Required<ContextTokenBudget> {
  return { ...DEFAULT_CONTEXT_BUDGET, ...budget };
}

export function detectToolRequiredTasks(question?: string): ToolRequiredTaskType[] {
  if (!question) {
    return [];
  }
  const rules: Array<[ToolRequiredTaskType, RegExp]> = [
    ["full_table_sum", /(求和|总额|合计|sum|total)/i],
    ["top_n_sorting", /(top\s*\d+|排名|最高|最低|排序|前\d+)/i],
    ["group_by_statistics", /(分组|按.+统计|group\s+by|分类统计)/i],
    ["distinct_count", /(去重|唯一|distinct|不重复)/i],
    ["complex_filtering", /(筛选|过滤|条件|where|满足.+的)/i],
    ["correlation_analysis", /(相关性|相关系数|correlation)/i],
    ["missing_value_statistics", /(缺失|空值|null|missing)/i],
    ["outlier_detection", /(异常值|离群|outlier)/i],
    ["trend_analysis", /(趋势|环比|同比|trend|变化)/i],
    ["multi_table_join", /(关联|join|多表|合并)/i],
    ["chart_generation", /(图表|图形|画图|绘图|可视化|柱状图|折线图|饼图|chart)/i],
    ["financial_data_analysis", /(贷款|授信|还款|风险|逾期|存续期|金融)/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(question)).map(([task]) => task);
}
