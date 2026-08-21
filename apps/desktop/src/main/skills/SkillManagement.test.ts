import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SkillManifest } from "../../shared/skills";
import { LocalSkillManager } from "./LocalSkillManager";
import { asSkillOperationError, SkillError } from "./SkillError";
import { validateSkillDirectory } from "./SkillPackageValidator";
import { SkillStateStore } from "./SkillStateStore";
import { compactSkillResultContract } from "./SkillResultValidator";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function writeSkillPackage(
  root: string,
  input: {
    skillId?: string;
    sourceType?: SkillManifest["sourceType"];
    requiredTools?: string[];
  } = {},
) {
  const skillId = input.skillId ?? "sample-analysis";
  const sourceType = input.sourceType ?? "local_personal";
  mkdirSync(root, { recursive: true });
  const manifest: SkillManifest = {
    skillId,
    name: skillId,
    displayName: "样本分析",
    description: "根据用户要求分析已授权数据。",
    version: "1.0.0",
    category: "analysis",
    tags: ["分析"],
    keywords: ["样本"],
    sourceType,
    runtime: "cycle-probe-client",
    clientOnly: true,
    requiredTools: input.requiredTools ?? [],
    entryFile: "SKILL.md",
    enabled: true,
  };
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(root, "SKILL.md"), `---\nname: ${skillId}\n---\n\n# 样本分析\n\n仅处理用户明确要求的目标。\n`);
  return manifest;
}

