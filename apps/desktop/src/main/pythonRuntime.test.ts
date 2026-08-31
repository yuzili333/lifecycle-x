import { describe, expect, it } from "vitest";
import { resolvePythonExecutable, restrictedPythonEnvironment } from "./pythonRuntime";

describe("Python runtime selection", () => {
  it("uses documented defaults for macOS and Windows", () => {
    expect(resolvePythonExecutable({}, "darwin")).toBe("python3");
    expect(resolvePythonExecutable({}, "win32")).toBe("python.exe");
  });

  it("prefers the explicit executable and keeps only process-launch variables", () => {
    expect(resolvePythonExecutable({ LIFECYCLE_X_PYTHON: " C:\\Python311\\python.exe " }, "win32")).toBe("C:\\Python311\\python.exe");
    expect(restrictedPythonEnvironment({ PATH: "/bin", SYSTEMROOT: "C:\\Windows", API_KEY: "secret" })).toEqual({
      PATH: "/bin",
      SYSTEMROOT: "C:\\Windows",
    });
  });
});
