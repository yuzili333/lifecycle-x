import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

type PersonalSkillState = {
  enabled: boolean;
  version: string;
  contentHash: string;
  installedAt: string;
};

type SkillStateFile = {
  version: 1;
  users: Record<string, Record<string, PersonalSkillState>>;
};

const EMPTY_STATE: SkillStateFile = {
  version: 1,
  users: {},
};

export class SkillStateStore {
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly statePath: string) {}

  async list(userKey: string) {
    return { ...(await this.read()).users[userKey] };
  }

  async get(userKey: string, skillId: string) {
    return (await this.read()).users[userKey]?.[skillId];
  }

  async set(userKey: string, skillId: string, state: PersonalSkillState) {
    return this.mutate(async (current) => {
      current.users[userKey] = {
        ...current.users[userKey],
        [skillId]: state,
      };
      return state;
    });
  }

  async setEnabled(userKey: string, skillId: string, enabled: boolean) {
    return this.mutate(async (current) => {
      const existing = current.users[userKey]?.[skillId];
      if (!existing) return null;
      current.users[userKey] = {
        ...current.users[userKey],
        [skillId]: { ...existing, enabled },
      };
      return current.users[userKey][skillId];
    });
  }

  async remove(userKey: string, skillId: string) {
    return this.mutate(async (current) => {
      if (!current.users[userKey]?.[skillId]) return false;
      const nextUser = { ...current.users[userKey] };
      delete nextUser[skillId];
      if (Object.keys(nextUser).length === 0) {
        delete current.users[userKey];
      } else {
        current.users[userKey] = nextUser;
      }
      return true;
    });
  }

  private mutate<T>(mutation: (state: SkillStateFile) => Promise<T>) {
    const operation = this.mutationQueue
      .catch(() => undefined)
      .then(async () => {
        const current = await this.read();
        const result = await mutation(current);
        await this.write(current);
        return result;
      });
    this.mutationQueue = operation;
    return operation;
  }

  private async read(): Promise<SkillStateFile> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as Partial<SkillStateFile>;
      if (parsed.version !== 1 || !parsed.users || typeof parsed.users !== "object") {
        return structuredClone(EMPTY_STATE);
      }
      return { version: 1, users: parsed.users };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(EMPTY_STATE);
      }
      throw error;
    }
  }

  private async write(state: SkillStateFile) {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await renameWithRetry(temporaryPath, this.statePath);
    } catch (error) {
      await import("node:fs/promises").then(({ rm }) => rm(temporaryPath, { force: true }));
      throw error;
    }
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
