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
      version: "1.0.7",
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
    expect(validated.loaded.reportTemplate).toContain("`{{loan_balance_field_name}}`");
    expect(validated.loaded.reportTemplate).toContain("{{loan_balance_display}}{{contract_amount_clause}}");
    expect(validated.loaded.instructions).toContain("10,000万元 = 1亿元");
    expect(validated.loaded.instructions).toContain("固定保留小数点后三位");
    expect(validated.loaded.instructions).toContain("换算结果前不添加“约”");
    expect(validated.loaded.instructions).toContain("`合同金额`合计 {{contract_amount_display}}");
    expect(validated.loaded.instructions).toContain("`riskResultDistribution[].loanBalanceDisplay`");
    expect(validated.loaded.instructions).toContain("`chartType` 使用 `pie`");
    expect(validated.loaded.instructions).toContain("每个扇面必须可见展示该分类笔数与占总笔数比例");
    expect(validated.loaded.instructions).toContain("Y 轴标题统一使用“贷款余额（万元）”");
    expect(validated.loaded.instructions).toContain("字段名称中的中英文括号和单位必须完整包含在字符串引号内");
    expect(validated.loaded.instructions).toContain("金额占比应先执行 `Decimal / Decimal`");
    expect(JSON.stringify(validated.loaded.outputSchema)).toContain("loanBalanceInYi");
    expect(JSON.stringify(validated.loaded.outputSchema)).toContain("contractAmountInYi");
    expect(JSON.stringify(validated.loaded.outputSchema)).toContain("loanBalanceDisplay");
    expect(JSON.stringify(validated.loaded.outputSchema)).toContain("contractAmountDisplay");
    expect(JSON.stringify(validated.loaded.outputSchema)).toContain("contractAmountClause");
    expect(JSON.stringify(validated.loaded.outputSchema)).toContain("固定三位小数的亿元值");
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
      version: "1.1.1",
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
    expect(validated.loaded.instructions).toContain("不良：源值“不良”，或次级、可疑、损失合计");
    expect(validated.loaded.instructions).toContain("全行平均率必须使用全量分子除以全量分母计算");
    expect(validated.loaded.instructions).toContain("按合同流水号去重");
    expect(validated.loaded.reportTemplate).toContain("{{branch_distribution_rows}}");
    expect(validated.loaded.reportTemplate).toContain("{{numbered_conclusions}}");
    expect(validated.loaded.reportTemplate).toContain("正常({{amount_unit_label}})");
    expect(validated.loaded.reportTemplate).toContain("合计({{amount_unit_label}}) | 不良率% | 关注率%");
    expect(validated.loaded.reportTemplate).not.toContain("{{amount_business_name}}");
    expect(validated.loaded.reportTemplate).not.toContain("正常(`{{loan_balance_business_name}}`");
    expect(validated.loaded.instructions).toContain("默认金额指标为贷款余额，报告展示单位为 `万`");
    expect(validated.loaded.instructions).toContain("第 12、13 列分别渲染金额不良率和金额关注率");
    expect(validated.loaded.instructions).toContain("所有对账完成前禁止转换为 `float`");
    expect(validated.loaded.instructions).toContain("禁止使用 `sum(branch[\"totalBalance\"])`");
    expect(validated.loaded.instructions).toContain("禁止读取 `branchDistribution[0]`");
    expect(JSON.stringify(validated.loaded.outputSchema)).toContain("nonperformingBalanceRate");
    expect(JSON.stringify(validated.loaded.outputSchema)).toContain("attentionBalanceRate");
    expect(JSON.stringify(validated.loaded.outputSchema)).toContain("normalBalanceDisplay");
    expect(JSON.stringify(validated.loaded.outputSchema)).toContain("amountDisplayUnit");
    expect(JSON.stringify(validated.loaded.outputSchema)).toContain("nonperformingCountRateDisplay");
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
