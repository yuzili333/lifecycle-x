# Task: Fix Guarantee Python Execution Failure

- Status: completed
- Owner: human + agent
- Started: 2026-08-20
- Completed: 2026-08-20

## Goal

Fix the latest guarantee-method report run so the Python execution model generates one complete, compact tool parameter instead of saturating its output budget or returning a placeholder script.

## Scope

- Analyze the latest local conversation, Agent Run, model observations, and tool records.
- Tighten only the guarantee Skill's planning-visible chart boundary and Python output contract.
- Update the Skill version and focused assertions.

## Non-goals

- No generic Agent runtime, model budget, tool protocol, report Schema, or report template changes.
- No deterministic hard-coded local workflow.
- No full regression or interactive page validation.

## Constraints

- Preserve the established built-in Skill section structure.
- SQL remains query-only, Python remains statistics-only, and the report model remains presentation-only.
- Preserve the report's five guarantee categories, count basis, amount metrics, rates, professional-guarantee metric, and reconciliation semantics.

## Affected Areas

- `skill/guarantee-method-risk-distribution-report/SKILL.md`
- `skill/guarantee-method-risk-distribution-report/manifest.json`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- No physical-field aliases or table-dictionary requirements are introduced.
- No chart tool is added to the Skill.
- Python results contain numeric data, not Markdown or display strings.

## Implementation Plan

1. Reconstruct the latest failed run and identify the exact failing phase.
2. Add the missing compact result shape and prohibit generic framework expansion.
3. Make the no-chart target visible to the planner.
4. Run focused validation, typecheck, diff checks, and design review.

## Acceptance Criteria

- The latest failure is accurately classified as parameter generation, not Python runtime execution.
- Planning-visible Skill instructions explicitly exclude charts.
- Python instructions define one stable top-level result shape and one stable distribution-row shape.
- Python instructions prohibit generic field discovery, reusable frameworks, repeated validation, and report generation.
- Focused tests and desktop typecheck pass.

## Verification

- Latest conversation: `82384107-1bfd-4032-8bcf-8a59af6ceb7e`; Agent Run: `agent_run_3afc3283-81cc-4e46-ae4b-a755628af4c0`; Skill version: `1.0.13`.
- SQL completed successfully with 200 rows and the four required real fields. No Python `tool_calls` record was created, so the failure happened before Python runtime execution.
- First Python parameter request used 1,572 prompt tokens, saturated 8,192 completion tokens, and produced 34,447 characters of incomplete arguments after 111,496 ms.
- Compact retry used 1,689 prompt tokens, again saturated 8,192 completion tokens, and produced 33,445 characters of incomplete arguments after 75,070 ms.
- High-reliability fallback returned a 218-character placeholder script that did not consume stdin. Its correction again consumed 8,192 completion tokens without a tool call.
- The planner incorrectly added a chart step even though the Skill neither declares the chart tool nor requires charts. The planning-visible target now explicitly excludes charts.
- The Python stage intentionally does not receive the report output Schema. The Skill now supplies the minimum stable result shape directly in the Python responsibility and prohibits generic field discovery, Schema frameworks, recursive serializers, classes, logging, and repeated validation.
- `pnpm --dir apps/desktop exec vitest run src/main/skills/SkillManagement.test.ts -t "uses a compact Python contract across built-in report skills|loads the built-in guarantee method risk distribution report without template example values" --reporter=dot`: 2 passed, 13 skipped.
- `pnpm desktop:typecheck`: passed.
- `git diff --check`: passed.
- Untracked Skill whitespace check passed.
- No full regression or interactive page validation was run, as requested.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

The repair remains inside the Skill package and does not add a hidden local workflow, field mapping, model-specific token exception, or tool protocol. The output shape is business data already required by the existing report Schema; exposing only its compact names to the Python execution stage removes ambiguity without injecting the full Schema.

## Outcome

The guarantee-method Skill is now version `1.0.14`. Its planning instructions explicitly exclude charts. Its Python responsibility tells the execution model that the SQL fields are already verified, forbids building a generic analysis framework, and defines the only permitted top-level result, distribution-row, metric-group, and validation shapes. This addresses the observed output expansion while preserving the standard built-in Skill structure and tool boundaries.

## Follow-up

A new live request after the client reloads version `1.0.14` is needed to measure provider output length and latency; repository checks cannot invoke the configured production model implicitly.
