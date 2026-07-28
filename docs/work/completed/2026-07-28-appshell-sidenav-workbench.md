# Task: AppShell SideNav Workbench

- Status: completed
- Owner: human + agent
- Started: 2026-07-28

## Goal

Move the desktop workbench from TopNav to a fixed SideNav with native hash
routing, shared conversation navigation, a database-only management page, and a
simplified settings dialog.

## Scope

- Add `#/home` and `#/database` route handling.
- Move conversation navigation into the AppShell SideNav.
- Add the SideNav user menu and database return action.
- Remove the persistent CSV management page and desktop menu entry.
- Remove the settings logout tab and constrain Skill content layout.

## Non-goals

- Do not remove temporary conversation CSV uploads.
- Do not remove server-side CSV compatibility APIs or historical CSV sources.
- Do not change Electron product identity, window title, or icons.
- Do not add SideNav collapse behavior.

## Constraints

- Renderer continues to use preload IPC only.
- Preserve mounted assistant state through React Activity.
- Use existing Astryx components and project theme tokens.
- Do not run full regression or interactive page verification.

## Affected Areas

- `apps/desktop/src/renderer/src/WorkbenchShell.tsx`
- `apps/desktop/src/renderer/src/DataAssistantWorkspace.tsx`
- `apps/desktop/src/renderer/src/DataManagementWorkspace.tsx`
- `apps/desktop/src/renderer/src/SkillManagementPanel.tsx`
- `apps/desktop/src/renderer/src/styles.css`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/main/index.ts`

## Invariants

- Conversation drafts and active Agent runs survive route changes.
- Database permissions still gate the database route and menu actions.
- Conversation-scoped CSV attachments and field selection remain available.
- Logout uses the existing confirmation and authentication cleanup path.

## Implementation Plan

1. Add native hash route parsing and permission fallback.
2. Add the AppShell SideNav and conversation navigation bridge.
3. Remove the assistant-local history panel.
4. Reduce data management to the database surface and add Return to App.
5. Remove persistent CSV desktop actions and the settings logout tab.
6. Add focused tests and run agreed mechanical checks.

## Acceptance Criteria

- The workbench has no TopNav and SideNav is fixed open.
- SideNav shows brand, Navigation, Recent conversations, and the bottom user menu.
- New Conversation and conversation selection navigate to Home before acting.
- Database is available at `#/database` and has a Return to App action.
- Persistent CSV page and app menu entry are absent; chat CSV still works.
- Settings has four tabs and Skill descriptions cannot create horizontal scroll.

## Verification

- `CI=true pnpm --filter @lifecycle-x/desktop typecheck` - passed.
- `node ../../node_modules/vitest/vitest.mjs run src/main/workbenchRoute.test.ts` - 4 tests passed.
- Follow-up SideNav refinement: `pnpm --filter @lifecycle-x/desktop typecheck` - passed.
- Follow-up Database/conversation routing refinement:
  `pnpm --filter @lifecycle-x/desktop typecheck` - passed.
- Source checks confirmed the removed TopNav, persistent CSV route/actions, and
  settings logout tab are absent.
- Source checks confirmed temporary conversation CSV IPC and renderer usage remain.
- `git diff --check` - passed.
- An accidental desktop package test invocation ran 332 tests: 304 passed and
  28 failed because `better-sqlite3` was built for Node ABI 130 while the test
  process requires ABI 137. The focused test above does not load that native
  dependency and passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

- AppShell now uses a fixed SideNav with brand, Navigation, Recent, and user footer zones.
- Native hash routing controls preserved Assistant and Database activities.
- Conversation navigation moved from the Assistant view into the SideNav through
  a narrow renderer-only snapshot/handle protocol.
- Persistent CSV management UI and desktop actions were removed while temporary
  chat CSV behavior and server compatibility remain intact.
- Settings now has four tabs and constrains long Skill content without nested or
  horizontal scrolling.
- Post-login Home rendering now uses a stable empty-message reference, and
  navigation Handle publication only updates the parent when a queued action is
  waiting. This prevents the parent/child update cycle that previously caused
  React's `Maximum update depth exceeded` error after restart.
- Navigation now stays in SideNav's fixed top content while only the Recent
  conversation list scrolls. Overflowing conversation titles use measured,
  reduced-motion-aware hover marquee animation.
- Recent conversation and user action menus use accessible icon-only dropdown
  triggers without hover tooltips. The user row uses the footer icon slot to
  avoid the empty footer row and duplicate padding that previously added height.
- Database now uses the full content area without a Return to App toolbar.
  Restoring the Home Activity reuses the loaded conversation catalog, so a
  conversation selected from Database remains selected instead of being
  overwritten by the default conversation initialization.

## Follow-up

- The repository's `better-sqlite3` native module must be rebuilt for the active
  Node test ABI before unrelated SQLite-backed desktop tests can run.
