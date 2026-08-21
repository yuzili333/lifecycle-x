# Task: Python Script Preflight Line 1

- Status: completed
- Owner: human + agent
- Started: 2026-08-18

## Goal

Prevent execution-model Python parameters from saturating the script limit and failing local preflight with a misleading line-one syntax error.

## Scope

Adjust the Python execution parameter contract, local preflight ordering, one-shot repair guidance, and focused tests.

## Non-goals

Do not add local business-analysis scripts, change Python runtime permissions, or run the full regression suite.

## Constraints

Python remains model-generated, locally validated, standard-library-only, and limited to statistical calculation over authorized artifacts.

## Affected Areas

- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- Focused desktop tests

## Invariants

- Invalid Python never reaches approval or execution.
- A failed parameter generation receives at most one pre-execution repair.
- Report composition remains the report model's responsibility.

## Implementation Plan

1. Confirm the latest run's model output shape and validation sequence.
2. Replace schema-length anchoring with a deterministic local hard limit.
3. Make compact-script and import guidance explicit for initial and repair prompts.
4. Add focused tests for saturated scripts and repair behavior.
5. Run targeted verification and design review.

## Acceptance Criteria

- A script over the local hard limit is rejected before AST parsing with an actionable length error.
- The repair request targets a materially shorter script and limited imports.
- Normal valid scripts still pass local preflight and execute unchanged.

## Verification

- Latest run audit: both Python responses were parseable tool calls but had `script` lengths of 8000 and 7999 characters; the first exceeded the import guard and the repair then failed AST parsing on line 1.
- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts` (72 tests passed).
- `pnpm exec vitest run src/main/assistantDualModelRuntime.test.ts -t "repairs a saturated Python script"` (1 focused integration test passed).
- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- `git diff --check` passed.
- Native `better-sqlite3` was restored to the Electron ABI after the focused integration test.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The execution-tool Schema no longer advertises a numeric `maxLength` that the observed model treated as a target. Python parameters are now bounded deterministically in the main-process preflight at 6000 characters before AST parsing, while initial and repair prompts target 2500-4500 characters and at most eight standard-library imports. Saturated output is rejected before approval or execution, and the existing one-shot repair path receives the concrete validation reason.

## Follow-up

The model provider still may return unusually verbose scripts. Existing parameter-shape telemetry records script length without logging script content; future model regressions can be diagnosed from that signal.
