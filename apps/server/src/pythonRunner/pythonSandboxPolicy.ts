import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PythonDatasetResolver, PythonRunnerModuleConfig } from "./types.js";

export type PythonSandboxPaths = {
  runDir: string;
  inputDir: string;
  outputDir: string;
  artifactsDir: string;
  scriptPath: string;
  metadataPath: string;
  stdoutPath: string;
  stderrPath: string;
};

export class PythonSandboxPolicy {
  constructor(private readonly config: Pick<PythonRunnerModuleConfig, "sandboxRootDir" | "datasetResolver">) {}

  async createRun(executionId: string) {
    const root = resolve(this.config.sandboxRootDir);
    const runDir = join(root, "runs", executionId);
    const paths: PythonSandboxPaths = {
      runDir,
      inputDir: join(runDir, "input"),
      outputDir: join(runDir, "output"),
      artifactsDir: join(runDir, "artifacts"),
      scriptPath: join(runDir, "script.py"),
      metadataPath: join(runDir, "metadata.json"),
      stdoutPath: join(runDir, "stdout.log"),
      stderrPath: join(runDir, "stderr.log"),
    };
    await mkdir(paths.inputDir, { recursive: true });
    await mkdir(paths.outputDir, { recursive: true });
    await mkdir(paths.artifactsDir, { recursive: true });
    return paths;
  }

  async writeScript(paths: PythonSandboxPaths, script: string) {
    await writeFile(paths.scriptPath, script, "utf8");
  }

  async writeMetadata(paths: PythonSandboxPaths, metadata: unknown) {
    await writeFile(paths.metadataPath, JSON.stringify(metadata, null, 2), "utf8");
  }

  async materializeDatasets(paths: PythonSandboxPaths, datasetResolver: PythonDatasetResolver, datasetIds: string[]) {
    const materialized = [];
    for (const datasetId of datasetIds) {
      const dataset = await datasetResolver.resolveDataset(datasetId);
      if (!dataset) {
        throw new Error(`PYTHON_DATASET_NOT_FOUND:${datasetId}`);
      }
      materialized.push(await dataset.materializeForSandbox({ targetDir: paths.inputDir, format: "csv" }));
    }
    return materialized;
  }

  buildSafeEnv(paths: PythonSandboxPaths) {
    return {
      PYTHONUNBUFFERED: "1",
      MPLBACKEND: "Agg",
      CYCLE_PROBE_SANDBOX: "1",
      CYCLE_PROBE_INPUT_DIR: "input",
      CYCLE_PROBE_OUTPUT_DIR: "output",
      CYCLE_PROBE_ARTIFACTS_DIR: "artifacts",
      HOME: paths.runDir,
      TMPDIR: paths.outputDir,
    };
  }

  async cleanup(paths: PythonSandboxPaths) {
    await rm(paths.runDir, { recursive: true, force: true });
  }
}
