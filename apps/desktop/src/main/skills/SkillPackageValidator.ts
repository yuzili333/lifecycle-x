import { createHash } from "node:crypto";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { LoadedSkill, SkillManifest, SkillOrigin, SkillSummary } from "../../shared/skills";
import { TOOL_NAMES } from "../toolOrchestration";
import { skillError } from "./SkillError";

const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ALLOWED_EXTENSIONS = new Set([".md", ".json", ".yaml", ".yml", ".txt"]);
const MAX_EXTRACTED_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 50;
const KNOWN_TOOL_NAMES = new Set(Object.values(TOOL_NAMES));

export type ValidatedSkillPackage = {
  root: string;
  manifest: SkillManifest;
  loaded: LoadedSkill;
  fileCount: number;
  totalBytes: number;
};

export async function validateSkillDirectory(input: {
  root: string;
  origin: SkillOrigin;
  traceId: string;
}): Promise<ValidatedSkillPackage> {
  const root = resolve(input.root);
  const files = await listSafeFiles(root, input.traceId);
  const manifestPath = resolve(root, "manifest.json");
  if (!files.some((file) => file.path === manifestPath)) {
    throw skillError({
      code: "SKILL_PACKAGE_INCOMPLETE",
      message: "Skill 安装包缺少 manifest.json。",
      operation: "install",
      traceId: input.traceId,
    });
  }

  const manifest = validateManifest(
    await readJson(manifestPath, "SKILL_MANIFEST_INVALID", input.traceId),
    input.origin,
    input.traceId,
  );
  const referencedFiles = [
    manifest.entryFile,
    manifest.templateFile,
    manifest.inputSchemaFile,
    manifest.reportDataSchemaFile,
    manifest.toolPolicyFile,
    manifest.analysisRecipeFile,
  ].filter((value): value is string => Boolean(value));
  for (const referencedFile of referencedFiles) {
    const referencedPath = safeReferencedPath(root, referencedFile, input.traceId);
    if (!files.some((file) => file.path === referencedPath)) {
      throw skillError({
        code: "SKILL_PACKAGE_INCOMPLETE",
        message: `Skill 安装包缺少声明文件：${referencedFile}`,
        operation: "install",
        traceId: input.traceId,
        skillId: manifest.skillId,
      });
    }
  }

  const instructions = await readFile(safeReferencedPath(root, manifest.entryFile, input.traceId), "utf8");
  const frontmatter = parseSkillFrontmatter(instructions);
  if (frontmatter.name !== undefined && frontmatter.name !== manifest.skillId) {
    throw skillError({
      code: "SKILL_MANIFEST_INVALID",
      message: "SKILL.md frontmatter name 必须与 skillId 一致。",
      operation: "install",
      traceId: input.traceId,
      skillId: manifest.skillId,
    });
  }

  const inputSchema = manifest.inputSchemaFile
    ? validateSchema(await readJson(safeReferencedPath(root, manifest.inputSchemaFile, input.traceId), "SKILL_SCHEMA_INVALID", input.traceId), manifest.skillId, input.traceId)
    : undefined;
  const outputSchema = manifest.reportDataSchemaFile
    ? validateSchema(await readJson(safeReferencedPath(root, manifest.reportDataSchemaFile, input.traceId), "SKILL_SCHEMA_INVALID", input.traceId), manifest.skillId, input.traceId)
    : undefined;
  const toolPolicy = manifest.toolPolicyFile
    ? asRecord(await readJson(safeReferencedPath(root, manifest.toolPolicyFile, input.traceId), "SKILL_SCHEMA_INVALID", input.traceId), "工具策略", manifest.skillId, input.traceId)
    : undefined;
  validateToolPolicy(toolPolicy, manifest, input.traceId);
  const analysisRecipe = manifest.analysisRecipeFile
    ? validateAnalysisRecipe(
        await readJson(safeReferencedPath(root, manifest.analysisRecipeFile, input.traceId), "SKILL_SCHEMA_INVALID", input.traceId),
        manifest.skillId,
        input.traceId,
      )
    : undefined;
  const reportTemplate = manifest.templateFile
    ? await readFile(safeReferencedPath(root, manifest.templateFile, input.traceId), "utf8")
    : undefined;
  const contentHash = await hashFiles(files);
  const summary = toSkillSummary(manifest, input.origin, true);

  return {
    root,
    manifest,
    loaded: {
      summary,
      requiredTools: [...manifest.requiredTools],
      instructions,
      reportTemplate,
      inputSchema,
      outputSchema,
      toolPolicy,
      analysisRecipe,
      contentHash,
      loadedAt: new Date().toISOString(),
    },
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}

export function toSkillSummary(
  manifest: SkillManifest,
  origin: SkillOrigin,
  enabled: boolean,
): SkillSummary {
  return {
    skillId: manifest.skillId,
    displayName: manifest.displayName,
    description: manifest.description,
    version: manifest.version,
    category: manifest.category,
    origin,
    enabled: origin === "system" ? true : enabled,
    availability: "ready",
    tags: manifest.tags,
    keywords: manifest.keywords,
    aliases: manifest.aliases ?? [],
    canToggle: origin === "personal",
    canDelete: origin === "personal",
  };
}

export function parseSkillFrontmatter(markdown: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {} as Record<string, string>;
  return Object.fromEntries(match[1].split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return [];
    return [[line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, "")]];
  }));
}