describe("Skill package validation", () => {
  it("uses a compact Python contract across built-in report skills", async () => {
    const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../skill");
    const skillIds = [
      "overall-risk-distribution-report",
      "branch-asset-quality-report",
      "key-risk-customer-analysis-report",
      "guarantee-method-risk-distribution-report",
    ];
    const instructions = await Promise.all(skillIds.map((skillId) => readFile(join(skillRoot, skillId, "SKILL.md"), "utf8")));

    for (const content of instructions) {
      expect(content).toContain("## 目标与字段");
      expect(content).toContain("## 统计口径");
      expect(content).toContain("## 工具职责");
      expect(content.indexOf("## 目标与字段")).toBeLessThan(content.indexOf("## 统计口径"));
      expect(content.indexOf("## 统计口径")).toBeLessThan(content.indexOf("## 工具职责"));
      expect(content).toContain("统一的紧凑统计脚本约束");
      expect(content).not.toMatch(/脚本目标不超过\s*[\d,]+\s*个字符/);
      expect(content).toMatch(/Python 禁止(?:生成|输出) Markdown|不输出 Markdown/);
      const pythonInstructions = content.match(/### Python 工具\s+([\s\S]*?)\s+### (?:报告模型|图表工具)/)?.[1] ?? "";
      expect(pythonInstructions.length).toBeGreaterThan(0);
      expect(pythonInstructions.length).toBeLessThan(900);
      expect(pythonInstructions).not.toContain("顶层 `result` 仅包含");
    }
  });

  it("loads the built-in overall risk distribution report without legacy field mappings", async () => {
    const root = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../skill/overall-risk-distribution-report",
    );
    const validated = await validateSkillDirectory({
      root,
      origin: "system",
      traceId: "trace-overall-risk",
    });
    const packageText = await Promise.all([
      "manifest.json",
      "SKILL.md",
      "report-template.md",
      "schemas/skill-input.schema.json",
      "schemas/report-data.schema.json",
      "tool-policy.json",
    ].map((relativePath) => readFile(join(root, relativePath), "utf8")));

    expect(validated.loaded.summary).toMatchObject({
      skillId: "overall-risk-distribution-report",
      displayName: "整体风险分类分布分析报告",
      version: "1.0.9",
      origin: "system",
      enabled: true,
      canToggle: false,
      canDelete: false,
    });
    expect(validated.loaded.requiredTools).toEqual([
      "request_sql_query_execution",
      "request_python_analysis_execution",
      "request_chart_rendering",
      "request_markdown_report_generation",
    ]);
    expect(validated.loaded.reportTemplate).toContain("fiveLevelDistribution");
    expect(validated.loaded.reportTemplate).toContain("nonperformingSummary");
    expect(validated.loaded.instructions).toContain("万元除以 `10,000`");
    expect(validated.loaded.instructions).toContain("Python 禁止生成 Markdown");
    expect(validated.loaded.instructions).toContain("报告模型");
    expect(validated.loaded.instructions).toContain("五级分类笔数饼图");
    const outputSchemaText = JSON.stringify(validated.loaded.outputSchema);
    expect(outputSchemaText).toContain("fiveLevelDistribution");
    expect(outputSchemaText).toContain("nonperformingSummary");
    expect(outputSchemaText).toContain("loanBalanceShare");
    expect(outputSchemaText).not.toMatch(/Display|conclusions|Markdown|Clause|dataQuality/i);
    expect(packageText.join("\n")).not.toMatch(
      /overall-risk-classification-distribution|latest_five_level_risk|latest_risk_result|loan_balance_10k|contract_amount_10k|businessFieldId|十二级分类/,
    );

    const manager = new LocalSkillManager({
      userDataRoot: temporaryDirectory("skill-builtin-catalog-"),
      systemRoot: resolve(root, ".."),
    });
    expect(await manager.list("user-1")).toContainEqual(expect.objectContaining({
      skillId: "overall-risk-distribution-report",
      origin: "system",
      availability: "ready",
      enabled: true,
    }));
  });

  it("loads the built-in branch asset quality report as a read-only system skill", async () => {
    const root = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../skill/branch-asset-quality-report",
    );
    const validated = await validateSkillDirectory({
      root,
      origin: "system",
      traceId: "trace-branch-asset-quality",
    });
    const packageText = await Promise.all([
      "manifest.json",
      "SKILL.md",
      "report-template.md",
      "schemas/skill-input.schema.json",
      "schemas/report-data.schema.json",
      "tool-policy.json",
    ].map((relativePath) => readFile(join(root, relativePath), "utf8")));

    expect(validated.loaded.summary).toMatchObject({
      skillId: "branch-asset-quality-report",
      displayName: "各分行资产质量状况分析报告",
      version: "1.1.3",
      origin: "system",
      enabled: true,
      canToggle: false,
      canDelete: false,
    });
    expect(validated.loaded.requiredTools).toEqual([
      "request_sql_query_execution",
      "request_python_analysis_execution",
      "request_markdown_report_generation",
    ]);
    expect(validated.loaded.requiredTools).not.toContain("request_chart_rendering");
    expect(validated.loaded.instructions).toContain("不良包含源值“不良”、次级、可疑、损失");
    expect(validated.loaded.instructions).toContain("全行平均率使用所有分行全量分子除以全量分母");
    expect(validated.loaded.instructions).toContain("按合同流水号去重");
    expect(validated.loaded.reportTemplate).toContain("branchDistribution");
    expect(validated.loaded.reportTemplate).toContain("金额不良率% | 金额关注率%");
    expect(validated.loaded.instructions).toContain("Python 禁止生成 Markdown");
    expect(validated.loaded.instructions).toContain("报告模型");
    const outputSchemaText = JSON.stringify(validated.loaded.outputSchema);
    expect(outputSchemaText).toContain("branchDistribution");
    expect(outputSchemaText).toContain("nonperformingRate");
    expect(outputSchemaText).toContain("amountSourceUnit");
    expect(outputSchemaText).not.toMatch(/Display|conclusions|Markdown|dataQuality/i);
    expect(packageText.join("\n")).not.toMatch(
      /latest_five_level_risk|loan_balance_10k|businessFieldId|十二级分类/,
    );

    const manager = new LocalSkillManager({
      userDataRoot: temporaryDirectory("skill-branch-catalog-"),
      systemRoot: resolve(root, ".."),
    });
    expect(await manager.list("user-1")).toContainEqual(expect.objectContaining({
      skillId: "branch-asset-quality-report",
      origin: "system",
      availability: "ready",
      enabled: true,
    }));
  });

  it("loads the built-in guarantee method risk distribution report without template example values", async () => {
    const root = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../skill/guarantee-method-risk-distribution-report",
    );
    const validated = await validateSkillDirectory({
      root,
      origin: "system",
      traceId: "trace-guarantee-method-risk",
    });
    const packageText = await Promise.all([
      "manifest.json",
      "SKILL.md",
      "report-template.md",
      "schemas/skill-input.schema.json",
      "schemas/report-data.schema.json",
      "tool-policy.json",
      "analysis-recipe.json",
    ].map((relativePath) => readFile(join(root, relativePath), "utf8")));

    expect(validated.loaded.summary).toMatchObject({
      skillId: "guarantee-method-risk-distribution-report",
      displayName: "担保方式风险分布分析报告",
      version: "1.2.0",
      origin: "system",
      enabled: true,
      canToggle: false,
      canDelete: false,
    });
    expect(validated.loaded.requiredTools).toEqual([
      "request_sql_query_execution",
      "request_python_analysis_execution",
      "request_markdown_report_generation",
    ]);
    expect(validated.loaded.requiredTools).not.toContain("request_chart_rendering");
    expect(validated.loaded.instructions).toContain("主要担保方式名称");
    expect(validated.loaded.instructions).toContain("保证金→质押");
    expect(validated.loaded.instructions).toContain("不良包含源值“不良”、次级、可疑、损失");
    expect(validated.loaded.instructions).toContain("按合同流水号去重");
    expect(validated.loaded.instructions).toContain("本模板只生成统计表和分析结论，不生成图表");
    expect(validated.loaded.instructions).toContain("## 目标与字段");
    expect(validated.loaded.instructions).toContain("## 统计口径");
    expect(validated.loaded.instructions).toContain("## 工具职责");
    expect(validated.loaded.instructions).toContain("### SQL 工具");
    expect(validated.loaded.instructions).toContain("只执行查询脚本并返回查询结果");
    expect(validated.loaded.instructions).toContain("### Python 工具");
    expect(validated.loaded.instructions).toContain("只执行统计脚本并输出计算结果");
    expect(validated.loaded.instructions).toContain("只读统计配方");
    expect(validated.loaded.instructions).toContain("执行模型不得重新编写、扩展或修复整段统计程序");
    expect(validated.loaded.instructions).toContain("专业担保公司保证不良数");
    expect(validated.loaded.analysisRecipe).toMatchObject({
      kind: "grouped-risk-distribution-v1",
      output: { distributionKey: "guaranteeMethodDistribution" },
    });
    expect(validated.loaded.instructions).toContain("不负责字段发现");
    expect(validated.loaded.instructions).toContain("不得退回模型生成完整脚本");
    expect(validated.loaded.instructions).not.toContain("顶层 `result` 仅包含");
    expect(validated.loaded.instructions).not.toContain("`guaranteeMethodDistribution` 只包含");
    expect(validated.loaded.instructions).not.toContain("## 任务与规划");
    expect(validated.loaded.instructions).not.toContain("运行时已核验查询骨架");
    expect(validated.loaded.instructions).not.toContain("当前步骤只调用 SQL 工具一次");
    expect(validated.loaded.instructions).not.toContain("前三条语句必须依次为");
    expect(validated.loaded.instructions).not.toContain("rows = json.load(sys.stdin)");
    expect(validated.loaded.instructions).not.toContain("print(json.dumps(result");
    expect(validated.loaded.instructions).not.toContain("当前步骤只调用 Python 工具一次");
    expect(validated.loaded.instructions).not.toContain("sourceRowCount = len(rows)");
    expect(validated.loaded.instructions).not.toContain("失败立即抛出 `ValueError`");
    expect(validated.loaded.instructions).toContain("### 报告模型");
    expect(validated.loaded.instructions).toContain("Python 禁止生成 Markdown");
    expect(validated.loaded.instructions).toContain("Python 统计结果契约");
    expect(validated.loaded.instructions).not.toContain("## 参数生成契约");
    expect(validated.loaded.instructions).not.toContain("表别名固定为 `T1`");
    expect(validated.loaded.reportTemplate).toContain("guaranteeMethodDistribution");
    expect(validated.loaded.reportTemplate).toContain("| 担保方式 | 正常 | 关注 | 不良 | 合计 | 笔数不良率% | 笔数关注率%");
    expect(validated.loaded.reportTemplate).toContain("金额不良率% | 金额关注率%");
    expect(validated.loaded.reportTemplate).toContain("overall");
    const outputSchemaText = JSON.stringify(validated.loaded.outputSchema);
    expect(outputSchemaText).toContain("guaranteeMethodDistribution");
    expect(outputSchemaText).toContain("categorySetReconciled");
    expect(outputSchemaText).toContain("professionalGuaranteeNonperformingCount");
    expect(outputSchemaText).toContain("sourceRowCount");
    expect(outputSchemaText).not.toMatch(/Display|conclusions|Markdown|dataQuality/i);
    const pythonResultContract = compactSkillResultContract(validated.loaded.outputSchema!);
    expect(pythonResultContract).toContain('"guaranteeMethodDistribution"');
    expect(pythonResultContract).toContain('"professionalGuaranteeNonperformingCount":integer');
    expect(pythonResultContract.length).toBeLessThan(outputSchemaText.length);
    const pythonInstructions = validated.loaded.instructions.match(/### Python 工具\s+([\s\S]*?)\s+### 报告模型/)?.[1] ?? "";
    expect(pythonInstructions.length).toBeGreaterThan(0);
    expect(pythonInstructions.length).toBeLessThan(700);
    expect(validated.loaded.instructions.length).toBeLessThan(3_000);
    expect(outputSchemaText.length).toBeLessThan(6_000);
    expect(packageText.join("\n")).not.toMatch(
      /latest_five_level_risk|loan_balance_10k|businessFieldId|十二级分类|336,080|345,340|925,520/,
    );

    const manager = new LocalSkillManager({
      userDataRoot: temporaryDirectory("skill-guarantee-method-catalog-"),
      systemRoot: resolve(root, ".."),
    });
    expect(await manager.list("user-1")).toContainEqual(expect.objectContaining({
      skillId: "guarantee-method-risk-distribution-report",
      origin: "system",
      availability: "ready",
      enabled: true,
    }));
  });

  it("loads the built-in key risk customer report without fixed field mappings", async () => {
    const root = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../skill/key-risk-customer-analysis-report",
    );
    const validated = await validateSkillDirectory({
      root,
      origin: "system",
      traceId: "trace-key-risk-customer",
    });
    const packageText = await Promise.all([
      "manifest.json",
      "SKILL.md",
      "report-template.md",
      "schemas/skill-input.schema.json",
      "schemas/report-data.schema.json",
      "tool-policy.json",
    ].map((relativePath) => readFile(join(root, relativePath), "utf8")));

    expect(validated.loaded.summary).toMatchObject({
      skillId: "key-risk-customer-analysis-report",
      displayName: "重点风险客户分析报告",
      version: "1.1.2",
      origin: "system",
      enabled: true,
      canToggle: false,
      canDelete: false,
    });
    expect(validated.loaded.requiredTools).toEqual([
      "request_sql_query_execution",
      "request_python_analysis_execution",
      "request_markdown_report_generation",
    ]);
    expect(validated.loaded.requiredTools).not.toContain("request_chart_rendering");
    expect(validated.loaded.instructions).toContain("重点风险客户是最新风险分类为关注或不良");
    expect(validated.loaded.instructions).toContain("不能先筛选关注或不良");
    expect(validated.loaded.instructions).toContain("按合同流水号去重");
    expect(validated.loaded.instructions).toContain("同一客户存在多笔合同时不合并为一个客户");
    expect(validated.loaded.instructions).toContain("10,000万 = 1亿");
    expect(validated.loaded.instructions).toContain("“省份”对应真实字段“客户所属省/市”");
    expect(validated.loaded.instructions).toContain("“行业”对应真实字段“国标行业投向名称”");
    expect(validated.loaded.instructions).toContain("不得根据分行、客户名称或地址推断省份");
    expect(validated.loaded.instructions).toContain("禁止 Top N 截断");
    expect(validated.loaded.instructions).toContain("不良合同表行数必须与计算结果中的不良笔数一致");
    expect(validated.loaded.instructions).toContain("Python 禁止生成 Markdown");
    expect(validated.loaded.reportTemplate).toContain("riskCustomers");
    expect(validated.loaded.reportTemplate).toContain("industryDistribution");
    const outputSchemaText = JSON.stringify(validated.loaded.outputSchema);
    expect(outputSchemaText).toContain("nonNormalCountShare");
    expect(outputSchemaText).toContain("loanBalanceShare");
    expect(outputSchemaText).toContain("deteriorationCount");
    expect(outputSchemaText).toContain("provinceDistribution");
    expect(outputSchemaText).toContain("sequenceContinuous");
    expect(outputSchemaText).not.toMatch(/Display|conclusions|Markdown|SummaryText|dataQuality/i);
    expect(packageText.join("\n")).not.toMatch(
      /福建墨砾|大连财神岛|山西全球蛙|latest_five_level_risk|latest_risk_result|loan_balance_10k|contract_amount_10k|businessFieldId|十二级分类/,
    );

    const manager = new LocalSkillManager({
      userDataRoot: temporaryDirectory("skill-key-risk-customer-catalog-"),
      systemRoot: resolve(root, ".."),
    });
    expect(await manager.list("user-1")).toContainEqual(expect.objectContaining({
      skillId: "key-risk-customer-analysis-report",
      origin: "system",
      availability: "ready",
      enabled: true,
    }));
  });

  it("does not expose local paths through generic IPC errors", () => {
    const result = asSkillOperationError(
      new Error("ENOENT: /Users/example/private/package.zip"),
      "install",
      "trace-redacted",
    );

    expect(result.message).not.toContain("/Users/example");
    expect(result.traceId).toBe("trace-redacted");
  });

  it("loads a valid personal package and returns a stable content hash", async () => {
    const root = temporaryDirectory("skill-valid-");
    writeSkillPackage(root);

    const validated = await validateSkillDirectory({
      root,
      origin: "personal",
      traceId: "trace-valid",
    });

    expect(validated.loaded.summary).toMatchObject({
      skillId: "sample-analysis",
      origin: "personal",
      enabled: true,
      canToggle: true,
      canDelete: true,
    });
    expect(validated.loaded.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unknown tools and symbolic links", async () => {
    const unknownToolRoot = temporaryDirectory("skill-unknown-tool-");
    writeSkillPackage(unknownToolRoot, { requiredTools: ["unknown_tool"] });
    await expect(validateSkillDirectory({
      root: unknownToolRoot,
      origin: "personal",
      traceId: "trace-tool",
    })).rejects.toMatchObject({
      detail: { code: "SKILL_MANIFEST_INVALID" },
    });

    const symlinkRoot = temporaryDirectory("skill-symlink-");
    writeSkillPackage(symlinkRoot);
    symlinkSync(join(symlinkRoot, "SKILL.md"), join(symlinkRoot, "linked.md"));
    await expect(validateSkillDirectory({
      root: symlinkRoot,
      origin: "personal",
      traceId: "trace-link",
    })).rejects.toMatchObject({
      detail: { code: "SKILL_PACKAGE_UNSAFE" },
    });
  });

  it("rejects tool policies that attempt to bypass approval", async () => {
    const root = temporaryDirectory("skill-unsafe-policy-");
    const manifest = writeSkillPackage(root);
    writeFileSync(join(root, "manifest.json"), `${JSON.stringify({
      ...manifest,
      toolPolicyFile: "tool-policy.json",
    }, null, 2)}\n`);
    writeFileSync(join(root, "tool-policy.json"), JSON.stringify({
      approvalRequired: false,
    }));

    await expect(validateSkillDirectory({
      root,
      origin: "personal",
      traceId: "trace-policy",
    })).rejects.toMatchObject({
      detail: { code: "SKILL_SCHEMA_INVALID" },
    });
  });

  it("returns a structured unsafe-package error for a damaged ZIP", async () => {
    const root = temporaryDirectory("skill-damaged-");
    const archivePath = join(root, "damaged.zip");
    writeFileSync(archivePath, "not-a-zip");
    const manager = new LocalSkillManager({
      userDataRoot: join(root, "user-data"),
      systemRoot: join(root, "system"),
    });

    await expect(manager.install("user-a", archivePath)).rejects.toMatchObject({
      detail: { code: "SKILL_PACKAGE_UNSAFE" },
    });
  });
});

