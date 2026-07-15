import { StreamSegmentManager } from "./streamSegmentManager";
import type { ChatStreamEvent } from "./types";

export function applyChatStreamEvent(manager: StreamSegmentManager, event: ChatStreamEvent) {
  switch (event.type) {
    case "text_delta":
      return manager.appendTextDelta(event);
    case "markdown_delta":
      return manager.appendMarkdownDelta({ ...event, role: "general" });
    case "report_markdown_delta":
      return manager.appendMarkdownDelta({ ...event, role: "report" });
    case "report_artifact_ready":
      return manager.markReportArtifactReady({
        messageId: event.messageId,
        segmentId: event.segmentId,
        artifactId: event.reportArtifactId,
        title: event.title,
        version: event.version,
      });
    case "message_stream_completed":
      manager.markMessageCompleted(event.messageId);
      return undefined;
    case "stream_error":
      return event.segmentId ? manager.failReportTransition(event.segmentId, event.message) : undefined;
  }
}