async function listSafeFiles(root: string, traceId: string) {
  const result: Array<{ path: string; relativePath: string; size: number }> = [];
  const queue = [root];
  let totalBytes = 0;
  while (queue.length > 0) {
    const directory = queue.shift() as string;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      assertInsideRoot(root, path, traceId);
      const details = await lstat(path);
      if (details.isSymbolicLink()) {
        throw unsafe("Skill 安装包禁止包含符号链接。", traceId);
      }
      if (details.isDirectory()) {
        queue.push(path);
        continue;
      }
      if (!details.isFile() || !ALLOWED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        throw unsafe(`Skill 安装包包含不支持的文件：${entry.name}`, traceId);
      }
      result.push({ path, relativePath: relative(root, path), size: details.size });
      totalBytes += details.size;
      if (result.length > MAX_FILES || totalBytes > MAX_EXTRACTED_BYTES) {
        throw unsafe("Skill 安装包超过 50 个文件或解压后 20 MB 的限制。", traceId);
      }
    }
  }
  return result.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function validateManifest(value: unknown, origin: SkillOrigin, traceId: string): SkillManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw manifestError("Manifest 必须是对象。", traceId);
  }
  const manifest = value as Record<string, unknown>;
  const expectedSourceType = origin === "system" ? "local_builtin" : "local_personal";
  const requiredStrings = ["skillId", "name", "displayName", "description", "version", "category", "entryFile"] as const;
  for (const key of requiredStrings) {
    if (typeof manifest[key] !== "string" || !(manifest[key] as string).trim()) {
      throw manifestError(`Manifest 字段 ${key} 不能为空。`, traceId);
    }
  }
  const skillId = String(manifest.skillId);
  if (!SKILL_ID_PATTERN.test(skillId) || skillId.includes("..") || manifest.name !== skillId) {
    throw manifestError("skillId/name 不合法或不一致。", traceId, skillId);
  }
  if (!SEMVER_PATTERN.test(String(manifest.version))) {
    throw manifestError("version 必须是合法语义化版本号。", traceId, skillId);
  }
  if (manifest.sourceType !== expectedSourceType || manifest.runtime !== "cycle-probe-client" || manifest.clientOnly !== true) {
    throw manifestError(`Skill 来源必须为 ${expectedSourceType}，且仅允许 cycle-probe-client 本地运行时。`, traceId, skillId);
  }
  if (typeof manifest.enabled !== "boolean") {
    throw manifestError("Manifest 字段 enabled 必须是布尔值。", traceId, skillId);
  }
  for (const key of ["tags", "keywords", "requiredTools"] as const) {
    if (!isStringArray(manifest[key])) {
      throw manifestError(`Manifest 字段 ${key} 必须是字符串数组。`, traceId, skillId);
    }
  }
  if (manifest.aliases !== undefined && !isStringArray(manifest.aliases)) {
    throw manifestError("Manifest 字段 aliases 必须是字符串数组。", traceId, skillId);
  }
  for (const tool of manifest.requiredTools as string[]) {
    if (!KNOWN_TOOL_NAMES.has(tool)) {
      throw manifestError(`Skill 声明了未知工具：${tool}`, traceId, skillId);
    }
  }
  for (const key of ["templateFile", "inputSchemaFile", "reportDataSchemaFile", "toolPolicyFile", "analysisRecipeFile"] as const) {
    if (manifest[key] !== undefined && typeof manifest[key] !== "string") {
      throw manifestError(`Manifest 字段 ${key} 必须是相对路径。`, traceId, skillId);
    }
  }
  return manifest as SkillManifest;
}

