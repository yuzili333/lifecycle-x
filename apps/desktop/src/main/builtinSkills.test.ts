import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { BuiltinSkillRegistry, getBuiltinSkillRoot, parseSkillFrontmatter } from "./builtinSkills";

const skillRoot = resolve(process.cwd(), "../../skill");

describe("BuiltinSkillRegistry", () => {
  it("resolves the development builtin skill root without hardcoded absolute paths", () => {
    expect(getBuiltinSkillRoot(skillRoot)).toBe(skillRoot);
  });

  it("scans and loads the overall risk classification skill package", async () => {
    const registry = new BuiltinSkillRegistry(skillRoot);
    const skills = await registry.scan();
    const skill = skills.find((item) => item.skillId === "overall-risk-classification-distribution");

    expect(skill).toMatchObject({
      displayName: "整体风险分类分布（笔数+金额）",
      sourceType: "local_builtin",
      clientOnly: true,
      enabled: true,
    });
    expect(skill?.requiredTools).toEqual([
      "request_sql_query_execution",
      "request_python_analysis_execution",
      "request_chart_rendering",
      "request_markdown_report_generation",
    ]);

    const loaded = await registry.load("overall-risk-classification-distribution");
    expect(loaded.instructions).toContain("不得使用报告模板中的示例数字");
    expect(loaded.reportTemplate).toContain("{{fiveLevelRows}}");
    expect(loaded.inputSchema).toMatchObject({ title: "OverallRiskClassificationSkillInput" });
    expect(loaded.outputSchema).toMatchObject({ title: "OverallRiskClassificationReportData" });
    expect(loaded.toolPolicy).toMatchObject({ skillId: "overall-risk-classification-distribution" });
  });

  it("searches aliases and keywords for @ quick selection", async () => {
    const registry = new BuiltinSkillRegistry(skillRoot);

    await expect(registry.search({ query: "@整体风险分类分布" })).resolves.toMatchObject([
      {
        skill: {
          skillId: "overall-risk-classification-distribution",
        },
      },
    ]);
    await expect(registry.search({ query: "资产质量分析" })).resolves.toMatchObject([
      {
        skill: {
          skillId: "overall-risk-classification-distribution",
        },
      },
    ]);
  });

  it("rejects path traversal while loading skill files", async () => {
    const registry = new BuiltinSkillRegistry(skillRoot);
    await expect(registry.load("../reports")).rejects.toThrow("Invalid skill id.");
  });

  it("parses required SKILL.md frontmatter", async () => {
    const registry = new BuiltinSkillRegistry(skillRoot);
    const loaded = await registry.load("overall-risk-classification-distribution");
    expect(parseSkillFrontmatter(loaded.instructions)).toMatchObject({
      name: "overall-risk-classification-distribution",
    });
  });

  it("reports builtin installation status without affecting other skills", async () => {
    const registry = new BuiltinSkillRegistry(skillRoot);
    await expect(registry.installBuiltinSkills()).resolves.toMatchObject({
      installed: ["overall-risk-classification-distribution"],
      failed: [],
    });
  });
});
