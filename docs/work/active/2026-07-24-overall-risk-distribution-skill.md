# Task: Overall Risk Distribution System Skill

- Status: completed
- Owner: human + agent
- Started: 2026-07-24

## Goal

Add a read-only built-in Skill that uses the selected source's real schema to
query, analyze, chart, and report the overall five-level risk distribution.

## Scope

Create the declarative Skill package, keep field resolution dictionary-free,
define contract-count and amount-unit rules, preserve two chart artifacts in
the generated report, and add focused validation.

## Constraints

- Do not restore the deleted legacy Skill ID or any dedicated workflow.
- Do not embed historical physical field aliases or require a table dictionary.
- Use contract serial number distinct counts when reliable, otherwise use one
  explicit valid-row fallback for the whole report.
- Keep SQL read-only and all Python/chart/report execution in existing tools.

## Acceptance Criteria

- The Skill is listed as a ready, always-enabled system Skill.
- A manually uploaded CSV without a dictionary can be used.
- The report follows the current template and declares its counting basis.
- Amount units come only from real field labels or schema metadata.
- Both chart artifacts are embedded in execution order in one report section.
- Focused tests and desktop type checking pass.

## Verification

- `node ../../node_modules/vitest/vitest.mjs run src/main/skills/SkillManagement.test.ts src/main/assistantRuntime.test.ts`
  - 2 files passed, 49 tests passed.
- `pnpm --filter @lifecycle-x/desktop typecheck`
- `git diff --check`
- Repository scans confirmed the package contains no deleted Skill ID,
  historical physical-field aliases, table-dictionary dependency, or template
  sample values.

## Design Review

- The Skill is declarative and uses the existing system Skill loader and
  generic Agent tool boundary.
- Field existence remains owned by the selected source Schema; Skill content
  cannot bypass local tool validation, approval, or lineage.
- Contract counting uses one explicit data grain for both counts and amounts,
  with a deterministic valid-row fallback.
- Report generation collects all completed chart records from the current
  Assistant message in execution order and only falls back to conversation
  history when the current message has no charts.
- No dedicated workflow, field resolver, executable Skill code, or renderer
  dependency was introduced.

## Outcome

The built-in Skill now guides the planner and executor through detail SQL,
contract-aware Python analysis, two horizontal charts, and a template-matched
report. Planning receives the authorized source Schema only while a Skill is
selected; execution continues to receive the full validated context. Reports
embed any missing current-run visualization Artifacts idempotently and retain
all parent tool lineage.

## Follow-up

- No full regression or interactive page verification was performed, following
  the requested verification scope.
