# Task: Evidence Card Content

- Status: completed
- Owner: human + agent
- Started: 2026-07-30

## Goal

Make report evidence scopes, execution records, lineage, and validation language
clear and verifiable for business users.

## Scope

Persist actual Skill/SQL field usage, improve system-built EvidenceCard content,
and update the shared Markdown representation used by reports and exports.

## Non-goals

Do not rebuild historical evidence artifacts, change evidence IPC, expose tool
scripts, or alter model-authored report content.

## Constraints

Evidence remains system-built from persisted tool and Artifact records. Missing
relationships or fields are reported explicitly and never inferred.

## Affected Areas

- Desktop assistant tool metadata
- Evidence card builder and shared evidence Markdown
- Evidence, report rendering, and export tests

## Invariants

- Existing EvidenceCard artifacts remain readable.
- Renderer access continues through preload IPC.
- SQL/Python source text, local paths, and credentials remain hidden.

## Implementation Plan

1. Persist Skill ID and actual SQL output field names.
2. Build ordered, validated analysis field scope.
3. Render concise execution records and direct source lineage.
4. Map validation codes to business-readable labels.
5. Run focused tests, typecheck, diff checks, and design review.

## Acceptance Criteria

- User and Skill fields are ordered, deduplicated, and verifiable.
- Low-value execution fields and Artifact versions are absent from reports.
- Source-to-report lineage uses direct source and formation descriptions.
- Historical evidence renders with the new labels without data migration.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/evidenceCard.test.tsx src/main/reportExportService.test.ts src/main/reportExportDocument.test.ts` passed: 23 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- Focused ESLint passed.
- `git diff --check` passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Tool records now preserve the selected Skill and actual SQL output fields for
future evidence construction. Evidence scopes ignore invalid field tokens,
lineage is rendered as direct source and formation relationships, execution
records are concise, and stable validation codes render business-readable
labels for both new and historical cards.

## Follow-up

Historical evidence artifacts are intentionally not rebuilt; only their shared
Markdown presentation uses the new labels and layout.
