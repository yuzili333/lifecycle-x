import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageManagerCommand, pythonCommand, supportedReviewPlatform } from "./lib/runtime-platform.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopDir = resolve(rootDir, "apps/desktop");
const requireFromDesktop = createRequire(resolve(desktopDir, "package.json"));
const preflightOnly = process.argv.includes("--preflight");
const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "[ok]" : "[failed]"} ${name}: ${detail}`);
}

function commandOutput(command, args, cwd = rootDir, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    error: result.error,
  };
}

function matchesVersion(value, expectedMajor, expectedMinor) {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  return Boolean(match && Number(match[1]) === expectedMajor && Number(match[2]) === expectedMinor);
}

async function portStatus(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) });
    const body = await response.json();
    if (response.ok && body?.ok === true && body?.service === "lifecycle-x-auth") return "service-running";
  } catch {
    // A free port is the normal state before pnpm dev.
  }
  return await new Promise((resolveStatus) => {
    const server = createServer();
    server.once("error", () => resolveStatus("occupied-by-another-process"));
    server.listen(port, "127.0.0.1", () => server.close(() => resolveStatus("available")));
  });
}

const platformId = supportedReviewPlatform();
record(
  "review platform",
  Boolean(platformId),
  platformId ?? `${process.platform}/${process.arch} is outside the supported review matrix`,
);
record("Node.js", matchesVersion(process.version, 24, 12), `${process.version}; expected 24.12.x`);

const pnpm = commandOutput(packageManagerCommand(), ["--version"]);
record("pnpm", pnpm.ok && pnpm.stdout === "11.7.0", `${pnpm.stdout || pnpm.stderr || pnpm.error?.message}; expected 11.7.0`);

const pythonExecutable = pythonCommand();
const python = commandOutput(pythonExecutable, ["-I", "-S", "-c", "import platform; print(platform.python_version())"]);
record(
  "Python",
  python.ok && matchesVersion(python.stdout, 3, 11),
  `${python.ok ? python.stdout : python.stderr || python.error?.message}; command=${pythonExecutable}; expected 3.11.x`,
);

if (!preflightOnly) {
  let electronExecutable = "";
  let electronVersion = "unknown";
  try {
    electronVersion = requireFromDesktop("electron/package.json").version;
    electronExecutable = requireFromDesktop("electron");
    record("Electron", matchesVersion(electronVersion, 33, 4), `${electronVersion}; executable installed`);
  } catch (error) {
    record("Electron", false, error instanceof Error ? error.message : String(error));
  }

  if (electronExecutable) {
    const nativeSmoke = commandOutput(
      electronExecutable,
      ["-e", "const Database=require('better-sqlite3');const db=new Database(':memory:');const row=db.prepare('select 1 as ok').get();db.close();if(row.ok!==1)process.exit(2)"],
      desktopDir,
      { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    );
    record(
      "Electron SQLite ABI",
      nativeSmoke.ok,
      nativeSmoke.ok ? "better-sqlite3 query passed" : nativeSmoke.stderr || nativeSmoke.error?.message,
    );
  }

  const authPort = await portStatus(4317);
  record("auth port 4317", authPort !== "occupied-by-another-process", authPort);
}

if (checks.some((check) => !check.ok)) {
  console.error("\nEnvironment check failed. See docs/review/deployment.md for the supported setup.");
  process.exitCode = 1;
} else {
  console.log(`\nEnvironment check passed${preflightOnly ? " (preflight)" : ""}.`);
}
