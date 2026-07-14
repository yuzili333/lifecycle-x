import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BuiltinSkillManifest = {
  skillId: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  category: string;
  tags: string[];
  keywords: string[];
  sourceType: "local_builtin";
  runtime: "cycle-probe-client";
  clientOnly: true;
  enabled: boolean;
  requiredTools: string[];
  entryFile: string;
  templateFile?: string;
  inputSchemaFile?: string;
  reportDataSchemaFile?: string;
  toolPolicyFile?: string;
  aliases?: string[];
};

export type BuiltinSkillMetadata = Pick<
  BuiltinSkillManifest,
  "skillId" | "name" | "displayName" | "description" | "version" | "category" | "tags" | "keywords" | "sourceType" | "clientOnly" | "enabled" | "requiredTools" | "aliases"
>;

export type BuiltinLoadedSkill = {
  metadata: BuiltinSkillMetadata;
  instructions: string;
  reportTemplate?: string;
  toolPolicy?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  loadedAt: string;
};

export type BuiltinSkillSearchQuery = {
  query?: string;
  enabledOnly?: boolean;
};

export type BuiltinSkillSearchResult = {
  skill: BuiltinSkillMetadata;
  score: number;
  matchedFields: string[];
};

export type BuiltinSkillInstallResult = {
  installed: string[];
  skipped: string[];
  failed: Array<{
    skillId: string;
    error: string;
  }>;
};

const currentFile = fileURLToPath(import.meta.url);
const repoRootFromSource = resolve(dirname(currentFile), "../../../..");

export function getBuiltinSkillRoot(explicitRoot?: string) {
  if (explicitRoot) {
    return resolve(explicitRoot);
  }
  if (process.env.CYCLE_PROBE_BUILTIN_SKILL_ROOT) {
    return resolve(process.env.CYCLE_PROBE_BUILTIN_SKILL_ROOT);
  }

  const packagedRoot = process.resourcesPath ? join(process.resourcesPath, "skills", "built-in") : "";
  if (packagedRoot && existsSync(packagedRoot)) {
    return resolve(packagedRoot);
  }

  const legacyPackagedRoot = process.resourcesPath ? join(process.resourcesPath, "skill") : "";
  if (legacyPackagedRoot && existsSync(legacyPackagedRoot)) {
    return resolve(legacyPackagedRoot);
  }

  return resolve(repoRootFromSource, "skill");
}

export class BuiltinSkillRegistry {
  private readonly root: string;

  constructor(root = getBuiltinSkillRoot()) {
    this.root = resolve(root);
  }

  getRoot() {
    return this.root;
  }

