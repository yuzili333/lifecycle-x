# Task: Built-in Skill Parameter Preflight Bypass

- Status: completed
- Owner: human + agent
- Started: 2026-08-18

## Goal

Stop desktop-side SQL/Python parameter preflight and model regeneration for all system built-in Skills, while strengthening execution-time parameter instructions for the guarantee-method risk report Skill.

## Scope

- Detect immutable system Skill snapshots in the assistant runtime.
- Bypass SQL/Python parameter quality preflight and its repair branches for those Skills.
- Keep required argument decoding and actual tool safety, permission, approval and sandbox checks.
- Extend the guarantee-method Skill SQL/Python parameter generation contract.

## Non-goals

- Do not disable SQL read-only enforcement, selected-field access control, approval, Python sandbox validation or runtime errors.
- Do not change personal Skill or no-Skill behavior.
- Do not add deterministic fallback scripts.

## Constraints

System Skill identity comes from the loaded immutable Skill snapshot (`summary.origin === "system"`), not a hard-coded Skill ID list.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantRuntime.test.ts`
- `skill/guarantee-method-risk-distribution-report/`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- Unsafe or mutating SQL is blocked at execution.
- SQL may only access the authorized conversation source/field scope.
- Python remains subject to runtime safety, permission and sandbox policies.
- A built-in Skill parameter is not sent back to a model because of desktop preflight rules.

## Implementation Plan

1. Add a system Skill preflight policy helper.
2. Gate SQL/Python desktop preflight and repair branches with that policy.
3. Add focused behavior tests.
4. Strengthen the guarantee-method Skill parameter contract and version.
5. Run targeted tests, desktop typecheck, diff check and design review.

## Acceptance Criteria

- All system built-in Skills bypass desktop SQL/Python parameter preflight.
- Personal Skills and no-Skill flows retain existing preflight.
- Built-in Skill requests still pass through runtime safety, approval and sandbox checks.
- The guarantee-method Skill explicitly constrains exact SQL and Python execution parameters.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts` (69 tests passed)
- `pnpm --filter @lifecycle-x/desktop typecheck` (passed)
- `git diff --check` (passed)
- `assistantDualModelRuntime.test.ts` was attempted; 2 tests passed and 32 setup-dependent tests could not start because `better-sqlite3` is currently built for Electron ABI 130 while the test Node runtime requires ABI 137. The native module was not rebuilt to avoid disrupting the desktop runtime.
- Full regression and interactive page validation were not run, per project/user scope.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

- Added an origin-based policy that recognizes every immutable system Skill without maintaining an ID allowlist.
- System Skills now bypass desktop SQL parameter repair/type checks, structural checks, aggregate/detail policy checks, plan-field coverage checks, selected-source presence checks and SQLite prepare preflight.
- System Skills now bypass desktop Python parameter repair/type checks, script length, AST/import syntax and stdin/JSON contract preflight.
- Model retries caused solely by those SQL/Python local preflight failures are disabled for system Skills.
- Personal Skills and no-Skill flows retain the existing preflight behavior.
- Actual SQL read-only/field-scope enforcement, approvals, Python safety validation, permissions and sandbox execution remain unchanged.
- The guarantee-method Skill now contains explicit single-call SQL/Python parameter contracts, exact source/schema usage, fixed Python I/O and model-side self-check requirements; version advanced to `1.0.5`.

## Follow-up

- Runtime syntax or data-processing failures may still use the existing bounded runtime repair path; this is intentionally separate from parameter preflight.
- Run the dual-model SQLite-backed tests through the repository verification wrapper when a Node ABI rebuild/restore cycle is desired.
