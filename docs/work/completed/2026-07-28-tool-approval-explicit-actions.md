# Task: Tool Approval Explicit Actions

- Status: completed
- Owner: human + agent
- Started: 2026-07-28

## Goal

Require an explicit approval button choice and make the approval card boundary
clear in dark themes.

## Scope

Remove the card-surface approval action and switch the approval card to the
themed card surface with an emphasized border.

## Non-goals

Do not change approval permissions, IPC, tool execution, or card content.

## Constraints

Keep the Astryx `ClickableCard` requested by the product design and use semantic
theme variants rather than hard-coded colors.

## Affected Areas

- `apps/desktop/src/renderer/src/components/tool-calls/ToolApprovalCard.tsx`
- `apps/desktop/src/main/toolCallStateCard.test.tsx`

## Invariants

- Only "接受" and "拒绝" submit an approval result.
- Both light and dark themes use Astryx semantic surface and border tokens.

## Implementation Plan

1. Remove the card-surface acceptance handler.
2. Use the default card surface and emphasized border.
3. Update the focused rendering assertions.
4. Run the focused test and desktop type checking.

## Acceptance Criteria

- Clicking the card surface does not accept or reject the tool call.
- Button actions retain their existing behavior.
- The approval card has a distinct themed background and border.

## Verification

- `pnpm --dir apps/desktop xds build "dark theme tool approval clickable card with explicit accept and reject buttons"` - completed.
- `pnpm --dir apps/desktop xds component ClickableCard` - completed.
- `pnpm --dir apps/desktop xds docs color` - completed.
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

The approval card surface no longer submits an approval decision. Users must
choose "接受" or "拒绝". The card now uses Astryx's default card surface, which
provides the themed card background and emphasized border in dark mode.

## Follow-up

None.
