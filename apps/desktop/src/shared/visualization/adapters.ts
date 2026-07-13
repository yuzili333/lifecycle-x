import { businessVisualizationSemantics } from "./types";
import type {
  ResolvedVisualizationData,
  ResolvedVisualizationTheme,
  VisualizationRendererAdapter,
  VisualizationRendererPayload,
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

export function createKpiRendererAdapter(): VisualizationRendererAdapter {
  return createAdapter("kpi-renderer", "kpi", ["kpi"], async ({ spec, data, theme }) => basePayload("kpi-renderer", "kpi", spec, data, theme));
}

export function createEChartsRendererAdapter(): VisualizationRendererAdapter {
  return createAdapter("echarts-controlled-renderer", "echarts", ECHARTS_TYPES, async ({ spec, data, theme }) => ({
    ...basePayload("echarts-controlled-renderer", "echarts", spec, data, theme),
    option: transformToControlledEChartsOption(spec, data, theme),
  }));
}

export function createNetworkRendererAdapter(): VisualizationRendererAdapter {
  return createAdapter("vis-network-adapter", "vis_network", ["network"], async ({ spec, data, theme }) => ({
    ...basePayload("vis-network-adapter", "vis_network", spec, data, theme),
    network: transformToNetworkPayload(spec, data),
  }), ["guarantee_relationship", "related_enterprise_risk"]);
}

export function createTimelineRendererAdapter(): VisualizationRendererAdapter {
  return createAdapter("vis-timeline-adapter", "vis_timeline", ["timeline"], async ({ spec, data, theme }) => ({
    ...basePayload("vis-timeline-adapter", "vis_timeline", spec, data, theme),
    timeline: transformToTimelinePayload(spec, data),
  }), ["lifecycle_event_chain"]);
}

export function createTableRendererAdapter(): VisualizationRendererAdapter {
  return createAdapter("table-renderer", "table", ["table"], async ({ spec, data, theme }) => basePayload("table-renderer", "table", spec, data, theme));
}

export function createFallbackRendererAdapter(): VisualizationRendererAdapter {
  return createAdapter(
    "fallback-table-renderer",
    "fallback",
    [
      "kpi",
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
      "timeline",
      "network",
      "table",
    ],
    async ({ spec, data, theme }) => basePayload("fallback-table-renderer", "fallback", spec, data, theme),
    [...businessVisualizationSemantics],
    1,
  );
}

function createAdapter(
  rendererId: string,
  engine: VisualizationRendererAdapter["capability"]["engine"],
  supportedTypes: VisualizationType[],
  transform: VisualizationRendererAdapter["transform"],
  supportedSemantics: VisualizationRendererAdapter["capability"]["supportedSemantics"] = [],
  priority = 50,
): VisualizationRendererAdapter {
  return {
    capability: {
      rendererId,
      engine,
      supportedTypes,
      supportedSemantics,
      supportsStreamingUpdate: engine !== "fallback",
      supportsLargeDataset: engine === "echarts" || engine === "table",
      supportsSvg: true,
      supportsCanvas: false,
      priority,
    },
    canRender: ({ spec }) => supportedTypes.includes(spec.type) || Boolean(spec.businessSemantic && supportedSemantics.includes(spec.businessSemantic)),
    validate: ({ data }) => ({ valid: data.rowCount >= 0, warnings: data.warnings, errors: [] }),
    transform,
    dispose: () => undefined,
  };
}

function basePayload(
  rendererId: string,
  engine: VisualizationRendererPayload["engine"],
  spec: VisualizationSpec,
  data: ResolvedVisualizationData,
  theme: ResolvedVisualizationTheme,
): VisualizationRendererPayload {
  return {
    rendererId,
    engine,
    visualizationId: spec.visualizationId,
    type: spec.type,
    title: spec.title,
    data,
    spec,
    theme,
  };
}

export function transformToControlledEChartsOption(spec: VisualizationSpec, data: ResolvedVisualizationData, theme: ResolvedVisualizationTheme) {
  const xField = spec.encoding?.x ?? spec.encoding?.category ?? data.columns[0]?.name;
  const yFields = spec.encoding?.y?.length ? spec.encoding.y : spec.measures?.map((measure) => measure.field) ?? [spec.encoding?.value].filter(Boolean) as string[];
  return {
    color: theme.colors.primary,
    tooltip: { show: spec.interaction?.tooltip ?? true },
    legend: { show: spec.interaction?.legend ?? yFields.length > 1 },
    dataset: { source: data.rows ?? [] },
    xAxis: { type: "category", field: xField },
    yAxis: spec.type === "bar_line_combo" ? [{ type: "value" }, { type: "value" }] : { type: "value" },
    series: yFields.map((field, index) => ({
      name: labelForField(spec, field),
      type: seriesTypeFor(spec.type, index),
      encode: { x: xField, y: field },
      stack: spec.type === "stacked_bar" ? "total" : undefined,
      yAxisIndex: spec.type === "bar_line_combo" && index > 0 ? 1 : 0,
    })),
  };
}

export function transformToNetworkPayload(spec: VisualizationSpec, data: ResolvedVisualizationData) {
  const sourceField = spec.encoding?.source ?? "source";
  const targetField = spec.encoding?.target ?? "target";
  const labelField = spec.encoding?.category ?? "label";
  const nodeMap = new Map<string, Record<string, unknown>>();
  const edges: Array<Record<string, unknown>> = [];
  for (const row of data.rows ?? []) {
    const source = String(row[sourceField] ?? "");
    const target = String(row[targetField] ?? "");
    if (!source || !target) {
      continue;
    }
    nodeMap.set(source, nodeMap.get(source) ?? { id: source, label: source });
    nodeMap.set(target, nodeMap.get(target) ?? { id: target, label: target });
    edges.push({ from: source, to: target, label: row[labelField] ?? "" });
  }
  return { nodes: Array.from(nodeMap.values()), edges };
}

export function transformToTimelinePayload(spec: VisualizationSpec, data: ResolvedVisualizationData) {
  const startField = spec.encoding?.startTime ?? "startTime";
  const endField = spec.encoding?.endTime ?? "endTime";
  const titleField = spec.encoding?.category ?? spec.encoding?.x ?? "title";
  const groupField = spec.encoding?.series;
  const groups = new Map<string, Record<string, unknown>>();
  const items = (data.rows ?? []).map((row, index) => {
    const group = groupField ? String(row[groupField] ?? "") : "";
    if (group) {
      groups.set(group, { id: group, content: group });
    }
    return {
      id: String(row.id ?? index + 1),
      content: String(row[titleField] ?? `事件 ${index + 1}`),
      start: row[startField],
      end: row[endField] || undefined,
      group: group || undefined,
    };
  });
  return { items, groups: Array.from(groups.values()) };
}

function seriesTypeFor(type: VisualizationType, index: number) {
  if (type === "line" || type === "area") {
    return "line";
  }
  if (type === "scatter" || type === "bubble") {
    return "scatter";
  }
  if (type === "funnel") {
    return "funnel";
  }
  if (type === "heatmap" || type === "migration_matrix") {
    return "heatmap";
  }
  if (type === "bar_line_combo" && index > 0) {
    return "line";
  }
  return "bar";
}

function labelForField(spec: VisualizationSpec, field: string) {
  return spec.measures?.find((measure) => measure.field === field)?.label ?? spec.dimensions?.find((dimension) => dimension.field === field)?.label ?? field;
}
