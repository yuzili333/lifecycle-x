import type { ChatCsvAttachment } from "../../main/chatCsvTempSource";

export type ChatCsvAggregateProgress = {
  fileCount: number;
  fileName?: string;
  percent: number;
};

export function isChatCsvImportActive(attachment: ChatCsvAttachment) {
  return (
    attachment.status === "selected" ||
    attachment.status === "reading" ||
    attachment.status === "validating" ||
    attachment.status === "parsing" ||
    attachment.status === "importing"
  );
}

export function aggregateChatCsvProgress(
  attachments: ChatCsvAttachment[],
): ChatCsvAggregateProgress | null {
  const active = attachments.filter(isChatCsvImportActive);
  if (active.length === 0) {
    return null;
  }
  const totalWeight = active.reduce(
    (total, attachment) => total + Math.max(1, attachment.fileSizeBytes),
    0,
  );
  const weightedProgress = active.reduce(
    (total, attachment) =>
      total +
      Math.max(1, attachment.fileSizeBytes) *
        Math.min(100, Math.max(0, attachment.progressPercent ?? 0)),
    0,
  );
  return {
    fileCount: active.length,
    fileName: active.length === 1 ? active[0]?.fileName : undefined,
    percent: Math.round(weightedProgress / totalWeight),
  };
}
