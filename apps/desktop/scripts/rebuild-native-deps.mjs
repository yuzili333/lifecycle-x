import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(scriptDir);
const requireFromDesktop = createRequire(join(packageDir, "package.json"));
const electronPackageJsonPath = join(packageDir, "node_modules", "electron", "package.json");
const electronVersion = JSON.parse(readFileSync(electronPackageJsonPath, "utf8")).version;
const betterSqlitePackageDir = dirname(requireFromDesktop.resolve("better-sqlite3/package.json"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const result = spawnSync(npmCommand, ["run", "build-release"], {
  cwd: betterSqlitePackageDir,
  stdio: "inherit",
  env: {
    ...process.env,
    npm_config_runtime: "electron",
    npm_config_target: electronVersion,
    npm_config_disturl: "https://electronjs.org/headers",
    npm_config_build_from_source: "true",
    npm_config_devdir: join(packageDir, ".electron", "node-gyp"),
  },
});

if (typeof result.status === "number" && result.status !== 0) {
  process.exit(result.status);
}

if (result.error) {
  throw result.error;
}
