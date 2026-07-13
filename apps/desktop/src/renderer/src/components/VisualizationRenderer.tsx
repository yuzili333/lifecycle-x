import { useMemo, type CSSProperties } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import {
  createDefaultVisualizationRendererRegistry,
  neutralDarkVisualizationTheme,
  validateVisualizationSpec,
  VisualizationRouter,
  type ResolvedVisualizationData,
  type StreamingVisualizationState,
  type VisualizationRenderError,
  type VisualizationSpec,
} from "../../../shared/visualization";

const registry = createDefaultVisualizationRendererRegistry();
const router = new VisualizationRouter(registry);

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
      <VisualizationBody spec={validation.spec} data={data} engine={route?.engine ?? "fallback"} />
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

function VisualizationBody({ spec, data, engine }: { spec: VisualizationSpec; data: ResolvedVisualizationData; engine: string }) {
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
  return <SvgChartView spec={spec} data={data} />;
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

function SvgChartView({ spec, data }: { spec: VisualizationSpec; data: ResolvedVisualizationData }) {
  const rows = data.rows ?? [];
  const xField = spec.encoding?.x ?? spec.encoding?.category ?? data.columns[0]?.name;
  const yField = spec.encoding?.y?.[0] ?? spec.encoding?.value ?? spec.measures?.[0]?.field ?? data.columns.find((column) => column.type === "number")?.name;
  const values = rows.map((row) => Number(row[yField ?? ""] ?? 0));
  const tickValues = buildNumericTicks(values);
  const min = tickValues[0] ?? 0;
  const max = tickValues.at(-1) ?? 1;
  const width = 680;
  const height = Math.max(240, spec.display?.height ?? 260);
  const margin = { top: 22, right: 22, bottom: 66, left: 76 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const zeroY = scaleValue(0, min, max, margin.top, plotHeight);
  const categoryCount = Math.max(1, rows.length);
  const categoryStep = plotWidth / categoryCount;
  const gap = Math.min(10, Math.max(4, categoryStep * 0.24));
  const barWidth = Math.max(6, categoryStep - gap);
  const xTickIndexes = buildCategoryTickIndexes(rows.length);
  const yAxisLabel = spec.measures?.find((measure) => measure.field === yField)?.label ?? yField ?? "数值";
  const xAxisLabel = spec.dimensions?.find((dimension) => dimension.field === xField)?.label ?? xField ?? "维度";
  const points = values.map((value, index) => {
    const x = margin.left + categoryStep * index + categoryStep / 2;
    const y = scaleValue(value, min, max, margin.top, plotHeight);
    return `${round(x)},${round(y)}`;
  }).join(" ");
  const chartStyle = {
    "--viz-series-0": neutralDarkVisualizationTheme.colors.primary[0],
    "--viz-series-1": neutralDarkVisualizationTheme.colors.primary[1],
    "--viz-axis": neutralDarkVisualizationTheme.colors.textSecondary,
    "--viz-grid": neutralDarkVisualizationTheme.colors.border,
    "--viz-text": neutralDarkVisualizationTheme.colors.textPrimary,
  } as CSSProperties;

  return (
    <div className="assistant-visualization-svg-wrap" style={chartStyle}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={spec.title}>
        <g className="axis-grid">
          {tickValues.map((tick) => {
            const y = scaleValue(tick, min, max, margin.top, plotHeight);
            return (
              <g key={tick}>
                <line x1={margin.left} y1={round(y)} x2={width - margin.right} y2={round(y)} className="grid-line" />
                <text x={margin.left - 10} y={round(y)} textAnchor="end" dominantBaseline="middle" className="axis-tick-label">
                  {formatCompactNumber(tick)}
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
        {xTickIndexes.map((index) => {
          const row = rows[index];
          const x = margin.left + categoryStep * index + categoryStep / 2;
          return (
            <g key={index}>
              <line x1={round(x)} y1={height - margin.bottom} x2={round(x)} y2={height - margin.bottom + 4} className="axis-line" />
              <text x={round(x)} y={height - margin.bottom + 18} textAnchor="middle" className="axis-tick-label">
                {truncateAxisLabel(formatCell(row?.[xField ?? ""]), rows.length)}
              </text>
            </g>
          );
        })}
        {spec.type === "line" || spec.type === "area" || spec.type === "bar_line_combo" ? (
          <>
            {spec.type === "area" && <polygon points={`${margin.left},${round(zeroY)} ${points} ${width - margin.right},${round(zeroY)}`} className="area" />}
            <polyline points={points} className="line" />
            {points.split(" ").map((point, index) => {
              const [x, y] = point.split(",");
              return <circle key={index} cx={x} cy={y} r="3" />;
            })}
          </>
        ) : (
          rows.map((row, index) => {
            const value = values[index] ?? 0;
            const valueY = scaleValue(value, min, max, margin.top, plotHeight);
            const barHeight = Math.max(2, Math.abs(zeroY - valueY));
            const x = margin.left + categoryStep * index + (categoryStep - barWidth) / 2;
            const y = value >= 0 ? valueY : zeroY;
            return (
              <g key={index}>
                <rect x={round(x)} y={round(y)} width={round(barWidth)} height={round(barHeight)} style={{ "--viz-bar-index": index } as CSSProperties} />
                <title>{`${formatCell(row[xField ?? ""])}: ${formatCell(value)}`}</title>
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
}

function scaleValue(value: number, min: number, max: number, top: number, plotHeight: number) {
  if (max === min) {
    return top + plotHeight / 2;
  }
  return top + plotHeight - ((value - min) / (max - min)) * plotHeight;
}

function buildNumericTicks(values: number[], tickCount = 5) {
  const finiteValues = values.filter(Number.isFinite);
  const rawMin = Math.min(0, ...finiteValues);
  const rawMax = Math.max(0, ...finiteValues);
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax) || rawMin === rawMax) {
    return [0, 1, 2, 3, 4];
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

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export const visualizationTheme = neutralDarkVisualizationTheme;
