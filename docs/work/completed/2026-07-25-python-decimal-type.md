# Task: Python Decimal Type Consistency

- Status: completed
- Archived: 2026-08-31
- Owner: human + agent
- Started: 2026-07-25

## Goal

Prevent and recover from Python amount calculations that mix `float` and
`Decimal`.

## Evidence

The latest local Python tool call
`bc7499ff-8138-4d2f-8c99-1f9645101cbb` failed at line 140 with
`TypeError: unsupported operand type(s) for /: 'float' and 'decimal.Decimal'`.
The script serialized each category loan balance to `float` before dividing it
by the `Decimal` total.

## Scope

- Define a single numeric-type rule for money calculations in the execution
  prompt and built-in Skill.
- Retry one recoverable Python runtime failure with the execution model.
- Support both full-access execution and approval-resume flows.
- Add focused regression tests.

## Non-goals

- No deterministic rewriting of model-generated business calculations.
- No reasoning-model fallback.
- No full regression or interactive page verification.

## Constraints

- The retry must preserve the plan, user goal, data source, and Artifact input.
- A changed script in approval mode must require a new approval.
- At most one runtime repair is allowed per Python step.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `skill/overall-risk-distribution-report/`

## Invariants

- Python remains isolated from business databases.
- Tool attempts remain auditable.
- Amount precision is preserved until final serialization.

## Implementation Plan

1. Add recoverable Python runtime error classification.
2. Repair one failed Python step using its actual runtime error.
3. Tighten Decimal calculation rules in the prompt and Skill.
4. Add focused integration and package tests.

## Acceptance Criteria

- The logged `float / Decimal` pattern is not requested by the Skill prompt.
- A first `TypeError` can be repaired once and complete the same step.
- A second failed attempt ends the step without another repair loop.

## Verification

- Local tool log:
  - Confirmed Python tool call `bc7499ff-8138-4d2f-8c99-1f9645101cbb`
    converted category loan balances to `float` and divided them by a
    `Decimal` total at line 140.
- Desktop focused unit tests:
  - `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts`
  - 2 files, 53 tests passed.
- Desktop dual-model integration tests:
  - `ELECTRON_RUN_AS_NODE=1 .electron/dist/Electron.app/Contents/MacOS/Electron ../../node_modules/vitest/vitest.mjs run src/main/assistantDualModelRuntime.test.ts`
  - 21 tests passed, including a real first-attempt `float / Decimal`
    failure followed by one successful execution-model repair.
- Desktop type check:
  - `pnpm --filter @lifecycle-x/desktop typecheck`
- Desktop build:
  - `pnpm --filter @lifecycle-x/desktop build`
- Mechanical check:
  - `git diff --check`

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The execution prompt and built-in Skill now keep all amount calculations in
`Decimal` until final JSON serialization. Recoverable Python type and data
handling errors receive one execution-model repair with the actual runtime
error and the unchanged plan context. Full-access execution retries
immediately; approval mode creates a new script that requires a new approval.

## Follow-up

None.
