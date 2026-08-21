# Task: SQL Detail Parameter Generation

- Status: completed
- Owner: human + agent
- Started: 2026-08-17

## Goal

Prevent composite Skill runs from failing before SQL execution because the SQL parameter model receives report aggregation instructions or the local aggregate detector mistakes quoted text for SQL syntax.

## Scope

- Scope SQL-stage Skill context to field binding and detail-row retrieval.
- Keep full Skill analysis and report instructions in their owning Python and report stages.
- Make aggregate detection ignore comments, quoted identifiers, and string literals.
- Add focused regression coverage.

## Non-goals

- Change SQL safety rules or database execution behavior.
- Change planner step ordering.
- Run the full regression suite or interactive page verification.

## Constraints

- SQL remains a read-only detail retrieval tool for composite analysis runs.
- Python remains responsible for statistics and aggregation.
- No source data or full generated SQL is added to diagnostic logs.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantRuntime.test.ts`

## Invariants

- Actual aggregate SQL is still rejected for composite query-and-analysis tasks.
- Explicit user requests for SQL-side aggregation remain supported.
- SQL context retains the real input Schema and data source Schema.

## Implementation Plan

1. Separate common Skill metadata from full Skill instructions.
2. Omit full analysis/report instructions from SQL parameter generation context.
3. Replace regex-only SQL preprocessing with syntax-aware masking.
4. Add focused tests and run desktop type checking.
5. Complete the independent design review.

## Acceptance Criteria

- SQL-stage context contains input field roles but not full Skill analysis/report instructions.
- Quoted field names and filter values containing aggregate keywords are not rejected.
- Real `GROUP BY`, aggregate functions, and `SELECT DISTINCT` remain rejected.
- Focused tests and desktop type checking pass.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts` passed: 48 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- `git diff --check` passed.
- The package-level desktop test command also ran the broader main-process suite; the focused tests passed, while 33 unrelated SQLite-backed tests could not start because the installed `better-sqlite3` Electron ABI (`NODE_MODULE_VERSION 130`) does not match the current Node test ABI (`137`).

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The latest failed run was stopped by the local composite-analysis business rule before any SQL tool call or database execution. SQL parameter generation had received the complete Skill instructions, including downstream aggregation and report requirements, and generated aggregate SQL twice. SQL-stage Skill context now contains only metadata, the input field-role Schema, and an explicit detail-query contract. Aggregate detection now masks quoted identifiers, string literals, and comments before inspecting SQL syntax, preventing false positives without weakening the aggregate boundary.

## Follow-up

The diagnostic log intentionally stores SQL parameter shape rather than full SQL text, so future investigations can identify the validation layer and aggregate classification but cannot reconstruct sensitive query text from logs.
