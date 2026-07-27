import { createHash, randomUUID } from "node:crypto";
import { access, appendFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  LoadedSkill,
  SkillInstallResult,
  SkillRemoveResult,
  SkillSummary,
} from "../../shared/skills";
import { getBuiltinSkillRoot } from "../builtinSkills";
import { SkillError, skillError } from "./SkillError";
import { SkillPackageInstaller } from "./SkillPackageInstaller";
import { toSkillSummary, validateSkillDirectory } from "./SkillPackageValidator";
import { SkillStateStore } from "./SkillStateStore";

type LocalSkillManagerOptions = {
  userDataRoot: string;
  systemRoot?: string;
  auditLogPath?: string;
};

type PersonalSkillState = {
  enabled: boolean;
  version: string;
  contentHash: string;
  installedAt: string;
};

export class LocalSkillManager {
  private readonly skillsRoot: string;
  private readonly personalRoot: string;
  private readonly systemRoot: string;
  private readonly stateStore: SkillStateStore;
  private readonly installer: SkillPackageInstaller;
  private readonly auditLogPath: string;
  private readonly operationQueue = new Map<string, Promise<unknown>>();

  constructor(options: LocalSkillManagerOptions) {
    this.skillsRoot = resolve(options.userDataRoot, "skills");
    this.personalRoot = resolve(this.skillsRoot, "personal");
    this.systemRoot = getBuiltinSkillRoot(options.systemRoot);
    this.stateStore = new SkillStateStore(resolve(this.skillsRoot, "skill-state.json"));
    this.installer = new SkillPackageInstaller(resolve(this.skillsRoot, "staging"));
    this.auditLogPath = options.auditLogPath ?? resolve(this.skillsRoot, "skill-audit.jsonl");
  }

  async list(userId: string): Promise<SkillSummary[]> {
    const userKey = userKeyFor(userId);
    const [system, personal] = await Promise.all([
      this.scanRoot(this.systemRoot, "system", {}),
      this.scanRoot(this.personalDirectory(userKey), "personal", await this.stateStore.list(userKey)),
    ]);
    return [...system, ...personal].sort((left, right) =>
      left.origin.localeCompare(right.origin) ||
      left.displayName.localeCompare(right.displayName, "zh-CN")
    );
  }

  async load(userId: string, skillId: string): Promise<LoadedSkill> {
    const traceId = randomUUID();
    assertRequestedSkillId(skillId, "load", traceId);
    const systemPath = resolve(this.systemRoot, skillId);
    const system = await this.validateForLoad(systemPath, "system", traceId, skillId);
    if (system) return system.loaded;

    const userKey = userKeyFor(userId);
    const state = await this.stateStore.get(userKey, skillId);
    const personalPath = resolve(this.personalDirectory(userKey), skillId);
    const personal = await this.validateForLoad(personalPath, "personal", traceId, skillId);
    if (!personal) {
      throw skillError({
        code: "SKILL_NOT_FOUND",
        message: `未找到 Skill：${skillId}`,
        operation: "load",
        traceId,
        skillId,
      });
    }
    if (!state) {
      throw integrityError("load", traceId, skillId, "Skill 状态索引缺失，无法确认安装完整性。");
    }
    assertPersonalSkillIntegrity(personal.loaded, state, "load", traceId, skillId);
    if (!state.enabled) {
      throw skillError({
        code: "SKILL_DISABLED",
        message: `Skill 已停用：${personal.manifest.displayName}`,
        operation: "load",
        traceId,
        skillId,
      });
    }
    return {
      ...personal.loaded,
      summary: toSkillSummary(personal.manifest, "personal", true),
    };
  }

  async install(userId: string, zipPath: string): Promise<SkillInstallResult> {
    return this.serialize(userId, async () => {
      const traceId = randomUUID();
      const userKey = userKeyFor(userId);
      await mkdir(resolve(this.skillsRoot, "staging"), { recursive: true });
      const staged = await this.installer.stageAndValidate(zipPath, traceId);
      const { manifest, loaded, root } = staged.package;
      const destination = resolve(this.personalDirectory(userKey), manifest.skillId);
      try {
        if (await pathExists(resolve(this.systemRoot, manifest.skillId))) {
          throw skillError({
            code: "SKILL_ID_RESERVED",
            message: "该 Skill ID 已被系统 Skill 占用。",
            operation: "install",
            traceId,
            skillId: manifest.skillId,
            conflictTrace: [manifest.skillId],
          });
        }
        if (await pathExists(destination)) {
          throw skillError({
            code: "SKILL_ALREADY_INSTALLED",
            message: "该个人 Skill 已安装，请删除后重装。",
            operation: "install",
            traceId,
            skillId: manifest.skillId,
          });
        }
        await mkdir(this.personalDirectory(userKey), { recursive: true });
        await renameWithRetry(root, destination);
        try {
          await this.stateStore.set(userKey, manifest.skillId, {
            enabled: true,
            version: manifest.version,
            contentHash: loaded.contentHash,
            installedAt: new Date().toISOString(),
          });
        } catch (error) {
          await rm(destination, { recursive: true, force: true });
          throw error;
        }
        const skill = toSkillSummary(manifest, "personal", true);
        await this.audit("install", userKey, skill, traceId, "success");
        return { status: "installed", skill };
      } catch (error) {
        await this.audit("install", userKey, {
          skillId: manifest.skillId,
          version: manifest.version,
        }, traceId, "failed");
        throw error;
      } finally {
        await this.installer.cleanup(staged.stagingDirectory);
      }
    });
  }

