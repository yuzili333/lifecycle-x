export type SegmentStatus = "streaming" | "completed";

export type BaseContentSegment = {
  segmentId: string;
  messageId: string;
  sequence: number;
  createdAt: string;
  updatedAt: string;
};

export type TextContentSegment = BaseContentSegment & {
  type: "text";
  content: string;
  status: SegmentStatus;
};

export type MarkdownContentSegment = BaseContentSegment & {
  type: "markdown";
  content: string;
  status: SegmentStatus;
  contentRole: "general";
};

export type ReportContentSegment = BaseContentSegment & {
  type: "report";
  markdownContent: string;
  status: "streaming" | "completed" | "buffering" | "card_ready" | "card_visible" | "failed";
  reportId?: string;
  reportArtifactId?: string;
  reportTitle?: string;
  reportVersion?: number;
  streamCompletedAt?: string;
  bufferStartedAt?: string;
  cardVisibleAt?: string;
  transitionError?: string;
};

export type VisualizationContentSegment = BaseContentSegment & {
  type: "visualization";
  status: SegmentStatus;
  content: string;
};

export type ToolStatusContentSegment = BaseContentSegment & {
  type: "tool_status";
  status: SegmentStatus;
  content: string;
};

export type ChatContentSegment =
  | TextContentSegment
  | MarkdownContentSegment
  | ReportContentSegment
  | VisualizationContentSegment
  | ToolStatusContentSegment;

export type ReportTransitionPolicy = {
  bufferDelayMs: number;
  transitionDurationMs: number;
  requireArtifactReady: boolean;
  keepMarkdownOnTransitionError: boolean;
  allowCrossFade: boolean;
};

export const DEFAULT_REPORT_TRANSITION_POLICY: ReportTransitionPolicy = {
  bufferDelayMs: 1000,
  transitionDurationMs: 180,
  requireArtifactReady: true,
  keepMarkdownOnTransitionError: true,
  allowCrossFade: true,
};

export type StreamRenderPolicy = {
  textFlushIntervalMs: number;
  markdownFlushIntervalMs: number;
  maxBufferedCharacters: number;
};

export const DEFAULT_STREAM_RENDER_POLICY: StreamRenderPolicy = {
  textFlushIntervalMs: 24,
  markdownFlushIntervalMs: 48,
  maxBufferedCharacters: 2048,
};

export type TextDeltaEvent = {
  type: "text_delta";
  messageId: string;
  segmentId: string;
  sequence: number;
  delta: string;
};

export type MarkdownDeltaEvent = {
  type: "markdown_delta";
  messageId: string;
  segmentId: string;
  sequence: number;
  delta: string;
  contentRole?: "general";
};

export type ReportMarkdownDeltaEvent = {
  type: "report_markdown_delta";
  messageId: string;
  segmentId: string;
  sequence: number;
  delta: string;
  reportId?: string;
};

export type ReportArtifactReadyEvent = {
  type: "report_artifact_ready";
  messageId: string;
  segmentId: string;
  reportId: string;
  reportArtifactId: string;
  title: string;
  version: number;
  createdAt: string;
};

export type MessageStreamCompletedEvent = {
  type: "message_stream_completed";
  messageId: string;
  completedAt: string;
};

export type StreamErrorEvent = {
  type: "stream_error";
  messageId: string;
  segmentId?: string;
  code: StreamingContentErrorCode;
  message: string;
};

export type ChatStreamEvent =
  | TextDeltaEvent
  | MarkdownDeltaEvent
  | ReportMarkdownDeltaEvent
  | ReportArtifactReadyEvent
  | MessageStreamCompletedEvent
  | StreamErrorEvent;

export type ModelStreamContentEvent = {
  eventId: string;
  messageId: string;
  segmentId: string;
  contentType: "text" | "markdown" | "report_markdown" | "visualization" | "tool_status";
  delta?: string;
  sequence: number;
  metadata?: {
    contentRole?: "general" | "report";
    reportId?: string;
    reportArtifactId?: string;
  };
};

export type StreamingContentModuleConfig = {
  reportTransitionPolicy?: Partial<ReportTransitionPolicy>;
  streamRenderPolicy?: Partial<StreamRenderPolicy>;
  preserveTextSegments?: boolean;
  preserveMarkdownOnReportError?: boolean;
  enableReportCrossFade?: boolean;
};

export const DEFAULT_STREAMING_CONTENT_CONFIG = {
  preserveTextSegments: true,
  preserveMarkdownOnReportError: true,
  enableReportCrossFade: true,
  reportTransitionPolicy: DEFAULT_REPORT_TRANSITION_POLICY,
  streamRenderPolicy: DEFAULT_STREAM_RENDER_POLICY,
} satisfies Required<StreamingContentModuleConfig>;

export type StreamingContentErrorCode =
  | "STREAM_SEGMENT_NOT_FOUND"
  | "STREAM_SEQUENCE_INVALID"
  | "STREAM_EVENT_DUPLICATED"
  | "REPORT_ARTIFACT_NOT_READY"
  | "REPORT_TRANSITION_CANCELLED"
  | "REPORT_TRANSITION_FAILED"
  | "REPORT_CONTENT_EMPTY"
  | "REPORT_METADATA_MISSING"
  | "UNKNOWN_ERROR";
