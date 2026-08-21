# Task: SQL Temp Source Alias Repair

- Status: completed
- Owner: human + agent
- Started: 2026-08-20
- Completed: 2026-08-20

## Goal

Ensure SQL generated for a selected temporary CSV always references its verified SQLite table instead of treating the injected `T1` alias as a table.

## Scope

- Reduce SQL execution context to the verified table, fields, query skeleton, and current step.
- Repair the narrow `FROM T1` alias-as-source mistake for a single selected temporary source.
- Add focused tests for context selection and SQL rewriting.

## Non-goals

- Changing SQL permissions, read-only enforcement, data-source selection, or tool execution semantics.
- Rewriting arbitrary model-generated table names.

## Constraints

- Never switch to an unselected data source.
- Preserve model-generated projections and filters.
- Keep unknown or ambiguous table references rejected.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/sqliteSqlRewrite.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- Focused tests for those modules

## Invariants

- SQL remains a single read-only statement and is audited normally.
- Temporary source authorization remains enforced.
- Alias repair is allowed only when exactly one temporary source is selected.

## Implementation Plan

1. Confirm the failing model output shape and selected source from local logs.
2. Remove redundant built-in Skill content from verified SQL parameter context.
3. Add a narrow top-level `FROM T1` source rewrite and apply it before source validation.
4. Run focused tests, type checking, `git diff --check`, and a design review.

## Acceptance Criteria

- `SELECT * FROM T1;` is safely rewritten to the sole selected temporary table with `T1` retained as its alias.
- SQL that names an unknown table is not rewritten.
- Verified SQL contexts do not include full system Skill instructions.
- Existing structure and source validation continue to run after rewriting.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/sqliteSqlRewrite.test.ts src/main/assistantRuntime.test.ts`: 62 tests passed.
- `pnpm --dir apps/desktop exec vitest run src/main/assistantDualModelRuntime.test.ts -t "repairs an execution-model FROM T1 source"`: focused integration test passed.
- `pnpm --dir apps/desktop typecheck`: passed.
- `git diff --check`: passed.
- Restored `better-sqlite3` to the Electron ABI with `pnpm --dir apps/desktop native:rebuild` after Node-based integration testing.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

The repair stays in the SQL normalization boundary, uses the already verified selected source, and runs before the existing structure and authorization checks. It does not accept arbitrary source substitutions or bypass read-only execution controls.

## Outcome

Local logs showed two consecutive 17-character SQL outputs, consistent with `SELECT * FROM T1;`, while the selected source and verified skeleton contained the real temporary table. SQL execution now omits redundant system Skill content when verified fields are available, explicitly tells the model that `T1` is only an alias, and deterministically repairs this narrow alias-as-source output for one selected temporary source. The focused dual-model test confirms execution completes with one parameter request and no repair-model retry.

## Follow-up

None.
