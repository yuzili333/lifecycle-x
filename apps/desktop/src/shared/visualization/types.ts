export const visualizationTypes = [
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
] as const;

export type VisualizationType = (typeof visualizationTypes)[number];

export const businessVisualizationSemantics = [
  "asset_scale_trend",
  "overdue_trend",
  "institution_risk_comparison",
  "product_risk_structure",
  "risk_grade_migration",
  "vintage_analysis",
  "concentration_analysis",
  "maturity_structure",
  "warning_model_analysis",
  "risk_score_distribution",
  "collection_conversion",
  "balance_change_attribution",
  "lifecycle_event_chain",
  "guarantee_relationship",
  "related_enterprise_risk",
  "general_analysis",
] as const;

export type BusinessVisualizationSemantic = (typeof businessVisualizationSemantics)[number];

export type ArtifactVisualizationDataSource = {
  mode: "artifact";
  artifactId: string;
  datasetId?: string;
  executionId?: string;
  dataPath?: string;
  expectedSchema?: Record<string, string>;
  rowCount?: number;
  checksum?: string;
};

export type InlineVisualizationDataSource = {
  mode: "inline";
  rows: Array<Record<string, string | number | boolean | null>>;
  rowCount: number;
  trusted: boolean;
};

export type VisualizationDataSource = ArtifactVisualizationDataSource | InlineVisualizationDataSource;

export type VisualizationDimension = {
  field: string;
  label?: string;
  dataType: "category" | "time" | "number" | "boolean" | "identifier";
  role?: "x" | "category" | "series" | "source" | "target" | "time";
  sort?: "asc" | "desc" | "none";
};

export type VisualizationValueFormat = {
  type: "number" | "integer" | "percentage" | "currency" | "compact" | "date" | "datetime";
  decimals?: number;
  prefix?: string;
  suffix?: string;
  currency?: string;
};

export type VisualizationMeasure = {
  field: string;
  label?: string;
  dataType: "number" | "percentage" | "currency" | "count";
  role?: "y" | "value" | "size" | "rate" | "cumulative";
  aggregation?: "none" | "sum" | "avg" | "min" | "max" | "count";
  axis?: "left" | "right";
  format?: VisualizationValueFormat;
};

export type VisualizationSeries = {
  field?: string;
  label?: string;
  type?: VisualizationType;
  measure?: string;
  axis?: "left" | "right";
  stack?: string;
};

export type VisualizationEncoding = {
  x?: string;
  y?: string[];
  category?: string;
  series?: string;
  colorBy?: string;
  sizeBy?: string;
  source?: string;
  target?: string;
  startTime?: string;
  endTime?: string;
  value?: string;
};

export type VisualizationInteraction = {
  tooltip?: boolean;
  legend?: boolean;
  zoom?: boolean;
  brush?: boolean;
  selectable?: boolean;
  draggable?: boolean;
  expandable?: boolean;
  exportable?: boolean;
};

export type VisualizationDisplay = {
  height?: number;
  minHeight?: number;
  aspectRatio?: number;
  responsive?: boolean;
  showDataSource?: boolean;
  showWarnings?: boolean;
  emptyText?: string;
  loadingText?: string;
};

export type VisualizationThemeRef = {
  mode?: "light" | "dark" | "system";
  palette?: "neutral";
  semanticColors?: Array<"positive" | "warning" | "danger" | "neutral" | "primary">;
};

export type VisualizationProvenance = {
  sourceType: "sql" | "python" | "workflow_dataset" | "approved_inline";
  sourceRequestId?: string;
  sourceExecutionId?: string;
  sourceDatasetId?: string;
  generatedAt: string;
  masked?: boolean;
  truncated?: boolean;
  warnings?: string[];
};

