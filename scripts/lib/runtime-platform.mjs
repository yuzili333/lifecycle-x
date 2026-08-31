import { spawnSync } from "node:child_process";

export function packageManagerCommand(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function npmCommand(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function pythonCommand(environment = process.env, platform = process.platform) {
  const configured = environment.LIFECYCLE_X_PYTHON?.trim();
  if (configured) return configured;
  return platform === "win32" ? "python.exe" : "python3";
}

export function supportedReviewPlatform(platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && arch === "arm64") return "macos-apple-silicon";
  if (platform === "win32" && arch === "x64") return "windows-11-x64";
  return null;
}

export function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: options.encoding,
    stdio: options.stdio ?? "inherit",
  });
  if (result.error) throw result.error;
  return result;
}
