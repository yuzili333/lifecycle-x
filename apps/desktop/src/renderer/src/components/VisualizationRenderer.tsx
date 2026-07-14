import { useMemo, type CSSProperties } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import {
  createDefaultVisualizationRendererRegistry,
  DefaultVisualizationThemeResolver,
  neutralDarkVisualizationTheme,
  validateVisualizationSpec,
  VisualizationRouter,
  type ResolvedVisualizationData,
  type ResolvedVisualizationTheme,
  type StreamingVisualizationState,
  type VisualizationDimension,
  type VisualizationMeasure,
  type VisualizationRenderError,
  type VisualizationSpec,
} from "../../../shared/visualization";

const registry = createDefaultVisualizationRendererRegistry();
const router = new VisualizationRouter(registry);
const themeResolver = new DefaultVisualizationThemeResolver();

type StreamingVisualizationNodeProps = {
  visualizationId: string;
  state?: StreamingVisualizationState;
};

type VisualizationRendererProps = {
  spec?: VisualizationSpec;
  error?: VisualizationRenderError;
  isStreaming?: boolean;
};

export function StreamingVisualizationNode({ visualizationId, state }: StreamingVisualizationNodeProps) {
  if (!state || state.status === "receiving" || state.status === "validating" || state.status === "resolving_data") {
    return <VisualizationSkeleton visualizationId={visualizationId} />;
  }
  if (state.status === "failed") {
    return <VisualizationErrorView error={state.error} visualizationId={visualizationId} />;
  }
  return <VisualizationRenderer spec={state.spec} />;
}

