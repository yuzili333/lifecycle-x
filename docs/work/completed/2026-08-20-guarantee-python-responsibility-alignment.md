# Task: Align Guarantee Python Responsibility

- Status: completed
- Owner: human + agent
- Started: 2026-08-20

## Goal

Align the guarantee-method report's Python responsibility with the abstraction level used by the working built-in report Skills, reducing script expansion and parameter-generation failures without changing business statistics.

## Scope

- Compare Python-stage instructions and recent model telemetry for guarantee, key-risk-customer, overall-risk, and branch reports.
- Remove the guarantee Skill's natural-language duplication of the report-data Schema.
- Preserve guarantee grouping, risk grouping, count basis, amount conversion, professional-guarantee metric, and reconciliation semantics.
- Add a cross-Skill compactness assertion and update package version coverage.

## Non-goals

- No generic runtime, model timeout, token budget, SQL, report template, or output Schema changes.
- No fallback restoration or executable Skill code.
- No full regression or interactive page validation.

## Constraints

- Python remains statistics-only and consumes the authorized SQL result through stdin.
- Report composition and display formatting remain the report model's responsibility.
- Existing output field names remain defined by the report-data Schema and report template.

## Affected Areas

- `skill/guarantee-method-risk-distribution-report/SKILL.md`
- `skill/guarantee-method-risk-distribution-report/manifest.json`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- The Skill remains a read-only built-in Skill with the same three tools and execution order.
- The five guarantee categories and normal/attention/nonperforming grouping are unchanged.
- Contract de-duplication and valid-row fallback use one consistent grain for counts and amounts.

## Implementation Plan

1. Record instruction-size and runtime behavior differences.
2. Rewrite only the guarantee Python responsibility at the established built-in abstraction level.
3. Update the manifest version and focused assertions.
4. Run package tests, desktop typecheck, diff checks, and design review.

## Acceptance Criteria

- The guarantee Python subsection is comparable in size and structure to the other built-in report Skills.
- It no longer enumerates the full result object or nested Schema keys in prose.
- Required business calculations and tool boundaries remain explicit.
- Focused package tests and typecheck pass.

## Verification

- Python responsibility sizes before the change: overall risk 297 characters, branch asset quality 335, key risk customer 474, and guarantee method 925.
- The guarantee subsection is now 383 characters and six lines, within the same range as the established built-in Skills.
- Recent Run `agent_run_2bbf8984-0fa1-4e75-b51e-45bcb537c526` sent only about 1,798 estimated tokens and received no first model event before the 180,013ms provider timeout. This is provider non-response, not evidence that the required script exceeded the budget.
- Earlier guarantee traces repeatedly consumed all 8,192 completion tokens and produced 33K-34K character incomplete tool arguments. The former Python responsibility uniquely restated every top-level and nested result key, encouraging generated framework expansion.
- Historical run counts are not a controlled benchmark but show the practical gap: guarantee 2 completed of 35 recorded runs, key-risk 3 of 10, and overall-risk 5 of 11. Partial status can include failures outside Python and is not treated as a pure Python success metric.
- Focused Skill package tests passed: 2 tests passed, 13 skipped.
- `pnpm --dir apps/desktop typecheck` passed.
- `git diff --check` passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

The change is limited to the Skill's Python responsibility and focused package assertions. Business rules remain in `统计口径`; result field names remain in the report-data Schema and report template. The execution prompt no longer receives a prose copy of that Schema, and no runtime-specific exception was introduced for this Skill.

## Outcome

The guarantee-method Python responsibility now uses the same concise pattern as the branch, overall-risk, and key-risk Skills: input, required business calculations, compact implementation style, numeric output categories, and report-boundary prohibitions. Manifest version `1.0.15` and the cross-Skill 700-character assertion prevent the verbose result-object contract from returning.

## Follow-up

A fresh live run is required to measure provider behavior with Skill version `1.0.15`. No-first-event provider timeouts remain external to Skill prompt structure and will now fail without the removed high-reliability fallback.
