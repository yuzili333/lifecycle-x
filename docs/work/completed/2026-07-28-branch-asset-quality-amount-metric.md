# Task: Branch Asset Quality Amount Metric

- Status: completed
- Owner: human + agent
- Started: 2026-07-28

## Goal

Align the branch asset quality Skill with the updated amount-column headings and
make loan balance in ten-thousands the default amount metric.

## Scope

Update Skill instructions, report template, schemas, manifest version, and
focused package assertions.

## Non-goals

Do not change the Agent runtime, tool order, SQL/Python safety boundaries, or
branch reconciliation logic.

## Constraints

Use only real source fields and deterministic unit conversion. Preserve the
existing report result field names to avoid destabilizing Python reconciliation.

## Affected Areas

- `skill/branch-asset-quality-report/`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- User-selected amount fields override the default.
- Without an explicit override, the amount metric is loan balance displayed in
  ten-thousands.
- Unknown source units are never guessed.

## Implementation Plan

1. Define the default amount metric and conversion rules.
2. Update the four amount-column headings to show only their unit.
3. Extend report metadata for amount business name and display unit.
4. Validate the Skill package and run focused tests.

## Acceptance Criteria

- Default headings render as `正常(万)`, `关注(万)`, `不良(万)`, and `合计(万)`.
- Default amount rates are based on loan balance.
- Explicit user amount metric selections remain supported.

## Verification

- Skill manifest and both JSON Schema files parse successfully.
- `../../node_modules/.bin/vitest run src/main/skills/SkillManagement.test.ts` from `apps/desktop` - 12 passed.
- `../../node_modules/.bin/tsc --noEmit` from `apps/desktop` - passed.
- `git diff --check` - passed.
- `quick_validate.py` was attempted but its standalone Python environment does
  not contain PyYAML; the repository's production Skill validator passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The Skill now defaults to loan balance displayed in ten-thousands, converts
confirmed source units deterministically, and supports explicit amount metric
overrides. The four amount headings display only their unit, while the amount
rate headings retain the selected business metric name.

## Follow-up

None.
