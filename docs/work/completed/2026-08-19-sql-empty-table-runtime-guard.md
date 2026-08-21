# Task: SQL Empty Table Runtime Guard

- Status: completed
- Owner: human + agent
- Started: 2026-08-19

## Goal

Prevent model-generated SQL with an empty or unselected table identifier from reaching approval and failing as `no such table:`.

## Scope

- Audit the latest Agent Run, generated SQL and selected temporary data source.
- Separate minimum executable-target validation from optional built-in Skill parameter preflight.
- Reuse the existing bounded SQL correction flow for malformed table or field identifiers.
- Add focused runtime coverage for a system built-in Skill.

## Non-goals

- Do not restore aggregate, metric or full field-completeness preflight for system built-in Skills.
- Do not generate SQL locally or silently replace the model response.
- Do not change SQL approval or execution permissions.

## Constraints

The model remains responsible for corrected SQL generation. Invalid SQL must be rejected before a tool call enters approval.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`

## Invariants

- Empty identifiers never reach SQLite execution.
- Temporary CSV SQL references the currently selected source table.
- System Skills continue to bypass business-specific desktop parameter preflight.
- SQL remains read-only and permission controlled.

## Implementation Plan

1. Record the latest log and persisted-run evidence.
2. Apply minimum SQL structure and selected-source validation for every Skill origin.
3. Allow malformed system-Skill SQL to enter the existing bounded model repair path.
4. Run focused tests, desktop typecheck, diff check and design review.

## Acceptance Criteria

- `SELECT T1.`` FROM `` AS T1` is rejected before approval.
- A system built-in Skill receives one compact correction request containing the verified SQL skeleton.
- Only the corrected SQL creates and executes a tool call.

## Verification

- Latest local trace audit for message `optimistic-8e118932-ebca-424e-9ec0-47a3713ee36e`:
  - the persisted analysis plan correctly selected `chat_csv_e9726039_1787047090_b2098f8f` and four real fields
  - the model instead returned `SELECT T1.`` FROM `` AS T1`
  - the built-in Skill bypass path incorrectly logged `issueCount: 0` and created a pending tool call
  - SQLite then failed with `no such table:` even though the selected temporary table existed
- Focused Electron-runtime integration tests:
  - system Skill empty identifier and unselected table repair passed
  - existing verified-skeleton and reasoning-fallback repair passed
- `pnpm --dir apps/desktop exec vitest run src/main/sqliteSqlRewrite.test.ts src/main/assistantRuntime.test.ts --reporter=dot`
  - 61 tests passed
- `pnpm --filter @lifecycle-x/desktop typecheck`
  - passed
- `git diff --check`
  - passed

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

Independent re-read conclusion: minimum SQL executability checks now apply at the tool boundary where selected temporary sources are available. Business-specific preflight remains disabled for system Skills, so the change does not restore the over-strict validation removed earlier. Invalid model output is never rewritten locally; it is passed back through the bounded model correction path.

## Outcome

- Empty or unterminated identifiers are rejected before approval for every Skill origin.
- When temporary CSV sources are selected, SQL must reference at least one current selected table before approval.
- System Skills still bypass aggregate, field-completeness and local prepare preflight.
- The existing execution-model correction and reasoning-model fallback now also handle malformed system-Skill SQL.

## Follow-up

Monitor future `sql_syntax_preflight_failed` observations to distinguish model noncompliance from expired source metadata. No broader SQL parser or deterministic SQL generator is required for this fix.
