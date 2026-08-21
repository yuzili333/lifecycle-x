# Task: Python Truncation Compact Retry

- Status: completed
- Owner: human + agent
- Started: 2026-08-20

## Goal

Prevent a first truncated Python tool-parameter response from immediately switching to the high-reliability model.

## Scope

- Diagnose the latest failed Agent run and compare truncated output with a completed script for the same built-in Skill.
- Retry the current Python step once with the configured execution model and a compact script contract.
- Keep the high-reliability model as a final fallback only when the compact execution-model retry also fails.
- Add focused dual-model runtime coverage.

## Non-goals

- No global model migration.
- No report, SQL, chart, Renderer, or Python sandbox behavior changes.
- No unconditional output-token increase.

## Constraints

- Python continues to consume only authorized upstream JSON through stdin.
- Incomplete tool-call JSON is never executed.
- The existing 180 second model request hard limit remains unchanged.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`

## Invariants

- A valid compact retry uses the configured execution model.
- The reasoning model is used only after the execution-model retry remains invalid.
- Tool approval, execution, and Artifact lineage are unchanged.

## Implementation Plan

1. Record latest-run output size, finish reason, and fallback behavior.
2. Execute the existing compact retry prompt with the execution model.
3. Update focused tests for the corrected model sequence and fallback event.
4. Run focused tests, desktop typecheck, diff check, and design review.

## Acceptance Criteria

- The first `PROVIDER_OUTPUT_TRUNCATED` Python response triggers one compact execution-model retry.
- A valid retry completes without invoking the reasoning model for parameter generation.
- A failed retry can still use the existing final high-reliability fallback.
- No incomplete Python parameters are executed.

## Verification

- Latest log: the failed response consumed 8,192 completion tokens and produced 33,750 unparseable argument characters.
- Comparable completed Skill script: 4,549 characters, so a larger global token budget is not justified.
- `pnpm --dir apps/desktop exec vitest run src/main/assistantDualModelRuntime.test.ts -t "retries truncated Python parameters|repairs a missing Python tool call"` passed: 2 tests passed, 35 skipped.
- `pnpm desktop:typecheck` passed.
- `git diff --check` passed.
- `better-sqlite3` was temporarily rebuilt for the Node test ABI and restored to the Electron ABI with `pnpm --dir apps/desktop native:rebuild`.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The first truncated Python parameter response now triggers one compact retry with the configured execution model. A valid retry proceeds directly to local validation and execution; only a failed retry can enter the existing high-reliability fallback. The global Python output budget remains 8,192 tokens because the latest output was pathological expansion rather than a required script size.

## Follow-up

None currently.
