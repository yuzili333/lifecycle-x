import { describe, expect, it } from "vitest";
import { createEmptyChatComposerDraft, removeChatComposerDraft } from "../renderer/src/chat-composer-draft";

describe("chat composer draft state", () => {
  it("creates an empty per-conversation composer draft", () => {
    expect(createEmptyChatComposerDraft("2026-07-16T00:00:00.000Z")).toEqual({
      value: "",
      selectedSkill: null,
      selectedDataSourceId: null,
      disabledTempDataSourceIds: [],
      selectedFieldRefs: [],
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
  });

  it("removes only the deleted conversation draft", () => {
    const drafts = {
      "conversation-1": createEmptyChatComposerDraft("2026-07-16T00:00:00.000Z"),
      "conversation-2": {
        ...createEmptyChatComposerDraft("2026-07-16T00:00:01.000Z"),
        value: "分析 #贷款余额",
      },
    };

    expect(removeChatComposerDraft(drafts, "conversation-1")).toEqual({
      "conversation-2": drafts["conversation-2"],
    });
    expect(removeChatComposerDraft(drafts, "conversation-missing")).toBe(drafts);
  });
});
