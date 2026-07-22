import { useMemo, type CSSProperties } from "react";
import { Text } from "@astryxdesign/core/Text";
import { useTheme } from "@astryxdesign/core/theme";
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
  data?: ResolvedVisualizationData;
  error?: VisualizationRenderError;
  isStreaming?: boolean;
  embedded?: boolean;
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

export function VisualizationRenderer({ spec, data: providedData, error, isStreaming, embedded = false }: VisualizationRendererProps) {
  const astryxTheme = useTheme();
  const validation = useMemo(() => (spec ? validateVisualizationSpec(spec, { allowInlineData: true }) : undefined), [spec]);
  const data = useMemo(() => providedData ?? (validation?.success ? resolveDisplayData(validation.spec) : undefined), [providedData, validation]);
  const route = useMemo(
    () => (validation?.success && data ? router.route(validation.spec, { rowCount: data.rowCount, columnCount: data.columns.length }) : undefined),
    [data, validation],
  );
  const theme = useMemo(
    () => validation?.success
      ? themeResolver.resolve(validation.spec, {
          appearance: astryxTheme.mode,
          tokens: /neutral/i.test(astryxTheme.name) ? astryxTheme.tokens : undefined,
        })
      : neutralDarkVisualizationTheme,
    [astryxTheme.mode, astryxTheme.tokens, validation],
  );

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
    <section className={`assistant-visualization${embedded ? " embedded" : ""}`} aria-label={`${visualizationTypeLabel(validation.spec.type)}：${validation.spec.title}`}>
      <div className="assistant-visualization-header">
        <div>
          <Text type="label" color="primary">{validation.spec.title}</Text>
          {validation.spec.subtitle && <Text type="body" color="secondary">{validation.spec.subtitle}</Text>}
        </div>
      </div>
      {validation.spec.description && <p className="assistant-visualization-description">{validation.spec.description}</p>}
      <VisualizationBody spec={validation.spec} data={data} engine={route?.engine ?? "fallback"} theme={theme} />
      {(validation.spec.provenance.truncated || data.truncated || validation.spec.provenance.masked || data.masked) && <div className="assistant-visualization-footer">
        {validation.spec.provenance.truncated || data.truncated ? <span>已截断</span> : null}
        {validation.spec.provenance.masked || data.masked ? <span>已脱敏</span> : null}
      </div>}
      {!embedded && validation.spec.display?.showWarnings !== false && warnings.length > 0 && (
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
  if (!data.rows?.length) {
    return <div className="assistant-visualization-empty">{spec.display?.emptyText ?? "当前图表没有可展示的数据。"}</div>;
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
  if (spec.type === "pie" || spec.type === "donut") {
    return <CircularChartView spec={spec} data={data} theme={theme} />;
  }
  if (spec.type === "horizontal_bar") {
    return <HorizontalBarChartView spec={spec} data={data} theme={theme} />;
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
      return null;
    }
    const y = scaleValue(value, yDomain.min, yDomain.max, margin.top, plotHeight);
    return { point: `${round(x)},${round(y)}`, rowIndex: index, value };
  }).filter((point): point is { point: string; rowIndex: number; value: number } => Boolean(point)));
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
                {spec.type === "area" && seriesIndex === 0 && points.length > 0 && <polygon points={`${margin.left},${round(zeroY)} ${points.map(({ point }) => point).join(" ")} ${width - margin.right},${round(zeroY)}`} className="area" />}
                <polyline points={points.map(({ point }) => point).join(" ")} className="line" />
                {points.map(({ point, rowIndex, value }) => {
                  const [x, y] = point.split(",");
                  return (
                    <circle key={rowIndex} cx={x} cy={y} r="3">
                      <title>{`${formatCell(rows[rowIndex]?.[xField ?? ""])} ${labelForMeasure(spec, yFields[seriesIndex] ?? "数值")}: ${formatCell(value)}`}</title>
                    </circle>
                  );
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
      <ChartLegend spec={spec} fields={yFields} />
      <VisualizationDataSummary spec={spec} data={data} />
    </div>
  );
}

function HorizontalBarChartView({ spec, data, theme }: { spec: VisualizationSpec; data: ResolvedVisualizationData; theme: ResolvedVisualizationTheme }) {
  const rows = (data.rows ?? []).slice(0, 30);
  const categoryField = spec.encoding?.category ?? spec.encoding?.x ?? data.columns[0]?.name;
  const categoryLabels = rows.map((row) => formatCell(row[categoryField ?? ""]));
  const valueFields = resolveYFields(spec, data, categoryField);
  const values = valueFields.flatMap((field) => rows.map((row) => normalizeNumber(row[field], Number.NaN)));
  const ticks = buildNumericTicks(values, 5, { includeZero: true });
  const domain = domainFromTicks(ticks);
  const width = 720;
  const labelWidth = Math.max(...categoryLabels.map(estimatedLabelWidth), 0);
  const margin = { top: 18, right: 60, bottom: 48, left: clamp(labelWidth + 20, 150, 320) };
  const rowHeight = Math.max(28, valueFields.length * 18 + 14);
  const height = Math.max(220, margin.top + margin.bottom + rows.length * rowHeight);
  const plotWidth = width - margin.left - margin.right;
  const zeroX = scaleContinuous(clamp(0, domain.min, domain.max), domain.min, domain.max, margin.left, plotWidth);
  const barHeight = Math.max(8, Math.min(18, (rowHeight - 8) / Math.max(1, valueFields.length)));

  return (
    <div className="assistant-visualization-svg-wrap horizontal" style={createChartStyle(theme)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={spec.title}>
        {ticks.map((tick) => {
          const x = scaleContinuous(tick, domain.min, domain.max, margin.left, plotWidth);
          return (
            <g key={tick}>
              <line x1={x} y1={margin.top} x2={x} y2={height - margin.bottom} className="grid-line" />
              <text x={x} y={height - 20} textAnchor="middle" className="axis-tick-label">{formatAxisTick(tick)}</text>
            </g>
          );
        })}
        <line x1={zeroX} y1={margin.top} x2={zeroX} y2={height - margin.bottom} className="axis-line zero-line" />
        {rows.flatMap((row, rowIndex) => {
          const groupTop = margin.top + rowIndex * rowHeight;
          const category = categoryLabels[rowIndex] ?? "--";
          return [
            <text key={`label-${rowIndex}`} x={margin.left - 12} y={groupTop + rowHeight / 2} textAnchor="end" dominantBaseline="middle" className="axis-tick-label full-label">
              {category}
            </text>,
            ...valueFields.map((field, seriesIndex) => {
              const value = normalizeNumber(row[field], Number.NaN);
              if (!Number.isFinite(value)) {
                return null;
              }
              const valueX = scaleContinuous(value, domain.min, domain.max, margin.left, plotWidth);
              const x = Math.min(zeroX, valueX);
              const y = groupTop + 5 + seriesIndex * (barHeight + 3);
              return (
                <g key={`${rowIndex}-${field}`} style={seriesStyle(seriesIndex)}>
                  <rect x={x} y={y} width={Math.max(2, Math.abs(valueX - zeroX))} height={barHeight} rx="3" />
                  <title>{`${category} ${labelForMeasure(spec, field)}: ${formatCell(value)}`}</title>
                </g>
              );
            }),
          ];
        })}
      </svg>
      <ChartLegend spec={spec} fields={valueFields} />
      <VisualizationDataSummary spec={spec} data={data} />
    </div>
  );
}

function CircularChartView({ spec, data, theme }: { spec: VisualizationSpec; data: ResolvedVisualizationData; theme: ResolvedVisualizationTheme }) {
  const rows = data.rows ?? [];
  const categoryField = spec.encoding?.category ?? spec.encoding?.x ?? data.columns[0]?.name;
  const valueField = resolveYFields(spec, data, categoryField)[0];
  const slices = rows
    .map((row) => ({ label: formatCell(row[categoryField ?? ""]), value: Math.max(0, normalizeNumber(row[valueField ?? ""], 0)) }))
    .filter((slice) => slice.value > 0);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) {
    return <div className="assistant-visualization-empty">当前图表没有可展示的数据。</div>;
  }
  let angle = -90;
  const width = 680;
  const height = Math.max(260, spec.display?.height ?? 300);
  const centerX = 250;
  const centerY = height / 2;
  const radius = Math.min(108, height / 2 - 28);
  const innerRadius = spec.type === "donut" ? radius * 0.56 : 0;

  return (
    <div className="assistant-visualization-circular" style={createChartStyle(theme)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={spec.title}>
        {slices.map((slice, index) => {
          const sweep = (slice.value / total) * 360;
          const end = angle + Math.min(sweep, 359.999);
          const path = describeArc(centerX, centerY, radius, innerRadius, angle, end);
          angle += sweep;
          return (
            <path key={`${slice.label}-${index}`} d={path} className="pie-slice" style={seriesStyle(index)}>
              <title>{`${slice.label}: ${formatCell(slice.value)}（${formatPercentage(slice.value / total)}）`}</title>
            </path>
          );
        })}
        {spec.type === "donut" ? (
          <g className="donut-center">
            <text x={centerX} y={centerY - 5} textAnchor="middle" className="donut-value">{formatCompactNumber(total)}</text>
            <text x={centerX} y={centerY + 18} textAnchor="middle" className="axis-tick-label">合计</text>
          </g>
        ) : null}
      </svg>
      <ul className="assistant-visualization-circular-legend" aria-label="图例">
        {slices.map((slice, index) => (
          <li key={`${slice.label}-${index}`} style={seriesStyle(index)}>
            <span className="assistant-visualization-legend-swatch" />
            <span>{slice.label}</span>
            <strong>{formatPercentage(slice.value / total)}</strong>
          </li>
        ))}
      </ul>
      <VisualizationDataSummary spec={spec} data={data} />
    </div>
  );
}

function ChartLegend({ spec, fields }: { spec: VisualizationSpec; fields: string[] }) {
  if (spec.interaction?.legend === false || fields.length <= 1) {
    return null;
  }
  return (
    <ul className="assistant-visualization-legend" aria-label="图例">
      {fields.map((field, index) => (
        <li key={field} style={seriesStyle(index)}>
          <span className="assistant-visualization-legend-swatch" />
          <span>{labelForMeasure(spec, field)}</span>
        </li>
      ))}
    </ul>
  );
}

function VisualizationDataSummary({ spec, data }: { spec: VisualizationSpec; data: ResolvedVisualizationData }) {
  const rows = (data.rows ?? []).slice(0, 30);
  const fields = uniqueStrings([
    spec.encoding?.category ?? "",
    spec.encoding?.x ?? "",
    ...(spec.encoding?.y ?? []),
    spec.encoding?.value ?? "",
  ]).filter((field) => data.columns.some((column) => column.name === field));
  if (rows.length === 0 || fields.length === 0) {
    return null;
  }
  return (
    <table className="assistant-visualization-a11y-table">
      <caption>{spec.title}数据摘要</caption>
      <thead><tr>{fields.map((field) => <th key={field}>{labelForField(spec, field)}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, index) => <tr key={index}>{fields.map((field) => <td key={field}>{formatCell(row[field])}</td>)}</tr>)}
      </tbody>
    </table>
  );
}

function createChartStyle(theme: ResolvedVisualizationTheme) {
  return {
    "--viz-series-0": theme.colors.primary[0],
    "--viz-series-1": theme.colors.primary[1],
    "--viz-series-2": theme.colors.primary[2],
    "--viz-series-3": theme.colors.primary[3],
    "--viz-series-4": theme.colors.primary[4],
    "--viz-axis": theme.colors.textSecondary,
    "--viz-grid": theme.colors.border,
    "--viz-text": theme.colors.textPrimary,
    "--viz-surface": theme.colors.neutral[1],
    "--viz-font": theme.typography.fontFamily,
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

function estimatedLabelWidth(value: string) {
  return Array.from(value).reduce((width, character) => width + (/[^\u0000-\u00ff]/.test(character) ? 12 : 7), 0);
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

function labelForField(spec: VisualizationSpec, field: string) {
  return spec.measures?.find((measure) => measure.field === field)?.label
    ?? spec.dimensions?.find((dimension) => dimension.field === field)?.label
    ?? field;
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

function VisualizationSkeleton(_props: { visualizationId?: string }) {
  return (
    <section className="assistant-visualization skeleton" aria-label="图表加载中">
      <div className="assistant-visualization-header">
        <div className="assistant-skeleton-line short" />
        <div className="assistant-skeleton-line chip" />
      </div>
      <div className="assistant-skeleton-chart" />
    </section>
  );
}

function VisualizationErrorView({ error }: { error?: VisualizationRenderError; visualizationId?: string }) {
  return (
    <section className="assistant-visualization error" aria-label="图表错误">
      <Text type="label" color="primary">图表暂时无法显示</Text>
      <p>{error ? "图表配置或数据无法解析，其他内容仍可正常查看。" : "图表渲染失败，其他内容仍可正常查看。"}</p>
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

function formatPercentage(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 2 }).format(value);
}

function describeArc(cx: number, cy: number, outerRadius: number, innerRadius: number, startAngle: number, endAngle: number) {
  const outerStart = polarPoint(cx, cy, outerRadius, startAngle);
  const outerEnd = polarPoint(cx, cy, outerRadius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  if (innerRadius <= 0) {
    return [
      `M ${cx} ${cy}`,
      `L ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      "Z",
    ].join(" ");
  }
  const innerEnd = polarPoint(cx, cy, innerRadius, endAngle);
  const innerStart = polarPoint(cx, cy, innerRadius, startAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: round(cx + Math.cos(radians) * radius),
    y: round(cy + Math.sin(radians) * radius),
  };
}

function visualizationTypeLabel(type: VisualizationSpec["type"]) {
  if (type === "horizontal_bar") return "横向柱状图";
  if (type === "bar" || type === "stacked_bar") return "柱状图";
  if (type === "line") return "折线图";
  if (type === "area") return "面积图";
  if (type === "pie") return "饼图";
  if (type === "donut") return "环形图";
  if (type === "scatter" || type === "bubble") return "散点图";
  if (type === "table") return "数据表";
  if (type === "kpi") return "指标";
  return "图表";
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
