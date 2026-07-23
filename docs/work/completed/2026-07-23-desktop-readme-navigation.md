# Task: Desktop README Harness Navigation

- Status: completed
- Owner: human + agent
- Started: 2026-07-23

## Goal

Make the desktop package README lead contributors back to the repository map
and root verification workflow.

## Scope

Add concise links and commands to `apps/desktop/README.md`.

## Non-goals

No desktop code, Astryx rules, runtime behavior, or package scripts change.

## Constraints

Do not duplicate the root repository map or architecture documents.

## Affected Areas

`apps/desktop/README.md`.

## Invariants

Existing package-specific start commands remain valid.

## Implementation Plan

1. Add root Harness navigation.
2. Run Harness checks and inspect the documentation diff.
3. Complete the design review and archive this record.

## Acceptance Criteria

- Desktop README links to the root Agent map and repository map.
- Desktop README names the root fast verification command.
- Harness checks remain green.

## Verification

- `node scripts/verify-harness.mjs`: passed before and after the change.
- `git diff --check`: passed.
- Manual link review: all three README links resolve to repository files.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The package README now points to the root Agent map, repository map, nested UI
rules, and fast verification entry. No package or runtime behavior changed.

## Follow-up

None.
