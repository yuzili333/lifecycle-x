# Task: SQL Model Stream Failure

- Status: completed
- Owner: human + agent
- Started: 2026-07-30

## Goal

Correctly classify and recover from transient model transport failures while generating SQL tool parameters.

## Scope

- Distinguish provider transport failures from invalid SSE payloads.
- Retry one execution-model parameter request when no tool call has been created.
- Keep provider failures out of local parameter-validation reporting.
- Add focused adapter and orchestration coverage.

## Non-goals

- Change SQL safety validation or database execution behavior.
- Change model selection, timeout budgets, or approval policy.
- Run full regression or interactive page validation.

## Constraints

- A retry must not execute an already-created tool call twice.
- True malformed SSE data must remain a stream-parse failure.
- Logs must retain structured provider failure details without exposing secrets.

## Affected Areas

- `apps/desktop/src/main/streamingModelAdapter/openAICompatibleProvider.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- Focused model adapter and dual-model runtime tests

## Invariants

- SQL remains read-only and permission controlled.
- Tool-call idempotency and execution order remain unchanged.
- User cancellation and model timeouts remain distinct from transport failures.

## Implementation Plan

1. Correct provider error classification.
2. Add a single safe execution-parameter retry.
3. Correct parameter observation messages for provider failures.
4. Add focused tests and run mechanical checks.

## Acceptance Criteria

- A terminal `fetch failed` error is reported as `PROVIDER_REQUEST_FAILED`.
- Malformed SSE JSON remains `PROVIDER_STREAM_PARSE_FAILED`.
- SQL parameter generation retries once before the step fails.
- Provider failures are not logged as local parameter validation failures.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/streamingModelAdapter/streamingModelAdapter.test.ts`: passed, 22 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck`: passed.
- `git diff --check`: passed.
- Focused `assistantDualModelRuntime.test.ts` execution was blocked before assertions because the installed `better-sqlite3` binary targets Electron ABI 130 while the command-line Node runtime requires ABI 137. The client dependency was not rebuilt to avoid disrupting the Electron development runtime.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Latest local trace `trace_5e9e7305-af8d-461f-b2ff-d32c209b7be1` failed before the first model event with the low-level cause `fetch failed`. The provider now classifies terminal transport failures as `PROVIDER_REQUEST_FAILED`; malformed JSON remains `PROVIDER_STREAM_PARSE_FAILED`. Execution steps with no created tool call receive one controlled retry, and provider failures are logged as parameter-generation failures rather than local validation failures.

## Follow-up

Run the new SQL orchestration test after the local native dependency is next rebuilt for the command-line Node ABI.
