# Task: Aggregate SQL Parameter Repair

- Status: completed
- Owner: human + agent
- Started: 2026-08-02

## Goal

Recover once when an execution model submits aggregate SQL for a composite task that requires detail rows for downstream Python analysis.

## Scope

- Detect the existing structured detail-SQL validation reason.
- Regenerate SQL parameters once before failing the step.
- Strengthen the execution tool description.
- Keep user guidance aligned with the actual plan.

## Non-goals

- Permit aggregate SQL where detail rows are required.
- Rewrite aggregate SQL locally.
- Change SQL safety, approval, or database execution.

## Constraints

- Retry only when no local tool call has been created.
- The corrected SQL must pass the same Schema, business, safety, and approval checks.
- Do not infer or fabricate fields.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- Focused tests

## Invariants

- SQL returns detail rows for composite analysis unless the user explicitly requests SQL aggregation.
- Python remains responsible for derived statistics in composite workflows.
- No duplicate SQL execution is possible.

## Implementation Plan

1. Expose deterministic recognition of the structured validation result.
2. Add one controlled SQL parameter repair attempt.
3. Strengthen execution instructions and update tests.
4. Run focused verification and design review.

## Acceptance Criteria

- Aggregate SQL rejected for detail-row analysis is regenerated once.
- Only the corrected SQL can enter approval and execution.
- Repeated invalid output fails clearly without looping.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantRuntime.test.ts`: passed, 47 tests.
- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/agentOrchestration/thinkingOptimization.test.ts`: passed, 20 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck`: passed.
- `git diff --check`: passed.
- The SQLite-backed orchestration test was added but could not reach assertions because `better-sqlite3` targets Electron ABI 130 while command-line Node requires ABI 137. The native module was not rebuilt to avoid disrupting the Electron development runtime.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The latest trace returned a valid SQL tool call that failed the existing detail-row business rule because it aggregated the sample before Python analysis. The orchestrator now recognizes the structured `sql_must_return_detail_rows_for_analysis` result and regenerates SQL once. Only a corrected request can create a local tool call and enter approval; repeated invalid output terminates without a loop.

## Follow-up

Run the new SQLite-backed orchestration test after the local native dependency is next rebuilt for the command-line Node ABI.
