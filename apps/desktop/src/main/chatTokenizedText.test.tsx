import { ChatTokenizedText } from "@astryxdesign/core/Chat";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("ChatTokenizedText context tokens", () => {
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
});
