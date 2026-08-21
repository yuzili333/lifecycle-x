# Task: Guarantee Count And Latency

- Status: completed
- Owner: human + agent
- Started: 2026-08-19

## Goal

Ensure the guarantee-method risk Skill cannot turn an empty Python result into a fabricated report, keeps contract counts consistent with the source rows, and reduces unnecessary model context and retries.

## Scope

- Enforce the minimum Python stdin/JSON stdout execution contract for all Skills.
- Reject empty or non-JSON Python analysis output before Artifact registration.
- Tighten the guarantee-method Skill's deterministic count invariants and compact script guidance.
- Remove tool execution instructions from planner-only Skill context.
- Add focused runtime and Skill tests.

## Non-goals

- No model provider change or reduced Python output token limit.
- No full regression or interactive page verification.
- No business-field preflight for built-in Skills.

## Constraints

- Built-in Skills continue to bypass field, import-count, length, and business-output preflight.
- SQL remains a detail query and Python remains the only statistics executor.
- Reports may only use successful structured analysis results.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantRuntime.test.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`
- `skill/guarantee-method-risk-distribution-report/`

## Invariants

- A successful Python analysis consumes the authorized rows and emits a non-empty JSON result.
- The sum of guarantee category counts equals the selected counting-basis total.
- A report is not generated from an empty Python Artifact.

## Implementation Plan

1. Add universal minimum Python execution-contract and runtime-output checks.
2. Make contract failures repairable in the existing single-step retry flow.
3. Add deterministic counting and reconciliation requirements to the Skill.
4. Scope planning context away from tool execution instructions.
5. Run focused tests, typecheck, diff check, and design review.

## Acceptance Criteria

- Import-only or no-output Python scripts cannot complete successfully.
- The verified 200-row/200-contract source cannot produce a 461-contract analysis result.
- Planner context excludes SQL, Python, and report execution instructions.
- The Skill remains dynamically bound to real source fields.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts --reporter=dot` - passed, 69 tests.
- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantDualModelRuntime.test.ts -t "falls back after Python truncation" --reporter=dot` - passed after temporary Node ABI rebuild; Electron ABI restored afterward.
- `pnpm desktop:typecheck` - passed.
- `git diff --check` - passed.
- Full regression and interactive page verification were not run per project constraints.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

- Verified the latest source contains 200 rows and 200 distinct nonblank contract serials; the 461 count was not derived from the source.
- Prevented import-only, empty-output, invalid-JSON, and empty-JSON Python analyses from becoming successful Artifacts.
- Made the minimum stdin/JSON stdout contract apply to built-in Skills without restoring business-field, import-count, or script-length preflight.
- Added deterministic guarantee-category count reconciliation and source-row bounds to the Skill.
- Removed tool execution instructions from planner-only Skill context and tightened SQL/Python generation guidance without reducing the shared Python token budget.

## Follow-up

None identified.
