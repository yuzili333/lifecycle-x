import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StreamingReportSegment } from "../renderer/src/components/streaming-content";
import type { ReportContentSegment } from "../renderer/src/streaming-content";

function reportSegment(patch: Partial<ReportContentSegment> = {}): ReportContentSegment {
  return {
    segmentId: "report-segment-1",
    messageId: "message-1",
    sequence: 1,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    type: "report",
    markdownContent: "# 风险分析报告\n\n完整 Markdown 内容",
    status: "streaming",
    ...patch,
  };
}

describe("StreamingReportSegment", () => {
  it("renders streaming and buffering report markdown instead of a card", () => {
    const streamingHtml = renderToString(
      <StreamingReportSegment segment={reportSegment()} onOpen={() => undefined} />,
    );
    const bufferingHtml = renderToString(
      <StreamingReportSegment segment={reportSegment({ status: "buffering" })} onOpen={() => undefined} />,
    );

    expect(streamingHtml).toContain("streaming-report-segment");
    expect(streamingHtml).toContain('data-segment-id="report-segment-1"');
    expect(streamingHtml).not.toContain("assistant-report-card");
    expect(bufferingHtml).toContain("streaming-report-segment");
    expect(bufferingHtml).toContain('data-segment-id="report-segment-1"');
    expect(bufferingHtml).not.toContain("assistant-report-card");
  });

  it("keeps markdown visible when artifact metadata is missing", () => {
    const html = renderToString(
      <StreamingReportSegment segment={reportSegment({ status: "card_ready" })} onOpen={() => undefined} />,
    );

    expect(html).toContain("streaming-report-segment");
    expect(html).not.toContain("assistant-report-card");
  });

  it("keeps markdown visible when report transition fails", () => {
    const html = renderToString(
      <StreamingReportSegment segment={reportSegment({ status: "failed", transitionError: "artifact missing" })} onOpen={() => undefined} />,
    );

    expect(html).toContain("streaming-report-segment");
    expect(html).toContain("完整 Markdown 内容");
    expect(html).not.toContain("assistant-report-card");
  });

  it("renders a clickable report card only after the report segment is card visible", () => {
    const html = renderToString(
      <StreamingReportSegment
        segment={reportSegment({
          status: "card_visible",
          reportArtifactId: "assistant-report-markdown:1",
          reportTitle: "风险分析报告",
          reportVersion: 2,
        })}
        generatedAt="2026-07-15 10:00:00"
        chartCount={1}
        dataSourceCount={1}
        dataSourceLabels={["贷款合同表"]}
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain("assistant-report-card");
    expect(html).toContain("风险分析报告");
    expect(html).toContain("版本 2");
    expect(html).toContain("包含 <!-- -->1<!-- --> 张图表");
    expect(html).toContain("1<!-- --> 个数据来源");
    expect(html).not.toContain("完整 Markdown 内容");
  });
});
