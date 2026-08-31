# Task: Overall Risk Chart Materialization

- Status: completed
- Archived: 2026-08-31
- Owner: human + agent
- Started: 2026-07-24

## Goal

Make generated report charts self-contained after authorized Python aggregation,
and update converted amount totals to display only the converted value.

## Evidence

- The latest report Run completed both chart tools and preserved complete
  Python/chart/report lineage.
- The generated report still contained a placeholder removed by the source
  fix, and its timestamp preceded the rebuilt desktop main bundle. The running
  main process therefore used stale code.
- Latest Python output exposes exact `category`, `count`, and `loanBalance`
  fields, so the current source resolver can read it once loaded.
- The report still displays the original ten-thousand-yuan total alongside a
  rounded hundred-million-yuan value.

## Scope

- Materialize small authorized Python aggregate rows into generated chart
  Artifacts while preserving source lineage.
- Keep report-time Artifact permission and ownership validation.
- Define exact converted display strings in the Skill output contract.
- Require contract amount in detail SQL whenever the real source field exists.
- Update focused tests, Skill version, and task documentation.

## Constraints

- Never inline raw source rows or data over the visualization limits.
- Do not infer units from numeric magnitude or physical suffixes.
- Do not mutate historical report Markdown.
- Do not run full regression or interactive page verification.

## Verification

- Local log and SQLite inspection:
  - Latest message `optimistic-855e2a52-2180-4c30-a7dc-c83eac2a31eb`
    completed SQL, Python, two chart tools, and report generation.
  - Both chart records have the current Python Artifact in
    `sourceArtifactIds`; both chart IDs are declared by report version 2.
  - Python output contains exact `category`, `count`, and `loanBalance`
    distribution fields.
  - The report timestamp preceded the rebuilt main bundle and retained a
    placeholder already removed in source, confirming stale runtime code.
- Focused desktop tests:
  - `node ../../node_modules/vitest/vitest.mjs run src/main/reportVisualizationArtifactResolver.test.ts src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts`
  - 3 files passed, 58 tests passed.
- Desktop type check:
  - `pnpm typecheck`
- Desktop targeted build:
  - `pnpm desktop:build`
  - Main, preload, and renderer bundles completed successfully.
- Bundle inspection confirmed chart materialization and placeholder removal are
  present in `apps/desktop/out/main/index.js`.
- Mechanical check:
  - `git diff --check`
- Full regression and interactive page verification were not run by request.

## Design Review

- Only small structured Python aggregates that satisfy all declared chart
  fields are materialized. Raw SQL datasets and over-limit results remain
  Artifact-backed.
- Inline rows are restricted to scalar JSON values and the existing 200-row
  visualization limit.
- The chart record still retains Python and SQL source Artifact lineage, while
  the stored visualization becomes independent of later source expiration.
- Report-time ownership, report declaration, chart ownership, and
  VisualizationSpec validation remain mandatory.
- Converted totals are computed from the real unit using decimal rules.
  Source-unit totals remain available for tables and audit but are omitted from
  summary and conclusion display text.
- No historical report is rewritten and no dedicated Agent workflow was added.

## Outcome

New charts based on Python aggregate Artifacts store validated inline chart
rows and no longer depend on reparsing temporary upstream content when a report
is opened. Skill version `1.0.2` requires final converted display strings, shows
only the converted total in report prose, and uses “约” only when an explicit
display precision causes rounding.
