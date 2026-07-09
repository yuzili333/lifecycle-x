import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import type { PythonArtifact, PythonRunnerModuleConfig } from "./types.js";

export class PythonArtifactManager {
  constructor(private readonly config: Pick<PythonRunnerModuleConfig, "maxArtifactCount" | "maxArtifactSizeBytes">) {}

  async collect(artifactsDir: string, runDir: string): Promise<{ artifacts: PythonArtifact[]; warnings: string[] }> {
    const warnings: string[] = [];
    const files = await readdir(artifactsDir).catch(() => []);
    if (files.length > this.config.maxArtifactCount) {
      warnings.push(`artifact 数量超过限制，仅收集前 ${this.config.maxArtifactCount} 个。`);
    }
    const artifacts: PythonArtifact[] = [];
    for (const fileName of files.slice(0, this.config.maxArtifactCount)) {
      const fullPath = join(artifactsDir, fileName);
      const fileStat = await stat(fullPath).catch(() => null);
      if (!fileStat?.isFile()) {
        continue;
      }
      if (fileStat.size > this.config.maxArtifactSizeBytes) {
        warnings.push(`artifact 超过大小限制，已忽略：${fileName}`);
        continue;
      }
      const { type, mimeType } = inferArtifactType(fileName);
      artifacts.push({
        artifactId: `py_art_${randomUUID()}`,
        name: fileName,
        type,
        mimeType,
        path: relative(runDir, fullPath),
        sizeBytes: fileStat.size,
        description: `Python 沙箱输出产物：${fileName}`,
        createdAt: new Date().toISOString(),
      });
    }
    return { artifacts, warnings };
  }
}

function inferArtifactType(fileName: string): Pick<PythonArtifact, "type" | "mimeType"> {
  const ext = extname(fileName).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(ext)) {
    return { type: "image", mimeType: ext === ".svg" ? "image/svg+xml" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png" };
  }
  if (ext === ".csv") {
    return { type: "csv", mimeType: "text/csv" };
  }
  if (ext === ".json") {
    return { type: "json", mimeType: "application/json" };
  }
  if (ext === ".html") {
    return { type: "html", mimeType: "text/html" };
  }
  if (ext === ".txt" || ext === ".log") {
    return { type: "text", mimeType: "text/plain" };
  }
  return { type: "text", mimeType: "application/octet-stream" };
}
