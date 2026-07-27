import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import extract from "extract-zip";
import type { ValidatedSkillPackage } from "./SkillPackageValidator";
import { fileSize, validateSkillDirectory } from "./SkillPackageValidator";
import { SkillError, skillError } from "./SkillError";

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 50;
const ALLOWED_EXTENSIONS = new Set([".md", ".json", ".yaml", ".yml", ".txt"]);

export class SkillPackageInstaller {
  constructor(private readonly stagingRoot: string) {}

  async stageAndValidate(zipPath: string, traceId: string): Promise<{
    stagingDirectory: string;
    package: ValidatedSkillPackage;
  }> {
    if (extname(zipPath).toLowerCase() !== ".zip" || await fileSize(zipPath) > MAX_ARCHIVE_BYTES) {
      throw unsafe("Skill 安装包必须是 10 MB 以内的 ZIP 文件。", traceId);
    }

    const stagingDirectory = resolve(this.stagingRoot, traceId);
    await mkdir(stagingDirectory, { recursive: false });
    let fileCount = 0;
    let totalBytes = 0;
    try {
      await extract(zipPath, {
        dir: stagingDirectory,
        onEntry: (entry) => {
          const entryName = entry.fileName.replace(/\\/g, "/");
          const target = resolve(stagingDirectory, entryName);
          const targetRelative = relative(stagingDirectory, target);
          if (
            !entryName ||
            entryName.includes("\0") ||
            isAbsolute(entryName) ||
            targetRelative.startsWith("..") ||
            isAbsolute(targetRelative)
          ) {
            throw unsafe("Skill 安装包包含越界路径。", traceId);
          }
          const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
          if ((unixMode & 0o170000) === 0o120000) {
            throw unsafe("Skill 安装包禁止包含符号链接。", traceId);
          }
          if (entryName.endsWith("/")) return;
          fileCount += 1;
          totalBytes += entry.uncompressedSize;
          if (
            fileCount > MAX_FILES ||
            totalBytes > MAX_EXTRACTED_BYTES ||
            !ALLOWED_EXTENSIONS.has(extname(entryName).toLowerCase())
          ) {
            throw unsafe("Skill 安装包超过安全限制或包含不支持的文件。", traceId);
          }
        },
      });
      const packageRoot = await locatePackageRoot(stagingDirectory, traceId);
      const validated = await validateSkillDirectory({
        root: packageRoot,
        origin: "personal",
        traceId,
      });
      return { stagingDirectory, package: validated };
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      if (!(error instanceof SkillError)) {
        throw unsafe("Skill 安装包损坏或无法解压。", traceId);
      }
      throw error;
    }
  }

  async cleanup(stagingDirectory: string) {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

async function locatePackageRoot(stagingDirectory: string, traceId: string) {
  const rootEntries = await readdir(stagingDirectory, { withFileTypes: true });
  if (rootEntries.some((entry) => entry.isFile() && entry.name === "manifest.json")) {
    return stagingDirectory;
  }

  const meaningfulEntries = rootEntries.filter((entry) => entry.name !== "__MACOSX");
  if (meaningfulEntries.length !== 1 || !meaningfulEntries[0].isDirectory()) {
    throw skillError({
      code: "SKILL_PACKAGE_INCOMPLETE",
      message: "ZIP 根目录或唯一顶层目录中必须包含 manifest.json。",
      operation: "install",
      traceId,
    });
  }
  const candidate = resolve(stagingDirectory, meaningfulEntries[0].name);
  const details = await lstat(candidate);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw unsafe("Skill 安装包顶层目录不合法。", traceId);
  }
  const candidateEntries = await readdir(candidate);
  if (!candidateEntries.includes("manifest.json")) {
    throw skillError({
      code: "SKILL_PACKAGE_INCOMPLETE",
      message: "Skill 安装包缺少 manifest.json。",
      operation: "install",
      traceId,
    });
  }
  return candidate;
}

function unsafe(message: string, traceId: string) {
  return skillError({
    code: "SKILL_PACKAGE_UNSAFE",
    message,
    operation: "install",
    traceId,
  });
}
