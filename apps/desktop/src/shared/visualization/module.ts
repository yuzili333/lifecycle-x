import {
  createEChartsRendererAdapter,
  createFallbackRendererAdapter,
  createKpiRendererAdapter,
  createNetworkRendererAdapter,
  createTableRendererAdapter,
  createTimelineRendererAdapter,
} from "./adapters";
import { StreamVisualizationAssembler } from "./assembler";
import { DefaultVisualizationRendererRegistry, VisualizationRouter } from "./router";
import { DefaultVisualizationThemeResolver } from "./theme";
import type {
  ArtifactDataResolver,
  ResolvedVisualizationData,
  VisualizationDataSummary,
  VisualizationModuleConfig,
  VisualizationRendererAdapter,
  VisualizationSpec,
  VisualizationStreamEvent,
} from "./types";
import { validateVisualizationSpec } from "./validator";

export class NoopArtifactDataResolver implements ArtifactDataResolver {
  async resolve({ artifactId }: { artifactId: string }): Promise<ResolvedVisualizationData> {
    return {
      artifactId,
      columns: [],
      rowCount: 0,
      truncated: false,
      masked: false,
      warnings: ["当前环境未提供 ArtifactDataResolver，图表仅显示数据来源引用。"],
    };
  }
}

export function createDefaultVisualizationRendererRegistry() {
  return new DefaultVisualizationRendererRegistry([
    createKpiRendererAdapter(),
    createEChartsRendererAdapter(),
    createNetworkRendererAdapter(),
    createTimelineRendererAdapter(),
    createTableRendererAdapter(),
    createFallbackRendererAdapter(),
  ]);
}

export function createVisualizationModule(config: VisualizationModuleConfig) {
  const registry = config.rendererRegistry ?? createDefaultVisualizationRendererRegistry();
  const router = new VisualizationRouter(registry);
  const assembler = new StreamVisualizationAssembler({
    allowInlineData: config.allowInlineData,
    inlineDataMaxRows: config.inlineDataMaxRows,
    inlineDataMaxBytes: config.inlineDataMaxBytes,
  });
  const themeResolver = config.themeResolver ?? new DefaultVisualizationThemeResolver();

  async function resolveData(spec: VisualizationSpec): Promise<ResolvedVisualizationData> {
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
    return config.artifactResolver.resolve({
      artifactId: spec.data.artifactId,
      expectedSchema: spec.data.expectedSchema,
      maxRowsForInline: config.inlineDataMaxRows,
    });
  }

  return {
    registerRenderer(renderer: VisualizationRendererAdapter) {
      registry.register(renderer);
    },
    unregisterRenderer(rendererId: string) {
      registry.unregister(rendererId);
    },
    getRendererCapabilities() {
      return registry.capabilities();
    },
    validateSpec(spec: unknown) {
      return validateVisualizationSpec(spec, {
        allowInlineData: config.allowInlineData,
        inlineDataMaxRows: config.inlineDataMaxRows,
        inlineDataMaxBytes: config.inlineDataMaxBytes,
      });
    },
    route(spec: VisualizationSpec, dataSummary?: VisualizationDataSummary) {
      return router.route(spec, dataSummary);
    },
    resolveData,
    async transform(spec: VisualizationSpec, rendererId?: string) {
      const data = await resolveData(spec);
      const route = rendererId ? { rendererId } : router.route(spec, { rowCount: data.rowCount, columnCount: data.columns.length });
      const renderer = registry.get(route.rendererId) ?? registry.get("fallback-table-renderer");
      if (!renderer) {
        throw new Error("未找到可用可视化 renderer。");
      }
      return renderer.transform({ spec, data, theme: themeResolver.resolve(spec) });
    },
    handleStreamEvent(event: VisualizationStreamEvent) {
      return assembler.handleStreamEvent(event);
    },
    getStreamingState(visualizationId: string) {
      return assembler.getStreamingState(visualizationId);
    },
    dispose(visualizationId: string) {
      assembler.dispose(visualizationId);
      for (const renderer of registry.list()) {
        void renderer.dispose?.(visualizationId);
      }
    },
  };
}
