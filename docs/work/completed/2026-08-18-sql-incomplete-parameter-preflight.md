# Task: SQL Incomplete Parameter Preflight

- Status: completed
- Owner: human + agent
- Started: 2026-08-18

## Goal

Prevent incomplete model-generated SQL such as `SELECT T1.``` from entering approval and execution, and repair it once through the existing execution-model path.

## Scope

- Add deterministic SQL structure checks for empty quoted identifiers and incomplete qualified names.
- Require SQL for a selected temporary CSV source to reference that selected source.
- Run SQLite prepare preflight for every selected temporary CSV query before approval.
- Add focused regression tests and tighten the SQL execution prompt.

## Non-goals

- Replacing the SQLite parser or changing server SQL execution semantics.
- Adding a local generated SQL fallback.
- Running full regression or interactive page verification.

## Constraints

- SQL remains read-only, permission-controlled, and audited.
- Invalid SQL must not create a pending approval tool call.
- A failed preflight may request one model parameter repair but may not fabricate a query.

## Affected Areas

- `apps/desktop/src/main/sqliteSqlRewrite.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- Focused desktop tests

## Invariants

- The selected data source is never silently replaced.
- Parameter validation remains local and deterministic.
- Valid persistent database SQL continues through the existing server-side validation path.

## Implementation Plan

1. Reproduce the failure from local tool logs and document the exact malformed SQL.
2. Add structural validation and selected-source checks before approval.
3. Reuse the existing SQL preflight repair path and clarify prompt constraints.
4. Run focused tests, desktop typecheck, `git diff --check`, and design review.

## Acceptance Criteria

- `SELECT T1.``` is rejected before approval.
- A selected temporary CSV query must reference its actual SQLite table.
- Corrected SQL executes after one model repair.
- Valid SQL behavior and approval flow remain unchanged.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/sqliteSqlRewrite.test.ts src/main/assistantRuntime.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts` passed: 3 files, 77 tests.
- `pnpm --dir apps/desktop exec vitest run src/main/assistantDualModelRuntime.test.ts -t "repairs incomplete SQL before creating a temporary CSV tool call"` passed after temporarily rebuilding `better-sqlite3` for the Node test ABI.
- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- `git diff --check` passed.
- `node ./scripts/rebuild-native-deps.mjs` restored the Electron native dependency ABI after the integration test.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Local logs showed the execution model returned valid tool-call JSON but only a 12-character SQL value, `SELECT T1.```. The prior non-empty-string schema check accepted it, and temporary-source preflight was conditional on the malformed script already naming the source. SQL structure and selected-source validation now run deterministically before approval; temporary CSV SQL always receives SQLite prepare preflight and one existing model repair attempt. No local SQL is fabricated.

## Follow-up

None identified.