function validateAnalysisRecipe(value: unknown, skillId: string, traceId: string) {
  const recipe = asRecord(value, "分析配方", skillId, traceId);
  if (recipe.kind === "overall-risk-distribution-v1") {
    const fieldRoles = asRecord(recipe.fieldRoles, "分析配方 fieldRoles", skillId, traceId);
    for (const role of ["fiveLevelClassification", "riskClassificationResult", "loanBalance", "contractAmount", "contractSerial"] as const) {
      const definition = asRecord(fieldRoles[role], `分析配方字段 ${role}`, skillId, traceId);
      if (!isStringArray(definition.candidates) || definition.candidates.length === 0) {
        throw schemaError(`分析配方字段 ${role}.candidates 必须是非空字符串数组。`, traceId, skillId);
      }
    }
    if (!isStringArray(recipe.categoryOrder) || recipe.categoryOrder.length !== 5 ||
      recipe.categoryOrder.join(",") !== "正常,关注,次级,可疑,损失") {
      throw schemaError("整体风险分析配方 categoryOrder 必须依次为正常、关注、次级、可疑、损失。", traceId, skillId);
    }
    return recipe;
  }
  if (recipe.kind !== "grouped-risk-distribution-v1") {
    throw schemaError("分析配方 kind 不受支持。", traceId, skillId);
  }
  const fieldRoles = asRecord(recipe.fieldRoles, "分析配方 fieldRoles", skillId, traceId);
  for (const role of ["group", "risk", "amount", "recordId"] as const) {
    const definition = asRecord(fieldRoles[role], `分析配方字段 ${role}`, skillId, traceId);
    if (!isStringArray(definition.candidates) || definition.candidates.length === 0) {
      throw schemaError(`分析配方字段 ${role}.candidates 必须是非空字符串数组。`, traceId, skillId);
    }
  }
  if (!isStringArray(recipe.groupOrder) || recipe.groupOrder.length === 0) {
    throw schemaError("分析配方 groupOrder 必须是非空字符串数组。", traceId, skillId);
  }
  const groupOrder = recipe.groupOrder;
  const groupRules = Array.isArray(recipe.groupRules) ? recipe.groupRules : [];
  if (groupRules.length === 0 || groupRules.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const rule = item as Record<string, unknown>;
    return typeof rule.label !== "string" || !groupOrder.includes(rule.label) ||
      !isStringArray(rule.keywords) || rule.keywords.length === 0;
  })) {
    throw schemaError("分析配方 groupRules 必须引用 groupOrder 中的分类并提供关键词。", traceId, skillId);
  }
  const riskRules = asRecord(recipe.riskRules, "分析配方 riskRules", skillId, traceId);
  for (const key of ["normal", "attention", "nonperforming"] as const) {
    if (!isStringArray(riskRules[key]) || riskRules[key].length === 0) {
      throw schemaError(`分析配方 riskRules.${key} 必须是非空字符串数组。`, traceId, skillId);
    }
  }
  const output = asRecord(recipe.output, "分析配方 output", skillId, traceId);
  for (const key of ["distributionKey", "groupLabelKey"] as const) {
    if (typeof output[key] !== "string" || !String(output[key]).trim()) {
      throw schemaError(`分析配方 output.${key} 不能为空。`, traceId, skillId);
    }
  }
  if (output.specialMetrics !== undefined && (!Array.isArray(output.specialMetrics) || output.specialMetrics.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const metric = item as Record<string, unknown>;
    return typeof metric.key !== "string" || typeof metric.groupSourceContains !== "string" ||
      !["normal", "attention", "nonperforming"].includes(String(metric.risk));
  }))) {
    throw schemaError("分析配方 output.specialMetrics 格式不合法。", traceId, skillId);
  }
  return recipe;
}

