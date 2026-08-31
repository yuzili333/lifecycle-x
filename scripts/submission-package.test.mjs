import assert from "node:assert/strict";
import test from "node:test";
import {
  createZip,
  isSubmissionPath,
  normalizeLicenseReport,
  scanSubmissionText,
  validateArchivePath,
} from "./lib/submission-package.mjs";

test("uses a narrow source-review allowlist", () => {
  assert.equal(isSubmissionPath("apps/desktop/src/main/index.ts"), true);
  assert.equal(isSubmissionPath("docs/review/deployment.md"), true);
  assert.equal(isSubmissionPath("de-identified-data/信贷风险.csv"), true);
  assert.equal(isSubmissionPath("prototype/BRD.md"), false);
  assert.equal(isSubmissionPath("output/hackathon-video/master.mp4"), false);
  assert.equal(isSubmissionPath("docs/work/completed/internal.md"), false);
});

test("rejects traversal, symlinks at the caller, secrets and personal paths", () => {
  assert.throws(() => validateArchivePath("../secret"));
  assert.throws(() => validateArchivePath("C:\\Users\\person\\secret"));
  assert.deepEqual(scanSubmissionText("src/config.ts", "-----BEGIN " + "PRIVATE KEY-----"), ["private-key"]);
  assert.deepEqual(scanSubmissionText("src/config.ts", "open('/Users/" + "person/private.csv')"), ["personal-macos-path"]);
  assert.deepEqual(scanSubmissionText("src/test.test.ts", "const apiKey = 'synthetic-test-value-123456'"), []);
});

test("removes local dependency paths from the license report", () => {
  const report = normalizeLicenseReport({ MIT: [{ name: "demo", versions: ["1.0.0"], paths: ["/Users/" + "person/node_modules/demo"], license: "MIT" }] });
  assert.equal("paths" in report[0].packages[0], false);
});

test("creates a valid UTF-8 ZIP envelope", () => {
  const zip = createZip([{ path: "溯据/README.md", data: Buffer.from("ok") }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});
