# Task: Python Tool Arguments Truncation

- Status: completed
- Owner: human + agent
- Started: 2026-08-02

## Goal

Prevent a Python execution-model response that reaches its output-token limit from being misreported as ordinary invalid JSON, and recover once by regenerating a complete concise script.

## Scope

- Detect truncated tool-call arguments before local tool execution.
- Return a structured provider-output-truncated error.
- Retry one Python parameter-generation step with an explicit script-size constraint.
- Add focused adapter and orchestration tests.

## Non-goals

- Reconstruct or execute partial Python scripts.
- Increase the global model timeout or output-token budget.
- Change Python sandbox policy or business analysis rules.

## Constraints

- Tool parameter validation remains local and schema-driven.
- A truncated response must never create or execute a local tool call.
- Retry must preserve the current plan, data source, fields, and requested outputs.

## Affected Areas

- `apps/desktop/src/main/streamingModelAdapter/`
- `apps/desktop/src/main/agentOrchestration/`
- `apps/desktop/src/main/assistantRuntime.ts`

## Invariants

- Complete tool-call JSON continues through the existing schema and safety validation.
- User cancellation still aborts model and tool work through the same signal.
- No source data or partial scripts are written to telemetry.

## Implementation Plan

1. Confirm the latest failure's model finish reason and argument size.
2. Stop truncated tool-call arguments before registry execution.
3. Add one bounded Python regeneration attempt with concise-code guidance.
4. Run focused tests, desktop typecheck, diff checks, and design review.

## Acceptance Criteria

- `finish_reason=length` with a partial Python tool call yields `PROVIDER_OUTPUT_TRUNCATED`.
- The partial call's handler is not invoked.
- Python orchestration retries once with an explicit compact-script constraint.
- A second failure terminates the step without a retry loop.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/agentOrchestration/thinkingOptimization.test.ts` - passed, 21 tests.
- `pnpm --dir apps/desktop exec vitest run src/main/streamingModelAdapter/streamingModelAdapter.test.ts` - passed, 22 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck` - passed.
- `git diff --check` - passed.
- Focused dual-model integration test was selected but could not run because the installed `better-sqlite3` uses Electron ABI 130 while command-line Node requires ABI 137. The native module was not rebuilt to avoid breaking the desktop runtime.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The latest failure was traced to `finish_reason=length`: the execution model emitted 33,350 characters of Python tool arguments and consumed all 8,192 completion tokens. The streaming adapter now marks that response as truncated and prevents the partial JSON from reaching the tool registry. Python generation is constrained to concise scripts and receives one bounded compact regeneration attempt when truncation occurs.

## Follow-up

Run the new full orchestration case when the repository verification harness temporarily switches `better-sqlite3` to the Node ABI and restores Electron ABI afterward.
