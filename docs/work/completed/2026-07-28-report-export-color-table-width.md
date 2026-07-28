# Task: Report Export Color And Table Width

- Status: completed
- Owner: human + agent
- Started: 2026-07-28

## Goal

Preserve distinguishable neutral-theme chart colors in exported images and make DOCX tables use the full document width with readable column sizing.

## Scope

Adjust the shared neutral visualization palette, emit explicit SVG series colors, and generate content-aware DOCX table grid widths.

## Non-goals

No report style editor, custom palette picker, or interactive page verification.

## Constraints

Keep the existing report export protocol and A4 document margins unchanged.

## Affected Areas

- Shared visualization theme and renderer
- DOCX report document generator
- Focused visualization and export tests

## Invariants

- Exported charts use the same neutral semantic palette as the application.
- DOCX table widths sum to the A4 body width.
- Existing report Artifact and export IPC semantics remain unchanged.

## Implementation Plan

1. Use neutral semantic colors for the default series palette.
2. Apply explicit series fills to pie, bar, and legend elements.
3. Allocate DOCX table columns from the available body width using content-length weights.
4. Run focused tests, type checking, build, lint, and diff checks.

## Acceptance Criteria

- Pie and bar series no longer export as uniformly black.
- DOCX tables fill the document body and long-content columns receive more width.

## Verification

- Desktop type check passed.
- Visualization and report export focused tests passed: 20 tests.
- Desktop production build passed.
- Focused ESLint and `git diff --check` passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Export snapshots now use explicit neutral semantic series colors. DOCX tables now include a full-width table grid and content-aware cell widths.

## Follow-up

Interactive inspection of representative exported PDF and DOCX files remains a release-check activity.
