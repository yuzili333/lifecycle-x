# Task: Overall Risk Python JSON Output

- Status: completed
- Owner: human + agent
- Started: 2026-08-22

## Goal

Ensure the overall risk distribution Skill always produces schema-valid JSON from its Python analysis step.

## Scope

Add a deterministic analysis recipe for the built-in Skill, validate the recipe package, and cover field binding, aggregation, deduplication, and JSON output with focused tests.

## Non-goals

No renderer changes, report redesign, full regression run, or interactive page verification.

## Constraints

Use only real SQL Artifact fields and rows. Python performs statistics only; report composition remains with the report model.

## Affected Areas

- `skill/overall-risk-distribution-report/`
- `apps/desktop/src/main/skills/SkillAnalysisRecipe.ts`
- `apps/desktop/src/main/skills/SkillPackageValidator.ts`

## Invariants

- SQL remains read-only.
- Python consumes the authorized upstream Dataset through stdin.
- The analysis output matches the Skill report-data Schema.
- Optional fields do not block the required count and loan-balance analysis.

## Implementation Plan

1. Reproduce and document the latest local failure.
2. Add and validate an overall-risk analysis recipe.
3. Compile a bounded statistics-only Python script from verified fields.
4. Add focused compiler and package tests.
5. Run targeted verification and design review.

## Acceptance Criteria

- The latest scenario produces one parseable JSON object.
- Contract serial deduplication, category totals, balance totals, shares, and reconciliation are correct.
- Missing optional risk-result and contract-amount fields remain schema-valid.
- The execution model is bypassed for the Python parameter generation of this Skill.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/skills/SkillAnalysisRecipe.test.ts src/main/skills/SkillManagement.test.ts` passed: 20 tests.
- `pnpm --dir apps/desktop typecheck` passed.
- `git diff --check` passed.
- The latest 200-row workflow Dataset produced schema-valid JSON with all reconciliation checks true.
- Assistant runtime tests were attempted but could not start because the local `better-sqlite3` binary targets Electron ABI 130 while the current Node process requires ABI 137.
- `pnpm harness:check` remains blocked by pre-existing incomplete active work records unrelated to this change.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The built-in overall-risk Skill now uses verified real-field bindings and a deterministic stdin-based statistics script. It emits a single compact JSON object instead of passing through the generic Markdown analysis fallback.

## Follow-up

Run the existing SQLite-backed Assistant runtime test after the repository native dependency is rebuilt for Node and restored for Electron by the standard verification harness.
