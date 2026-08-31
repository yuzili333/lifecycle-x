import assert from "node:assert/strict";
import test from "node:test";
import {
  npmCommand,
  packageManagerCommand,
  pythonCommand,
  supportedReviewPlatform,
} from "./lib/runtime-platform.mjs";

test("selects platform-specific executable names", () => {
  assert.equal(packageManagerCommand("win32"), "pnpm.cmd");
  assert.equal(packageManagerCommand("darwin"), "pnpm");
  assert.equal(npmCommand("win32"), "npm.cmd");
  assert.equal(pythonCommand({}, "win32"), "python.exe");
  assert.equal(pythonCommand({}, "darwin"), "python3");
});

test("honors an explicit Python executable", () => {
  assert.equal(pythonCommand({ LIFECYCLE_X_PYTHON: "C:\\Python311\\python.exe" }, "win32"), "C:\\Python311\\python.exe");
  assert.equal(pythonCommand({ LIFECYCLE_X_PYTHON: " /opt/python/bin/python3 " }, "darwin"), "/opt/python/bin/python3");
});

test("accepts only the documented review platforms", () => {
  assert.equal(supportedReviewPlatform("darwin", "arm64"), "macos-apple-silicon");
  assert.equal(supportedReviewPlatform("win32", "x64"), "windows-11-x64");
  assert.equal(supportedReviewPlatform("darwin", "x64"), null);
  assert.equal(supportedReviewPlatform("win32", "arm64"), null);
});
