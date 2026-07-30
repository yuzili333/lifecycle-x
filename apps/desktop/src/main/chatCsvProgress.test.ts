import { describe, expect, it } from "vitest";
import type { ChatCsvAttachment } from "./chatCsvTempSource";
import {
  aggregateChatCsvProgress,
  isChatCsvImportActive,
} from "../renderer/src/chat-csv-progress";

function attachment(
  attachmentId: string,
  fileSizeBytes: number,
  progressPercent: number,
  status: ChatCsvAttachment["status"] = "importing",
): ChatCsvAttachment {
  return {
    attachmentId,
    conversationId: "conversation-1",
    fileName: `${attachmentId}.csv`,
    fileSizeBytes,
    mimeType: "text/csv",
    status,
    createdAt: "2026-07-30T00:00:00.000Z",
    progressPhase: status === "ready" || status === "removed" || status === "selected"
      ? undefined
      : status,
    progressPercent,
  };
}

describe("chat CSV aggregate progress", () => {
  it("uses file size weighted progress for concurrent imports", () => {
    expect(
      aggregateChatCsvProgress([
        attachment("small", 100, 100),
        attachment("large", 300, 20),
      ]),
    ).toEqual({
      fileCount: 2,
      fileName: undefined,
      percent: 40,
    });
  });

  it("ignores completed and failed attachments", () => {
    expect(isChatCsvImportActive(attachment("reading", 100, 10, "reading"))).toBe(true);
    expect(isChatCsvImportActive(attachment("ready", 100, 100, "ready"))).toBe(false);
    expect(
      aggregateChatCsvProgress([
        attachment("ready", 100, 100, "ready"),
        attachment("failed", 100, 50, "failed"),
      ]),
    ).toBeNull();
  });
});
