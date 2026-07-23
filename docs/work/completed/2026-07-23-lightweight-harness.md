# Task: Lightweight Harness Engineering

- Status: completed
- Owner: human + agent
- Started: 2026-07-23

## Goal

Make the repository the durable source for structure, constraints, non-trivial
work, decisions, and verification without changing business behavior.

## Scope

Add concise repository navigation, architecture boundaries, ADR and work
records, quality checkpoints, shared verification commands, a lightweight
Harness verifier, and one completed workflow exercise.

## Non-goals

No business workflow refactor, multi-Agent scheduler, merge queue, background
garbage collector, quality scoring service, or Agent-specific technology stack.

## Constraints

Reuse pnpm, Node.js, ESLint, TypeScript, Vitest, and current package boundaries.
Do not add a dependency or duplicate existing topic documentation.

## Affected Areas

`AGENTS.md`, `README.md`, `docs/`, `scripts/`, and root `package.json`.

## Invariants

Existing desktop/server behavior and security boundaries remain unchanged.
Mechanical checks remain distinct from human design judgment.

## Implementation Plan

1. Audit repository documents, scripts, packages, tests, and runtime surfaces.
2. Add navigation, stable boundaries, record templates, and quality checks.
3. Implement and test `harness:check`.
4. Run a small work-record exercise.
5. Execute repository verification and independent design review.

## Acceptance Criteria

- All P0 Harness files and directories exist and link to real paths.
- `harness:check`, `verify:fast`, and `verify` are executable root scripts.
- The verifier detects missing files, broken links, and malformed active tasks.
- One task completes the active-to-completed lifecycle.
- Existing project checks complete without business code changes.

## Verification

- `pnpm verify:fast`: passed; ESLint reported 0 errors and 13 existing Hooks warnings.
- Initial `pnpm verify`: exposed the existing Electron/Node `better-sqlite3`
  ABI transition requirement before tests could initialize.
- `pnpm verify` through the restore-safe entry: passed 291 desktop tests and
  77 server tests, then built both workspace applications.
- `node --test scripts/verify-harness.test.mjs`: passed all six positive and
  negative Harness cases.
- `git diff --check`: passed.
- `better-sqlite3` was restored to the Electron ABI after Node-based tests.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Refactor Checkpoint

- Inspected duplicate documentation, script responsibility, path handling,
  failure cleanup, stale inputs, and accidental business changes.
- Kept the verifier on Node standard library APIs and rejected additional
  parsing or workflow dependencies.
- Retained existing topic documents and requirement inputs; no file was deleted
  without evidence that it was stale and redundant.
- Accepted three focused scripts: Harness validation, its tests, and full
  verification with native ABI restoration.

## Outcome

Before this task, the root README contained an incomplete module list and there
was no root Agent map, repository map, stable boundary document, ADR mechanism,
task lifecycle, design review, refactor checkpoint, or shared verification
entry.

The repository now records those facts and workflows under `AGENTS.md` and
`docs/`. `harness:check` validates required paths, links, package scripts,
templates, and active tasks. `verify:fast` composes the existing mechanical
checks. `verify` adds full tests/builds and safely restores the Electron native
module ABI. A small desktop README task completed the active-to-completed
exercise without changing business code.

## Follow-up

- The existing 13 React Hooks lint warnings remain; fixing them is unrelated to
  this documentation and verification task.
- Automated import-boundary and circular-dependency checks are not currently
  configured. Add one only when a concrete boundary regression justifies it.
- Existing `goal/` and `plan/` inputs were not bulk archived. Review individual
  files only when evidence shows they are stale or duplicated.
- No CI integration was added because the repository has no existing CI and
  local commands satisfy the current single-developer workflow.
