# Task: Optional Chart Report Generation

- Status: completed
- Owner: human + agent
- Started: 2026-07-25

## Goal

Fix repeated pie-chart parameter generation failures and allow report generation to continue when one or more chart steps fail, omitting failed visualizations.

## Scope

- Synchronize the execution-model chart type Schema with the shared visualization protocol.
- Treat chart dependencies as optional only for report-generation steps.
- Restrict Agent reports to successful chart Artifacts from the current run.
- Omit failed or unavailable visualization content from generated reports.
- Add targeted tests.

## Non-goals

- No local chart fallback or chart-type substitution.
- No changes to SQL/Python execution semantics.
- No full regression or interactive page verification.

## Constraints

- Reports still require successful real query or analysis input.
- Successful charts remain available to reports.
- Failed charts remain visible as failed `tool_calls`.
- Historical chart Artifacts cannot leak into a regenerated report.

## Affected Areas

- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- Targeted desktop tests

## Invariants

- Tool Schema uses the same chart types as the shared validator and renderer.
- A report never references a failed or stale chart Artifact.
- Non-chart dependency failures continue to block downstream report execution.

## Implementation Plan

1. Inspect the latest chart model observation and plan.
2. Synchronize chart type enums.
3. Implement optional chart dependencies for reports.
4. Filter report visualization references to current-run successful charts.
5. Add and run targeted tests and type checking.
6. Complete the independent design review.

## Acceptance Criteria

- `pie` is available in the execution model's chart tool Schema.
- A failed chart does not block a report with valid analysis input.
- Failed chart content is absent from the report.
- A successful sibling chart can still be embedded.
- Non-chart failures continue to block dependent reports.

## Verification

- Latest local run diagnosis:
  - `chart_count` requested a pie chart, but the execution-model tool Schema did not include `pie`.
  - The execution model produced 8,707 characters, exhausted the 4,096-token output limit, ended with `finish_reason=length`, and returned no `tool_calls`.
  - The shared visualization protocol and renderer already supported `pie`; the stale execution Schema was the failure source.
- `ELECTRON_RUN_AS_NODE=1 .electron/dist/Electron.app/Contents/MacOS/Electron ../../node_modules/vitest/vitest.mjs run src/main/assistantDualModelRuntime.test.ts`
  - 24 tests passed.
  - Covers one failed pie chart, one successful sibling bar chart, and successful report generation using only the successful chart.
- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts`
  - 57 tests passed.
- `pnpm --filter @lifecycle-x/desktop typecheck`
  - Passed.
- Full regression and interactive page verification were not run, per repository and user constraints.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The execution model now receives chart types from the shared visualization protocol, eliminating the stale duplicate enum that rejected pie charts. Report orchestration treats only chart dependencies as optional, preserves failures in `tool_calls`, and continues when SQL/Python inputs are valid. Report generation is constrained to successful chart Artifacts from the current message; failed or stale visualization blocks are removed, and the visualization section is omitted when no chart succeeds.

## Follow-up

The targeted integration run emitted an existing `MaxListenersExceededWarning` for shared AbortSignal listeners. It did not affect assertions and is outside this chart/report scope, but should be addressed separately if it also appears in production traces.
