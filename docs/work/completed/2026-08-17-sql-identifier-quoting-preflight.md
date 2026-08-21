# Task: SQL Identifier Quoting Preflight

- Status: completed
- Owner: human + agent
- Started: 2026-08-17

## Goal

Prevent SQLite syntax failures caused by model-generated unquoted CSV identifiers such as `贷款余额(万元)` and detect remaining temporary-table SQL syntax errors before approval.

## Scope

- Quote exact table and column identifiers from selected temporary CSV Schema.
- Preserve quoted text, literals and comments during normalization.
- Prepare SQL that references selected temporary tables before creating approval records.
- Retry one SQL parameter generation when local syntax preflight still fails.
- Strengthen SQL parameter instructions and focused tests.

## Non-goals

- Rewrite arbitrary SQL expressions or business filters.
- Change SQL permissions, aggregation boundaries or execution semantics.
- Run full regression or page verification.

## Constraints

- Only identifiers proven by the selected source Schema may be rewritten.
- The exact normalized SQL is retained in the tool record and audit path.
- SQL remains single-statement and read-only.

## Affected Areas

- `apps/desktop/src/main/sqliteSqlRewrite.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- Focused tests.

## Invariants

- String literals and comments are never rewritten.
- Already quoted identifiers remain unchanged.
- Approval occurs only after local syntax preflight succeeds for selected temporary CSV tables.

## Implementation Plan

1. Add syntax-aware known-identifier quoting.
2. Apply normalization to model SQL for selected temporary CSV sources.
3. Add temporary-table prepare preflight and one repair path.
4. Strengthen model instructions and add focused tests.
5. Run targeted verification and design review.

## Acceptance Criteria

- `T1.贷款余额(万元)` becomes `T1."贷款余额(万元)"` before approval.
- Existing quoted fields, literals and comments are preserved.
- Invalid temporary-table SQL returns a parameter issue before approval and is retried once.
- Focused tests and desktop type checking pass.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/sqliteSqlRewrite.test.ts src/main/assistantRuntime.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts` passed: 75 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- `git diff --check` passed.
- The normalized form of the exact failed query executed successfully against the same local temporary CSV table and returned a sample row.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The failed SQL used `T1.贷款余额(万元)`, causing SQLite to parse the parenthesized unit as function syntax. SQL parameters are now normalized against the selected temporary CSV's actual table and column names before tool-call creation. The syntax-aware normalizer skips quoted identifiers, string literals and comments. Queries that reference a selected temporary table are then prepared locally without execution; remaining syntax errors enter one parameter-repair attempt before approval. SQL model descriptions now require double-quoted SQLite identifiers and include the exact parenthesized-field example.

## Follow-up

Known-identifier normalization currently uses selected conversation CSV Schema. Other database sources continue to rely on their injected Schema and the strengthened model contract because their tables are not mounted in the assistant SQLite database during parameter generation.
