import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createZip, isSubmissionPath, normalizeLicenseReport, scanSubmissionText, validateArchivePath } from "./lib/submission-package.mjs";
import { packageManagerCommand } from "./lib/runtime-platform.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = resolve(rootDir, "artifacts/review");
const maxArchiveBytes = 20 * 1024 * 1024;
const productVersion = "0.1.0";
const archiveRoot = `sujudata-source-${productVersion}`;

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: options.encoding,
    maxBuffer: 50 * 1024 * 1024,
  });
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

const dirty = git(["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim();
if (dirty) {
  throw new Error("Submission packaging requires a clean committed HEAD. Commit or stash the review release changes first.");
}

const commit = git(["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const shortCommit = commit.slice(0, 8);
const commitDate = new Date(git(["show", "-s", "--format=%cI", "HEAD"], { encoding: "utf8" }).trim());
const tree = git(["ls-tree", "-r", "-z", "HEAD"]);
const sourceEntries = [];
const fileManifest = [];

for (const rawEntry of tree.toString("utf8").split("\0").filter(Boolean)) {
  const match = rawEntry.match(/^(\d+)\s+blob\s+([0-9a-f]+)\t(.+)$/s);
  if (!match) continue;
  const [, mode, objectId, path] = match;
  if (!isSubmissionPath(path)) continue;
  validateArchivePath(path);
  if (mode === "120000") throw new Error(`Symlinks are not allowed in the submission: ${path}`);
  const data = git(["cat-file", "blob", objectId]);
  if (!data.includes(0)) {
    const issues = scanSubmissionText(path, data.toString("utf8"));
    if (issues.length > 0) throw new Error(`Sensitive content in ${path}: ${issues.join(", ")}`);
  }
  sourceEntries.push({ path: `${archiveRoot}/${path}`, data });
  fileManifest.push({ path, bytes: data.length, sha256: sha256(data) });
}

const requiredPaths = ["README.md", "package.json", "apps/desktop/package.json", "apps/server/package.json", "docs/review/deployment.md"];
for (const path of requiredPaths) {
  if (!fileManifest.some((entry) => entry.path === path)) throw new Error(`Required review file is missing from HEAD: ${path}`);
}

const licenseRaw = execFileSync(packageManagerCommand(), ["licenses", "list", "--prod", "--json"], {
  cwd: rootDir,
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
});
const licenses = normalizeLicenseReport(JSON.parse(licenseRaw));
const licenseData = Buffer.from(`${JSON.stringify(licenses, null, 2)}\n`);
sourceEntries.push({ path: `${archiveRoot}/THIRD_PARTY_LICENSES.json`, data: licenseData });

const verificationStatusEntry = sourceEntries.find((entry) => entry.path === `${archiveRoot}/docs/review/verification-status.json`);
if (!verificationStatusEntry) throw new Error("docs/review/verification-status.json is required.");
const platformValidation = JSON.parse(verificationStatusEntry.data.toString("utf8"));
const packageManifest = {
  schemaVersion: 1,
  product: "溯据",
  version: productVersion,
  commit,
  generatedAt: new Date().toISOString(),
  lockfileSha256: fileManifest.find((entry) => entry.path === "pnpm-lock.yaml")?.sha256,
  platformValidation,
  files: fileManifest.sort((left, right) => left.path.localeCompare(right.path)),
};
sourceEntries.push({ path: `${archiveRoot}/PACKAGE-MANIFEST.json`, data: Buffer.from(`${JSON.stringify(packageManifest, null, 2)}\n`) });

const archive = createZip(sourceEntries, commitDate);
if (archive.length > maxArchiveBytes) throw new Error(`Archive is ${(archive.length / 1024 / 1024).toFixed(2)} MB; maximum is 20 MB.`);

mkdirSync(outputDir, { recursive: true });
const archiveName = `sujudata-source-${productVersion}-${shortCommit}.zip`;
const archivePath = resolve(outputDir, archiveName);
writeFileSync(archivePath, archive);
const archiveHash = sha256(archive);
writeFileSync(resolve(outputDir, "SHA256SUMS.txt"), `${archiveHash}  ${archiveName}\n`);
writeFileSync(resolve(outputDir, "RELEASE-MANIFEST.json"), `${JSON.stringify({
  ...packageManifest,
  archive: { name: archiveName, bytes: archive.length, sha256: archiveHash },
  thirdPartyLicenseGroups: licenses.length,
}, null, 2)}\n`);

console.log(`Created ${archiveName}`);
console.log(`Size: ${(archive.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`SHA-256: ${archiveHash}`);
