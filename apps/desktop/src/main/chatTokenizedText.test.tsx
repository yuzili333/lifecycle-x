import { ChatTokenizedText } from "@astryxdesign/core/Chat";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chatTokensForFieldRefs, copyTextForMessage, mergeFieldRefsWithTextMatches } from "../renderer/src/DataAssistantWorkspace";
import type { ChatCsvSelectedFieldRef } from "./chatCsvTempSource";
import type { ConversationCsvField } from "../renderer/src/chat-field-selector";

describe("ChatTokenizedText context tokens", () => {
  it("copies user field-token text without the composer spacer after tokens", () => {
    const fieldRef: ChatCsvSelectedFieldRef = {
      tokenId: "field_token_branch",
      type: "csv_field",
      tempDataSourceId: "temp-ds-1",
      tempTableId: "temp-table-1",
      fieldId: "field-branch",
      sourceHeader: "一级分行名称",
      physicalName: "branch_name",
      displayName: "一级分行名称",
      logicalType: "category",
      sqliteType: "TEXT",
      rawText: "#一级分行名称",
      start: 3,
      end: 10,
      createdAt: "2026-07-20T00:00:00.000Z",
      status: "valid",
    };

    expect(copyTextForMessage({
      id: "message-1",
      conversationId: "conversation-1",
      userId: "user-1",
      role: "user",
      status: "sent",
      content: "查询 #一级分行名称 的数据",
      blocks: [],
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      integrityHash: "hash",
      context: { selectedFieldRefs: [fieldRef] },
    })).toBe("查询 #一级分行名称的数据");
  });

  it("renders selected file, skill, and data source labels from alphanumeric placeholders with text prefixes", () => {
    const html = renderToString(
      <ChatTokenizedText
        tokens={[
          { value: "assistantfile0", label: "#loan_contracts.csv", variant: "green" },
          { value: "assistantskill1", label: "@整体风险分类分布（笔数+金额）", variant: "purple" },
          { value: "assistantdatasource2", label: "#loan_contracts", variant: "blue" },
        ]}
      >
        {"assistantfile0 assistantskill1 assistantdatasource2 请生成报告"}
      </ChatTokenizedText>,
    );

    expect(html).toContain("#loan_contracts.csv");
    expect(html).toContain("@整体风险分类分布（笔数+金额）");
    expect(html).toContain("#loan_contracts");
    expect(html).toContain("请生成报告");
    expect(html).not.toContain("assistantfile0");
    expect(html).not.toContain("assistantskill1");
    expect(html).not.toContain("assistantdatasource2");
  });

  it("orders overlapping field tokens by longest raw text first", () => {
    const baseField: ChatCsvSelectedFieldRef = {
      tokenId: "field_token",
      type: "csv_field",
      tempDataSourceId: "temp-ds-1",
      tempTableId: "temp-table-1",
      fieldId: "field",
      sourceHeader: "最新风险分类",
      physicalName: "latest_risk",
      displayName: "最新风险分类",
      logicalType: "category",
      sqliteType: "TEXT",
      rawText: "#最新风险分类",
      start: 0,
      end: 7,
      createdAt: "2026-07-20T00:00:00.000Z",
      status: "valid",
    };

    const tokens = chatTokensForFieldRefs([
      baseField,
      {
        ...baseField,
        tokenId: "field_token_result",
        fieldId: "field-result",
        sourceHeader: "最新风险分类结果",
        physicalName: "latest_risk_result",
        displayName: "最新风险分类结果",
        rawText: "#最新风险分类结果",
      },
    ]);

    expect(tokens.map((token) => token.value)).toEqual(["#最新风险分类结果", "#最新风险分类"]);
  });

  it("adds longest text-matched field refs when context only contains a shorter overlapping field", () => {
    const shortField: ChatCsvSelectedFieldRef = {
      tokenId: "field_token",
      type: "csv_field",
      tempDataSourceId: "temp-ds-1",
      tempTableId: "temp-table-1",
      fieldId: "field-risk",
      sourceHeader: "最新风险分类",
      physicalName: "latest_risk",
      displayName: "最新风险分类",
      logicalType: "category",
      sqliteType: "TEXT",
      rawText: "#最新风险分类",
      start: 3,
      end: 10,
      createdAt: "2026-07-20T00:00:00.000Z",
      status: "valid",
    };
    const fields: ConversationCsvField[] = [
      {
        fieldId: "field-risk",
        tempDataSourceId: "temp-ds-1",
        tempTableId: "temp-table-1",
        fileName: "loan.csv",
        ordinalPosition: 1,
        sourceHeader: "最新风险分类",
        physicalName: "latest_risk",
        displayName: "最新风险分类",
        logicalType: "category",
        sqliteType: "TEXT",
        status: "active",
      },
      {
        fieldId: "field-risk-result",
        tempDataSourceId: "temp-ds-1",
        tempTableId: "temp-table-1",
        fileName: "loan.csv",
        ordinalPosition: 2,
        sourceHeader: "最新风险分类结果",
        physicalName: "latest_risk_result",
        displayName: "最新风险分类结果",
        logicalType: "category",
        sqliteType: "TEXT",
        status: "active",
      },
    ];

    const merged = mergeFieldRefsWithTextMatches(
      "统计 #最新风险分类结果 为“0300--次级”的数量",
      [shortField],
      fields,
    );

    expect(chatTokensForFieldRefs(merged).map((token) => token.value)).toEqual(["#最新风险分类结果", "#最新风险分类"]);
  });
});
