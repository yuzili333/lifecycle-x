# Task: Tool Approval Clickable Card

- Status: completed
- Owner: human + agent
- Started: 2026-07-28

## Goal

Render pending tool approvals as concise Astryx `ClickableCard` components.

## Scope

Update the pending approval title, remove its visible description, and rename
the approve action to "接受".

## Non-goals

Do not change approval permissions, execution behavior, tool audit logs, or
non-approval tool result rendering.

## Constraints

Use Astryx components and preserve the existing renderer-to-main approval IPC.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/renderer/src/components/tool-calls/`
- `apps/desktop/src/renderer/src/DataAssistantWorkspace.tsx`

## Invariants

- Accept and reject actions continue to target the original tool call.
- Approval descriptions remain available in audit logs but are not rendered in
  the chat card.

## Implementation Plan

1. Add a focused `ToolApprovalCard` based on `ClickableCard`.
2. Route pending approval blocks through the new component.
3. Normalize newly persisted approval block titles and content.
4. Add a focused render test and run desktop type checking.

## Acceptance Criteria

- The card title is `{TOOL} 工具调用权限申请`.
- The card displays only its title and the "接受"/"拒绝" actions.
- The previous approval description and "批准执行" label are absent.

## Verification

- `pnpm --dir apps/desktop xds build "tool execution approval clickable card with accept and reject actions"` - completed.
- `pnpm --dir apps/desktop xds component ClickableCard` - completed.
- `../../node_modules/.bin/vitest run src/main/toolCallStateCard.test.tsx` from `apps/desktop` - 5 passed.
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

Pending tool approvals now render as `ClickableCard` components. The card uses
the normalized `{TOOL} 工具调用权限申请` title, exposes "接受" and "拒绝"
actions, and omits the previous approval description. Newly persisted blocks
also use the concise title and empty visible content.

## Follow-up

None.
