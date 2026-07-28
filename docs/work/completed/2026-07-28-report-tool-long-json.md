# Task: Report Tool Long JSON Failure

- Status: completed
- Owner: human + agent
- Started: 2026-07-28

## Goal

Prevent long Markdown reports from failing because model-generated tool-call JSON is truncated or malformed.

## Scope

Use direct Markdown streaming for the report execution step, then invoke the existing local report tool with locally constructed and validated parameters.

## Non-goals

Do not change SQL, Python, chart execution, report Artifact semantics, approval rules, or renderer behavior.

## Constraints

Preserve Agent Run lineage, cancellation, progress streaming, local report validation, and tool call records.

## Affected Areas

- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`

## Invariants

- Models do not access data sources directly.
- Reports use only injected Artifact summaries.
- The existing report tool remains responsible for report registration and post-processing.

## Implementation Plan

1. Add a direct Markdown execution path for report steps.
2. Invoke the existing report handler locally with a synthetic model tool call ID.
3. Add focused tests for successful long report output and truncated output rejection.
4. Run desktop report tests and type checking.

## Acceptance Criteria

- Report Markdown is no longer transported inside provider tool-call JSON.
- A valid Markdown response creates the normal report tool record and Artifact.
- Empty or token-truncated output fails explicitly without creating a partial report.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/agentOrchestration/thinkingOptimization.test.ts src/main/assistantDualModelRuntime.test.ts` - 45 passed.
- `../../node_modules/.bin/vitest run src/main/agentOrchestration/thinkingOptimization.test.ts` after the final ToolRegistry review change - 19 passed.
- `../../node_modules/.bin/tsc --noEmit` from `apps/desktop` - passed.
- `git diff --check` - passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Report generation now streams Markdown directly from the execution model and invokes the existing local report tool through `ToolRegistry` with deterministic parameters. Long report content no longer depends on provider function-call JSON serialization, and token-truncated output is rejected before Artifact registration.

## Follow-up

None.
