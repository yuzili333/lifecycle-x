import { getBusinessChartRule } from "./businessChartRules";
import type {
  BusinessVisualizationSemantic,
  VisualizationDataSummary,
  VisualizationEngine,
  VisualizationRendererAdapter,
  VisualizationRendererCapability,
  VisualizationRendererRegistry,
  VisualizationRouteResult,
  VisualizationSpec,
  VisualizationType,
} from "./types";

const ECHARTS_TYPES: VisualizationType[] = [
  "line",
  "area",
  "bar",
  "horizontal_bar",
  "stacked_bar",
  "bar_line_combo",
  "scatter",
  "bubble",
  "heatmap",
  "migration_matrix",
  "histogram",
  "pareto",
  "funnel",
  "waterfall",
];

export class DefaultVisualizationRendererRegistry implements VisualizationRendererRegistry {
  private readonly renderers = new Map<string, VisualizationRendererAdapter>();

  constructor(renderers: VisualizationRendererAdapter[] = []) {
    renderers.forEach((renderer) => this.register(renderer));
  }

  register(renderer: VisualizationRendererAdapter) {
    this.renderers.set(renderer.capability.rendererId, renderer);
  }

  unregister(rendererId: string) {
    this.renderers.delete(rendererId);
  }

  get(rendererId: string) {
    return this.renderers.get(rendererId);
  }

  list() {
    return Array.from(this.renderers.values()).sort((a, b) => b.capability.priority - a.capability.priority);
  }

  capabilities() {
    return this.list().map((renderer) => renderer.capability);
  }
}

export class VisualizationRouter {
  constructor(private readonly registry: VisualizationRendererRegistry) {}

  route(spec: VisualizationSpec, dataSummary?: VisualizationDataSummary): VisualizationRouteResult {
    const warnings: string[] = [];
    const preferredEngine = preferredEngineForSpec(spec);
    const candidates = this.registry
      .list()
      .filter((renderer) => renderer.canRender({ spec, dataSummary }))
      .filter((renderer) => supportsSpec(renderer.capability, spec));

    const preferred = candidates
      .filter((renderer) => renderer.capability.engine === preferredEngine)
      .sort((a, b) => capabilityScore(b.capability, spec, dataSummary) - capabilityScore(a.capability, spec, dataSummary))[0];

    if (preferred) {
      return {
        engine: preferred.capability.engine,
        rendererId: preferred.capability.rendererId,
        reason: `根据 ${spec.businessSemantic ?? spec.type} 选择 ${preferred.capability.engine}。`,
        fallbackRendererId: fallbackRendererId(this.registry),
        warnings,
      };
    }

    const compatible = candidates.sort((a, b) => capabilityScore(b.capability, spec, dataSummary) - capabilityScore(a.capability, spec, dataSummary))[0];
    if (compatible) {
      warnings.push(`未找到首选 ${preferredEngine} renderer，已使用 ${compatible.capability.engine}。`);
      return {
        engine: compatible.capability.engine,
        rendererId: compatible.capability.rendererId,
        reason: "根据已注册 renderer 能力降级选择。",
        fallbackRendererId: fallbackRendererId(this.registry),
        warnings,
      };
    }

    const fallback = this.registry.list().find((renderer) => renderer.capability.engine === "fallback");
    return {
      engine: fallback?.capability.engine ?? "fallback",
      rendererId: fallback?.capability.rendererId ?? "fallback-table-renderer",
      reason: "未找到匹配 renderer，使用 fallback。",
      warnings: ["可视化类型没有可用 renderer。"],
    };
  }
}

export function preferredEngineForSpec(spec: VisualizationSpec): VisualizationEngine {
  if (spec.type === "kpi") {
    return "kpi";
  }
  if (spec.type === "table") {
    return "table";
  }
  if (spec.type === "timeline" || spec.businessSemantic === "lifecycle_event_chain") {
    return "vis_timeline";
  }
  if (spec.type === "network" || spec.businessSemantic === "guarantee_relationship" || spec.businessSemantic === "related_enterprise_risk") {
    return "vis_network";
  }
  const rule = getBusinessChartRule(spec.businessSemantic);
  if (rule) {
    return rule.defaultEngine;
  }
  if (ECHARTS_TYPES.includes(spec.type)) {
    return "echarts";
  }
  return "fallback";
}

function supportsSpec(capability: VisualizationRendererCapability, spec: VisualizationSpec) {
  const supportsType = capability.supportedTypes.includes(spec.type);
  const supportsSemantic = spec.businessSemantic && capability.supportedSemantics?.includes(spec.businessSemantic as BusinessVisualizationSemantic);
  return supportsType || Boolean(supportsSemantic) || capability.engine === "fallback";
}

function capabilityScore(capability: VisualizationRendererCapability, spec: VisualizationSpec, dataSummary?: VisualizationDataSummary) {
  let score = capability.priority;
  if (capability.supportedTypes.includes(spec.type)) {
    score += 40;
  }
  if (spec.businessSemantic && capability.supportedSemantics?.includes(spec.businessSemantic)) {
    score += 30;
  }
  if ((dataSummary?.rowCount ?? 0) > 10_000 && capability.supportsLargeDataset) {
    score += 10;
  }
  if (capability.supportsStreamingUpdate) {
    score += 4;
  }
  return score;
}

function fallbackRendererId(registry: VisualizationRendererRegistry) {
  return registry.list().find((renderer) => renderer.capability.engine === "fallback")?.capability.rendererId;
}
