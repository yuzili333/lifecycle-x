export function resolvePythonExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  const configured = environment.LIFECYCLE_X_PYTHON?.trim();
  if (configured) return configured;
  return platform === "win32" ? "python.exe" : "python3";
}
