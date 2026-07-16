import { describe, expect, it } from "vitest";
import {
  buildChatToolSelectorSections,
  chatToolMentionKey,
  findChatToolMention,
  isSuppressedChatToolMention,
  removeChatToolMention,
  type ChatToolDataSourceOption,
  type ChatToolSkillOption,
} from "../renderer/src/chat-tool-selector";

const skills: Array<ChatToolSkillOption<"overall-risk-classification-distribution">> = [
  { label: "整体风险分类分布（笔数+金额）", value: "overall-risk-classification-distribution" },
];

const dataSources: ChatToolDataSourceOption[] = [
  {
    id: "db-1",
    label: "loan_contracts / risk_warehouse",
    description: "risk_warehouse",
    kind: "database",
  },
  {
    id: "csv-1",
    label: "loan_contracts_header_dictionary_standardized",
    description: "CSV",
    kind: "csv",
  },
  {
    id: "temp-1",
    label: "loan_contracts_500.csv",
    description: "当前会话临时 CSV",
    kind: "temporary_csv",
  },
];

describe("chat tool selector mention parsing", () => {
  it("opens from a standalone at sign and captures the keyword at the end of composer text", () => {
    expect(findChatToolMention("请分析 @整体")).toEqual({ start: 4, end: 7, query: "整体" });
    expect(findChatToolMention("@")).toEqual({ start: 0, end: 1, query: "" });
  });

  it("does not treat email text or markdown code as tool mentions", () => {
    expect(findChatToolMention("a@example.com")).toBeNull();
    expect(findChatToolMention("`@整体`")).toBeNull();
    expect(findChatToolMention("```sql\n@整体")).toBeNull();
  });

  it("removes the active mention without disturbing the surrounding prompt", () => {
    expect(removeChatToolMention("请分析 @整体", { start: 4, end: 7, query: "整体" })).toBe("请分析");
    expect(removeChatToolMention("@整体 请分析", { start: 0, end: 3, query: "整体" })).toBe("请分析");
  });

  it("builds a stable suppression key for a dismissed mention", () => {
    const mention = findChatToolMention("请分析 @");
    expect(mention).not.toBeNull();
    expect(chatToolMentionKey("请分析 @", mention!)).toBe("4:5::请分析 @");
  });

  it("keeps a blurred at sign as plain text without blocking a later mention", () => {
    const value = "请分析 @";
    const mention = findChatToolMention(value);
    expect(mention).not.toBeNull();

    expect(
      isSuppressedChatToolMention({
        value,
        mention: mention!,
        suppressedAnchor: mention!.start,
        suppressedKey: chatToolMentionKey(value, mention!),
      }),
    ).toBe(true);

    const continuedValue = "请分析 @整体";
    const continuedMention = findChatToolMention(continuedValue);
    expect(continuedMention).not.toBeNull();
    expect(
      isSuppressedChatToolMention({
        value: continuedValue,
        mention: continuedMention!,
        suppressedAnchor: mention!.start,
        suppressedKey: chatToolMentionKey(value, mention!),
      }),
    ).toBe(true);

    const laterValue = "请分析 @ 再选择 @整体";
    const laterMention = findChatToolMention(laterValue);
    expect(laterMention).not.toBeNull();
    expect(
      isSuppressedChatToolMention({
        value: laterValue,
        mention: laterMention!,
        suppressedAnchor: mention!.start,
        suppressedKey: chatToolMentionKey(value, mention!),
      }),
    ).toBe(false);
  });
});

describe("chat tool selector sections", () => {
  it("builds add, skill, and data source sections in the expected order", () => {
    expect(buildChatToolSelectorSections({ skills, dataSources }).map((section) => section.id)).toEqual([
      "add",
      "skill",
      "data_source",
    ]);
  });

  it("searches skills and data sources while preferring skill section ordering", () => {
    const sections = buildChatToolSelectorSections({ query: "整体", skills, dataSources });
    expect(sections.map((section) => section.id)).toEqual(["skill"]);
    expect(sections[0].items[0]).toMatchObject({ type: "skill", value: "overall-risk-classification-distribution" });

    const dataSourceSections = buildChatToolSelectorSections({ query: "loan_contracts", skills, dataSources });
    expect(dataSourceSections.map((section) => section.id)).toEqual(["data_source"]);
    expect(dataSourceSections[0].items).toHaveLength(3);
  });

  it("marks selected skills and data sources", () => {
    const sections = buildChatToolSelectorSections({
      skills,
      dataSources: [{ ...dataSources[0], isSelected: true }],
      selectedSkill: "overall-risk-classification-distribution",
    });

    expect(sections.find((section) => section.id === "skill")?.items[0]).toMatchObject({ isSelected: true });
    expect(sections.find((section) => section.id === "data_source")?.items[0]).toMatchObject({ isSelected: true });
  });
});
