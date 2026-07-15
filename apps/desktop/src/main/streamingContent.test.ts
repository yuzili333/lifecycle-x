import { afterEach, describe, expect, it, vi } from "vitest";
import { applyChatStreamEvent, isReportMarkdownContentBlock, reportMarkdownContentIndex, ReportTransitionController, resolveReportCardRenderTransition, StreamSegmentManager, splitReportMarkdownContent } from "../renderer/src/streaming-content";

describe("StreamSegmentManager", () => {
  it("keeps text and report segments independent and deduplicates sequence numbers", () => {
    const manager = new StreamSegmentManager();

    manager.appendTextDelta({ messageId: "message-1", segmentId: "text-1", sequence: 1, delta: "说明：" });
    manager.appendMarkdownDelta({ messageId: "message-1", segmentId: "report-1", sequence: 2, delta: "# 风险报告", role: "report" });
    manager.appendMarkdownDelta({ messageId: "message-1", segmentId: "report-1", sequence: 2, delta: "# 风险报告", role: "report" });
    manager.markReportArtifactReady({
      messageId: "message-1",
      segmentId: "report-1",
      artifactId: "assistant-report-markdown:1",
      title: "风险报告",
      version: 1,
    });
    manager.markMessageCompleted("message-1");
    manager.startReportBuffer("report-1");
    manager.markReportCardReady("report-1");
    manager.showReportCard("report-1");

    const segments = manager.getMessageSegments("message-1");
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ type: "text", content: "说明：", status: "completed" });
    expect(segments[1]).toMatchObject({
      type: "report",
      markdownContent: "# 风险报告",
      status: "card_visible",
      reportArtifactId: "assistant-report-markdown:1",
      reportTitle: "风险报告",
      reportVersion: 1,
    });
  });

  it("does not convert ordinary markdown into a report segment", () => {
    const manager = new StreamSegmentManager();

    manager.appendMarkdownDelta({ messageId: "message-1", segmentId: "markdown-1", sequence: 1, delta: "# 普通说明报告\n这不是报告工具结果。", role: "general" });
    manager.markMessageCompleted("message-1");

    expect(manager.getSegment("markdown-1")).toMatchObject({
      type: "markdown",
      contentRole: "general",
      status: "completed",
    });
  });

  it("returns a buffering report segment to streaming when a new delta arrives", () => {
    const manager = new StreamSegmentManager();

    manager.appendMarkdownDelta({ messageId: "message-1", segmentId: "report-1", sequence: 1, delta: "# 风险报告", role: "report" });
    manager.markReportArtifactReady({
      messageId: "message-1",
      segmentId: "report-1",
      artifactId: "assistant-report-markdown:1",
      title: "风险报告",
      version: 1,
    });
    manager.startReportBuffer("report-1");
    manager.appendMarkdownDelta({ messageId: "message-1", segmentId: "report-1", sequence: 2, delta: "\n补充内容", role: "report" });

    expect(manager.getSegment("report-1")).toMatchObject({
      type: "report",
      status: "streaming",
      markdownContent: "# 风险报告\n补充内容",
    });
  });
});

describe("applyChatStreamEvent", () => {
  it("maps structured stream events into independent content segments", () => {
    const manager = new StreamSegmentManager();

    applyChatStreamEvent(manager, { type: "text_delta", messageId: "message-1", segmentId: "text-1", sequence: 1, delta: "说明：" });
    applyChatStreamEvent(manager, { type: "markdown_delta", messageId: "message-1", segmentId: "markdown-1", sequence: 2, delta: "# 普通 Markdown" });
    applyChatStreamEvent(manager, { type: "report_markdown_delta", messageId: "message-1", segmentId: "report-1", sequence: 3, delta: "# 风险报告" });
    applyChatStreamEvent(manager, {
      type: "report_artifact_ready",
      messageId: "message-1",
      segmentId: "report-1",
      reportId: "report-1",
      reportArtifactId: "assistant-report-markdown:1",
      title: "风险报告",
      version: 1,
      createdAt: "2026-07-15T00:00:00.000Z",
    });
    applyChatStreamEvent(manager, { type: "message_stream_completed", messageId: "message-1", completedAt: "2026-07-15T00:00:01.000Z" });

    expect(manager.getMessageSegments("message-1")).toMatchObject([
      { type: "text", content: "说明：", status: "completed" },
      { type: "markdown", content: "# 普通 Markdown", status: "completed", contentRole: "general" },
      {
        type: "report",
        markdownContent: "# 风险报告",
        status: "completed",
        reportArtifactId: "assistant-report-markdown:1",
        reportTitle: "风险报告",
      },
    ]);
  });
});

