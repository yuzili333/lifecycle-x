import { useMemo } from "react";
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
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const width = 640;
  const height = Math.max(180, spec.display?.height ?? 220);
  const plotHeight = height - 50;
  const gap = 8;
  const barWidth = Math.max(8, (width - gap * (rows.length + 1)) / Math.max(1, rows.length));
  const points = values.map((value, index) => {
    const x = gap + index * (barWidth + gap) + barWidth / 2;
    const y = 20 + plotHeight - (value / max) * plotHeight;
    return `${round(x)},${round(y)}`;
  }).join(" ");

  return (
    <div className="assistant-visualization-svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={spec.title}>
        <line x1="24" y1={height - 30} x2={width - 12} y2={height - 30} />
        {spec.type === "line" || spec.type === "area" || spec.type === "bar_line_combo" ? (
          <>
            {spec.type === "area" && <polygon points={`24,${height - 30} ${points} ${width - 20},${height - 30}`} className="area" />}
            <polyline points={points} className="line" />
            {points.split(" ").map((point, index) => {
              const [x, y] = point.split(",");
              return <circle key={index} cx={x} cy={y} r="3" />;
            })}
          </>
        ) : (
          rows.map((row, index) => {
            const value = values[index] ?? 0;
            const barHeight = Math.max(2, (Math.abs(value) / max) * plotHeight);
            const x = gap + index * (barWidth + gap);
            const y = 20 + plotHeight - barHeight;
            return (
              <g key={index}>
                <rect x={round(x)} y={round(y)} width={round(barWidth)} height={round(barHeight)} />
                <title>{`${formatCell(row[xField ?? ""])}: ${formatCell(value)}`}</title>
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
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

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export const visualizationTheme = neutralDarkVisualizationTheme;
