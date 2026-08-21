# Task: Guarantee Skill Prompt Scope

- Status: completed
- Owner: human + agent
- Started: 2026-08-19

## Goal

Reduce guarantee-method Skill prompt size and ambiguity by sending each model only the instructions required for its role.

## Scope

- Restructure the guarantee-method Skill into concise planning, SQL, Python, and report responsibilities.
- Move concrete statistical rules into the Python section that actually receives them.
- Restrict report-stage Skill context to the report responsibility, output Schema, and template.
- Add focused prompt-scoping and Skill package tests.

## Non-goals

- No model, timeout, token-budget, tool Schema, or approval changes.
- No full regression or interactive page verification.

## Constraints

- SQL only queries detail rows; Python only computes statistics; report model only assembles presentation.
- Field existence remains determined by the selected source Schema.
- Count and amount reconciliation rules must remain explicit.

## Affected Areas

- `skill/guarantee-method-risk-distribution-report/`
- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantRuntime.test.ts`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- Planner receives no SQL, Python, or report parameter instructions.
- Python receives the guarantee/risk mapping, count basis, amount conversion, and reconciliation rules.
- Report generation receives no SQL or Python implementation instructions.

## Implementation Plan

1. Reorganize the Skill around role-specific responsibilities.
2. Add report-stage instruction extraction.
3. Update prompt-scoping and package assertions.
4. Run focused tests, typecheck, diff check, and design review.

## Acceptance Criteria

- Planning, SQL, Python, and report contexts contain only role-relevant Skill content.
- Required statistical rules remain available to Python.
- Skill instructions are shorter and contain no duplicated generic execution contract.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts --reporter=dot` - passed, 69 tests.
- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/skills/SkillManagement.test.ts --reporter=dot` - passed, 15 tests after final Skill wording adjustment.
- `pnpm desktop:typecheck` - passed.
- `git diff --check` - passed.
- Full regression, live model latency benchmarking, and interactive page verification were not run.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

- Reduced the Skill to about 1,750 characters with role slices of roughly 418 planning, 186 SQL, 918 Python, and 212 report characters.
- Planner context now contains only task, field roles, core count basis, Artifact reuse, and requested outputs.
- Python context now owns every guarantee/risk mapping, amount conversion, deduplication, aggregation, and reconciliation rule it must execute.
- Report context now excludes planning, SQL, and Python instructions and receives only report responsibility, output Schema, and template.
- Preserved the shared model and token budgets; latency improvement comes from smaller, non-conflicting context rather than reduced output capacity.

## Follow-up

None identified.
