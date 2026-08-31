# Task: Python Unmatched Parenthesis

- Status: completed
- Archived: 2026-08-31
- Owner: human + agent
- Started: 2026-07-25

## Goal

Prevent model-generated Python with invalid syntax from reaching approval or
execution, and repair one invalid execution-model response automatically.

## Evidence

The latest local tool log shows tool call
`f33061d8-89ad-4147-a033-779bba393344` failed before execution at line 18:
`contract_amount_field = '合同金额(万元')`. The field-name closing parenthesis
was emitted outside the string literal, producing `SyntaxError: unmatched ')'`.

## Scope

- Run local Python AST syntax validation before accepting model tool parameters.
- Retry the execution model once when Python syntax validation fails.
- Require exact field-name copying and concise scripts in the execution prompt
  and built-in Skill.
- Strengthen server-side delimiter validation as defense in depth.
- Add focused desktop and server tests.

## Non-goals

- No deterministic rewriting of model-generated Python business logic.
- No full regression or interactive page verification.

## Constraints

- Validation must be local and must not call a model.
- Invalid scripts must not create approval records or tool-call history.
- Repair must use the execution model, not the reasoning model.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/server/src/pythonRunner/pythonScriptValidator.ts`
- `skill/overall-risk-distribution-report/`

## Invariants

- Python still receives authorized dataset rows only through stdin.
- Model-generated code is never silently rewritten.
- Existing safety and approval checks remain in force.

## Implementation Plan

1. Add an AST-based local syntax preflight.
2. Return syntax failures as parameter issues and retry once.
3. Tighten prompt and Skill script-generation instructions.
4. Add focused regression tests and run type checks.

## Acceptance Criteria

- The logged malformed assignment is rejected before approval/execution.
- A corrected second execution-model response can continue the same step.
- Server validation detects unmatched delimiters outside strings and comments.

## Verification

- Local tool log:
  - Confirmed tool call `f33061d8-89ad-4147-a033-779bba393344`
    failed at line 18 because `合同金额(万元)` was emitted with `)` outside
    the string literal.
- Desktop focused unit tests:
  - `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts`
  - 2 files, 52 tests passed.
- Desktop dual-model integration tests:
  - `ELECTRON_RUN_AS_NODE=1 .electron/dist/Electron.app/Contents/MacOS/Electron ../../node_modules/vitest/vitest.mjs run src/main/assistantDualModelRuntime.test.ts`
  - 20 tests passed using the repository Electron ABI required by
    `better-sqlite3`.
- Server focused tests:
  - `pnpm --filter @lifecycle-x/server exec vitest run src/pythonRunner.test.ts`
  - 16 tests passed.
- Type checks:
  - `pnpm --filter @lifecycle-x/desktop typecheck`
  - `pnpm --filter @lifecycle-x/server typecheck`
- Desktop build:
  - `pnpm --filter @lifecycle-x/desktop build`
- Mechanical check:
  - `git diff --check`

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Python execution parameters are now parsed by the local Python AST before an
approval or execution record is created. Syntax failures are returned to the
execution model for one repair attempt, while the reasoning model and plan
remain unchanged. The Skill and execution prompt require exact field-name
copying, and the server validator rejects unmatched delimiters outside string
literals and comments.

## Follow-up

None.
