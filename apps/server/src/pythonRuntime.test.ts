import { describe, expect, it } from "vitest";
import { resolvePythonExecutable } from "./pythonRuntime.js";

describe("resolvePythonExecutable", () => {
  it("uses platform defaults and an explicit override", () => {
    expect(resolvePythonExecutable({}, "darwin")).toBe("python3");
    expect(resolvePythonExecutable({}, "win32")).toBe("python.exe");
    expect(resolvePythonExecutable({ LIFECYCLE_X_PYTHON: " /opt/python3 " }, "darwin")).toBe("/opt/python3");
  });
});
