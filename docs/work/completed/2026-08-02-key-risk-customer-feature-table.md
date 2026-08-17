# Task: Key Risk Customer Feature Table

- Status: completed
- Owner: human + agent
- Started: 2026-08-02

## Goal

Update the built-in key-risk-customer report Skill so nonperforming customer details in the feature analysis render as a verified Markdown table.

## Scope

- Update Skill instructions and report template.
- Add structured feature-analysis data to the report Schema.
- Add reconciliation requirements for nonperforming detail rows.
- Increment the built-in Skill version.

## Non-goals

- Change the generic Agent workflow or report renderer.
- Change field binding, risk classification, or amount calculations.
- Copy example values from the report template.

## Constraints

- The table must contain every and only nonperforming contract from the analyzed risk-customer set.
- Missing auxiliary values display `--`; values must not be inferred.
- Output remains Markdown and uses the existing SQL, Python, and report tools.

## Affected Areas

- `skill/key-risk-customer-analysis-report/`

## Invariants

- All figures come from the complete Python analysis result.
- Detail counts and balances reconcile to the report totals.
- No template sample customer or value enters generated output.

## Implementation Plan

1. Model feature analysis as structured report data.
2. Add the nonperforming customer Markdown table to the report template.
3. Tighten Skill execution and validation instructions.
4. Validate JSON and run targeted checks.

## Acceptance Criteria

- Feature item (2) renders a Markdown table with the updated template columns.
- The table is omitted with an explicit statement when there are no nonperforming records.
- Table rows reconcile to the nonperforming count and risk-customer details.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/skills/SkillManagement.test.ts`: passed, 13 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck`: passed.
- `jq empty` for the Skill manifest, input Schema, report Schema, and tool policy: passed.
- Legacy `featureConclusions` and `numbered_feature_conclusions` references are absent from the Skill package.
- `git diff --check`: passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Skill version 1.1.0 now models feature analysis as structured data. Feature item (2) renders all and only nonperforming contracts in a Markdown table, and a required validation flag confirms row membership, count, and loan-balance reconciliation. No-nonperforming cases state the result without rendering an empty table.

## Follow-up

None currently.