  async setEnabled(userId: string, skillId: string, enabled: boolean): Promise<SkillSummary> {
    return this.serialize(userId, async () => {
      const traceId = randomUUID();
      assertRequestedSkillId(skillId, "set_enabled", traceId);
      if (typeof enabled !== "boolean") {
        throw skillError({
          code: "SKILL_OPERATION_FAILED",
          message: "Skill 启用状态必须是布尔值。",
          operation: "set_enabled",
          traceId,
          skillId,
        });
      }
      const userKey = userKeyFor(userId);
      if (await pathExists(resolve(this.systemRoot, skillId))) {
        throw skillError({
          code: "SKILL_ID_RESERVED",
          message: "系统 Skill 始终启用，不能修改状态。",
          operation: "set_enabled",
          traceId,
          skillId,
        });
      }
      const personalPath = resolve(this.personalDirectory(userKey), skillId);
      if (!(await pathExists(personalPath))) throw notFound("set_enabled", traceId, skillId);
      const validated = await this.validateForLoad(personalPath, "personal", traceId, skillId);
      const existingState = await this.stateStore.get(userKey, skillId);
      if (!validated || !existingState) {
        throw integrityError(
          "set_enabled",
          traceId,
          skillId,
          "Skill 状态索引缺失，无法修改启用状态。",
        );
      }
      assertPersonalSkillIntegrity(
        validated.loaded,
        existingState,
        "set_enabled",
        traceId,
        skillId,
      );
      const state = await this.stateStore.setEnabled(userKey, skillId, enabled);
      if (!state) throw notFound("set_enabled", traceId, skillId);
      const summary = toSkillSummary(validated.manifest, "personal", enabled);
      await this.audit("set_enabled", userKey, summary, traceId, "success");
      return summary;
    });
  }

  async remove(userId: string, skillId: string): Promise<SkillRemoveResult> {
    return this.serialize(userId, async () => {
      const traceId = randomUUID();
      assertRequestedSkillId(skillId, "remove", traceId);
      const userKey = userKeyFor(userId);
      if (await pathExists(resolve(this.systemRoot, skillId))) {
        throw skillError({
          code: "SKILL_ID_RESERVED",
          message: "系统 Skill 不能删除。",
          operation: "remove",
          traceId,
          skillId,
        });
      }
      const source = resolve(this.personalDirectory(userKey), skillId);
      if (!(await pathExists(source))) throw notFound("remove", traceId, skillId);
      const validated = await this.tryValidate(source, "personal", traceId);
      const previousState = await this.stateStore.get(userKey, skillId);
      const quarantine = resolve(this.skillsRoot, "staging", `${traceId}-remove`);
      await mkdir(resolve(this.skillsRoot, "staging"), { recursive: true });
      await renameWithRetry(source, quarantine);
      try {
        await this.stateStore.remove(userKey, skillId);
        await rm(quarantine, { recursive: true, force: true });
      } catch (error) {
        try {
          await renameWithRetry(quarantine, source);
          if (previousState) {
            await this.stateStore.set(userKey, skillId, previousState);
          }
        } catch {
          throw skillError({
            code: "SKILL_REMOVE_PARTIAL",
            message: "Skill 删除失败，且无法自动回滚文件。",
            operation: "remove",
            traceId,
            skillId,
            recoverable: false,
            fallbackTrace: ["state rollback failed"],
          });
        }
        throw error;
      }
      await this.audit("remove", userKey, {
        skillId,
        version: validated?.manifest.version ?? previousState?.version,
        contentHash: validated?.loaded.contentHash ?? previousState?.contentHash,
      }, traceId, "success");
      return { success: true, skillId };
    });
  }

