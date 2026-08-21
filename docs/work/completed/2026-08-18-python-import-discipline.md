# Task: Python Import Discipline

- Status: completed
- Owner: human + agent
- Started: 2026-08-18

## Goal

Prevent model-generated Python analysis parameters from repeatedly failing the local eight-import preflight.

## Scope

Clarify on-demand import rules in the initial Python prompt and every Python parameter repair path, and cover the latest truncation-to-reasoning fallback scenario.

## Non-goals

Do not change Python sandbox permissions, business calculations, report generation, or Artifact lineage.

## Findings

- The initial prompt stated the eight-entry limit but did not define a minimal default import set.
- The latest reasoning fallback generated scripts with more than eight import entries twice.
- The second reasoning repair repeated the stdin/JSON contract but did not explicitly correct the import validation failure.

## Implementation Plan

1. Define a concrete on-demand import rule in the Python execution prompt and tool Schema.
2. Carry the same rule into truncation, executor repair, reasoning fallback, and reasoning preflight repair prompts.
3. Make the local preflight error report its import count and clarify that imported names count individually.
4. Add focused prompt, validator, and dual-model fallback tests.
5. Run desktop typecheck, targeted tests, diff check, and design review.

## Verification

- `pnpm --filter @lifecycle-x/desktop typecheck`
- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts` (73 passed)
- `pnpm exec vitest run src/main/assistantDualModelRuntime.test.ts -t "repairs excessive reasoning-model imports"` (1 passed)
- `git diff --check`
- Electron ABI restored with `apps/desktop/scripts/rebuild-native-deps.mjs` after the Node-targeted integration test.

## Design Review

- The change stays within prompt construction, local preflight diagnostics, and existing parameter-repair paths.
- No Python permission, execution, data-source, approval, or Artifact behavior changed.
- One consistent import rule is present in initial generation and every Python repair path.
- The preflight remains deterministic and exposes only import names and counts, not script contents or business data.
- The focused integration test reproduces the latest truncation, excessive-import fallback, and successful repair sequence.

## Outcome

- Initial Python generation now defaults to `import json, sys` and adds `Decimal` only when the calculation actually uses it.
- Convenience modules may only be imported when directly referenced by executable calculation code.
- The prompt defines the validator's exact counting rule: each import alias and each from-import name counts as one entry, with a maximum of eight.
- Local validation errors include the actual count and a short import-name preview so the repair model can remove the correct entries.
- The reasoning-model repair now addresses the concrete preflight error instead of repeating only the stdin/JSON contract.
