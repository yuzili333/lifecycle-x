import { spawn, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { packageManagerCommand } from "./lib/runtime-platform.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pnpm = packageManagerCommand();
const children = new Set();
let serverProcess = null;
let desktopProcess = null;
let stopping = false;

function spawnManaged(args) {
  const child = spawn(pnpm, args, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function stopTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The process may have exited between the check and the signal.
  }
}

function cleanup(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) stopTree(child);
  process.exitCode = exitCode;
}

async function lifecycleHealth() {
  try {
    const response = await fetch("http://127.0.0.1:4317/health", { signal: AbortSignal.timeout(1_000) });
    const body = await response.json();
    return response.ok && body?.ok === true && body?.service === "lifecycle-x-auth";
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await lifecycleHealth()) return true;
    if (serverProcess && serverProcess.exitCode !== null) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => cleanup(0));
}
process.on("exit", () => {
  for (const child of children) stopTree(child);
});

if (!(await lifecycleHealth())) {
  console.log("Starting the local authentication service...");
  serverProcess = spawnManaged(["--filter", "@lifecycle-x/server", "dev"]);
}

if (!(await waitForServer())) {
  console.error("Authentication service did not become healthy on 127.0.0.1:4317.");
  cleanup(1);
} else {
  console.log("Authentication service is healthy. Starting the desktop client...");
  desktopProcess = spawnManaged(["--filter", "@lifecycle-x/desktop", "dev"]);
  desktopProcess.once("error", (error) => {
    console.error(`Desktop client failed to start: ${error.message}`);
    cleanup(1);
  });
  desktopProcess.once("exit", (code, signal) => {
    if (!stopping) cleanup(code ?? (signal ? 1 : 0));
  });
  serverProcess?.once("exit", (code) => {
    if (!stopping) {
      console.error("Authentication service exited before the desktop client.");
      cleanup(code ?? 1);
    }
  });
}
