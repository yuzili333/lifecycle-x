import { Markdown, type MarkdownComponents } from "@astryxdesign/core/Markdown";
import type { ReportContentSegment } from "../../streaming-content";
import { ReportToolCallCard, type ReportCardStatus } from "../tool-calls";

export type StreamingReportSegmentProps = {
  segment: ReportContentSegment;
  markdownComponents?: MarkdownComponents;
  chartCount?: number;
  dataSourceCount?: number;
  dataSourceLabels?: string[];
  generatedAt?: string;
  onOpen: () => void;
};

function cardStatus(segment: ReportContentSegment): ReportCardStatus {
  if (segment.status === "failed") {
    return "failed";
  }
  if (segment.status === "card_ready" || segment.status === "card_visible") {
    return "completed";
  }
  return "creating";
}

export function StreamingReportSegment({
  segment,
  markdownComponents,
  chartCount,
  dataSourceCount,
  dataSourceLabels,
  generatedAt,
  onOpen,
}: StreamingReportSegmentProps) {
  const canShowReportCard =
    (segment.status === "card_ready" || segment.status === "card_visible") &&
    Boolean(segment.reportArtifactId) &&
    Boolean(segment.reportTitle);

  if (!canShowReportCard) {
    return (
      <div className="assistant-message-block markdown streaming-report-segment" data-segment-id={segment.segmentId}>
        <Markdown
          density="compact"
          headingLevelStart={3}
          contentWidth="100%"
          autolink="gfm"
          isStreaming={segment.status === "streaming" || segment.status === "buffering"}
          components={markdownComponents}
        >
          {segment.markdownContent}
        </Markdown>
      </div>
    );
  }

  return (
    <div className="assistant-message-block report-transition card-visible" data-segment-id={segment.segmentId}>
      <ReportToolCallCard
        title={segment.reportTitle ?? "分析报告"}
        version={segment.reportVersion}
        generatedAt={generatedAt ?? segment.cardVisibleAt ?? segment.updatedAt}
        chartCount={chartCount}
        dataSourceCount={dataSourceCount}
        dataSourceLabels={dataSourceLabels}
        status={cardStatus(segment)}
        onOpen={onOpen}
      />
    </div>
  );
}

