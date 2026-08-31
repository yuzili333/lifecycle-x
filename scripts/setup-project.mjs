import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { packageManagerCommand, runSync } from "./lib/runtime-platform.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pnpm = packageManagerCommand();

function step(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = runSync(command, args, { cwd: rootDir });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

step("Validate the supported platform and language runtimes", process.execPath, ["scripts/doctor.mjs", "--preflight"]);
step("Install or repair the Electron runtime", pnpm, ["--filter", "@lifecycle-x/desktop", "rebuild", "electron"]);
step("Build better-sqlite3 for the Electron ABI", process.execPath, ["apps/desktop/scripts/rebuild-native-deps.mjs"]);
step("Run the complete environment diagnostic", process.execPath, ["scripts/doctor.mjs"]);

console.log("\nSetup completed. Run `pnpm dev` to start the local review environment.");
