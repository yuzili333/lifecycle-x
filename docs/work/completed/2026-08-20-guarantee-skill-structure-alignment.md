# Task: Align Guarantee Skill Structure

- Status: completed
- Owner: human + agent
- Started: 2026-08-20
- Completed: 2026-08-20

## Goal

Align the guarantee-method risk distribution Skill with the established built-in report Skill structure and tool responsibility style so SQL and Python parameter generation receive concise, unambiguous instructions.

## Scope

- Compare the guarantee Skill with the key-risk, branch, and overall-risk built-in Skills.
- Restore the standard `目标与字段` and `统计口径` sections.
- Align SQL, Python, and report responsibilities with the established wording level.
- Update the Skill version and focused package assertions.

## Non-goals

- No changes to the generic Agent runtime, tool protocols, output Schema, or report template.
- No increase to model output budgets.
- No full regression or interactive page validation.

## Constraints

- Preserve the existing guarantee grouping, risk grouping, count basis, amount unit, and reconciliation semantics.
- Do not introduce historical physical-field mappings or table-dictionary dependencies.
- Keep SQL query-only, Python statistics-only, and report composition model-only.

## Affected Areas

- `skill/guarantee-method-risk-distribution-report/SKILL.md`
- `skill/guarantee-method-risk-distribution-report/manifest.json`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- The Skill remains a read-only built-in Skill with the same required tool order.
- Python output remains structured numeric analysis data rather than Markdown.
- SQL returns source detail rows rather than report aggregates.

## Implementation Plan

1. Record the structural and runtime-log differences.
2. Rewrite the Skill using the built-in report section sequence and responsibility style.
3. Update focused assertions and version metadata.
4. Run focused tests, desktop typecheck, diff checks, and design review.

## Acceptance Criteria

- The heading sequence matches the established built-in report Skills.
- The Skill contains `目标与字段`, `统计口径`, and `工具职责`.
- The SQL responsibility does not rely on a promised query skeleton or fixed call count.
- The Python responsibility does not prescribe a bespoke accumulator, row builder, or transport protocol.
- Focused tests and typecheck pass.

## Verification

- Latest historical failure run `agent_run_cf93a541-2962-406b-95ea-624c411083dd` saturated the 8,192-token completion budget in both the first Python parameter request and compact retry. The outputs were unparseable tool arguments of 26,434 and 32,933 characters.
- A later attempt at 2026-08-20 03:09 used a 2,823-character Python system prompt but was user-aborted after 141,775 ms without a provider event; it did not produce evidence that a larger output budget was needed.
- The old guarantee Skill diverged from every other built-in report Skill: it used `任务与规划`, omitted `目标与字段` and `统计口径`, promised a runtime query skeleton, and prescribed a bespoke accumulator and row builder.
- `pnpm --dir apps/desktop exec vitest run src/main/skills/SkillManagement.test.ts -t "uses a compact Python contract across built-in report skills|loads the built-in guarantee method risk distribution report without template example values" --reporter=dot`: 2 passed, 13 skipped.
- `pnpm desktop:typecheck`: passed.
- `git diff --check`: passed.
- `git diff --no-index --check /dev/null skill/guarantee-method-risk-distribution-report/SKILL.md`: passed.
- `quick_validate.py` could not start because its external `yaml` module is not installed. The repository's `validateSkillDirectory` package validation completed in the focused test.
- No full regression or interactive page validation was run, as requested.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

The change is confined to the Skill package and its focused assertions. The section order now matches the other built-in report Skills, while SQL, Python, and report responsibilities remain separated. No runtime fallback, output-budget exception, fixed physical mapping, or hidden execution dependency was added.

## Outcome

The guarantee-method Skill now uses the same `目标与字段 → 统计口径 → 工具职责` structure as the key-risk, branch, and overall-risk built-in report Skills. Its SQL responsibility is query-only and no longer assumes a promised skeleton. Its Python responsibility is statistics-only and uses the same abstraction level as the other built-in Skills, without bespoke transport, accumulator, row-builder, or report-generation instructions. Version `1.0.13` and cross-Skill structural assertions prevent the missing sections from recurring.

## Follow-up

Restart the client and run the same guarantee-method report request to capture the new live Python parameter length and latency. This repository-only change cannot prove provider latency without a new model call.
