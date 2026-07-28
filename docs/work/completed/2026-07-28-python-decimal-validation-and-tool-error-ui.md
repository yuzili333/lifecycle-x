# Task: Python Decimal Validation And Tool Error UI

- Status: completed
- Owner: human + agent
- Started: 2026-07-28

## Goal

Fix `branch-asset-quality-report` Python amount reconciliation so exact Decimal
totals do not fail after float serialization, and stop rendering recovery cards
for tool execution errors.

## Scope

- Tighten the Skill Python-generation instructions around Decimal validation.
- Preserve failed tool records in `tool_calls`.
- Replace tool-error recovery cards with plain status text.
- Keep the existing one-time dual-model Python repair flow.
- Add focused tests for the Skill instructions and failed-tool message blocks.

## Non-goals

- No full regression.
- No interactive page verification.
- No changes to approval rejection or missing-input guidance.

## Verification

- Inspected the latest local Python failure and confirmed float serialization was
  used before amount reconciliation.
- Desktop TypeScript check: `../../node_modules/.bin/tsc --noEmit`.
- Targeted Skill package test passed.
- Targeted failed-tool message test passed and confirmed the failed tool remains
  in `tool_calls` without card or guidance blocks.
- Restored `better-sqlite3` to the Electron ABI after the Node-based test.
- Full regression and interactive page verification were intentionally not run.

## Design Review

- [x] Decimal validation remains in Skill instructions and does not introduce a
  hard-coded business-field implementation.
- [x] Tool execution errors remain audited and visible in `tool_calls`.
- [x] Automatic dual-model repair still reads the failed local tool status.
- [x] Approval and missing-input guidance paths are unchanged.
- [x] Failed terminal tool blocks are hidden from inline chat rendering while
  pending approval remains visible.
- [x] No new cross-process dependency or permission bypass was introduced.

## Outcome

Generated Python now validates branch and overall amount totals using internal
Decimal values before JSON serialization. Tool execution failures produce plain
status text and a failed `tool_calls` record without creating recovery cards or
blocking guidance checkpoints.
