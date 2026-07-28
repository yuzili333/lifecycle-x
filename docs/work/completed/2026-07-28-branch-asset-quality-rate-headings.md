# Task: Branch Asset Quality Rate Headings

- Status: completed
- Owner: human + agent
- Started: 2026-07-28

## Goal

Remove the amount metric prefix from the final two rate headings in the branch
asset quality report.

## Scope

Update the Skill report template, instructions, manifest version, and focused
package assertions.

## Non-goals

Do not change rate formulas, default amount metric selection, unit conversion,
or report data Schema.

## Constraints

The first rate pair remains count-based and the final rate pair remains
amount-based even though the displayed headings are identical.

## Affected Areas

- `skill/branch-asset-quality-report/`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- Default amount statistics use loan balance in ten-thousands.
- Count and amount rates continue to use their respective denominators.

## Implementation Plan

1. Replace the final two dynamic rate headings with the concise static labels.
2. Clarify duplicate heading semantics in the Skill instructions.
3. Update the package version and focused assertions.
4. Run Skill validation and type checking.

## Acceptance Criteria

- The final two headings are `不良率%` and `关注率%`.
- The report template no longer renders the amount business name in rate
  headings.
- Default amount calculations still use loan balance in ten-thousands.

## Verification

- Skill manifest and JSON files parse successfully.
- `../../node_modules/.bin/vitest run src/main/skills/SkillManagement.test.ts` from `apps/desktop` - 12 passed.
- `../../node_modules/.bin/tsc --noEmit` from `apps/desktop` - passed.
- Old amount-prefixed rate heading variables are absent from the Skill package.
- `git diff --check` - passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The final amount-rate headings now render as `不良率%` and `关注率%` without
an amount metric prefix. Skill instructions explicitly preserve the distinction
between the count-rate pair and amount-rate pair by column position and formula.
The default amount metric remains loan balance in ten-thousands.

## Follow-up

None.
