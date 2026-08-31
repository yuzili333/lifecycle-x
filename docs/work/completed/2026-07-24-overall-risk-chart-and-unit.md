# Task: Overall Risk Chart And Unit Repair

- Status: completed
- Archived: 2026-08-31
- Owner: human + agent
- Started: 2026-07-24

## Goal

Keep report chart Artifacts renderable when Python analysis returns a JSON
payload through stdout, and require deterministic amount conversion displays
for source fields measured in ten-thousand yuan.

## Evidence

- Conversation `c39b6950-139d-4cb7-b894-8578ff7c22d9` registered two completed
  chart Artifacts and declared both in the report.
- The chart source Artifact contains a JSON execution envelope whose `stdout`
  contains `fiveLevelDistribution`; the resolver only recognizes top-level
  `rows` or `previewRows` and therefore reports the source as expired.
- Python calculated loan balance `373,780.35` and contract amount `765,794.84`
  in ten-thousand yuan, while the report displayed only the source-unit totals.

## Scope

- Resolve bounded nested row arrays from structured Python stdout payloads.
- Project semantic chart fields onto the requested chart field labels.
- Remove unexpanded controlled-visualization template placeholders.
- Require Python and report outputs to include ten-thousand-yuan to
  hundred-million-yuan conversions.
- Add focused resolver, report-normalization, and Skill package tests.

## Constraints

- Preserve Artifact ownership, report declarations, and execution lineage.
- Do not treat a missing Artifact as valid or fabricate chart rows.
- Do not infer units from numeric magnitude or physical field suffixes.
- Do not run full regression or interactive page verification.

## Verification

- Local log and SQLite inspection:
  - Confirmed both chart records and visualization Artifacts completed in
    conversation `c39b6950-139d-4cb7-b894-8578ff7c22d9`.
  - Confirmed the report declared both chart Artifact IDs.
  - Confirmed the Python Artifact stored `fiveLevelDistribution` inside a
    JSON-encoded `stdout` envelope.
  - Confirmed source units were ten-thousand yuan and totals were
    `373,780.35` and `765,794.84`.
- Focused desktop tests:
  - `node ../../node_modules/vitest/vitest.mjs run src/main/reportVisualizationArtifactResolver.test.ts src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts`
  - 3 files passed, 58 tests passed.
- Desktop type check:
  - `pnpm typecheck`
- Mechanical check:
  - `git diff --check`
- Full regression and interactive page verification were not run by request.

## Design Review

- Artifact ownership and report declaration checks still run before any source
  payload is parsed.
- Nested structured-data discovery is bounded to five levels and 200 rendered
  rows. It does not read paths, query databases, or synthesize missing values.
- Candidate arrays must satisfy all declared visualization fields. Exact names
  outrank normalized names and semantic roles, while path relevance separates
  five-level distribution rows from other nested distributions.
- Conventional top-level `rows` and `previewRows` retain their prior validation
  behavior, including expected-Schema failures.
- Amount conversion is driven only by the real source unit. Source-unit values
  remain the basis for tables and ratios; converted values are display-only.
- The change remains in the generic visualization resolver and declarative
  Skill package. No dedicated workflow or report constructor was introduced.

## Outcome

Existing reports whose chart sources use Python stdout JSON envelopes can
resolve their completed chart Artifacts instead of showing them as expired.
New Skill runs require Python to emit chart-compatible distribution keys and
converted totals, and require report summaries and amount conclusions to show
ten-thousand-yuan totals with their hundred-million-yuan equivalents.
