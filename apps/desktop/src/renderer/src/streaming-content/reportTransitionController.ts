import { DEFAULT_REPORT_TRANSITION_POLICY, type ReportTransitionPolicy } from "./types";

export type ReportTransitionSnapshot = {
  segmentId: string;
  markdownStreamCompleted: boolean;
  reportArtifactId?: string;
  reportTitle?: string;
  isCardVisible?: boolean;
};

export class ReportTransitionController {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly visibleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly transitionKeys = new Map<string, string>();
  readonly policy: ReportTransitionPolicy;

  constructor(
    policy: Partial<ReportTransitionPolicy> = {},
    private readonly onCardReady: (segmentId: string) => void,
    private readonly onCardVisible: (segmentId: string) => void = onCardReady,
    private readonly onBuffering?: (segmentId: string) => void,
  ) {
    this.policy = { ...DEFAULT_REPORT_TRANSITION_POLICY, ...policy };
  }

  schedule(snapshot: ReportTransitionSnapshot) {
    if (!snapshot.markdownStreamCompleted || snapshot.isCardVisible) {
      return false;
    }
    if (this.policy.requireArtifactReady && (!snapshot.reportArtifactId || !snapshot.reportTitle)) {
      return false;
    }
    const transitionKey = this.transitionKey(snapshot);
    if (this.timers.has(snapshot.segmentId)) {
      if (this.transitionKeys.get(snapshot.segmentId) === transitionKey) {
        return true;
      }
      this.cancel(snapshot.segmentId);
    }
    if (this.visibleTimers.has(snapshot.segmentId)) {
      if (this.transitionKeys.get(snapshot.segmentId) === transitionKey) {
        return true;
      }
      this.cancel(snapshot.segmentId);
    }
    this.onBuffering?.(snapshot.segmentId);
    this.transitionKeys.set(snapshot.segmentId, transitionKey);
    const timer = setTimeout(() => {
      this.timers.delete(snapshot.segmentId);
      this.onCardReady(snapshot.segmentId);
      if (this.policy.transitionDurationMs > 0) {
        const visibleTimer = setTimeout(() => {
          this.visibleTimers.delete(snapshot.segmentId);
          this.onCardVisible(snapshot.segmentId);
        }, this.policy.transitionDurationMs);
        this.visibleTimers.set(snapshot.segmentId, visibleTimer);
        return;
      }
      this.onCardVisible(snapshot.segmentId);
    }, this.policy.bufferDelayMs);
    this.timers.set(snapshot.segmentId, timer);
    return true;
  }

  cancel(segmentId: string) {
    const timer = this.timers.get(segmentId);
    const visibleTimer = this.visibleTimers.get(segmentId);
    if (!timer && !visibleTimer) {
      return false;
    }
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(segmentId);
    }
    if (visibleTimer) {
      clearTimeout(visibleTimer);
      this.visibleTimers.delete(segmentId);
    }
    this.transitionKeys.delete(segmentId);
    return true;
  }

  dispose() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const timer of this.visibleTimers.values()) {
      clearTimeout(timer);
    }
    this.visibleTimers.clear();
    this.transitionKeys.clear();
  }

  private transitionKey(snapshot: ReportTransitionSnapshot) {
    return [
      snapshot.markdownStreamCompleted ? "completed" : "streaming",
      snapshot.reportArtifactId ?? "",
      snapshot.reportTitle ?? "",
    ].join("\u0000");
  }
}
