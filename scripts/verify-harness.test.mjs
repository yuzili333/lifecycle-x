import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatHarnessResult, verifyHarness } from "./verify-harness.mjs";

const requiredFiles = [
  "AGENTS.md",
  "README.md",
  "docs/README.md",
  "docs/repo-map.md",
  "docs/architecture/overview.md",
  "docs/architecture/boundaries.md",
  "docs/decisions/README.md",
  "docs/decisions/ADR-000-template.md",
  "docs/work/README.md",
  "docs/work/task-template.md",
  "docs/quality/design-review.md",
  "docs/quality/refactor-checkpoint.md",
  "scripts/verify-project.mjs",
  "apps/desktop/src/main/index.ts",
  "apps/desktop/src/main/assistantRuntime.ts",
  "apps/desktop/src/main/workflowRuntime.ts",
  "apps/desktop/src/preload/index.ts",
  "apps/server/src/dataManagementStore.ts",
];

const requiredDirectories = [
  "docs/work/active",
  "docs/work/completed",
  "apps/desktop/src/main/agentOrchestration",
  "apps/desktop/src/main/toolOrchestration",
  "apps/desktop/src/renderer/src",
  "apps/desktop/src/shared/visualization",
  "apps/server/src/sqlTool",
  "apps/server/src/pythonRunner",
];

const activeTask = `# Task: Fixture

- Status: active
- Owner: human + agent
- Started: 2026-07-23

## Goal
Fixture.
## Scope
Fixture.
## Non-goals
Fixture.
## Constraints
Fixture.
## Affected Areas
Fixture.
## Invariants
Fixture.
## Implementation Plan
Fixture.
## Acceptance Criteria
Fixture.
## Verification
Fixture.
## Design Review
Fixture.
## Outcome
Fixture.
## Follow-up
Fixture.
`;

const adrTemplate = `# ADR-NNN: Decision Title

- Status: Proposed | Accepted | Superseded
- Date: YYYY-MM-DD

## Context
Fixture.
## Decision
Fixture.
## Consequences
Fixture.
## Alternatives Considered
Fixture.
## Follow-up
Fixture.
`;

function write(root, path, content = "# Fixture\n") {
  const absolutePath = join(root, path);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lifecycle-x-harness-"));
  for (const directory of requiredDirectories) mkdirSync(join(root, directory), { recursive: true });
  for (const file of requiredFiles) write(root, file);
  write(root, "AGENTS.md", "[Map](docs/repo-map.md)\n");
  write(root, "docs/work/task-template.md", activeTask);
  write(root, "docs/decisions/ADR-000-template.md", adrTemplate);
  write(root, "docs/work/active/2026-07-23-fixture.md", activeTask);
  write(root, "package.json", JSON.stringify({
    scripts: {
      "harness:check": "node scripts/verify-harness.mjs",
      "harness:test": "node --test scripts/verify-harness.test.mjs",
      "verify:fast": "pnpm harness:check",
      verify: "pnpm verify:fast",
    },
  }));
  return root;
}

function withFixture(run) {
  const root = fixture();
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts the minimum valid Harness structure", () => {
  withFixture((root) => assert.deepEqual(verifyHarness(root), []));
});

test("reports a missing critical file without exposing the fixture absolute path", () => {
  withFixture((root) => {
    rmSync(join(root, "docs/repo-map.md"));
    const output = formatHarnessResult(verifyHarness(root));
    assert.match(output, /Missing required path: docs\/repo-map\.md/);
    assert.equal(output.includes(root), false);
  });
});

test("detects a broken relative Markdown link", () => {
  withFixture((root) => {
    write(root, "docs/README.md", "[Missing](architecture/missing.md)\n");
    assert.match(formatHarnessResult(verifyHarness(root)), /broken link "architecture\/missing\.md"/);
  });
});

test("validates the structure of active task records", () => {
  withFixture((root) => {
    write(root, "docs/work/active/2026-07-23-fixture.md", "# Task: Incomplete\n\n- Status: active\n");
    const output = formatHarnessResult(verifyHarness(root));
    assert.match(output, /missing task Owner/);
    assert.match(output, /missing "## Acceptance Criteria"/);
  });
});

test("validates task and ADR template headings", () => {
  withFixture((root) => {
    write(root, "docs/decisions/ADR-000-template.md", "# ADR-NNN: Incomplete\n");
    assert.match(formatHarnessResult(verifyHarness(root)), /ADR-000-template\.md: missing "## Decision"/);
  });
});

test("rejects absolute local links without printing the sensitive target", () => {
  withFixture((root) => {
    write(root, "docs/README.md", "[Local](/private-example.md)\n");
    const output = formatHarnessResult(verifyHarness(root));
    assert.match(output, /absolute local link is not portable/);
    assert.equal(output.includes("/private-example.md"), false);
  });
});
