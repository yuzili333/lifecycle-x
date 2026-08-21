# Task: Python Parameter Prompt Optimization

- Status: completed
- Owner: human + agent
- Started: 2026-08-18

## Goal

Reduce Python parameter generation latency and prevent import-only scripts from being accepted as successful analysis.

## Scope

Optimize the shared Python execution prompt, add local analysis-contract validation, and route output truncation directly to the reasoning-model fallback.

## Non-goals

Do not alter business statistics, SQL behavior, report structure, approval, or Artifact lineage.

## Constraints

Python remains model-generated and executes only against authorized stdin rows. Incomplete or non-analytical scripts must not execute.

## Affected Areas

- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- Focused orchestration and prompt tests

## Invariants

- Python scripts must read stdin and emit a JSON result.
- Output truncation creates no tool call and executes no partial script.
- Report generation only proceeds from a successful analytical Python result.

## Implementation Plan

1. Audit latest successful run timings and parameter shapes.
2. Replace repetitive negative instructions with a concise positive script blueprint.
3. Add deterministic model-script contract validation.
4. Skip same-executor retry for hard output truncation and use the reasoning fallback directly.
5. Run focused tests, typecheck, diff check, and design review.

## Acceptance Criteria

- Initial Python prompt requires stdin loading, calculation, one result object, and JSON output.
- Import-only or no-output scripts fail before approval.
- Truncation performs one direct reasoning fallback instead of another executor request.
- Existing valid Python analysis scripts remain accepted.

## Verification

- `pnpm --filter @lifecycle-x/desktop typecheck`
- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts` (73 passed)
- `pnpm exec vitest run src/main/assistantDualModelRuntime.test.ts -t "falls back directly after Python truncation|executes SQL, Python, and chart with compact parameters|repairs one Python Decimal runtime type error"` (3 passed)
- `git diff --check`
- Electron ABI restored with `apps/desktop/scripts/rebuild-native-deps.mjs` after the Node-targeted integration test.

## Design Review

- [x] The positive script blueprint explains the contract without relying on tests.
- [x] Prompt construction, local validation, and orchestration fallback remain in their existing owners.
- [x] Direct fallback removes a redundant executor retry instead of adding another repair layer.
- [x] No new dependency or cross-process interface was introduced.
- [x] Truncation, invalid analytical contracts, and high-reliability repair are explicit and deterministic.
- [x] The implementation adds one small validator and reuses existing fallback and validation paths.
- [x] No deferred technical debt was identified for this scoped fix.

## Outcome

- Latest logs showed two consecutive 8,192-token executor responses taking about 65.8s and 61.4s, followed by an import-only reasoning fallback that was incorrectly marked successful.
- Python generation now uses a concise stdin-to-result-to-JSON blueprint and a deterministic local analytical contract check.
- Hard output truncation no longer spends a second request on the same execution model; it falls back directly to the reasoning model.
- The Python output cap is 4,096 tokens, bounding runaway latency while preserving a high-reliability fallback.
- Import-only and non-JSON-output scripts are rejected before approval or execution, so report generation cannot treat them as successful analysis.

## Follow-up

None identified.
