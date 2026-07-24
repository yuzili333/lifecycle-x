# Task: Sync Product Documents With Current Implementation

- Status: completed
- Owner: human + agent
- Started: 2026-07-23

## Goal

Use `prototype/补充材料.md` and the current repository implementation to make
the BRD, MVP, and PRD complete, mutually consistent, and explicit about the
difference between business target, MVP target, and implemented capability.

## Scope

- Supplement `prototype/BRD.md`, `prototype/MVP.md`, and `prototype/PRD.md`.
- Add missing background, business value, innovation, and human-review
  boundaries from `prototype/补充材料.md`.
- Record the current implementation status of product modules with repository
  evidence.
- Correct claims that currently describe planned capabilities as implemented.

## Non-goals

- No application code or runtime behavior changes.
- No product renaming.
- No claim that tests, simulated adapters, or generic tool infrastructure prove
  business acceptance.

## Constraints

- Preserve the renderer, IPC, SQL, Python, model-context, and Artifact-lineage
  boundaries in `docs/architecture/boundaries.md`.
- Treat the MySQL metadata/connection adapter as simulated until a real
  integration is implemented and verified.
- Treat PDF/JSON file export and standalone report, lineage, and audit pages as
  planned rather than delivered.

## Affected Areas

- `prototype/BRD.md`
- `prototype/MVP.md`
- `prototype/PRD.md`
- `docs/work/active/sync-product-docs-with-implementation.md`

## Invariants

- The product provides factual analysis assistance and does not make risk
  classifications, approvals, or disposal decisions.
- Models receive controlled schema, summary, and Artifact context rather than
  full source datasets.
- SQL is read-only, permission-controlled, approval-aware, and audited.
- Python consumes controlled datasets and does not connect to business
  databases.
- Current implementation claims are backed by code or tests, not plans.

## Implementation Plan

1. Compare the supplemental material with the three product documents.
2. Audit current modules, UI surfaces, runtime boundaries, and tests.
3. Add document-specific background and value content.
4. Add current-version capability/status matrices and correct scope claims.
5. Run document checks and independently re-read the diff.

## Acceptance Criteria

- All material additions are represented in the appropriate document.
- The three documents use consistent product and human-review boundaries.
- Delivered, partial, and planned capabilities are distinguishable.
- Current CSV, database, SQL, Python, visualization, report, Artifact, Skill,
  Memory, authentication, and settings capabilities are represented.
- Markdown links and repository Harness checks pass.

## Verification

- `pnpm harness:check`: environment wrapper stopped because pnpm attempted a
  non-interactive `node_modules` purge; no dependency mutation was forced.
- `node scripts/verify-harness.mjs`: passed.
- `git diff --check`: passed.
- Manual cross-document and repository-evidence review: passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The BRD, MVP, and PRD now include the supplemental background and business
value, use one consistent human-review boundary, and distinguish delivered,
partial, planned, and unverified capabilities. Claims about MySQL, report
exports, standalone libraries, and business templates now match the current
implementation.

## Follow-up

- Complete real read-only database integration and security verification.
- Implement PDF/JSON file export and export audit before advertising them as
  delivered.
- Build and validate scenario-specific Skills and formal business acceptance
  datasets.
- Productize standalone lineage, report, and audit views if they remain part of
  the target information architecture.
