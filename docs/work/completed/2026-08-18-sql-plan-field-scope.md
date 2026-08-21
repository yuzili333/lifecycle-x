# Task: SQL Plan Field Scope

- Status: completed
- Owner: human + agent
- Started: 2026-08-18

## Goal

Ensure SQL parameter generation receives and uses the task-specific real table and fields already confirmed by the reasoning plan and selected CSV Schema.

## Scope

- Resolve an execution scope by intersecting `AnalysisPlan.requiredData` and selected field references with the selected temporary CSV Schema.
- Add a compact, verified table and field list to the SQL execution-model context.
- Reject SQL that omits verified required fields before approval, while allowing explicit `SELECT *` queries.
- Add focused unit and dual-model regression tests.

## Non-goals

- Generating SQL locally or weakening SQL structure validation.
- Hard-coding Skill-specific physical field names.
- Removing the full table Schema from model context.
- Running full regression or interactive page verification.

## Constraints

- Real temporary CSV Schema remains the source of truth for table and field existence.
- Invalid SQL creates no approval or tool call record.
- The execution model remains responsible for SQL construction.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- SQL execution and dual-model focused tests

## Invariants

- Full Schema context remains available according to the existing field upload policy.
- Selected data sources are not silently replaced.
- SQL remains read-only, audited, and permission controlled.

## Implementation Plan

1. Reproduce the two failed parameter attempts from local model observations.
2. Resolve a locally verified task-specific SQL field scope.
3. Inject the compact scope into execution context and enforce it before approval.
4. Run focused tests, desktop typecheck, `git diff --check`, and design review.

## Acceptance Criteria

- The latest task resolves the real CSV table and four required fields from the analysis plan.
- SQL generation context includes exact quoted references for those fields.
- SQL with an empty identifier or omitted required field is rejected before approval.
- Corrected SQL creates one successful tool record.

## Verification

- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/sqliteSqlRewrite.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts` passed: 3 files, 78 tests.
- `pnpm --dir apps/desktop exec vitest run src/main/assistantDualModelRuntime.test.ts -t "repairs incomplete SQL before creating a temporary CSV tool call"` passed for dynamic routing, AnalysisPlan field scope, one repair, and final SQL execution.
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

The latest run contained the correct table and four fields in both the full CSV Schema and `AnalysisPlan.requiredData`, but the execution model produced two incomplete SQL parameters. The runtime now intersects plan and selected fields with the real temporary CSV Schema, injects a compact exact-reference scope near the SQL output constraint, and verifies those fields are present before approval. The full 80-field Schema remains in context and the model still constructs the SQL.

## Follow-up

None identified.
