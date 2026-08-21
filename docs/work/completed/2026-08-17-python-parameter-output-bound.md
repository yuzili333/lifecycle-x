# Task: Bound Python Tool Parameters

- Status: completed
- Owner: human + agent
- Started: 2026-08-17

## Goal

Prevent Python parameter generation from exhausting the model output budget before a valid tool call can be executed.

## Scope

- Scope Skill instructions to the Python stage.
- Add an explicit and locally enforced Python script length contract.
- Reduce the default Python generation budget and variance.
- Add focused regression tests.

## Non-goals

- Generate business-specific Python locally.
- Change Python sandbox, approval, or Artifact semantics.
- Run full regression or interactive page verification.

## Constraints

- Python remains responsible only for controlled statistics.
- Report composition remains owned by the report model.
- Existing personal Skills without structured tool headings remain compatible.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/agentOrchestration/modelRuntimeConfig.ts`
- `apps/desktop/src/main/streamingModelAdapter/`
- Focused tests under `apps/desktop/src/main/`

## Invariants

- Incomplete tool-call JSON is never executed.
- Scripts over the declared limit are rejected locally.
- Python receives the real upstream field and Artifact context.

## Implementation Plan

1. Confirm the latest failure stage and model telemetry.
2. Limit Python Skill context to shared computation rules and the Python section.
3. Add and validate `maxLength` in the Python tool Schema.
4. Reduce the default Python output budget to match the script contract.
5. Run focused tests, type checking, diff checks, and design review.

## Acceptance Criteria

- Python context excludes SQL, report, and report Schema instructions.
- The provider sees a script maximum of 8,000 characters.
- Local validation rejects a longer script before execution.
- Default Python generation is capped at 4,096 tokens with deterministic temperature.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts src/main/streamingModelAdapter/streamingModelAdapter.test.ts` passed: 92 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- `git diff --check` passed.
- The SQLite-backed dual-model integration test was not run because the installed `better-sqlite3` binary currently targets the Electron ABI rather than the Node test ABI; its request-budget assertions were updated and compile successfully.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The latest relevant run successfully queried 200 rows, then the Python parameter model exhausted all 8,192 output tokens twice. The responses contained 26,334 and 18,708 argument characters and were discarded before execution. Python context now includes only shared computation rules and the Skill's Python section, not SQL/report sections or the full report output Schema. The script contract is capped at 8,000 characters in the provider-visible Schema and local validation, while the default Python profile is deterministic and capped at 4,096 output tokens.

## Follow-up

Personal Skills without a structured `## 工具职责` and `### Python 工具` section retain their full instruction text for backward compatibility; package guidance should encourage the structured headings for optimal context isolation.
