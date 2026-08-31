import { deflateRawSync } from "node:zlib";

const ROOT_FILES = new Set([
  ".gitignore",
  ".npmrc",
  "AGENTS.md",
  "README.md",
  "eslint.config.mjs",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
]);

const REVIEW_SCRIPTS = new Set([
  "scripts/check-worktree.mjs",
  "scripts/dev-project.mjs",
  "scripts/doctor.mjs",
  "scripts/setup-project.mjs",
  "scripts/test-project.mjs",
  "scripts/verify-harness.mjs",
  "scripts/verify-harness.test.mjs",
  "scripts/verify-project.mjs",
  "scripts/review-tooling.test.mjs",
  "scripts/submission-package.mjs",
  "scripts/submission-package.test.mjs",
  "scripts/lib/runtime-platform.mjs",
  "scripts/lib/submission-package.mjs",
]);

const STABLE_DOCS = new Set([
  "docs/README.md",
  "docs/repo-map.md",
  "docs/architecture/boundaries.md",
  "docs/architecture/overview.md",
  "docs/architecture/thinking-optimization.md",
  "docs/decisions/README.md",
  "docs/decisions/ADR-000-template.md",
  "docs/decisions/ADR-001-report-evidence-card-artifact.md",
  "docs/quality/design-review.md",
  "docs/quality/refactor-checkpoint.md",
  "docs/verification/thinking-optimization-validation.md",
  "docs/work/README.md",
  "docs/work/task-template.md",
  "docs/work/active/.gitkeep",
  "docs/work/completed/.gitkeep",
]);

export function isSubmissionPath(path) {
  return ROOT_FILES.has(path)
    || path.startsWith("apps/desktop/")
    || path.startsWith("apps/server/")
    || path.startsWith("skill/")
    || path === "de-identified-data/信贷风险.csv"
    || path.startsWith("docs/review/")
    || STABLE_DOCS.has(path)
    || REVIEW_SCRIPTS.has(path);
}

export function validateArchivePath(path) {
  if (!path || path.startsWith("/") || path.startsWith("\\") || path.includes("\\")) {
    throw new Error(`Unsafe archive path: ${path}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe archive path: ${path}`);
  }
}

export function scanSubmissionText(path, text) {
  const issues = [];
  const isTestFixture = /(?:\.test\.[cm]?[jt]sx?|scripts\/.*\.test\.mjs)$/.test(path);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) issues.push("private-key");
  if (/\/Users\/(?!example(?:\/|\b))[^/\s"']+/.test(text)) issues.push("personal-macos-path");
  if (/[A-Z]:\\Users\\(?!example(?:\\|\b))[^\\\s"']+/i.test(text)) issues.push("personal-windows-path");
  if (!isTestFixture && /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(text)) issues.push("bearer-token");
  if (!isTestFixture && /\b(?:api[_-]?key|token|secret)\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{20,}["']/i.test(text)) issues.push("credential-like-value");
  if (!isTestFixture && /\b(?:mysql|postgres(?:ql)?):\/\/[^\s/:]+:[^\s/@]+@/i.test(text)) issues.push("credentialed-connection-string");
  return issues;
}

export function normalizeLicenseReport(report) {
  return Object.entries(report)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, packages]) => ({
      license,
      packages: packages
        .map(({ paths: _paths, ...item }) => item)
        .sort((left, right) => left.name.localeCompare(right.name)),
    }));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { day, time };
}

export function createZip(entries, timestamp = new Date("2026-01-01T00:00:00Z")) {
  if (entries.length >= 65_535) throw new Error("ZIP entry limit exceeded.");
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const { day, time } = dosDateTime(timestamp);

  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    validateArchivePath(entry.path);
    const name = Buffer.from(entry.path, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
