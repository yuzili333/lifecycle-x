import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const repoRootFromSource = resolve(dirname(currentFile), "../../../..");

export function getBuiltinSkillRoot(explicitRoot?: string) {
  if (explicitRoot) return resolve(explicitRoot);
  if (process.env.CYCLE_PROBE_BUILTIN_SKILL_ROOT) {
    return resolve(process.env.CYCLE_PROBE_BUILTIN_SKILL_ROOT);
  }

  const packagedRoot = process.resourcesPath
    ? join(process.resourcesPath, "skills", "built-in")
    : "";
  if (packagedRoot && existsSync(packagedRoot)) return resolve(packagedRoot);

  return resolve(repoRootFromSource, "skill");
}