describe("ReportTransitionController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the configured buffer before showing a report card", () => {
    vi.useFakeTimers();
    const onCardReady = vi.fn();
    const onCardVisible = vi.fn();
    const onBuffering = vi.fn();
    const controller = new ReportTransitionController({ bufferDelayMs: 1000, transitionDurationMs: 180 }, onCardReady, onCardVisible, onBuffering);

    expect(controller.schedule({
      segmentId: "report-1",
      markdownStreamCompleted: true,
      reportArtifactId: "assistant-report-markdown:1",
      reportTitle: "风险报告",
    })).toBe(true);
    expect(onBuffering).toHaveBeenCalledWith("report-1");
    expect(onCardReady).not.toHaveBeenCalled();

    vi.advanceTimersByTime(999);
    expect(onCardReady).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onCardReady).toHaveBeenCalledTimes(1);
    expect(onCardReady).toHaveBeenCalledWith("report-1");
    expect(onCardVisible).not.toHaveBeenCalled();

    vi.advanceTimersByTime(180);
    expect(onCardVisible).toHaveBeenCalledTimes(1);
    expect(onCardVisible).toHaveBeenCalledWith("report-1");
    controller.dispose();
  });

  it("does not schedule without artifact metadata and cancels pending transitions", () => {
    vi.useFakeTimers();
    const onCardReady = vi.fn();
    const onCardVisible = vi.fn();
    const controller = new ReportTransitionController({ bufferDelayMs: 1000, requireArtifactReady: true }, onCardReady, onCardVisible);

    expect(controller.schedule({
      segmentId: "report-1",
      markdownStreamCompleted: true,
    })).toBe(false);

    expect(controller.schedule({
      segmentId: "report-1",
      markdownStreamCompleted: true,
      reportArtifactId: "assistant-report-markdown:1",
      reportTitle: "风险报告",
    })).toBe(true);
    expect(controller.cancel("report-1")).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(onCardReady).not.toHaveBeenCalled();
    expect(onCardVisible).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not create duplicate timers for the same report segment", () => {
    vi.useFakeTimers();
    const onCardReady = vi.fn();
    const onCardVisible = vi.fn();
    const controller = new ReportTransitionController({ bufferDelayMs: 1000, transitionDurationMs: 0 }, onCardReady, onCardVisible);
    const snapshot = {
      segmentId: "report-1",
      markdownStreamCompleted: true,
      reportArtifactId: "assistant-report-markdown:1",
      reportTitle: "风险报告",
    };

    controller.schedule(snapshot);
    controller.schedule(snapshot);
    vi.advanceTimersByTime(1000);

    expect(onCardReady).toHaveBeenCalledTimes(1);
    expect(onCardVisible).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("revalidates pending transitions when report artifact metadata changes", () => {
    vi.useFakeTimers();
    const onCardReady = vi.fn();
    const onCardVisible = vi.fn();
    const controller = new ReportTransitionController({ bufferDelayMs: 1000, transitionDurationMs: 0 }, onCardReady, onCardVisible);

    controller.schedule({
      segmentId: "report-1",
      markdownStreamCompleted: true,
      reportArtifactId: "assistant-report-markdown:1",
      reportTitle: "风险报告 v1",
    });
    vi.advanceTimersByTime(800);
    controller.schedule({
      segmentId: "report-1",
      markdownStreamCompleted: true,
      reportArtifactId: "assistant-report-markdown:2",
      reportTitle: "风险报告 v2",
    });
    vi.advanceTimersByTime(999);

    expect(onCardReady).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onCardReady).toHaveBeenCalledTimes(1);
    expect(onCardVisible).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});

describe("resolveReportCardRenderTransition", () => {
  it("renders persisted completed report artifacts as visible cards immediately", () => {
    expect(resolveReportCardRenderTransition({
      segmentId: "report:message-1:tool-1:v1",
      messageStatus: "completed",
      hasCompletedReportRecord: true,
      hasReportArtifact: true,
      hasStreamReportSegment: false,
    })).toEqual({
      segmentId: "report:message-1:tool-1:v1",
      status: "visible",
    });
  });

  it("keeps first streaming report transitions controlled by stored stream state", () => {
    expect(resolveReportCardRenderTransition({
      segmentId: "report:message-1:tool-1:v1",
      messageStatus: "completed",
      hasCompletedReportRecord: true,
      hasReportArtifact: true,
      hasStreamReportSegment: true,
      storedTransition: { segmentId: "report:message-1:tool-1:v1", status: "buffering" },
    })).toEqual({
      segmentId: "report:message-1:tool-1:v1",
      status: "buffering",
    });
  });
});

describe("report markdown segment content", () => {
  it("preserves ordinary text before the report markdown segment", () => {
    const content = [
      "以下是本次分析的简要说明：",
      "",
      "# 风险分析报告",
      "",
      "## 一、分析范围",
      "正文",
    ].join("\n");

    expect(splitReportMarkdownContent(content, "风险分析报告")).toEqual({
      preface: "以下是本次分析的简要说明：",
      reportMarkdown: "# 风险分析报告\n\n## 一、分析范围\n正文",
    });
  });

  it("does not treat ordinary report wording before a heading as the report segment", () => {
    const content = "这句话提到了报告，但只是普通说明。\n\n# 普通 Markdown\n正文";

    expect(splitReportMarkdownContent(content)).toEqual({
      preface: "这句话提到了报告，但只是普通说明。",
      reportMarkdown: "# 普通 Markdown\n正文",
    });
  });

  it("matches the confirmed report block by title instead of ordinary markdown", () => {
    expect(isReportMarkdownContentBlock("# 普通 Markdown\n这段文字提到了报告。", "整体风险分类分布报告 v1")).toBe(false);
    expect(isReportMarkdownContentBlock("# 整体风险分类分布报告 v1\n正文", "整体风险分类分布报告 v1")).toBe(true);
    expect(reportMarkdownContentIndex([
      "# 普通 Markdown\n这段文字提到了报告。",
      "# 整体风险分类分布报告 v1\n正文",
    ], "整体风险分类分布报告 v1")).toBe(1);
  });
});
