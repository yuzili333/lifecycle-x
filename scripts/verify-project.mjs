import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { packageManagerCommand, runSync } from "./lib/runtime-platform.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pnpmCommand = packageManagerCommand();
const nodeCommand = process.execPath;

function run(command, args, cwd = rootDir) {
  const result = runSync(command, args, { cwd });
  return result.status ?? 1;
}

let exitCode = 0;
exitCode = run(pnpmCommand, ["verify:fast"]);
if (exitCode === 0) exitCode = run(nodeCommand, ["scripts/test-project.mjs"]);
if (exitCode === 0) exitCode = run(pnpmCommand, ["build"]);
if (exitCode === 0) exitCode = run(nodeCommand, ["scripts/doctor.mjs"]);

process.exitCode = exitCode;
