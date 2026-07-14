import type { BusinessVisualizationSemantic, VisualizationEngine, VisualizationType } from "./types";

export type BusinessChartRule = {
  semantic: BusinessVisualizationSemantic;
  recommendedTypes: VisualizationType[];
  defaultEngine: VisualizationEngine;
  description: string;
};

export const businessChartRules: BusinessChartRule[] = [
  { semantic: "asset_scale_trend", recommendedTypes: ["line", "area"], defaultEngine: "echarts", description: "资产规模趋势" },
  { semantic: "overdue_trend", recommendedTypes: ["line", "bar_line_combo"], defaultEngine: "echarts", description: "逾期趋势" },
  { semantic: "institution_risk_comparison", recommendedTypes: ["horizontal_bar"], defaultEngine: "echarts", description: "机构风险比较" },
  { semantic: "product_risk_structure", recommendedTypes: ["stacked_bar"], defaultEngine: "echarts", description: "产品风险结构" },
  { semantic: "risk_grade_migration", recommendedTypes: ["migration_matrix", "heatmap"], defaultEngine: "echarts", description: "风险等级迁徙" },
  { semantic: "vintage_analysis", recommendedTypes: ["line", "heatmap"], defaultEngine: "echarts", description: "Vintage 分析" },
  { semantic: "concentration_analysis", recommendedTypes: ["pareto"], defaultEngine: "echarts", description: "集中度分析" },
  { semantic: "maturity_structure", recommendedTypes: ["stacked_bar"], defaultEngine: "echarts", description: "到期结构分析" },
  { semantic: "warning_model_analysis", recommendedTypes: ["scatter", "bubble"], defaultEngine: "echarts", description: "预警模型分析" },
  { semantic: "risk_score_distribution", recommendedTypes: ["histogram"], defaultEngine: "echarts", description: "风险评分分布" },
  { semantic: "collection_conversion", recommendedTypes: ["funnel"], defaultEngine: "echarts", description: "清收转化过程" },
  { semantic: "balance_change_attribution", recommendedTypes: ["waterfall"], defaultEngine: "echarts", description: "余额变动归因" },
  { semantic: "lifecycle_event_chain", recommendedTypes: ["timeline"], defaultEngine: "vis_timeline", description: "存续期事件链" },
  { semantic: "guarantee_relationship", recommendedTypes: ["network"], defaultEngine: "vis_network", description: "担保关系分析" },
  { semantic: "related_enterprise_risk", recommendedTypes: ["network"], defaultEngine: "vis_network", description: "关联企业风险" },
  { semantic: "generic_analysis", recommendedTypes: ["table", "bar", "line"], defaultEngine: "table", description: "通用分析" },
];

export function getBusinessChartRule(semantic: BusinessVisualizationSemantic | undefined) {
  return semantic ? businessChartRules.find((rule) => rule.semantic === semantic) : undefined;
}

export function recommendVisualizationType(input: {
  semantic?: BusinessVisualizationSemantic;
  hasTimeDimension?: boolean;
  hasSourceTarget?: boolean;
  hasCumulativeMeasure?: boolean;
  hasPositiveNegativeAttribution?: boolean;
  needsPreciseInstitutionComparison?: boolean;
}): VisualizationType {
  const rule = getBusinessChartRule(input.semantic);
  if (rule) {
    return rule.recommendedTypes[0];
  }
  if (input.hasSourceTarget) {
    return "network";
  }
  if (input.hasCumulativeMeasure) {
    return "pareto";
  }
  if (input.hasPositiveNegativeAttribution) {
    return "waterfall";
  }
  if (input.needsPreciseInstitutionComparison) {
    return "horizontal_bar";
  }
  return input.hasTimeDimension ? "line" : "table";
}
