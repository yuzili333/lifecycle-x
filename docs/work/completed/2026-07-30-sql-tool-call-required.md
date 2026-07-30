# Task: SQL Tool Call Required

- Status: completed
- Owner: human + agent
- Started: 2026-07-30

## Goal

Prevent SQL parameter generation from failing when the execution model returns ordinary text instead of the required tool call.

## Scope

- Force the sole execution tool in provider requests.
- Classify missing tool calls as protocol failures.
- Retry one protocol-deviating execution response before failing the step.
- Add focused adapter and orchestration tests.

## Non-goals

- Parse SQL from ordinary model text.
- Change SQL safety validation, approval, or execution.
- Run full regression or interactive page validation.

## Constraints

- Retry only before any tool call has been created.
- Tool parameters must still pass the registered JSON Schema and local safety rules.
- Do not execute inferred or fabricated SQL.

## Affected Areas

- Streaming model request options and provider serialization.
- Execution parameter adapter.
- Agent execution-step recovery.

## Invariants

- SQL remains read-only and permission controlled.
- Exactly one controlled tool call is accepted for an execution step.
- Existing report direct-Markdown behavior remains unchanged.

## Implementation Plan

1. Add explicit single-tool choice to execution-model requests.
2. Classify plain-text/no-tool responses as protocol failures.
3. Add one safe corrective retry.
4. Add focused tests and run mechanical checks.

## Acceptance Criteria

- SQL execution requests contain a forced tool selection.
- Plain text with `finish_reason=stop` is not reported as local SQL validation.
- A first protocol deviation is retried once.
- No tool is executed twice.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/agentOrchestration/thinkingOptimization.test.ts`: passed, 20 tests.
- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/streamingModelAdapter/streamingModelAdapter.test.ts`: passed, 22 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck`: passed.
- `git diff --check`: passed.
- The SQLite-backed orchestration test was added but not executed because the installed `better-sqlite3` binary targets Electron ABI 130 while the command-line Node runtime requires ABI 137. The native dependency was not rebuilt to avoid disrupting the Electron development runtime.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The latest execution trace completed normally with `finish_reason=stop`, 273 content characters, and no tool call. Execution requests now force the sole registered tool. If a provider still returns ordinary text, the adapter records `TOOL_CALL_REQUIRED` at the protocol stage and the orchestrator performs one corrective retry before failing. Ordinary text is never parsed into SQL.

## Follow-up

Run the new SQLite-backed orchestration test after the local native dependency is next rebuilt for the command-line Node ABI.
