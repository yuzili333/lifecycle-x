export type ReportCardRenderTransition = {
  segmentId: string;
  status: "hidden" | "buffering" | "card_ready" | "visible" | "error";
};

export function resolveReportCardRenderTransition(input: {
  segmentId?: string | null;
  messageStatus: string;
  hasCompletedReportRecord: boolean;
  hasReportArtifact: boolean;
  hasStreamReportSegment: boolean;
  storedTransition?: ReportCardRenderTransition;
}): ReportCardRenderTransition | undefined {
  if (
    input.segmentId &&
    input.messageStatus === "completed" &&
    input.hasCompletedReportRecord &&
    input.hasReportArtifact &&
    !input.hasStreamReportSegment
  ) {
    return { segmentId: input.segmentId, status: "visible" };
  }
  return input.storedTransition;
}