export type VisualizationSpec = {
  specVersion: "1.0";
  visualizationId: string;
  type: VisualizationType;
  title: string;
  subtitle?: string;
  description?: string;
  businessSemantic?: BusinessVisualizationSemantic;
  data: VisualizationDataSource;
  dimensions?: VisualizationDimension[];
  measures?: VisualizationMeasure[];
  series?: VisualizationSeries[];
  encoding?: VisualizationEncoding;
  interaction?: VisualizationInteraction;
  display?: VisualizationDisplay;
  theme?: VisualizationThemeRef;
  provenance: VisualizationProvenance;
  metadata?: Record<string, unknown>;
};

export type VisualizationErrorCode =
  | "VISUALIZATION_SPEC_INVALID"
  | "VISUALIZATION_TYPE_UNSUPPORTED"
  | "VISUALIZATION_RENDERER_NOT_FOUND"
  | "VISUALIZATION_DATA_NOT_FOUND"
  | "VISUALIZATION_DATA_PERMISSION_DENIED"
  | "VISUALIZATION_SCHEMA_MISMATCH"
  | "VISUALIZATION_ARTIFACT_FAILED"
  | "VISUALIZATION_ROUTE_FAILED"
  | "VISUALIZATION_TRANSFORM_FAILED"
  | "VISUALIZATION_RENDER_FAILED"
  | "VISUALIZATION_STREAM_INCOMPLETE"
  | "VISUALIZATION_DATA_TOO_LARGE"
  | "UNKNOWN_ERROR";

export type VisualizationRenderError = {
  code: VisualizationErrorCode;
  message: string;
  traceId?: string;
  visualizationId?: string;
  artifactId?: string;
  recoverable?: boolean;
  details?: string[];
};

export type VisualizationStartEvent = {
  type: "visualization_start";
  eventId: string;
  messageId: string;
  conversationId: string;
  visualizationId: string;
  createdAt: string;
  payload: {
    specVersion?: string;
    type?: VisualizationType;
    title?: string;
  };
};

export type VisualizationDeltaEvent = {
  type: "visualization_delta";
  eventId: string;
  messageId: string;
  conversationId: string;
  visualizationId: string;
  createdAt: string;
  payload: {
    path?: string;
    value?: unknown;
    rawDelta?: string;
    sequence: number;
  };
};

export type VisualizationCompleteEvent = {
  type: "visualization_complete";
  eventId: string;
  messageId: string;
  conversationId: string;
  visualizationId: string;
  createdAt: string;
  payload: {
    spec: VisualizationSpec;
  };
};

export type VisualizationErrorEvent = {
  type: "visualization_error";
  eventId: string;
  messageId: string;
  conversationId: string;
  visualizationId?: string;
  createdAt: string;
  payload: {
    code: string;
    message: string;
    recoverable: boolean;
  };
};

export type VisualizationStreamEvent =
  | VisualizationStartEvent
  | VisualizationDeltaEvent
  | VisualizationCompleteEvent
  | VisualizationErrorEvent;

export type StreamingVisualizationState = {
  visualizationId: string;
  status: "receiving" | "validating" | "resolving_data" | "ready" | "rendering" | "completed" | "failed";
  partialSpec?: Partial<VisualizationSpec>;
  spec?: VisualizationSpec;
  error?: VisualizationRenderError;
  updatedAt: string;
};

export type VisualizationMarkdownNode = {
  nodeType: "visualization";
  visualizationId: string;
  status: "streaming" | "ready" | "error";
  spec?: VisualizationSpec;
  error?: VisualizationRenderError;
};

export type VisualizationEngine = "kpi" | "echarts" | "vis_network" | "vis_timeline" | "table" | "fallback";

export type VisualizationRendererCapability = {
  rendererId: string;
  engine: VisualizationEngine;
  supportedTypes: VisualizationType[];
  supportedSemantics?: BusinessVisualizationSemantic[];
  supportsStreamingUpdate: boolean;
  supportsLargeDataset: boolean;
  supportsSvg: boolean;
  supportsCanvas: boolean;
  priority: number;
};

