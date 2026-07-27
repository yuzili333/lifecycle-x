# Task: Skill Management

- Status: completed
- Owner: human + agent
- Started: 2026-07-24

## Goal

Replace the hardcoded single-Skill flow with secure local system and per-user
personal Skill management, dynamic ChatComposer selection, and generic Agent
runtime loading.

## Scope

Add Skill package validation, ZIP installation, per-user state, typed IPC,
settings UI, dynamic chat selection, generic runtime prompt loading, packaging,
and removal of the overall-risk-specific Skill and runtime branches.

## Non-goals

No marketplace, remote download, auto-update, export, signing, synchronization,
or executable Skill code.

## Constraints

Preserve `AssistantSendInput.skill` and the existing workbench settings shape.
Renderer code uses preload IPC only. System Skills are read-only; personal
Skills are user-isolated and declarative.

## Affected Areas

Electron main/preload, Workbench settings, ChatComposer, Agent runtime, server
settings compatibility, system Skill packaging, and focused tests.

## Invariants

- Skill content cannot bypass tool safety, approval, or data-source ownership.
- Installation is validated before entering the active Skill directory.
- Disabled, missing, or invalid Skills are not silently replaced.
- Existing user messages retain their selected Skill identifier.

## Implementation Plan

1. Define shared Skill protocols and secure package validation.
2. Implement system/personal registry, state, installation, and audit.
3. Add typed IPC and runtime resolution.
4. Add the settings panel and dynamic ChatComposer catalog.
5. Remove the overall-risk Skill and dedicated code paths.
6. Run focused checks and complete design review.

## Acceptance Criteria

- System and personal Skills are listed with correct capabilities.
- ZIP installation validates structure and defaults personal Skills to enabled.
- Personal Skills can be toggled and deleted; system Skills cannot.
- ChatComposer lists only enabled, valid Skills and supports `@` filtering.
- Agent runs load the selected Skill from the registry without hardcoded IDs.
- No overall-risk-specific Skill package or execution branch remains.

## Verification

- `pnpm --filter @lifecycle-x/desktop typecheck`
- `pnpm --filter @lifecycle-x/server typecheck`
- `node ../../node_modules/vitest/vitest.mjs run src/main/skills/SkillManagement.test.ts src/main/chatToolSelector.test.ts src/main/assistantRuntime.test.ts`
  - 3 files passed, 54 tests passed.
- `pnpm --filter @lifecycle-x/server test`
  - 7 files passed, 76 tests passed.
- `git diff --check`
- Electron packaging resource configuration was inspected: `skill/` is copied
  to `resources/skills/built-in`.
- Repository scan confirmed that
  `overall-risk-classification-distribution` no longer exists under
  `apps/` or `skill/`.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Skill management now uses a generic declarative package model. System Skills
are resolved from the development or packaged resource directory and remain
read-only. Personal Skills are installed from validated ZIP packages into a
per-user hashed directory, indexed atomically, and can be enabled, disabled,
or removed through typed IPC.

Workbench settings and ChatComposer share the same dynamic catalog. Agent runs
resolve the selected Skill into an immutable snapshot, persist that snapshot
for approval recovery, enforce restrictive tool policy, and inject declarative
content below system safety rules. The former overall-risk package, field
scope, report builder, and dedicated workflow were removed.

## Follow-up

- The current Node shell cannot load the repository's existing
  `better-sqlite3` binary because its Node ABI differs from the installed
  binary. Rebuild native dependencies before a future full desktop suite.
- No full regression or interactive page validation was performed, following
  the requested verification scope.
