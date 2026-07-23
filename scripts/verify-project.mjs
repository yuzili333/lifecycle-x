import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopDir = resolve(rootDir, "apps/desktop");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeCommand = process.execPath;

function run(command, args, cwd = rootDir) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

let exitCode = 0;
try {
  exitCode = run(pnpmCommand, ["verify:fast"]);
  if (exitCode === 0) exitCode = run(npmCommand, ["rebuild", "better-sqlite3"], desktopDir);
  if (exitCode === 0) exitCode = run(pnpmCommand, ["test"]);
  if (exitCode === 0) exitCode = run(pnpmCommand, ["build"]);
} finally {
  const restoreCode = run(nodeCommand, ["apps/desktop/scripts/rebuild-native-deps.mjs"]);
  if (exitCode === 0 && restoreCode !== 0) exitCode = restoreCode;
}

process.exitCode = exitCode;
