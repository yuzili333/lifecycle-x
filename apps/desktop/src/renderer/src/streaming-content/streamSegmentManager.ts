import type { ChatContentSegment, MarkdownContentSegment, ReportContentSegment, TextContentSegment } from "./types";

type SegmentRecord = ChatContentSegment & {
  appliedSequences: Set<number>;
};

function nowIso() {
  return new Date().toISOString();
}

function baseSegment(input: { messageId: string; segmentId: string; sequence: number }) {
  const createdAt = nowIso();
  return {
    segmentId: input.segmentId,
    messageId: input.messageId,
    sequence: input.sequence,
    createdAt,
    updatedAt: createdAt,
  };
}

export class StreamSegmentManager {
  private readonly segments = new Map<string, SegmentRecord>();

  appendTextDelta(input: { messageId: string; segmentId: string; sequence: number; delta: string }) {
    const segment = this.ensureTextSegment(input);
    if (!this.shouldApplyDelta(segment, input.sequence, input.delta)) {
      return segment;
    }
    segment.content += input.delta;
    segment.sequence = input.sequence;
    segment.updatedAt = nowIso();
    segment.appliedSequences.add(input.sequence);
    return segment;
  }

  appendMarkdownDelta(input: { messageId: string; segmentId: string; sequence: number; delta: string; role: "general" | "report" }) {
    const segment = input.role === "report" ? this.ensureReportSegment(input) : this.ensureMarkdownSegment(input);
    if (!this.shouldApplyDelta(segment, input.sequence, input.delta)) {
      return segment;
    }
    if (segment.type === "report") {
      segment.markdownContent += input.delta;
      if (segment.status !== "card_visible") {
        segment.status = "streaming";
      }
    } else {
      segment.content += input.delta;
    }
    segment.sequence = input.sequence;
    segment.updatedAt = nowIso();
    segment.appliedSequences.add(input.sequence);
    return segment;
  }

  markMessageCompleted(messageId: string) {
    for (const segment of this.segments.values()) {
      if (segment.messageId !== messageId) {
        continue;
      }
      if (segment.type === "report" && segment.status === "streaming") {
        segment.status = "completed";
        segment.streamCompletedAt = nowIso();
      } else if ("status" in segment && segment.status === "streaming") {
        segment.status = "completed";
      }
      segment.updatedAt = nowIso();
    }
  }

  markReportArtifactReady(input: { messageId: string; segmentId: string; artifactId: string; title: string; version: number }) {
    const segment = this.ensureReportSegment({
      messageId: input.messageId,
      segmentId: input.segmentId,
      sequence: this.segments.get(input.segmentId)?.sequence ?? 0,
    });
    segment.reportArtifactId = input.artifactId;
    segment.reportTitle = input.title;
    segment.reportVersion = input.version;
    if (segment.status === "streaming") {
      segment.status = "completed";
      segment.streamCompletedAt = nowIso();
    }
    segment.updatedAt = nowIso();
    return segment;
  }

  startReportBuffer(segmentId: string) {
    const segment = this.reportSegment(segmentId);
    if (!segment || segment.status === "card_visible") {
      return segment;
    }
    segment.status = "buffering";
    segment.bufferStartedAt = nowIso();
    segment.updatedAt = segment.bufferStartedAt;
    return segment;
  }

  markReportCardReady(segmentId: string) {
    const segment = this.reportSegment(segmentId);
    if (!segment || segment.status === "card_visible") {
      return segment;
    }
    segment.status = "card_ready";
    segment.updatedAt = nowIso();
    return segment;
  }

  showReportCard(segmentId: string) {
    const segment = this.reportSegment(segmentId);
    if (!segment || segment.status === "card_visible") {
      return segment;
    }
    segment.status = "card_visible";
    segment.cardVisibleAt = nowIso();
    segment.updatedAt = segment.cardVisibleAt;
    return segment;
  }

  failReportTransition(segmentId: string, reason: string) {
    const segment = this.reportSegment(segmentId);
    if (!segment || segment.status === "card_visible") {
      return segment;
    }
    segment.status = "failed";
    segment.transitionError = reason;
    segment.updatedAt = nowIso();
    return segment;
  }

  getSegment(segmentId: string) {
    return this.clone(this.segments.get(segmentId));
  }

  getMessageSegments(messageId: string) {
    return Array.from(this.segments.values())
      .filter((segment) => segment.messageId === messageId)
      .sort((left, right) => left.sequence - right.sequence)
      .map((segment) => this.clone(segment));
  }

  private ensureTextSegment(input: { messageId: string; segmentId: string; sequence: number }): SegmentRecord & TextContentSegment {
    const existing = this.segments.get(input.segmentId);
    if (existing?.type === "text") {
      return existing as SegmentRecord & TextContentSegment;
    }
    const segment: SegmentRecord & TextContentSegment = {
      ...baseSegment(input),
      type: "text",
      content: "",
      status: "streaming",
      appliedSequences: new Set(),
    };
    this.segments.set(input.segmentId, segment);
    return segment;
  }

  private ensureMarkdownSegment(input: { messageId: string; segmentId: string; sequence: number }): SegmentRecord & MarkdownContentSegment {
    const existing = this.segments.get(input.segmentId);
    if (existing?.type === "markdown") {
      return existing as SegmentRecord & MarkdownContentSegment;
    }
    const segment: SegmentRecord & MarkdownContentSegment = {
      ...baseSegment(input),
      type: "markdown",
      content: "",
      status: "streaming",
      contentRole: "general",
      appliedSequences: new Set(),
    };
    this.segments.set(input.segmentId, segment);
    return segment;
  }

  private ensureReportSegment(input: { messageId: string; segmentId: string; sequence: number }): SegmentRecord & ReportContentSegment {
    const existing = this.segments.get(input.segmentId);
    if (existing?.type === "report") {
      return existing as SegmentRecord & ReportContentSegment;
    }
    const segment: SegmentRecord & ReportContentSegment = {
      ...baseSegment(input),
      type: "report",
      markdownContent: "",
      status: "streaming",
      appliedSequences: new Set(),
    };
    this.segments.set(input.segmentId, segment);
    return segment;
  }

  private shouldApplyDelta(segment: SegmentRecord, sequence: number, delta: string) {
    if (!delta || segment.appliedSequences.has(sequence) || sequence < segment.sequence) {
      return false;
    }
    return true;
  }

  private reportSegment(segmentId: string) {
    const segment = this.segments.get(segmentId);
    return segment?.type === "report" ? segment as SegmentRecord & ReportContentSegment : undefined;
  }

  private clone<T extends ChatContentSegment | undefined>(segment: T): T {
    if (!segment) {
      return undefined as T;
    }
    const { appliedSequences: _appliedSequences, ...publicSegment } = segment as SegmentRecord;
    return publicSegment as T;
  }
}
