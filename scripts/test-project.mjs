import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { npmCommand, packageManagerCommand, runSync } from "./lib/runtime-platform.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopDir = resolve(rootDir, "apps/desktop");
const pnpm = packageManagerCommand();
const npm = npmCommand();
let exitCode = 0;

try {
  const rebuildForNode = runSync(npm, ["rebuild", "better-sqlite3"], { cwd: desktopDir });
  exitCode = rebuildForNode.status ?? 1;
  if (exitCode === 0) {
    const tests = runSync(pnpm, ["-r", "test"], { cwd: rootDir });
    exitCode = tests.status ?? 1;
  }
} finally {
  const restore = runSync(process.execPath, ["apps/desktop/scripts/rebuild-native-deps.mjs"], { cwd: rootDir });
  if (exitCode === 0 && restore.status !== 0) exitCode = restore.status ?? 1;
}

process.exitCode = exitCode;
