import { describe, expect, it } from "vitest";
import {
  WORKBENCH_ROUTE_HASH,
  canAccessWorkbenchRoute,
  fallbackWorkbenchRoute,
  parseWorkbenchRoute,
} from "../renderer/src/workbench-route";

describe("workbench route", () => {
  const allPermissions = ["analysis:read", "datasource:read"];

  it("parses supported hashes", () => {
    expect(parseWorkbenchRoute("#/home", allPermissions)).toBe("home");
    expect(parseWorkbenchRoute("#/database", allPermissions)).toBe("database");
  });

  it("falls back from empty and unknown hashes", () => {
    expect(parseWorkbenchRoute("", allPermissions)).toBe("home");
    expect(parseWorkbenchRoute("#/csv", allPermissions)).toBe("home");
  });

  it("uses the first permitted route", () => {
    expect(fallbackWorkbenchRoute(["datasource:read"])).toBe("database");
    expect(parseWorkbenchRoute("#/home", ["datasource:read"])).toBe("database");
    expect(parseWorkbenchRoute("#/database", ["analysis:read"])).toBe("home");
  });

  it("exposes stable route hashes and permission checks", () => {
    expect(WORKBENCH_ROUTE_HASH).toEqual({
      home: "#/home",
      database: "#/database",
    });
    expect(canAccessWorkbenchRoute("home", ["analysis:read"])).toBe(true);
    expect(canAccessWorkbenchRoute("database", [])).toBe(false);
  });
});
