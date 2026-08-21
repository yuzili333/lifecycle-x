# Task: Python Import Limit And Budget

- Status: completed
- Owner: human + agent
- Started: 2026-08-18

## Goal

Remove the Python import-count regression and restore the shared built-in Skill Python output budget.

## Scope

Remove numeric import limits from prompts and local preflight, restore the shared Python execution profile to 8192 output tokens, and update focused tests.

## Non-goals

Do not remove invalid-module, duplicate-import, syntax, script-length, permission, or sandbox checks. Do not add a Skill-specific model profile.

## Constraints

All built-in Skills use the same Python execution profile. Imports may be used as required by the calculation, while modules must remain valid and permitted by the controlled runtime.

## Affected Areas

- `apps/desktop/src/main/agentOrchestration/modelRuntimeConfig.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- Focused runtime and orchestration tests

## Invariants

- Python remains standard-library only and consumes authorized stdin data.
- Invalid dotted module targets still fail before approval.
- Truncated or syntactically invalid scripts never execute.
- Guarantee-method and existing built-in Skills share one token budget.

## Implementation Plan

1. Audit the latest two Python parameter-generation runs.
2. Remove import-count validation and numeric prompt constraints.
3. Restore the shared Python execution profile to 8192 tokens.
4. Update tests to cover unrestricted import counts and retained module validation.
5. Run focused tests, typecheck, diff check, and design review.

## Acceptance Criteria

- Scripts are not rejected because they import more than eight names.
- Prompts contain no numeric import-count restriction.
- Invalid module targets and duplicate imports remain rejected.
- All built-in Skill Python requests use the same 8192-token profile.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts` passed (74 tests).
- Three focused dual-model integration tests passed after a temporary Node ABI rebuild.
- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- Source scan found no remaining numeric eight-import restriction.
- `git diff --check` passed.
- Electron native dependency ABI was restored and verified as ABI 130.

## Design Review

- [x] Prompt text now states the intended need-based import policy directly.
- [x] Model profile ownership remains in runtime configuration and syntax checks remain in local preflight.
- [x] Removing one count branch is simpler than adding Skill-specific exemptions.
- [x] No Skill-specific token profile or execution branch was introduced.
- [x] Invalid module targets, duplicate imports, syntax errors, truncation, and runtime errors retain explicit paths.
- [x] No new abstraction, dependency, or protocol was added.
- [x] Existing telemetry remains sufficient to monitor output size and parameter success.

## Outcome

The two latest runs showed the regression directly. Message `optimistic-be037698-73f5-481b-9823-85b17fb1b164` produced a syntactically parseable 1,870-character script but local preflight rejected its 128 import entries before execution. Message `optimistic-d3701d7e-a972-4feb-8e49-c00941a8a6c0` reached a 7,576-character syntax-repair result, then generated a 214-character repair containing 25 imports and was rejected by the same eight-entry rule. Both runs used a 4,096-token Python profile.

The AST preflight no longer rejects a script based on import count. Invalid dotted standard-library modules and duplicate imports remain checked. Initial, syntax-repair, reasoning-repair, and runtime-repair prompts now allow as many standard-library imports as the calculation actually uses and contain no numeric threshold. The shared Python execution profile is restored to 8,192 output tokens, so the guarantee-method Skill and all existing built-in Skills use the same budget without a Skill-specific reduction.

## Follow-up

Continue using parameter-shape telemetry to identify genuinely unnecessary generated imports; do not reintroduce a numeric import limit.