  private async scanRoot(
    root: string,
    origin: "system" | "personal",
    state: Record<string, PersonalSkillState>,
  ) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const summaries: SkillSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillRoot = resolve(root, entry.name);
      if (!(await pathExists(resolve(skillRoot, "manifest.json")))) {
        continue;
      }
      const traceId = randomUUID();
      try {
        const validated = await validateSkillDirectory({
          root: skillRoot,
          origin,
          traceId,
        });
        const personalState = origin === "personal"
          ? state[validated.manifest.skillId]
          : undefined;
        if (origin === "personal" && (!personalState ||
          personalState.version !== validated.manifest.version ||
          personalState.contentHash !== validated.loaded.contentHash)) {
          const error = !personalState
            ? "Skill 状态索引缺失，无法确认安装完整性。"
            : "Skill 内容或版本与安装记录不一致。";
          summaries.push({
            ...toSkillSummary(validated.manifest, origin, false),
            availability: "invalid",
            canToggle: false,
            error,
          });
          continue;
        }
        summaries.push(toSkillSummary(
          validated.manifest,
          origin,
          origin === "system" ? true : personalState!.enabled,
        ));
      } catch (error) {
        summaries.push({
          skillId: entry.name,
          displayName: entry.name,
          description: error instanceof Error ? error.message : "Skill 无法加载。",
          version: "",
          category: "",
          origin,
          enabled: false,
          availability: "invalid",
          tags: [],
          keywords: [],
          aliases: [],
          canToggle: false,
          canDelete: origin === "personal",
          error: error instanceof Error ? error.message : "Skill 无法加载。",
        });
      }
    }
    return summaries;
  }

  private async tryValidate(root: string, origin: "system" | "personal", traceId: string) {
    try {
      return await validateSkillDirectory({ root, origin, traceId });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof SkillError && error.detail.code === "SKILL_PACKAGE_INCOMPLETE") {
        try {
          await readdir(root);
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === "ENOENT") return null;
        }
      }
      throw error;
    }
  }

  private async validateForLoad(
    root: string,
    origin: "system" | "personal",
    traceId: string,
    skillId: string,
  ) {
    if (!(await pathExists(root))) return null;
    try {
      return await validateSkillDirectory({ root, origin, traceId });
    } catch (error) {
      throw skillError({
        code: "SKILL_LOAD_FAILED",
        message: error instanceof Error ? error.message : `Skill 无法加载：${skillId}`,
        operation: "load",
        traceId,
        skillId,
        recoverable: false,
      });
    }
  }

  private personalDirectory(userKey: string) {
    return resolve(this.personalRoot, userKey);
  }

  private serialize<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const userKey = userKeyFor(userId);
    const previous = this.operationQueue.get(userKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.operationQueue.set(userKey, next);
    return next.finally(() => {
      if (this.operationQueue.get(userKey) === next) this.operationQueue.delete(userKey);
    });
  }

  private async audit(
    operation: string,
    userKey: string,
    skill: { skillId: string; version?: string; contentHash?: string },
    traceId: string,
    result: "success" | "failed",
  ) {
    await mkdir(resolve(this.skillsRoot), { recursive: true });
    const contentHash = "contentHash" in skill ? skill.contentHash : undefined;
    try {
      await appendFile(this.auditLogPath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        operation,
        userKey,
        skillId: skill.skillId,
        version: skill.version,
        contentHash,
        result,
        traceId,
      })}\n`, "utf8");
    } catch {
      // Audit storage failure must not undo an already committed Skill operation.
    }
  }
}

function userKeyFor(userId: string) {
  const normalized = userId.trim();
  if (!normalized) throw new Error("用户 ID 不能为空。");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

function notFound(operation: "set_enabled" | "remove", traceId: string, skillId: string) {
  return skillError({
    code: "SKILL_NOT_FOUND",
    message: `未找到个人 Skill：${skillId}`,
    operation,
    traceId,
    skillId,
  });
}

function integrityError(
  operation: "load" | "set_enabled",
  traceId: string,
  skillId: string,
  message: string,
) {
  return skillError({
    code: "SKILL_LOAD_FAILED",
    message,
    operation,
    traceId,
    skillId,
    recoverable: false,
  });
}

function assertPersonalSkillIntegrity(
  loaded: LoadedSkill,
  state: PersonalSkillState,
  operation: "load" | "set_enabled",
  traceId: string,
  skillId: string,
) {
  if (
    state.version !== loaded.summary.version ||
    state.contentHash !== loaded.contentHash
  ) {
    throw integrityError(
      operation,
      traceId,
      skillId,
      "Skill 内容或版本与安装记录不一致，请删除后重新安装。",
    );
  }
}

function assertRequestedSkillId(
  skillId: string,
  operation: "load" | "set_enabled" | "remove",
  traceId: string,
) {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(skillId) || skillId.includes("..")) {
    throw skillError({
      code: "SKILL_OPERATION_FAILED",
      message: "Skill ID 不合法。",
      operation,
      traceId,
      recoverable: false,
    });
  }
}

async function renameWithRetry(source: string, destination: string) {
  try {
    await rename(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EBUSY" && code !== "EPERM") throw error;
    await new Promise((resolve) => setTimeout(resolve, 40));
    await rename(source, destination);
  }
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
