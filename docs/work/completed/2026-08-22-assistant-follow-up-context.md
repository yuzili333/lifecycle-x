# Task: Assistant Follow-up Context

- Status: completed
- Owner: human + agent
- Started: 2026-08-22

## Goal

Allow a follow-up turn in the same conversation to reuse the most recently confirmed Skill and valid CSV field references without requiring the user to select them again.

## Scope

- Resolve reusable Skill and CSV field context before a new Agent Run starts.
- Persist the effective context on the follow-up user message.
- Restore the same context when retrying a failed assistant message.
- Add focused runtime tests.

## Non-goals

- Do not infer a Skill from natural-language report names.
- Do not inherit context across conversations.
- Do not reuse fields from an expired, removed, or different temporary CSV source.
- Do not change ChatComposer's post-send context preview clearing behavior.

## Constraints

- The main process remains the source of truth for persisted conversation context.
- Current explicit selections override inherited values.
- Existing tool approval, Artifact, and data-source boundaries remain unchanged.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`

## Invariants

- A new conversation with no selected Skill remains on the generic Agent path.
- Context is inherited only from prior user messages owned by the same user and conversation.
- Inherited field references must still exist in an active temporary CSV source.

## Implementation Plan

1. Inspect the latest persisted messages and Agent Runs.
2. Add deterministic conversation-context resolution in the main process.
3. Apply the effective context to schema construction, message persistence, Skill loading, and retry.
4. Add focused follow-up and source-isolation tests.
5. Run targeted tests, desktop typecheck, `git diff --check`, and design review.

## Acceptance Criteria

- A second turn can say only “重新生成报告” or another follow-up instruction and retain the prior Skill and valid fields.
- The effective context is visible in the persisted user message and Agent Run input.
- Switching temporary CSV sources does not reuse fields from the old source.
- No Skill is selected automatically in a new conversation.

## Verification

- `pnpm --dir apps/desktop typecheck` passed.
- Focused Vitest `inherits the confirmed Skill and CSV fields for a follow-up turn` passed.
- The focused test verifies effective message and Agent Run context, selected-fields schema rebuilding, and old-field isolation after switching CSV sources.
- `git diff --check` passed.
- Electron `better-sqlite3` ABI was restored and loaded successfully.
- Full regression and interactive page verification were not run, per project guidance.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The main process now resolves the latest confirmed Skill and valid CSV field references before persisting a follow-up message or creating its Agent Run. Explicit current selections override inherited values. Empty composer selections reuse the prior context only within the same conversation, while removed, expired, or different CSV sources invalidate old field references. Retry uses the same persisted-context recovery path.

## Follow-up

Starting a new conversation remains the explicit boundary for leaving a conversation's active Skill context when no replacement Skill is selected.
