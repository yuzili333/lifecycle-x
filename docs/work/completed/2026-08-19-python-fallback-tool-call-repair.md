# Task: Python Fallback Tool Call Repair

- Status: completed
- Owner: human + agent
- Started: 2026-08-19

## Goal

Recover once when the high-reliability Python parameter fallback returns no required tool call, and preserve the real sanitized failure reason in terminal tool records.

## Evidence

- Latest run: initial Python executor exhausted 8192 output tokens after 160 seconds.
- High-reliability fallback then completed after 169 seconds with `finish_reason=unexpected_state`, zero content and zero tool calls.
- The orchestration path handled syntax/contract failures after fallback but did not re-handle `TOOL_CALL_REQUIRED` produced after that fallback.
- Terminal registration replaced the actual failure with the generic `未返回可执行参数` message.

## Scope

- Add one protocol correction after a reasoning fallback returns `TOOL_CALL_REQUIRED`.
- Keep forced tool choice, Schema validation, safety checks and approval unchanged.
- Preserve sanitized step failure details in terminal tool records.
- Add focused integration tests.

## Non-goals

- No execution of plain-text model output.
- No automatic script wrapping or deterministic business script.
- No full regression or interactive page verification.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantDualModelRuntime.test.ts -t "registers failed and blocked model-planned steps|falls back after Python truncation|repairs a missing Python tool call after the high-reliability truncation fallback" --reporter=dot`：3 项通过。
- `pnpm desktop:typecheck`：通过。
- `pnpm --filter @lifecycle-x/desktop native:rebuild`：已恢复 Electron ABI。
- `git diff --check`：通过。

## Design Review

- Problem fit: covers the exact missing state transition observed in the latest run.
- Boundaries: retry remains in orchestration; the Python runner and Skill business calculations are unchanged.
- Safety: plain text is never parsed or executed, and the corrected response must still pass tool Schema, syntax, security, stdin and approval checks.
- Termination: the new protocol correction is a single sequential branch and cannot loop.
- Observability: terminal records now preserve the sanitized step failure reason without model response content.

## Outcome

After an initial Python truncation and a high-reliability response with no required tool call, the orchestrator now performs one explicit tool-protocol correction using the same reasoning model and forced tool Schema. If it still fails, `tool_calls` records the real sanitized failure instead of the generic `未返回可执行参数` message.
