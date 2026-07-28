# Task: Report Export

- Status: completed
- Owner: human + agent
- Started: 2026-07-28

## Goal

Export the selected full-report version as Markdown, PDF, or DOCX with stable Chinese typography and embedded report charts.

## Scope

Add the report toolbar export menu, renderer chart snapshot preparation, typed IPC, trusted main-process Artifact validation, and local PDF/DOCX/Markdown writers.

## Non-goals

No export style editor, bundled FangSong font, model call, server API, or remote upload.

## Constraints

Renderer uses preload IPC only. Report and visualization lineage must be validated in main. PDF/DOCX export must fail if any declared chart cannot be rendered.

## Affected Areas

- Desktop report window and visualization renderer
- Electron preload and main IPC
- Shared report export protocol
- Desktop package dependencies and focused tests

## Invariants

- Export always targets the currently selected report version.
- Markdown remains the report Artifact source.
- Internal Artifact IDs and local paths do not appear in PDF/DOCX output.
- Existing report rendering and tool execution semantics remain unchanged.

## Implementation Plan

1. Add shared export types and trusted report-version resolution.
2. Add local Markdown, PDF, and DOCX generation service.
3. Add renderer visualization snapshot preparation and export menu.
4. Add focused tests and run desktop mechanical checks.
5. Complete an independent design review.

## Acceptance Criteria

- The full report toolbar offers PDF, DOCX, and Markdown export.
- PDF/DOCX preserve headings, body text, bold, lists, tables, and charts.
- Default typography uses FangSong-compatible system fonts, 14pt headings, and 10pt body text.
- Failed chart resolution or rendering prevents partial PDF/DOCX output.
- Cancelling the save dialog is silent and successful exports show a Toast.

## Verification

- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- `pnpm desktop:build` passed.
- Export, evidence, and visualization focused tests passed: 32 tests.
- Focused ESLint passed with zero errors; four pre-existing hook warnings remain in touched legacy components.
- `git diff --check` passed.
- Full regression and interactive page verification were not run, as requested.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Added local Markdown, A4 PDF, and DOCX export for the selected report version. Export revalidates report lineage in main, expands evidence, embeds validated chart snapshots, and keeps filesystem access outside Renderer.

## Follow-up

- FangSong remains a system-font dependency; DOCX viewers may substitute it when unavailable.
- Interactive visual verification of generated files remains a release-check activity.
