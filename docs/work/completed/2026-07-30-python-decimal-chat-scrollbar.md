# Task: Python Decimal and Chat Scrollbar

- Status: completed
- Owner: human + agent
- Started: 2026-07-30

## Goal

Prevent mixed float/Decimal Python analysis failures before tool approval and
stop the message-container scrollbar from flashing during Assistant processing.

## Scope

- Extend local Python preflight for count-ratio expressions in Decimal scripts.
- Clarify execution-model and Skill ratio rules.
- Stabilize the Astryx ChatLayout scrollbar presentation while streaming.
- Add focused runtime assertions.

## Non-goals

Do not replace the Python runtime, rewrite generated scripts, fork Astryx, or
change user-controlled scrolling behavior.

## Invariants

- Python remains locally syntax- and safety-validated before approval.
- Models generate scripts; the client does not silently change calculations.
- ChatLayout remains the single owner of message scrolling.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts`
  - Passed: 60 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck`
  - Passed.
- `git diff --check`
  - Passed.
- `assistantDualModelRuntime.test.ts` could not initialize because the current
  Node 24 process requires native module ABI 137 while the installed
  `better-sqlite3` binary targets ABI 130. The failure occurred before test
  behavior ran; native dependencies were not rebuilt to avoid disturbing the
  Electron development runtime.

## Design Review

The local preflight reports a parameter issue and lets the existing single
repair path regenerate the script; it does not rewrite calculations or bypass
approval. The count-name rule is deliberately limited to count/row/record/size
suffixes so Decimal amount variables are not rejected. ChatLayout remains the
only scroll owner; the Renderer adds a stable gutter and suppresses the
programmatic scrollbar paint only while an Assistant message is processing.

## Outcome

Count ratios in Decimal-based scripts must now use
`Decimal(count) / Decimal(total)` and are rejected before approval otherwise.
The key-risk-customer Skill and execution prompts carry the same invariant.
Assistant processing keeps auto-follow behavior without repeatedly painting the
vertical scrollbar.
