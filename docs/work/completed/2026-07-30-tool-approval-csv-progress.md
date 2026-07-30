# Task: Tool Approval And CSV Progress

- Status: completed
- Owner: human + agent
- Started: 2026-07-30

## Goal

Move tool approval into ChatComposer Feedback and expose local CSV import progress.

## Scope

Update the desktop renderer, preload-compatible shared types, temporary CSV
manager events, and focused tests.

## Non-goals

Do not change the approval state machine, add CSV import cancellation, remove
legacy `no_access` protocol support, or run full regression and page validation.

## Constraints

Keep Renderer access behind preload IPC, preserve conversation-scoped temporary
CSV isolation, and retain durable pending approval state.

## Affected Areas

- `apps/desktop/src/renderer/src/DataAssistantWorkspace.tsx`
- `apps/desktop/src/renderer/src/components/tool-calls/`
- `apps/desktop/src/main/chatCsvTempSource.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- Focused desktop tests

## Invariants

- Approval remains explicit and idempotent.
- Old `no_access` requests remain blocked by the main process.
- CSV progress events never expose local paths or source contents.
- Removed in-progress attachments ignore subsequent progress updates.

## Implementation Plan

1. Replace message approval cards with a composer Feedback drawer.
2. Remove approval actions from tool call rows and Python text shortcuts.
3. Add CSV attachment progress types and stream events.
4. Emit read, validation, parse, import, completion, and failure progress.
5. Render aggregate progress in ChatComposer header context.
6. Add focused tests and run desktop checks.

## Acceptance Criteria

- Permission UI exposes only request approval and full access.
- Pending approvals appear only in ChatComposer Feedback.
- Approval options submit immediately and cannot be double-submitted.
- CSV progress advances monotonically through local processing stages.
- Completed imports hide progress and retain attachment metadata.

## Verification

- Focused desktop tests
- Desktop typecheck
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

Tool approval now uses a composer Feedback drawer and no longer renders message
cards or tool-row actions. Temporary CSV imports emit correlated progress from
file read through SQLite completion and render one weighted progress bar.

Verification:

- Desktop typecheck passed.
- 23 focused approval and CSV tests passed.
- Runtime CSV event test was added but could not run locally because the checked
  out `better-sqlite3` binary targets Electron ABI 130 while the Node test
  process requires ABI 137.
- `git diff --check` passed.

## Follow-up

Run the runtime CSV event test in the repository's ABI-rebuilding verification
harness when a full verification cycle is next requested.
