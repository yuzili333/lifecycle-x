import { describe, expect, it } from "vitest";
import {
  chatFieldMentionKey,
  createChatFieldToken,
  fieldsFromChatCsvAttachment,
  filterConversationCsvFields,
  findChatFieldMention,
  insertFieldTokenText,
  removeFieldTokenText,
  selectConversationCsvFields,
  upsertFieldToken,
} from "../renderer/src/chat-field-selector";
import type { ChatCsvAttachment } from "./chatCsvTempSource";

const attachment: ChatCsvAttachment = {
  attachmentId: "temp-1",
  conversationId: "conversation-1",
  fileName: "风险分类数据.csv",
  fileSizeBytes: 128,
  mimeType: "text/csv",
  status: "ready",
  tempDataSourceId: "temp-ds-1",
  tempTableId: "temp-table-1",
  sqliteTableName: "chat_csv_abc",
  rowCount: 2,
  columnCount: 3,
  createdAt: "2026-07-16T00:00:00.000Z",
  columns: [
    {
      ordinalPosition: 1,
      sourceHeader: "五级分类",
      sqliteColumnName: "五级分类",
      displayName: "五级分类",
      inferredLogicalType: "category",
      sqliteType: "TEXT",
      sampleValues: ["正常", "关注"],
    },
    {
      ordinalPosition: 2,
      sourceHeader: "贷款余额（万元）",
      sqliteColumnName: "贷款余额（万元）",
      displayName: "贷款余额（万元）",
      inferredLogicalType: "decimal",
      sqliteType: "NUMERIC",
      sampleValues: [100.5],
    },
  ],
};

describe("chat field selector mention parsing", () => {
  it("detects field mentions at line start and after whitespace or punctuation", () => {
    expect(findChatFieldMention("#五级")).toEqual({ start: 0, end: 3, query: "五级" });
    expect(findChatFieldMention("分析 #贷款")).toEqual({ start: 3, end: 6, query: "贷款" });
    expect(findChatFieldMention("基于（#客户")).toEqual({ start: 3, end: 6, query: "客户" });
    expect(findChatFieldMention("查询 #短中长期贷款标识")).toEqual({ start: 3, end: 12, query: "短中长期贷款标识" });
  });

  it("does not trigger for markdown headings, url fragments, or code", () => {
    expect(findChatFieldMention("# 标题")).toBeNull();
    expect(findChatFieldMention("https://example.com/a#贷款")).toBeNull();
    expect(findChatFieldMention("`#贷款`")).toBeNull();
    expect(findChatFieldMention("```sql\n#贷款")).toBeNull();
  });

  it("builds a stable suppression key", () => {
    const mention = findChatFieldMention("分析 #");
    expect(mention).not.toBeNull();
    expect(chatFieldMentionKey("分析 #", mention!)).toBe("3:4::分析 #");
  });
});

describe("chat field selector field operations", () => {
  it("builds fields from a ready CSV attachment and searches names and types", () => {
    const fields = fieldsFromChatCsvAttachment(attachment);
    expect(fields).toHaveLength(2);
    expect(filterConversationCsvFields(fields, "贷款")).toHaveLength(1);
    expect(filterConversationCsvFields(fields, "decimal")[0].displayName).toBe("贷款余额（万元）");
  });

  it("orders selected and recent fields before source order with a 200 item cap", () => {
    const fields = Array.from({ length: 205 }, (_, index) => ({
      fieldId: `field-${index}`,
      tempDataSourceId: "temp-1",
      tempTableId: "table-1",
      fileName: "loan.csv",
      ordinalPosition: index,
      sourceHeader: `字段${index}`,
      physicalName: `col_${index}`,
      displayName: `字段${index}`,
      logicalType: "string" as const,
      sqliteType: "TEXT" as const,
      status: "active" as const,
    }));

    const selected = selectConversationCsvFields({
      fields,
      selectedFieldIds: new Set(["field-20"]),
      recentFieldIds: ["field-10"],
    });

    expect(selected).toHaveLength(200);
    expect(selected.slice(0, 3).map((field) => field.fieldId)).toEqual(["field-20", "field-10", "field-0"]);
    expect(selectConversationCsvFields({ fields, query: "字段20" }).map((field) => field.fieldId)).toEqual([
      "field-20",
      "field-200",
      "field-201",
      "field-202",
      "field-203",
      "field-204",
    ]);
  });

  it("inserts, deduplicates, and removes field token text", () => {
    const field = fieldsFromChatCsvAttachment(attachment)[0];
    const mention = findChatFieldMention("分析 #五")!;
    const token = createChatFieldToken(field, mention);
    const nextText = insertFieldTokenText("分析 #五 的分布", mention, token);

    expect(nextText).toBe("分析 #五级分类 的分布");
    expect(insertFieldTokenText("分析 #五", mention, token)).toBe("分析 #五级分类 ");
    expect(upsertFieldToken([], token)).toHaveLength(1);
    expect(upsertFieldToken([token], token)).toHaveLength(1);
    expect(removeFieldTokenText(nextText, token)).toBe("分析 的分布");
  });
});
