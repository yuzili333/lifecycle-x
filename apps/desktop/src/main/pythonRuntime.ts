export function resolvePythonExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  const configured = environment.LIFECYCLE_X_PYTHON?.trim();
  if (configured) return configured;
  return platform === "win32" ? "python.exe" : "python3";
}

export function restrictedPythonEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const allowedKeys = ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"] as const;
  return Object.fromEntries(
    allowedKeys.flatMap((key) => environment[key] ? [[key, environment[key]]] : []),
  ) as NodeJS.ProcessEnv;
}