export function VisualizationRenderer({ spec, error, isStreaming }: VisualizationRendererProps) {
  const validation = useMemo(() => (spec ? validateVisualizationSpec(spec, { allowInlineData: true }) : undefined), [spec]);
  const data = useMemo(() => (validation?.success ? resolveDisplayData(validation.spec) : undefined), [validation]);
  const route = useMemo(
    () => (validation?.success && data ? router.route(validation.spec, { rowCount: data.rowCount, columnCount: data.columns.length }) : undefined),
    [data, validation],
  );
  const theme = useMemo(() => (validation?.success ? themeResolver.resolve(validation.spec) : neutralDarkVisualizationTheme), [validation]);

  if (isStreaming || !spec) {
    return <VisualizationSkeleton visualizationId={spec?.visualizationId} />;
  }
  if (error) {
    return <VisualizationErrorView error={error} visualizationId={spec.visualizationId} />;
  }
  if (!validation?.success) {
    return <VisualizationErrorView error={validation?.error} visualizationId={spec.visualizationId} />;
  }
  if (!data) {
    return <VisualizationErrorView visualizationId={spec.visualizationId} />;
  }

  const warnings = [...(validation.warnings ?? []), ...(data.warnings ?? []), ...(route?.warnings ?? [])];
  return (
    <section className="assistant-visualization" aria-label={validation.spec.title}>
      <div className="assistant-visualization-header">
        <div>
          <Text type="label" color="primary">{validation.spec.title}</Text>
          {validation.spec.subtitle && <Text type="body" color="secondary">{validation.spec.subtitle}</Text>}
        </div>
        <span className="assistant-visualization-engine">{route?.engine ?? "fallback"}</span>
      </div>
      {validation.spec.description && <p className="assistant-visualization-description">{validation.spec.description}</p>}
      <VisualizationBody spec={validation.spec} data={data} engine={route?.engine ?? "fallback"} theme={theme} />
      <div className="assistant-visualization-footer">
        <span>来源：{data.artifactId ? `Artifact ${data.artifactId}` : validation.spec.provenance.sourceType}</span>
        {validation.spec.provenance.truncated || data.truncated ? <span>已截断</span> : null}
        {validation.spec.provenance.masked || data.masked ? <span>已脱敏</span> : null}
      </div>
      {warnings.length > 0 && (
        <details className="assistant-visualization-warnings">
          <summary>查看警告</summary>
          <ul>
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

function VisualizationBody({ spec, data, engine, theme }: { spec: VisualizationSpec; data: ResolvedVisualizationData; engine: string; theme: ResolvedVisualizationTheme }) {
  if (data.rows?.length === 0) {
    return <div className="assistant-visualization-empty">{spec.display?.emptyText ?? "暂无可视化数据。"}</div>;
  }
  if (spec.type === "kpi") {
    return <KpiView spec={spec} data={data} />;
  }
  if (spec.type === "table" || engine === "table" || engine === "fallback" || !data.rows?.length) {
    return <TableView data={data} />;
  }
  if (spec.type === "network" || engine === "vis_network") {
    return <NetworkView spec={spec} data={data} />;
  }
  if (spec.type === "timeline" || engine === "vis_timeline") {
    return <TimelineView spec={spec} data={data} />;
  }
  return <SvgChartView spec={spec} data={data} theme={theme} />;
}

function KpiView({ spec, data }: { spec: VisualizationSpec; data: ResolvedVisualizationData }) {
  const firstRow = data.rows?.[0] ?? {};
  return (
    <div className="assistant-visualization-kpis">
      {(spec.measures ?? []).map((measure) => (
        <div key={measure.field} className="assistant-visualization-kpi">
          <span>{measure.label ?? measure.field}</span>
          <strong>{formatValue(firstRow[measure.field], measure.format?.suffix)}</strong>
        </div>
      ))}
    </div>
  );
}

function TableView({ data }: { data: ResolvedVisualizationData }) {
  const columns = data.columns.length > 0 ? data.columns : Object.keys(data.rows?.[0] ?? {}).map((name) => ({ name, type: typeof data.rows?.[0]?.[name] }));
  return (
    <div className="assistant-visualization-table-wrap">
      <table className="assistant-visualization-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column.name}>{column.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {(data.rows ?? []).slice(0, 50).map((row, index) => (
            <tr key={index}>
              {columns.map((column) => <td key={column.name}>{formatCell(row[column.name])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type XAxisScale =
  | {
      kind: "category";
      ticks: Array<{ key: string; x: number; label: string }>;
      position: (row: Record<string, unknown>, index: number) => number;
    }
  | {
      kind: "number" | "time";
      ticks: Array<{ key: string; x: number; label: string }>;
      position: (row: Record<string, unknown>, index: number) => number;
    };

function SvgChartView({ spec, data, theme }: { spec: VisualizationSpec; data: ResolvedVisualizationData; theme: ResolvedVisualizationTheme }) {
  const rows = data.rows ?? [];
  const xField = spec.encoding?.x ?? spec.encoding?.category ?? data.columns[0]?.name;
  const yFields = resolveYFields(spec, data, xField);
  const primaryYField = yFields[0];
  const seriesValues = yFields.map((field) => rows.map((row) => normalizeNumber(row[field], Number.NaN)));
  const yTickValues = buildNumericTicks(seriesValues.flat(), 5, {
    fitToDataRange: !shouldIncludeYAxisZero(spec.type),
    includeZero: shouldIncludeYAxisZero(spec.type),
  });
  const yDomain = domainFromTicks(yTickValues);
  const width = 680;
  const height = Math.max(240, spec.display?.height ?? 260);
  const margin = { top: 22, right: 22, bottom: 66, left: 76 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const zeroY = scaleValue(clamp(0, yDomain.min, yDomain.max), yDomain.min, yDomain.max, margin.top, plotHeight);
  const categoryCount = Math.max(1, rows.length);
  const categoryStep = plotWidth / categoryCount;
  const gap = Math.min(10, Math.max(4, categoryStep * 0.24));
  const seriesCount = Math.max(1, yFields.length);
  const barWidth = Math.max(4, (categoryStep - gap) / seriesCount);
  const xAxis = buildXAxisScale({ spec, data, xField, rows, margin, plotWidth });
  const yAxisLabel = yFields.length > 1 ? "数值" : spec.measures?.find((measure) => measure.field === primaryYField)?.label ?? primaryYField ?? "数值";
  const xAxisLabel = spec.dimensions?.find((dimension) => dimension.field === xField)?.label ?? xField ?? "维度";
  const seriesPoints = seriesValues.map((values) => values.map((value, index) => {
    const x = xAxis.position(rows[index] ?? {}, index);
    if (!Number.isFinite(value)) {
      return "";
    }
    const y = scaleValue(value, yDomain.min, yDomain.max, margin.top, plotHeight);
    return `${round(x)},${round(y)}`;
  }).filter(Boolean));
  const chartStyle = createChartStyle(theme);
  const isPointChart = spec.type === "scatter" || spec.type === "bubble";

  return (
    <div className="assistant-visualization-svg-wrap" style={chartStyle}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={spec.title}>
        <g className="axis-grid">
          {yTickValues.map((tick) => {
            const y = scaleValue(tick, yDomain.min, yDomain.max, margin.top, plotHeight);
            return (
              <g key={tick}>
                <line x1={margin.left} y1={round(y)} x2={width - margin.right} y2={round(y)} className="grid-line" />
                <text x={margin.left - 10} y={round(y)} textAnchor="end" dominantBaseline="middle" className="axis-tick-label">
                  {formatAxisTick(tick)}
                </text>
              </g>
            );
          })}
        </g>
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} className="axis-line" />
        <line x1={margin.left} y1={zeroY} x2={width - margin.right} y2={zeroY} className="axis-line zero-line" />
        <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} className="axis-line" />
        <text x={margin.left} y={height - 14} className="axis-title">{xAxisLabel}</text>
        <text x={16} y={margin.top} className="axis-title" transform={`rotate(-90 16 ${margin.top})`}>{yAxisLabel}</text>
        {xAxis.ticks.map((tick) => {
          return (
            <g key={tick.key}>
              <line x1={round(tick.x)} y1={height - margin.bottom} x2={round(tick.x)} y2={height - margin.bottom + 4} className="axis-line" />
              <text x={round(tick.x)} y={height - margin.bottom + 18} textAnchor="middle" className="axis-tick-label">
                {tick.label}
              </text>
            </g>
          );
        })}
        {isPointChart ? (
          rows.flatMap((row, rowIndex) => yFields.map((field, seriesIndex) => {
            const value = seriesValues[seriesIndex]?.[rowIndex] ?? Number.NaN;
            if (!Number.isFinite(value)) {
              return null;
            }
            const x = xAxis.position(row, rowIndex);
            const y = scaleValue(value, yDomain.min, yDomain.max, margin.top, plotHeight);
            const radius = spec.type === "bubble" ? bubbleRadius(value, seriesValues.flat()) : 4;
            return (
              <g key={`${rowIndex}-${field}`} style={seriesStyle(seriesIndex)}>
                <circle cx={round(x)} cy={round(y)} r={radius} className="point" />
                <title>{`${formatCell(row[xField ?? ""])} ${labelForMeasure(spec, field)}: ${formatCell(value)}`}</title>
              </g>
            );
          }))
        ) : spec.type === "line" || spec.type === "area" || spec.type === "bar_line_combo" ? (
          <>
            {seriesPoints.map((points, seriesIndex) => (
              <g key={yFields[seriesIndex] ?? seriesIndex} style={seriesStyle(seriesIndex)}>
                {spec.type === "area" && seriesIndex === 0 && points.length > 0 && <polygon points={`${margin.left},${round(zeroY)} ${points.join(" ")} ${width - margin.right},${round(zeroY)}`} className="area" />}
                <polyline points={points.join(" ")} className="line" />
                {points.map((point, index) => {
                  const [x, y] = point.split(",");
                  return <circle key={index} cx={x} cy={y} r="3" />;
                })}
              </g>
            ))}
          </>
        ) : (
          rows.flatMap((row, rowIndex) => yFields.map((field, seriesIndex) => {
            const value = seriesValues[seriesIndex]?.[rowIndex] ?? 0;
            if (!Number.isFinite(value)) {
              return null;
            }
            const valueY = scaleValue(value, yDomain.min, yDomain.max, margin.top, plotHeight);
            const barHeight = Math.max(2, Math.abs(zeroY - valueY));
            const groupCenter = xAxis.position(row, rowIndex);
            const groupWidth = barWidth * seriesCount;
            const x = groupCenter - groupWidth / 2 + barWidth * seriesIndex;
            const y = value >= 0 ? valueY : zeroY;
            return (
              <g key={`${rowIndex}-${field}`} style={seriesStyle(seriesIndex)}>
                <rect x={round(x)} y={round(y)} width={round(Math.max(3, barWidth - 2))} height={round(barHeight)} />
                <title>{`${formatCell(row[xField ?? ""])} ${labelForMeasure(spec, field)}: ${formatCell(value)}`}</title>
              </g>
            );
          }))
        )}
      </svg>
    </div>
  );
}

function createChartStyle(theme: ResolvedVisualizationTheme) {
  return {
    "--viz-series-0": `var(--color-accent-primary, var(--color-icon-blue, ${theme.colors.primary[0]}))`,
    "--viz-series-1": `var(--color-accent-success, var(--color-icon-teal, ${theme.colors.primary[1]}))`,
    "--viz-series-2": `var(--color-accent-info, var(--color-icon-purple, ${theme.colors.primary[2]}))`,
    "--viz-series-3": `var(--color-accent-warning, var(--color-icon-orange, ${theme.colors.primary[3]}))`,
    "--viz-series-4": `var(--color-accent-danger, var(--color-icon-green, ${theme.colors.primary[4]}))`,
    "--viz-axis": `var(--color-text-secondary, ${theme.colors.textSecondary})`,
    "--viz-grid": `var(--color-border, ${theme.colors.border})`,
    "--viz-text": `var(--color-text-primary, ${theme.colors.textPrimary})`,
    "--viz-surface": `var(--color-background-surface, ${theme.colors.neutral[1]})`,
  } as CSSProperties;
}

function resolveYFields(spec: VisualizationSpec, data: ResolvedVisualizationData, xField?: string) {
  const explicitFields = spec.encoding?.y?.length ? spec.encoding.y : [spec.encoding?.value].filter(Boolean) as string[];
  const measureFields = spec.measures?.map((measure) => measure.field) ?? [];
  const numericColumns = data.columns.filter((column) => column.type === "number" && column.name !== xField).map((column) => column.name);
  return uniqueStrings([...explicitFields, ...measureFields, ...numericColumns]).slice(0, 4);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildXAxisScale(input: {
  spec: VisualizationSpec;
  data: ResolvedVisualizationData;
  xField?: string;
  rows: Record<string, unknown>[];
  margin: { left: number };
  plotWidth: number;
}): XAxisScale {
  const { spec, data, xField, rows, margin, plotWidth } = input;
  const dimension = spec.dimensions?.find((item) => item.field === xField);
  const column = data.columns.find((item) => item.name === xField);
  const kind = inferXAxisKind(dimension, column?.type);
  if (kind === "number") {
    const values = rows.map((row) => normalizeNumber(row[xField ?? ""], Number.NaN));
    const ticks = buildNumericTicks(values, 5, { fitToDataRange: true, includeZero: false });
    const domain = domainFromTicks(ticks);
    return {
      kind,
      ticks: ticks.map((tick) => ({ key: `x-${tick}`, x: scaleContinuous(tick, domain.min, domain.max, margin.left, plotWidth), label: formatAxisNumber(tick) })),
      position: (row, index) => {
        const value = normalizeNumber(row[xField ?? ""], Number.NaN);
        return scaleContinuous(Number.isFinite(value) ? value : index, domain.min, domain.max, margin.left, plotWidth);
      },
    };
  }
  if (kind === "time") {
    const values = rows.map((row) => normalizeTime(row[xField ?? ""], Number.NaN));
    const ticks = buildTimeTicks(values);
    const domain = domainFromTicks(ticks);
    const span = domain.max - domain.min;
    return {
      kind,
      ticks: ticks.map((tick) => ({ key: `x-${tick}`, x: scaleContinuous(tick, domain.min, domain.max, margin.left, plotWidth), label: formatTimeTick(tick, span) })),
      position: (row, index) => {
        const value = normalizeTime(row[xField ?? ""], Number.NaN);
        return scaleContinuous(Number.isFinite(value) ? value : index, domain.min, domain.max, margin.left, plotWidth);
      },
    };
  }

  const categoryCount = Math.max(1, rows.length);
  const categoryStep = plotWidth / categoryCount;
  const tickIndexes = buildCategoryTickIndexes(rows.length);
  return {
    kind: "category",
    ticks: tickIndexes.map((index) => {
      const row = rows[index];
      const x = margin.left + categoryStep * index + categoryStep / 2;
      return {
        key: `x-${index}`,
        x,
        label: truncateAxisLabel(formatCell(row?.[xField ?? ""]), rows.length),
      };
    }),
    position: (_row, index) => margin.left + categoryStep * index + categoryStep / 2,
  };
}

function inferXAxisKind(dimension?: VisualizationDimension, columnType?: string): XAxisScale["kind"] {
  if (dimension?.dataType === "time" || columnType === "date" || columnType === "datetime") {
    return "time";
  }
  if (dimension?.dataType === "number" || columnType === "number") {
    return "number";
  }
  return "category";
}

function shouldIncludeYAxisZero(type: VisualizationSpec["type"]) {
  return ["bar", "stacked_bar", "horizontal_bar", "waterfall", "area", "bar_line_combo"].includes(type);
}

function scaleContinuous(value: number, min: number, max: number, left: number, plotWidth: number) {
  if (!Number.isFinite(value)) {
    return left;
  }
  if (max === min) {
    return left + plotWidth / 2;
  }
  return left + ((value - min) / (max - min)) * plotWidth;
}

function scaleValue(value: number, min: number, max: number, top: number, plotHeight: number) {
  if (!Number.isFinite(value)) {
    return top + plotHeight / 2;
  }
  if (max === min) {
    return top + plotHeight / 2;
  }
  return top + plotHeight - ((value - min) / (max - min)) * plotHeight;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function buildNumericTicks(values: number[], tickCount = 5, options: { fitToDataRange?: boolean; includeZero?: boolean } = {}) {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) {
    return [0, 1];
  }
  const includeZero = options.includeZero ?? true;
  let rawMin = includeZero ? Math.min(0, ...finiteValues) : Math.min(...finiteValues);
  let rawMax = includeZero ? Math.max(0, ...finiteValues) : Math.max(...finiteValues);
  if (rawMin === rawMax) {
    const offset = niceStep(Math.max(Math.abs(rawMax), 1) / Math.max(2, tickCount - 1));
    rawMin -= offset * 2;
    rawMax += offset * 2;
  }
  if (options.fitToDataRange) {
    const step = (rawMax - rawMin) / Math.max(1, tickCount - 1);
    return Array.from({ length: tickCount }, (_item, index) => round(rawMin + step * index));
  }
  const span = rawMax - rawMin;
  const step = niceStep(span / Math.max(1, tickCount - 1));
  const min = Math.floor(rawMin / step) * step;
  const max = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + step * 0.5; value += step) {
    ticks.push(round(value));
  }
  return ticks.length >= 2 ? ticks : [min, max];
}

function buildTimeTicks(values: number[], tickCount = 5) {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) {
    const now = Date.now();
    return [now, now + 86_400_000];
  }
  let min = Math.min(...finiteValues);
  let max = Math.max(...finiteValues);
  if (min === max) {
    min -= 86_400_000;
    max += 86_400_000;
  }
  const step = (max - min) / Math.max(1, tickCount - 1);
  return Array.from({ length: tickCount }, (_item, index) => Math.round(min + step * index));
}

function domainFromTicks(ticks: number[]) {
  return {
    min: ticks[0] ?? 0,
    max: ticks.at(-1) ?? 1,
  };
}

function niceStep(value: number) {
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function buildCategoryTickIndexes(length: number) {
  if (length <= 0) {
    return [];
  }
  const maxTicks = length <= 8 ? length : 8;
  const step = Math.max(1, Math.ceil(length / maxTicks));
  const indexes = Array.from({ length }, (_item, index) => index).filter((index) => index % step === 0);
  const lastIndex = length - 1;
  return indexes.includes(lastIndex) ? indexes : [...indexes, lastIndex];
}

function truncateAxisLabel(value: string, rowCount: number) {
  const maxLength = rowCount > 12 ? 5 : rowCount > 8 ? 7 : 10;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function normalizeNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeTime(value: unknown, fallback = 0) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function formatTimeTick(value: number, span: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "--";
  }
  const options: Intl.DateTimeFormatOptions = span > 365 * 86_400_000
    ? { year: "numeric", month: "2-digit" }
    : span >= 86_400_000
      ? { month: "2-digit", day: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat("zh-CN", options).format(date);
}

function labelForMeasure(spec: VisualizationSpec, field: string) {
  return spec.measures?.find((measure: VisualizationMeasure) => measure.field === field)?.label ?? field;
}

function seriesStyle(index: number) {
  return { "--viz-current": `var(--viz-series-${index % 5})` } as CSSProperties;
}

function NetworkView({ spec, data }: { spec: VisualizationSpec; data: ResolvedVisualizationData }) {
  const source = spec.encoding?.source ?? "source";
  const target = spec.encoding?.target ?? "target";
  return (
    <div className="assistant-visualization-network">
      {(data.rows ?? []).slice(0, 20).map((row, index) => (
        <div key={index} className="assistant-visualization-edge">
          <span>{formatCell(row[source])}</span>
          <span>→</span>
          <span>{formatCell(row[target])}</span>
        </div>
      ))}
    </div>
  );
}

function TimelineView({ spec, data }: { spec: VisualizationSpec; data: ResolvedVisualizationData }) {
  const start = spec.encoding?.startTime ?? "startTime";
  const end = spec.encoding?.endTime;
  const title = spec.encoding?.category ?? spec.encoding?.x ?? "title";
  return (
    <div className="assistant-visualization-timeline">
      {(data.rows ?? []).slice(0, 30).map((row, index) => (
        <div key={index} className="assistant-visualization-timeline-item">
          <strong>{formatCell(row[title])}</strong>
          <span>{formatCell(row[start])}{end && row[end] ? ` - ${formatCell(row[end])}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

function VisualizationSkeleton({ visualizationId }: { visualizationId?: string }) {
  return (
    <section className="assistant-visualization skeleton" aria-label="图表加载中">
      <div className="assistant-visualization-header">
        <div className="assistant-skeleton-line short" />
        <div className="assistant-skeleton-line chip" />
      </div>
      <div className="assistant-skeleton-chart" />
      {visualizationId && <span className="assistant-visualization-id">{visualizationId}</span>}
    </section>
  );
}

function VisualizationErrorView({ error, visualizationId }: { error?: VisualizationRenderError; visualizationId?: string }) {
  return (
    <section className="assistant-visualization error" aria-label="图表错误">
      <Text type="label" color="primary">可视化配置无法解析</Text>
      <p>{error?.message ?? "图表渲染失败，已降级显示。"}</p>
      <HStack gap={2} wrap="wrap">
        {visualizationId && <span className="assistant-visualization-id">{visualizationId}</span>}
        {error?.traceId && <span className="assistant-visualization-id">Trace: {error.traceId}</span>}
        <Button label="保留消息继续阅读" variant="secondary" size="sm" isDisabled />
      </HStack>
    </section>
  );
}

function resolveDisplayData(spec: VisualizationSpec): ResolvedVisualizationData {
  if (spec.data.mode === "inline") {
    const inlineData = spec.data;
    return {
      columns: Object.keys(inlineData.rows[0] ?? {}).map((name) => ({ name, type: typeof inlineData.rows[0]?.[name] })),
      rows: inlineData.rows,
      rowCount: inlineData.rowCount,
      truncated: inlineData.rows.length < inlineData.rowCount,
      masked: spec.provenance.masked ?? false,
      warnings: spec.provenance.warnings ?? [],
    };
  }
  return {
    artifactId: spec.data.artifactId,
    columns: Object.entries(spec.data.expectedSchema ?? {}).map(([name, type]) => ({ name, type })),
    rowCount: spec.data.rowCount ?? 0,
    dataRef: spec.data.dataPath,
    truncated: spec.provenance.truncated ?? false,
    masked: spec.provenance.masked ?? false,
    warnings: ["该图表引用 Artifact 数据。当前消息渲染器仅显示数据来源，完整数据由 ArtifactDataResolver 解析。", ...(spec.provenance.warnings ?? [])],
  };
}

function formatValue(value: unknown, suffix = "") {
  return `${formatCell(value)}${suffix}`;
}

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }
  if (typeof value === "number") {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
  }
  return String(value);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatAxisTick(value: number) {
  return Math.abs(value) >= 10_000 ? formatCompactNumber(value) : formatAxisNumber(value);
}

function formatAxisNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
    useGrouping: Math.abs(value) >= 10_000,
  }).format(value);
}

function bubbleRadius(value: number, values: number[]) {
  const finiteValues = values.filter(Number.isFinite).map((item) => Math.abs(item));
  if (finiteValues.length === 0) {
    return 5;
  }
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  if (min === max) {
    return 7;
  }
  return round(4 + ((Math.abs(value) - min) / Math.max(1, max - min)) * 10);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export const visualizationTheme = neutralDarkVisualizationTheme;
