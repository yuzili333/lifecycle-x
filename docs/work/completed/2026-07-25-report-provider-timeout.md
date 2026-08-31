# Task: Report Provider Timeout Recovery

- Status: completed
- Archived: 2026-08-31
- Owner: human + agent
- Started: 2026-07-25

## Goal

Recover once from a report parameter-generation provider failure and preserve the real provider error in terminal `tool_calls`.

## Scope

- Diagnose the latest local Agent Run and model observation logs.
- Retry report parameter generation once when the provider fails before creating a tool call.
- Keep user cancellation non-retryable.
- Preserve the provider failure reason in the generated terminal tool record.
- Add targeted tests.

## Non-goals

- No local or fabricated report fallback.
- No changes to SQL, Python, chart, or approval semantics.
- No full regression or interactive page verification.

## Acceptance Criteria

- A transient report provider failure is retried once.
- A successful retry creates the report normally.
- A repeated provider failure remains failed and displays the provider error rather than “未返回可执行参数”.
- User cancellation is never retried.

## Verification

- Latest local run `agent_run_fe640b62-6b1d-4cc9-9540-7a157579d097`:
  - SQL, Python, and both chart steps completed.
  - Report request started with about 7,600 estimated context tokens.
  - No first model event, token, or tool call arrived within 180 seconds.
  - Provider ended with `PROVIDER_TIMEOUT`; the terminal tool record previously replaced this with a generic missing-parameters message.
- `ELECTRON_RUN_AS_NODE=1 .electron/dist/Electron.app/Contents/MacOS/Electron ../../node_modules/vitest/vitest.mjs run src/main/assistantDualModelRuntime.test.ts`
  - 26 tests passed.
  - Covers transient provider failure followed by successful report generation.
  - Covers repeated provider failure with the real provider message preserved.
- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantRuntime.test.ts`
  - 46 tests passed.
- `pnpm --filter @lifecycle-x/desktop typecheck`
  - Passed.
- Full regression and interactive page verification were not run.

## Design Review

- [x] Retry is idempotent before any report tool call exists.
- [x] Cancellation semantics are preserved.
- [x] Terminal error reporting is accurate.
- [x] No data or report content is fabricated.

## Outcome

Report parameter generation now retries once only for timeout, first-event timeout, and stream-parse provider failures when no report tool call has been created. User cancellation and non-transient request errors are not retried. If the retry also fails, the terminal `tool_calls` entry preserves the controlled provider failure summary instead of reporting missing parameters.
