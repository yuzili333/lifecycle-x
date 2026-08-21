# Task: Python Line-One Syntax Repair

- Status: completed
- Owner: human + agent
- Started: 2026-08-20

## Goal

Prevent Python tool parameters from passing JSON Schema but failing syntax parsing on line one after a contract repair.

## Scope

- Diagnose the latest model parameter and validation telemetry.
- Make the compact target distinct from the hard Schema ceiling.
- Require a deterministic valid stdin bootstrap at the start of generated scripts.
- Separate contract-repair guidance from syntax-repair guidance.
- Normalize a single model-generated Markdown code wrapper before syntax validation.
- Add focused prompt, normalization, and dual-model repair tests.

## Non-goals

- No Python syntax-check bypass, model migration, output-token increase, report, SQL, or UI changes.
- No full regression or interactive page validation.

## Constraints

- Only valid Python reaches approval and execution.
- Python still reads the authorized upstream JSON from stdin and writes one JSON result to stdout.
- The 16,000-character Schema ceiling and 8,192-token model budget remain safety limits, not generation targets.

## Affected Areas

- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/thinkingOptimization.test.ts`
- `apps/desktop/src/main/assistantRuntime.test.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`

## Invariants

- Tool approval, execution sandbox, and Artifact lineage are unchanged.
- Wrapper normalization extracts code but does not rewrite invalid Python statements.
- A failed repair does not create or execute a Python tool call.

## Implementation Plan

1. Record the latest script lengths, validation sequence, and timings.
2. Add a compact target and deterministic first-two-line contract.
3. Split contract and syntax repair messages while retaining one repair request.
4. Add safe single-fence normalization and focused coverage.
5. Run focused tests, desktop typecheck, diff check, and design review.

## Acceptance Criteria

- The model is told not to pad the script toward the Schema ceiling.
- Generated scripts start with valid imports and stdin JSON loading.
- Contract failures are not mislabeled as syntax failures.
- A single fenced Python body with surrounding prose normalizes to executable code.
- Focused tests and typecheck pass.

## Verification

- Latest conversation `725144d6-f3df-4237-9f47-ea3e292a990d`, message `optimistic-00d82c81-9550-493e-8f90-2b12b3632483`: the first Python response returned a complete 15,999-character script after 80,367 ms but failed the stdin JSON contract.
- The repair response returned another complete 15,998-character script after 95,095 ms and then failed `ast.parse` on line one with `invalid syntax`.
- Both responses stopped normally and their JSON tool arguments were parseable, so the failure was in generated script content rather than provider truncation or JSON parsing.
- The 15,999/15,998 lengths show the model treated the 16,000-character safety ceiling as a fill target. The prompt now uses a 6,000-character compact target and explicitly prohibits padding toward the ceiling.
- Prompt/normalization/syntax focused tests passed: 3 tests passed, 73 skipped.
- Dual-model truncation, terminal failure, and syntax-repair tests passed: 3 tests passed, 35 skipped.
- The real stdin-contract repair path passed in a dedicated dual-model test: 1 test passed, 37 skipped.
- `pnpm --dir apps/desktop typecheck` passed.
- `git diff --check` passed.
- `better-sqlite3` was temporarily rebuilt for Node-based tests and restored to the Electron ABI after each integration-test pass.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The Python execution contract now distinguishes a 6,000-character compact target from the 16,000-character safety ceiling and requires a deterministic, syntax-safe two-line stdin bootstrap. Contract and syntax failures retain one controlled regeneration attempt but now receive accurate, separate guidance and must regenerate from a blank script. A single whole-parameter Markdown code wrapper is normalized without rewriting invalid Python statements.

## Follow-up

Reload the client and run the same Skill once to confirm that production output stays materially below the safety ceiling. Raw scripts remain intentionally absent from telemetry; only safe parameter shape, length, validation result, and trace metadata are logged.
