# Task: Guarantee Method Risk Distribution Skill

- Status: completed
- Owner: human + agent
- Started: 2026-08-17

## Goal

Add a read-only built-in Skill that generates the guarantee-method risk distribution report from the selected data source and the provided report template.

## Scope

- Add the built-in Skill package, manifest, tool policy, input schema, output schema, and report template.
- Define dynamic field binding, guarantee-method grouping, count and amount metrics, reconciliation, and report constraints.
- Add focused Skill validation and catalog tests.

## Non-goals

- Add a dedicated Agent route or hard-coded physical field mapping.
- Add charts not present in the report template.
- Change the general SQL, Python, report, or approval runtime.

## Constraints

- Use only fields verified in the selected data source Schema.
- Do not require a table dictionary or business field ID.
- SQL returns detail rows; Python performs all grouping and calculations.
- Template example values and inconsistent example conclusions must never enter generated reports.

## Affected Areas

- `skill/guarantee-method-risk-distribution-report/`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- The Skill remains client-only, read-only, and always enabled as a system Skill.
- Contract counts and amount totals use one consistent record grain.
- Report totals reconcile exactly with category rows before report generation.

## Implementation Plan

1. Extract field roles, categories, formulas, and report layout from the latest template.
2. Create the built-in Skill package with dynamic field binding and deterministic analysis rules.
3. Add package validation and catalog tests.
4. Run focused tests, typecheck, diff checks, and design review.

## Acceptance Criteria

- The Skill appears as an enabled read-only system Skill.
- It requests SQL, Python, and Markdown report tools in order.
- It produces five guarantee categories plus a reconciled total row using real data.
- Counts, amounts, nonperforming rates, and attention rates match deterministic formulas.
- No example values, fixed physical mappings, or template-only recommendations are emitted.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/skills/SkillManagement.test.ts` - passed, 14 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck` - passed.
- `git diff --check` - passed.
- Confirmed the package contains only the manifest, instructions, template, two schemas, and tool policy.
- Full regression and interactive page validation were not run, per project instruction.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Added `guarantee-method-risk-distribution-report` as a read-only built-in Skill. It dynamically binds real fields, groups source guarantee-method values into five report categories, applies a consistent contract or valid-row grain, converts the selected amount metric to the confirmed display unit with Decimal arithmetic, reconciles all category and total metrics, and renders the template without charts or example values.

## Follow-up

None currently.