export type VisualizationRouteResult = {
  engine: VisualizationEngine;
  rendererId: string;
  reason: string;
  fallbackRendererId?: string;
  warnings: string[];
};

export type VisualizationDataSummary = {
  rowCount: number;
  columnCount: number;
  truncated?: boolean;
  masked?: boolean;
};

export type ResolvedVisualizationData = {
  artifactId?: string;
  columns: Array<{ name: string; type: string }>;
  rows?: Record<string, unknown>[];
  dataRef?: string;
  rowCount: number;
  truncated: boolean;
  masked: boolean;
  warnings: string[];
};

export type ArtifactDataResolver = {
  resolve(input: {
    artifactId: string;
    userId?: string;
    expectedSchema?: Record<string, string>;
    maxRowsForInline?: number;
  }): Promise<ResolvedVisualizationData>;
};

export type ResolvedVisualizationTheme = {
  name: string;
  mode: "light" | "dark";
  colors: {
    primary: string[];
    positive: string;
    warning: string;
    danger: string;
    neutral: string[];
    textPrimary: string;
    textSecondary: string;
    border: string;
    background: string;
  };
  typography: {
    fontFamily: string;
    titleSize: number;
    labelSize: number;
    valueSize: number;
    lineHeight: number;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
  };
};

export type VisualizationThemeResolver = {
  resolve(spec: VisualizationSpec): ResolvedVisualizationTheme;
};

export type VisualizationRendererValidationResult = {
  valid: boolean;
  warnings: string[];
  errors: string[];
};

export type VisualizationRendererPayload = {
  rendererId: string;
  engine: VisualizationEngine;
  visualizationId: string;
  type: VisualizationType;
  title: string;
  data: ResolvedVisualizationData;
  spec: VisualizationSpec;
  theme: ResolvedVisualizationTheme;
  option?: Record<string, unknown>;
  network?: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
  timeline?: {
    items: Array<Record<string, unknown>>;
    groups: Array<Record<string, unknown>>;
  };
};

export type VisualizationRendererAdapter = {
  capability: VisualizationRendererCapability;
  canRender(input: { spec: VisualizationSpec; dataSummary?: VisualizationDataSummary }): boolean;
  validate(input: { spec: VisualizationSpec; data: ResolvedVisualizationData }): VisualizationRendererValidationResult;
  transform(input: {
    spec: VisualizationSpec;
    data: ResolvedVisualizationData;
    theme: ResolvedVisualizationTheme;
  }): Promise<VisualizationRendererPayload>;
  update?(input: {
    previousPayload: VisualizationRendererPayload;
    spec: VisualizationSpec;
    data: ResolvedVisualizationData;
  }): Promise<VisualizationRendererPayload>;
  dispose?(visualizationId: string): Promise<void> | void;
};

export type VisualizationStreamingPolicy = {
  specUpdateThrottleMs: number;
  renderUpdateThrottleMs: number;
  maxPendingDeltas: number;
  allowPartialPreview: boolean;
  validateOnEveryDelta: boolean;
  validateOnComplete: boolean;
};

export type VisualizationModuleConfig = {
  artifactResolver: ArtifactDataResolver;
  rendererRegistry?: VisualizationRendererRegistry;
  themeResolver: VisualizationThemeResolver;
  streamingPolicy?: Partial<VisualizationStreamingPolicy>;
  inlineDataMaxRows?: number;
  inlineDataMaxBytes?: number;
  allowInlineData?: boolean;
  enableDebugInfo?: boolean;
};

export type VisualizationRendererRegistry = {
  register(renderer: VisualizationRendererAdapter): void;
  unregister(rendererId: string): void;
  get(rendererId: string): VisualizationRendererAdapter | undefined;
  list(): VisualizationRendererAdapter[];
  capabilities(): VisualizationRendererCapability[];
};
