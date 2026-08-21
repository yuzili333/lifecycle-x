# Task: Python Parameter Truncation Retry

- Status: completed
- Owner: human + agent
- Started: 2026-08-17

## Goal

Allow a Python analysis step whose tool-call arguments exceed the normal model output limit to recover once without executing partial parameters or repeating the same insufficient budget.

## Scope

- Diagnose the latest model telemetry and retry behavior.
- Limit execution-stage Skill context to files relevant to the current tool.
- Use an expanded output-token cap only for a Python truncation retry.
- Add focused regression assertions.

## Non-goals

- Raise the output budget for every model request.
- Reconstruct or execute a truncated script.
- Add a Skill-specific Python runtime or business calculation path.

## Constraints

- The initial Python request keeps the normal execution profile.
- A truncated response never reaches the local tool handler.
- Retry preserves the plan, data source, fields, and analysis requirements.
- Skill safety instructions remain present in every phase.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`

## Invariants

- SQL, chart, and report model budgets are unchanged.
- Tool approval and Python sandbox behavior are unchanged.
- Retry occurs at most once for this failure mode.

## Implementation Plan

1. Confirm tool kind, output size, finish reason, and repeated retry budget in the latest logs.
2. Build phase-specific Skill execution context.
3. Apply a bounded expanded output budget to the one Python truncation retry.
4. Run focused tests, typecheck, diff checks, and design review.

## Acceptance Criteria

- Python execution context excludes report-only template and unrelated Skill metadata.
- First truncation is classified as `PROVIDER_OUTPUT_TRUNCATED` and no tool handler runs.
- The single retry requests up to 16,000 output tokens and retains compact-script instructions.
- A second failure terminates normally without a retry loop.

## Verification

- Latest log inspection confirmed both Python attempts used `maxTokens=8192`, returned `finishReason=length`, and produced incomplete argument payloads of 21,772 and 18,113 characters.
- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts -t 'scopes Skill context to the current execution tool'` - passed.
- `pnpm --dir apps/desktop exec vitest run src/main/agentOrchestration/thinkingOptimization.test.ts -t 'does not execute truncated tool-call JSON'` - passed.
- `pnpm --filter @lifecycle-x/desktop typecheck` - passed.
- `git diff --check` - passed.
- The SQLite-backed orchestration assertion was updated but not executed because the installed `better-sqlite3` binary targets Electron ABI 130 while command-line Node requires ABI 137; the native module was not rebuilt to avoid breaking the desktop runtime.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Execution-stage Skill context is now scoped by tool kind: SQL receives the input Schema, Python receives the report-data Schema, chart receives shared instructions only, and report receives the output Schema plus report template. A Python response truncated at the normal 8,192-token limit is still discarded without execution, but its single compact retry now receives a 16,000-token cap. Normal requests and all other tool budgets remain unchanged.

## Follow-up

None currently.
