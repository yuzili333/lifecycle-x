# Task: Agent Failed Tool Records

- Status: completed
- Owner: human + agent
- Started: 2026-07-25

## Goal

Represent every failed or blocked step from a model-generated Agent plan in `tool_calls`, including steps that never produced executable tool parameters.

## Scope

- Diagnose the latest partial Agent Run.
- Persist missing terminal tool records for failed and upstream-blocked plan steps.
- Keep terminal records ordered by actual step completion time.
- Prevent raw model prose from appearing as a large user-visible parameter error.
- Add targeted runtime tests.

## Non-goals

- No changes to tool approval or execution semantics.
- No retries or local fallback plans.
- No full regression or interactive page verification.

## Constraints

- Existing successful tool records and Artifact lineage remain unchanged.
- Terminal records must be idempotent across repeated finalization.
- Failure details remain concise and traceable to the Agent Run and plan step.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`

## Invariants

- `tool_calls` preserves actual execution order.
- Failed records never become latest successful inputs.
- Blocked tools are not represented as executed tools.

## Implementation Plan

1. Inspect the latest Run plan, progress events, and tool registry.
2. Add terminal record synchronization for missing failed/blocked steps.
3. Sanitize no-tool parameter-generation errors.
4. Add and run targeted tests and type checking.
5. Complete the independent design review.

## Acceptance Criteria

- A failed chart parameter-generation step appears in `tool_calls` as `failed`.
- A dependent report step appears in `tool_calls` as `blocked`.
- Successful tool records remain unchanged and ordered before later failures.
- Large model prose is not displayed as the step failure message.

## Verification

- Local log review:
  - Run `agent_run_c918cf8b-2d11-45ea-976f-a248ddabf864` planned five steps.
  - SQL, Python, and the loan-balance chart completed.
  - `chart_count` returned model prose instead of a chart tool call and failed.
  - `report` was blocked by the failed `chart_count` dependency.
  - Only the three successful steps existed in `tool_orchestration_calls`.
- `ELECTRON_RUN_AS_NODE=1 .electron/dist/Electron.app/Contents/MacOS/Electron ../../node_modules/vitest/vitest.mjs run src/main/assistantDualModelRuntime.test.ts`
  - Passed: 23 tests.
- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantRuntime.test.ts`
  - Passed: 44 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck`
  - Passed.
- Full regression and interactive page verification were not run, per current task constraints.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Agent Run finalization now creates idempotent terminal `tool_calls` records for model-planned steps that failed before a concrete tool call or were blocked by an upstream failure. Historical terminal runs are backfilled when either conversation tool state or tool calls are loaded, including the normal client conversation-reload path. Records retain plan purpose, status, trace metadata, duration, and terminal ordering without becoming successful Artifact inputs. Raw model prose is no longer surfaced as the parameter-generation error.

## Follow-up

None currently.