describe("Skill state and local manager", () => {
  it("serializes concurrent user state updates without dropping either user", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-state-"));
    temporaryDirectories.push(root);
    const statePath = join(root, "skill-state.json");
    const store = new SkillStateStore(statePath);
    await Promise.all([
      store.set("user-a", "skill-a", {
        enabled: true,
        version: "1.0.0",
        contentHash: "a",
        installedAt: "2026-07-24T00:00:00.000Z",
      }),
      store.set("user-b", "skill-b", {
        enabled: false,
        version: "2.0.0",
        contentHash: "b",
        installedAt: "2026-07-24T00:00:00.000Z",
      }),
    ]);

    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    expect(Object.keys(persisted.users).sort()).toEqual(["user-a", "user-b"]);
  });

  it("installs, isolates, toggles and removes a personal ZIP package", async () => {
    const root = temporaryDirectory("skill-manager-");
    const packageRoot = join(root, "package");
    const archivePath = join(root, "sample-analysis.zip");
    writeSkillPackage(packageRoot);
    execFileSync("zip", ["-q", "-r", archivePath, "manifest.json", "SKILL.md"], {
      cwd: packageRoot,
    });
    const manager = new LocalSkillManager({
      userDataRoot: join(root, "user-data"),
      systemRoot: join(root, "system"),
    });

    const installed = await manager.install("user-a", archivePath);
    expect(installed).toMatchObject({
      status: "installed",
      skill: { skillId: "sample-analysis", enabled: true, origin: "personal" },
    });
    expect(await manager.list("user-b")).toEqual([]);
    await expect(manager.load("user-a", "sample-analysis")).resolves.toMatchObject({
      summary: { skillId: "sample-analysis" },
    });

    await manager.setEnabled("user-a", "sample-analysis", false);
    await expect(manager.load("user-a", "sample-analysis")).rejects.toBeInstanceOf(SkillError);
    await manager.remove("user-a", "sample-analysis");
    expect(await manager.list("user-a")).toEqual([]);
  });

  it("marks modified personal Skills invalid and still allows deletion", async () => {
    const root = temporaryDirectory("skill-integrity-");
    const packageRoot = join(root, "package");
    const archivePath = join(root, "sample-analysis.zip");
    writeSkillPackage(packageRoot);
    execFileSync("zip", ["-q", "-r", archivePath, "manifest.json", "SKILL.md"], {
      cwd: packageRoot,
    });
    const userDataRoot = join(root, "user-data");
    const manager = new LocalSkillManager({
      userDataRoot,
      systemRoot: join(root, "system"),
    });

    await manager.install("user-a", archivePath);
    const personalRoot = join(userDataRoot, "skills", "personal");
    const [userKey] = await import("node:fs/promises").then(({ readdir }) => readdir(personalRoot));
    writeFileSync(
      join(personalRoot, userKey, "sample-analysis", "SKILL.md"),
      "# 已被修改\n",
    );

    await expect(manager.list("user-a")).resolves.toMatchObject([
      {
        skillId: "sample-analysis",
        availability: "invalid",
        enabled: false,
        canToggle: false,
        canDelete: true,
      },
    ]);
    await expect(manager.load("user-a", "sample-analysis")).rejects.toMatchObject({
      detail: { code: "SKILL_LOAD_FAILED" },
    });
    await expect(manager.remove("user-a", "sample-analysis")).resolves.toEqual({
      success: true,
      skillId: "sample-analysis",
    });
  });

  it("keeps system Skills read-only and always enabled", async () => {
    const root = temporaryDirectory("skill-system-");
    writeSkillPackage(join(root, "system", "system-analysis"), {
      skillId: "system-analysis",
      sourceType: "local_builtin",
    });
    const manager = new LocalSkillManager({
      userDataRoot: join(root, "user-data"),
      systemRoot: join(root, "system"),
    });

    await expect(manager.list("user-a")).resolves.toMatchObject([
      {
        skillId: "system-analysis",
        origin: "system",
        enabled: true,
        canToggle: false,
        canDelete: false,
      },
    ]);
    await expect(manager.setEnabled("user-a", "system-analysis", false)).rejects.toMatchObject({
      detail: { code: "SKILL_ID_RESERVED" },
    });
    await expect(manager.remove("user-a", "../system-analysis")).rejects.toMatchObject({
      detail: { code: "SKILL_OPERATION_FAILED" },
    });
  });

  it("ignores deleted system Skill directories that no longer contain a manifest", async () => {
    const root = temporaryDirectory("skill-system-empty-");
    mkdirSync(join(root, "system", "retired-skill", "schemas"), { recursive: true });
    const manager = new LocalSkillManager({
      userDataRoot: join(root, "user-data"),
      systemRoot: join(root, "system"),
    });

    await expect(manager.list("user-a")).resolves.toEqual([]);
  });
});
