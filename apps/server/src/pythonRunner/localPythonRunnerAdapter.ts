import { spawn, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import type { PythonRunnerAdapter, PythonRunnerAdapterResult, PythonRunnerModuleConfig, PythonSandboxRunInput } from "./types.js";
import { PythonArtifactManager } from "./pythonArtifactManager.js";
import { PythonSandboxPolicy } from "./pythonSandboxPolicy.js";

export class LocalPythonRunnerAdapter implements PythonRunnerAdapter {
  private readonly sandboxPolicy: PythonSandboxPolicy;
  private readonly artifactManager: PythonArtifactManager;
  private readonly processes = new Map<string, ChildProcess>();

  constructor(private readonly config: PythonRunnerModuleConfig) {
    this.sandboxPolicy = new PythonSandboxPolicy(config);
    this.artifactManager = new PythonArtifactManager(config);
  }

  async execute(input: PythonSandboxRunInput): Promise<PythonRunnerAdapterResult> {
    const startedAt = Date.now();
    const paths = await this.sandboxPolicy.createRun(input.executionId);
    await this.sandboxPolicy.writeScript(paths, input.script);
    const materializedDatasets = await this.sandboxPolicy.materializeDatasets(
      paths,
      this.config.datasetResolver,
      input.input.inputDatasets.map((dataset) => dataset.datasetId),
    );
    await this.sandboxPolicy.writeMetadata(paths, {
      executionId: input.executionId,
      requestId: input.requestId,
      inputDatasets: input.input.inputDatasets,
      materializedDatasets,
      expectedOutputs: input.input.expectedOutputs,
      timeoutMs: input.timeoutMs,
      memoryLimitMb: input.memoryLimitMb,
    });

    const env = this.sandboxPolicy.buildSafeEnv(paths);
    const child = spawn(this.config.pythonExecutable ?? "python3", ["script.py"], {
      cwd: paths.runDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.processes.set(input.executionId, child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    const onAbort = () => child.kill("SIGTERM");
    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk.toString("utf8"), this.config.maxStdoutBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"), this.config.maxStderrBytes);
    });

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onAbort);
    this.processes.delete(input.executionId);
    await writeFile(paths.stdoutPath, stdout, "utf8");
    await writeFile(paths.stderrPath, stderr, "utf8");
    const { artifacts, warnings } = await this.artifactManager.collect(paths.artifactsDir, paths.runDir);
    const status = input.signal?.aborted ? "cancelled" : timedOut ? "timeout" : exit.code === 0 ? "success" : "failed";
    const result: PythonRunnerAdapterResult = {
      status,
      stdout,
      stderr,
      outputs: [],
      artifacts,
      executionTimeMs: Date.now() - startedAt,
      warnings: [
        ...warnings,
        stdout.length >= this.config.maxStdoutBytes ? "stdout 已按最大长度截断。" : undefined,
        stderr.length >= this.config.maxStderrBytes ? "stderr 已按最大长度截断。" : undefined,
        status === "timeout" ? "Python 执行超时，进程已终止。" : undefined,
        status === "cancelled" ? "Python 执行已取消。" : undefined,
      ].filter((value): value is string => Boolean(value)),
    };
    if (this.config.cleanupSandboxOnSuccess && status === "success") {
      await this.sandboxPolicy.cleanup(paths);
    }
    return result;
  }

  cancel(executionId: string) {
    this.processes.get(executionId)?.kill("SIGTERM");
  }
}

function appendLimited(current: string, next: string, maxBytes: number) {
  const combined = `${current}${next}`;
  if (Buffer.byteLength(combined, "utf8") <= maxBytes) {
    return combined;
  }
  return combined.slice(0, maxBytes);
}
