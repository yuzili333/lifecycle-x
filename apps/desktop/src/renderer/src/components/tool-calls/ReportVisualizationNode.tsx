import { Component, useEffect, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import type {
  ReportVisualizationErrorCode,
  ResolvedReportVisualizationArtifact,
} from "../../../../shared/visualization";
import { VisualizationRenderer } from "../VisualizationRenderer";

export type ReportVisualizationNodeProps = {
  userId: string;
  conversationId: string;
  reportArtifactId: string;
  reportVersion: number;
  artifactId?: string;
  title?: string;
  description?: string;
  resolveArtifact?: (input: {
    userId: string;
    conversationId: string;
    reportArtifactId: string;
    reportVersion: number;
    visualizationArtifactId: string;
  }) => Promise<ResolvedReportVisualizationArtifact>;
};

export type ReportVisualizationState =
  | { status: "loading" }
  | { status: "ready"; artifact: ResolvedReportVisualizationArtifact }
  | { status: "empty" }
  | { status: "expired" }
  | { status: "failed"; message: string };

const artifactRequestCache = new Map<string, Promise<ResolvedReportVisualizationArtifact>>();

export function ReportVisualizationNode(props: ReportVisualizationNodeProps) {
  const [retryCount, setRetryCount] = useState(0);
  const [state, setState] = useState<ReportVisualizationState>(() => props.artifactId ? { status: "loading" } : { status: "failed", message: "该可视化内容暂时无法显示。" });
  const cacheKey = cacheKeyFor(props);

  useEffect(() => {
    if (!props.artifactId) {
      setState({ status: "failed", message: "该可视化内容暂时无法显示。" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    const request = cachedArtifactRequest(props, cacheKey);
    void request
      .then((artifact) => {
        if (!active) {
          return;
        }
        const rows = artifact.data.rows ?? [];
        setState(artifact.data.rowCount === 0 || rows.length === 0 ? { status: "empty" } : { status: "ready", artifact });
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        const code = reportVisualizationErrorCode(error);
        if (code === "VISUALIZATION_ARTIFACT_EXPIRED" || code === "VISUALIZATION_ARTIFACT_NOT_FOUND") {
          setState({ status: "expired" });
          return;
        }
        setState({
          status: "failed",
          message: code === "VISUALIZATION_NODE_INVALID"
            ? "该可视化内容暂时无法显示。"
            : "图表加载失败，报告中的其他内容仍可正常查看。",
        });
      });
    return () => {
      active = false;
    };
  }, [cacheKey, props.artifactId, props.conversationId, props.reportArtifactId, props.resolveArtifact, props.userId, retryCount]);

  return (
    <ReportVisualizationContent
      state={state}
      title={props.title}
      artifactId={props.artifactId}
      retryKey={`${cacheKey}\u0000${retryCount}`}
      onRetry={() => retryArtifact(cacheKey, setRetryCount)}
    />
  );
}

export function ReportVisualizationContent({
  state,
  title,
  artifactId,
  retryKey,
  onRetry,
}: {
  state: ReportVisualizationState;
  title?: string;
  artifactId?: string;
  retryKey: string;
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    return <ReportVisualizationPlaceholder title={title} />;
  }
  if (state.status === "empty") {
    return <ReportVisualizationNotice state="empty" title={title} message="当前图表没有可展示的数据。" />;
  }
  if (state.status === "expired") {
    return (
      <ReportVisualizationNotice
        state="expired"
        title={title}
        message="该图表数据已失效，请重新执行上游查询或分析。"
        action={<Button label="重试" variant="secondary" size="sm" onClick={onRetry} />}
      />
    );
  }
  if (state.status === "failed") {
    return (
      <ReportVisualizationNotice
        state="failed"
        title={title}
        message={state.message}
        action={artifactId ? <Button label="重试" variant="secondary" size="sm" onClick={onRetry} /> : undefined}
      />
    );
  }
  return (
    <VisualizationErrorBoundary title={title} resetKey={retryKey} onRetry={onRetry}>
      <div className="assistant-report-visualization-node" data-visualization-state="ready">
        <VisualizationRenderer
          spec={state.artifact.visualizationSpec}
          data={state.artifact.data}
          embedded
        />
      </div>
    </VisualizationErrorBoundary>
  );
}

function ReportVisualizationPlaceholder({ title }: { title?: string }) {
  return (
    <section className="assistant-report-visualization-node loading" aria-label={title ? `${title}加载中` : "图表加载中"} aria-busy="true" data-visualization-state="loading">
      <div className="assistant-report-visualization-title-skeleton" />
      <div className="assistant-report-visualization-chart-skeleton" />
    </section>
  );
}

function ReportVisualizationNotice({ state = "failed", title, message, action }: { state?: "empty" | "expired" | "failed"; title?: string; message: string; action?: ReactNode }) {
  return (
    <section className="assistant-report-visualization-node notice" aria-label={title ?? "图表状态"} data-visualization-state={state}>
      {title ? <Text type="label" weight="semibold">{title}</Text> : null}
      <Text type="body" color="secondary">{message}</Text>
      {action}
    </section>
  );
}

class VisualizationErrorBoundary extends Component<{ title?: string; resetKey: string; onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Report visualization render failed", error);
  }

  componentDidUpdate(previousProps: Readonly<{ resetKey: string }>) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <ReportVisualizationNotice
          state="failed"
          title={this.props.title}
          message="图表加载失败，报告中的其他内容仍可正常查看。"
          action={<Button label="重试" variant="secondary" size="sm" onClick={this.props.onRetry} />}
        />
      );
    }
    return this.props.children;
  }
}

function cachedArtifactRequest(props: ReportVisualizationNodeProps, cacheKey: string) {
  const cached = artifactRequestCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const resolver = props.resolveArtifact ?? defaultArtifactResolver;
  const request = resolver({
    userId: props.userId,
    conversationId: props.conversationId,
    reportArtifactId: props.reportArtifactId,
    reportVersion: props.reportVersion,
    visualizationArtifactId: props.artifactId as string,
  }).catch((error) => {
    artifactRequestCache.delete(cacheKey);
    throw error;
  });
  artifactRequestCache.set(cacheKey, request);
  return request;
}

function defaultArtifactResolver(input: {
  userId: string;
  conversationId: string;
  reportArtifactId: string;
  reportVersion: number;
  visualizationArtifactId: string;
}) {
  const api = window.lifecycleX?.assistant;
  if (!api?.resolveReportVisualization) {
    return Promise.reject(new Error("[UNKNOWN_ERROR] 图表解析服务不可用。"));
  }
  return api.resolveReportVisualization(input.userId, input.conversationId, input.reportArtifactId, input.reportVersion, input.visualizationArtifactId);
}

function cacheKeyFor(props: ReportVisualizationNodeProps) {
  return [props.userId, props.conversationId, props.reportArtifactId, props.reportVersion, props.artifactId ?? "invalid"].join("\u0000");
}

function retryArtifact(cacheKey: string, update: (updater: (value: number) => number) => void) {
  artifactRequestCache.delete(cacheKey);
  update((value) => value + 1);
}

function reportVisualizationErrorCode(error: unknown): ReportVisualizationErrorCode | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code as ReportVisualizationErrorCode;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = message.match(/\[(VISUALIZATION_[A-Z_]+|CHART_THEME_RESOLVE_FAILED|UNKNOWN_ERROR)\]/);
  return match?.[1] as ReportVisualizationErrorCode | undefined;
}
