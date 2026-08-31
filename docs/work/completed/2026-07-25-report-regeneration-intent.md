# Task: Report Regeneration Intent

- Status: completed
- Archived: 2026-08-31
- Owner: human + agent
- Started: 2026-07-25

## Goal

Ensure an explicit follow-up such as "重新生成报告" reaches model intent routing and can reuse conversation Artifacts instead of being consumed by a stale blocking guidance checkpoint.

## Scope

- Detect explicit query, analysis, visualization, and report commands before guided-workflow resume.
- Cancel stale blocking guidance checkpoints while preserving completed tool results and Artifacts.
- Clarify task-router handling for short follow-up commands.
- Add targeted tests.

## Non-goals

- No deterministic report plan or hard-coded Skill workflow.
- No changes to report rendering, tool execution, or Artifact semantics.
- No full regression or interactive page verification.

## Constraints

- Model intent recognition remains the source of the next execution plan.
- Existing completed tool calls and Artifacts remain available to the model.
- Workflow cancellation commands retain their current behavior.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- Targeted desktop tests

## Invariants

- A stale checkpoint cannot block a clear new task.
- Ambiguous supplements can still resume a recoverable workflow.
- No local prebuilt plan is introduced.

## Implementation Plan

1. Record the failing checkpoint and message path from local logs.
2. Add an explicit-task checkpoint bypass.
3. Strengthen model routing instructions for short follow-up commands.
4. Add and run targeted tests and desktop type checking.
5. Complete the independent design review.

## Acceptance Criteria

- "重新生成报告" bypasses a stale blocking guidance checkpoint.
- The request proceeds to model routing with historical Artifact context.
- Cancellation prompts and genuine workflow supplements remain unaffected.

## Verification

- Local log review:
  - Conversation `5bf5ae6a-f2e0-4800-9c52-050db6f7c8ad` retained a blocking `recoverable_error` checkpoint after Python tool failure.
  - The next "重新生成报告" message was consumed by checkpoint recovery and persisted as the legacy "想执行哪类数据任务？" guidance instead of creating an Agent Run.
- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantRuntime.test.ts`
  - Passed: 44 tests.
- `ELECTRON_RUN_AS_NODE=1 .electron/dist/Electron.app/Contents/MacOS/Electron ../../node_modules/vitest/vitest.mjs run src/main/assistantDualModelRuntime.test.ts`
  - Passed: 22 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck`
  - Passed.
- Full regression and interactive page verification were not run, per current task constraints.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Explicit data tasks now invalidate only the stale blocking checkpoint and continue through the configured model orchestration. Completed tool results and Artifact pointers remain in conversation context. The task-router prompt now treats short follow-up report, chart, and analysis commands as executable intents. Legacy dual-model planning also preserves valid model `respond` or `clarify` output rather than replacing it with an empty-plan completion summary.

## Follow-up

No deferred work.
