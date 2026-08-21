# Task: Python Stdin Contract

- Status: completed
- Owner: human + agent
- Started: 2026-08-19

## Goal

Prevent valid stdin-based Python scripts from being rejected while ensuring the guarantee-method Skill always requests an unambiguous stdin-to-JSON script.

## Scope

- Recognize safe standard-library alias forms for `sys.stdin` and JSON load/dump calls.
- Strengthen the guarantee-method Python scaffold and contract-repair prompt.
- Add focused contract and Skill tests.

## Non-goals

- No removal of the minimum Python execution contract.
- No business preflight, token-budget, timeout, model, or tool Schema changes.
- No full regression or interactive page verification.

## Constraints

- Import-only and no-output scripts must remain invalid.
- Python must consume authorized upstream JSON and emit JSON to stdout.
- No automatic wrapping or execution of incomplete model scripts.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantRuntime.test.ts`
- `skill/guarantee-method-risk-distribution-report/`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- `sys.stdin`, imported `stdin`, and safe `sys` aliases are accepted.
- JSON module aliases and `from json import load/dump` forms are accepted.
- A script without both input parsing and JSON stdout remains rejected.

## Implementation Plan

1. Expand minimum contract recognition for safe import aliases.
2. Make repair guidance use an exact mandatory scaffold.
3. Update the Skill and tests.
4. Run focused tests, typecheck, diff check, and design review.

## Acceptance Criteria

- Equivalent safe stdin/JSON patterns pass the contract check.
- Import-only scripts still fail.
- The guarantee Skill explicitly requires the exact first three script statements.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts --reporter=dot`：69 项通过。
- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantDualModelRuntime.test.ts -t "falls back after Python truncation" --reporter=dot`：目标集成场景通过。
- `pnpm desktop:typecheck`：通过。
- `pnpm --filter @lifecycle-x/desktop native:rebuild`：已恢复 Electron 原生模块 ABI。
- `git diff --check`：通过。

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

Independent re-read conclusion: the contract still requires authorized stdin input, JSON parsing, and JSON stdout. It only recognizes equivalent safe import aliases and makes the repair scaffold deterministic; import-only and missing-output scripts remain invalid. No permissions, Artifact lineage, model budget, or execution runtime boundary changed.

## Outcome

The latest failure followed an initial truncated executor response and two very short fallback scripts that did not satisfy the stdin contract. The Skill and contract-repair prompts now require an exact stdin scaffold, while the local validator recognizes safe `sys`/`json` aliases instead of rejecting equivalent valid scripts.

## Follow-up

None identified.