  async scan(): Promise<BuiltinSkillMetadata[]> {
    if (!existsSync(this.root)) {
      return [];
    }

    const entries = await readdir(this.root, { withFileTypes: true });
    const skills: BuiltinSkillMetadata[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const manifest = await this.readManifest(entry.name);
        if (manifest.sourceType !== "local_builtin" || manifest.clientOnly !== true) {
          continue;
        }
        skills.push(toMetadata(manifest));
      } catch {
        continue;
      }
    }
    return skills.sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-CN"));
  }

  async search(input: BuiltinSkillSearchQuery = {}): Promise<BuiltinSkillSearchResult[]> {
    const query = normalizeSearchText(input.query ?? "");
    const skills = await this.scan();
    return skills
      .filter((skill) => (input.enabledOnly === false ? true : skill.enabled))
      .map((skill) => scoreSkill(skill, query))
      .filter((result) => !query || result.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.displayName.localeCompare(b.skill.displayName, "zh-CN"));
  }

  async load(skillId: string): Promise<BuiltinLoadedSkill> {
    const manifest = await this.readManifest(skillId);
    validateManifest(manifest);

    const instructions = await this.readText(skillId, manifest.entryFile);
    return {
      metadata: toMetadata(manifest),
      instructions,
      reportTemplate: manifest.templateFile ? await this.readText(skillId, manifest.templateFile) : undefined,
      toolPolicy: manifest.toolPolicyFile ? await this.readRecord(skillId, manifest.toolPolicyFile) : undefined,
      inputSchema: manifest.inputSchemaFile ? await this.readRecord(skillId, manifest.inputSchemaFile) : undefined,
      outputSchema: manifest.reportDataSchemaFile ? await this.readRecord(skillId, manifest.reportDataSchemaFile) : undefined,
      loadedAt: new Date().toISOString(),
    };
  }

  async installBuiltinSkills(): Promise<BuiltinSkillInstallResult> {
    const installed: string[] = [];
    const skipped: string[] = [];
    const failed: BuiltinSkillInstallResult["failed"] = [];
    if (!existsSync(this.root)) {
      return { installed, skipped, failed };
    }

    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        skipped.push(entry.name);
        continue;
      }
      try {
        const manifest = await this.readManifest(entry.name);
        validateManifest(manifest);
        if (manifest.enabled) {
          installed.push(manifest.skillId);
        } else {
          skipped.push(manifest.skillId);
        }
      } catch (error) {
        failed.push({
          skillId: entry.name,
          error: error instanceof Error ? error.message : "Skill load failed.",
        });
      }
    }
    return { installed, skipped, failed };
  }

  private async readManifest(skillId: string) {
    const manifest = await this.readJson(skillId, "manifest.json") as BuiltinSkillManifest;
    validateManifest(manifest);
    return manifest;
  }

  private async readJson(skillId: string, relativePath: string) {
    return JSON.parse(await this.readText(skillId, relativePath)) as unknown;
  }

  private async readRecord(skillId: string, relativePath: string) {
    const parsed = await this.readJson(skillId, relativePath);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Skill JSON file must contain an object.");
    }
    return parsed as Record<string, unknown>;
  }

  private async readText(skillId: string, relativePath: string) {
    const filePath = this.resolveSkillPath(skillId, relativePath);
    return readFile(filePath, "utf8");
  }

  private resolveSkillPath(skillId: string, relativePath: string) {
    if (!skillId || skillId.includes("..") || isAbsolute(skillId)) {
      throw new Error("Invalid skill id.");
    }
    if (!relativePath || relativePath.includes("..") || isAbsolute(relativePath)) {
      throw new Error("Invalid skill file path.");
    }
    const skillRoot = resolve(this.root, skillId);
    const filePath = resolve(skillRoot, relativePath);
    const relativeFilePath = relative(skillRoot, filePath);
    if (relativeFilePath.startsWith("..") || isAbsolute(relativeFilePath)) {
      throw new Error("Skill path escapes skill root.");
    }
    return filePath;
  }
}

export function parseSkillFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    result[key] = value.replace(/^["']|["']$/g, "");
  }
  return result;
}

function validateManifest(manifest: BuiltinSkillManifest) {
  const requiredTools = [
    "request_sql_query_execution",
    "request_python_analysis_execution",
    "request_chart_rendering",
    "request_markdown_report_generation",
  ];
  if (!manifest || manifest.skillId !== manifest.name) {
    throw new Error("Skill manifest skillId/name mismatch.");
  }
  if (manifest.sourceType !== "local_builtin") {
    throw new Error("Builtin skill sourceType must be local_builtin.");
  }
  if (manifest.clientOnly !== true) {
    throw new Error("Builtin skill clientOnly must be true.");
  }
  for (const tool of requiredTools) {
    if (!manifest.requiredTools?.includes(tool)) {
      throw new Error(`Builtin skill missing required tool: ${tool}`);
    }
  }
  if (!manifest.entryFile || !manifest.displayName || !manifest.description) {
    throw new Error("Builtin skill manifest missing required metadata.");
  }
}

function toMetadata(manifest: BuiltinSkillManifest): BuiltinSkillMetadata {
  return {
    skillId: manifest.skillId,
    name: manifest.name,
    displayName: manifest.displayName,
    description: manifest.description,
    version: manifest.version,
    category: manifest.category,
    tags: manifest.tags,
    keywords: manifest.keywords,
    sourceType: manifest.sourceType,
    clientOnly: manifest.clientOnly,
    enabled: manifest.enabled,
    requiredTools: manifest.requiredTools,
    aliases: manifest.aliases,
  };
}

function scoreSkill(skill: BuiltinSkillMetadata, query: string): BuiltinSkillSearchResult {
  if (!query) {
    return { skill, score: 1, matchedFields: [] };
  }

  const weightedFields: Array<[string, string | string[] | undefined, number]> = [
    ["displayName", skill.displayName, 10],
    ["aliases", skill.aliases, 8],
    ["keywords", skill.keywords, 6],
    ["tags", skill.tags, 4],
    ["name", skill.name, 3],
    ["description", skill.description, 2],
  ];
  let score = 0;
  const matchedFields: string[] = [];
  for (const [field, value, weight] of weightedFields) {
    const haystack = normalizeSearchText(Array.isArray(value) ? value.join(" ") : value ?? "");
    if (haystack.includes(query)) {
      score += weight;
      matchedFields.push(field);
    }
  }
  return { skill, score, matchedFields };
}

function normalizeSearchText(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}
