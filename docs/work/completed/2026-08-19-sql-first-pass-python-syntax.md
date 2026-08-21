# Task: SQL First Pass And Python Syntax

- Status: completed
- Owner: human + agent
- Started: 2026-08-19

## Goal

Improve first-pass SQL parameter generation for built-in Skills and prevent syntactically invalid generated Python from reaching execution.

## Scope

- Scope SQL Skill instructions to the current SQL tool responsibility section.
- Clarify that compact Python must remain valid multiline Python.
- Apply a minimum syntax-only Python executable guard to every generated script.
- Add focused regression coverage for prompt scoping and syntax repair.

## Non-goals

- Re-enable built-in Skill business parameter preflight.
- Change model token budgets, planner behavior, tool permissions, or Python business calculations.
- Run full regression or page interaction verification.

## Constraints

- Preserve the system Skill preflight bypass for business and contract rules.
- Keep SQL read-only and Python execution sandboxed.
- Do not expose source data or generated scripts in logs.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `skill/guarantee-method-risk-distribution-report/`
- Focused desktop tests

## Invariants

- SQL receives only verified real table and field identifiers.
- Python still reads controlled stdin and emits one JSON result.
- Built-in Skills are not subjected to field, import-count, length, or business-contract preflight.

## Implementation Plan

1. Add stage-scoped SQL Skill instruction extraction.
2. Add explicit multiline Python generation rules.
3. Run syntax-only validation for generated Python regardless of Skill origin.
4. Permit one syntax repair after a high-reliability parameter fallback.
5. Run focused tests, type checking, diff check, and design review.

## Acceptance Criteria

- SQL execution context contains the Skill SQL responsibility and excludes unrelated input Schema and Python/report instructions.
- Generated one-line compound Python is rejected before tool creation.
- A built-in Skill can repair that syntax error once without enabling business preflight.
- Valid built-in Skill Python remains unaffected.

## Verification

- `pnpm exec vitest run src/main/assistantRuntime.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts src/main/skills/SkillManagement.test.ts` - 90 passed.
- Focused `assistantDualModelRuntime.test.ts` SQL and Python recovery cases - 2 passed.
- `pnpm --filter @lifecycle-x/desktop typecheck` - passed.
- `git diff --check` - passed.
- The full dual-model test file was sampled but not treated as a full regression gate; 34 passed and 2 unrelated existing mock expectation cases failed.
- Electron `better-sqlite3` ABI was restored with `pnpm --dir apps/desktop native:rebuild` after Node-based integration tests.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Latest logs showed a valid plan and verified SQL skeleton, followed by two execution-model responses with empty identifiers. SQL execution context now prefers the Skill's SQL responsibility section over the unrelated input Schema. Python logs showed output truncation followed by a syntactically invalid one-line compound script. Prompts now require multiline compound statements, and every generated script receives a minimum parseability check before tool creation. Built-in Skills continue to bypass import, length, field, and business-contract preflight.

## Follow-up

Two pre-existing dual-model integration expectations remain outside this task: provider-failure wording and sibling-chart mock response ordering.