function validateSchema(value: unknown, skillId: string, traceId: string) {
  const schema = asRecord(value, "JSON Schema", skillId, traceId);
  if (schema.type !== undefined && schema.type !== "object") {
    throw schemaError("Skill JSON Schema 根节点 type 必须为 object。", traceId, skillId);
  }
  if (schema.properties !== undefined && (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties))) {
    throw schemaError("Skill JSON Schema properties 必须为对象。", traceId, skillId);
  }
  return schema;
}

function validateToolPolicy(policy: Record<string, unknown> | undefined, manifest: SkillManifest, traceId: string) {
  if (!policy) return;
  if (policy.skillId !== undefined && policy.skillId !== manifest.skillId) {
    throw schemaError("工具策略 skillId 必须与 Manifest 一致。", traceId, manifest.skillId);
  }
  if (policy.requiredTools !== undefined) {
    if (!isStringArray(policy.requiredTools) || (policy.requiredTools as string[]).some((tool) => !manifest.requiredTools.includes(tool))) {
      throw schemaError("工具策略只能引用 Manifest 已声明的工具。", traceId, manifest.skillId);
    }
  }
  for (const key of ["allowedTools", "deniedTools"] as const) {
    if (policy[key] === undefined) continue;
    if (!isStringArray(policy[key]) || (policy[key] as string[]).some((tool) => !KNOWN_TOOL_NAMES.has(tool))) {
      throw schemaError(`工具策略 ${key} 只能引用已注册工具。`, traceId, manifest.skillId);
    }
    if (key === "allowedTools" && (policy[key] as string[]).some((tool) => !manifest.requiredTools.includes(tool))) {
      throw schemaError("工具策略 allowedTools 必须是 Manifest requiredTools 的子集。", traceId, manifest.skillId);
    }
  }
  const unsafePolicy = findUnsafePolicy(policy);
  if (unsafePolicy) {
    throw schemaError(`工具策略不能放宽审批或安全校验：${unsafePolicy}`, traceId, manifest.skillId);
  }
}

function findUnsafePolicy(value: unknown, path = "toolPolicy"): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (/^(allowUnsafe|bypassSafety|skipApproval|disableApproval|disableSafety)$/i.test(key) && item === true) {
      return nextPath;
    }
    if (/^(approvalRequired|requiresApproval|enforceSafety)$/i.test(key) && item === false) {
      return nextPath;
    }
    if (/^approvalMode$/i.test(key) && /^(full_access|no_approval|bypass)$/i.test(String(item))) {
      return nextPath;
    }
    const nested = findUnsafePolicy(item, nextPath);
    if (nested) return nested;
  }
  return null;
}

function safeReferencedPath(root: string, relativePath: string, traceId: string) {
  if (!relativePath || isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw unsafe("Skill 文件路径不合法。", traceId);
  }
  const resolvedPath = resolve(root, relativePath);
  assertInsideRoot(root, resolvedPath, traceId);
  return resolvedPath;
}

function assertInsideRoot(root: string, path: string, traceId: string) {
  const relativePath = relative(root, path);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    if (!relativePath) return;
    throw unsafe("Skill 文件路径越过安装目录。", traceId);
  }
}

async function readJson(path: string, code: "SKILL_MANIFEST_INVALID" | "SKILL_SCHEMA_INVALID", traceId: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw skillError({
      code,
      message: "Skill JSON 文件格式不合法。",
      operation: "install",
      traceId,
    });
  }
}

function asRecord(value: unknown, label: string, skillId: string | undefined, traceId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw schemaError(`${label} 必须是对象。`, traceId, skillId);
  }
  return value as Record<string, unknown>;
}

async function hashFiles(files: Array<{ path: string; relativePath: string }>) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(await readFile(file.path));
  }
  return hash.digest("hex");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function unsafe(message: string, traceId: string) {
  return skillError({ code: "SKILL_PACKAGE_UNSAFE", message, operation: "install", traceId });
}

function manifestError(message: string, traceId: string, skillId?: string) {
  return skillError({ code: "SKILL_MANIFEST_INVALID", message, operation: "install", traceId, skillId });
}

function schemaError(message: string, traceId: string, skillId?: string) {
  return skillError({ code: "SKILL_SCHEMA_INVALID", message, operation: "install", traceId, skillId });
}

export async function fileSize(path: string) {
  return (await stat(path)).size;
}
