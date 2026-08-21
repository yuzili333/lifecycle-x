# Task: Guarantee Python Prompt Contract

- Status: completed
- Owner: human + agent
- Started: 2026-08-20

## Goal

Stop the guarantee-method report Skill from repeatedly producing oversized, incomplete Python tool parameters.

## Scope

- Diagnose the latest live Agent run.
- Reduce the Skill Python section to non-duplicated business rules.
- Constrain implementation shape to one normalization pass and one data-driven aggregation path.
- Update the built-in Skill version and focused package assertions.

## Non-goals

- No model, global token-budget, retry-count, Python sandbox, or report-template changes.
- No full regression or interactive page verification.

## Constraints

- Preserve guarantee classification, risk classification, amount conversion, contract deduplication fallback, professional-guarantee count, and reconciliation semantics.
- Generic Python transport and execution rules remain owned by the runtime prompt and tool Schema.
- Python remains responsible only for statistics; report formatting remains owned by the report model.

## Affected Areas

- `skill/guarantee-method-risk-distribution-report/SKILL.md`
- `skill/guarantee-method-risk-distribution-report/manifest.json`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- No historical physical-field mapping is introduced.
- The report output Schema and template remain compatible.
- No incomplete tool-call arguments are executed.

## Implementation Plan

1. Record latest output sizes and prompt overlap.
2. Replace repeated execution protocol with a compact business computation contract.
3. Assert the Skill keeps required semantics without duplicating runtime protocol.
4. Run focused validation, typecheck, diff check, and design review.

## Acceptance Criteria

- The Skill Python section no longer repeats import ordering, stdin/stdout boilerplate, or tool-call count rules.
- The model is instructed to use one normalized record stream, one accumulator, and one row builder instead of category-specific code expansion.
- All required report metrics remain available in the Python result.
- The global Python max-token setting remains unchanged.

## Verification

- Latest run: first Python response produced 26,434 unparseable argument characters at 8,192 completion tokens.
- Compact retry produced 32,933 unparseable argument characters at the same limit.
- The complete Skill is now 1,817 characters; the Python responsibility is kept below 1,300 characters by a focused test.
- `pnpm --dir apps/desktop exec vitest run src/main/skills/SkillManagement.test.ts -t "uses a compact Python contract across built-in report skills|loads the built-in guarantee method risk distribution report without template example values" --reporter=dot` passed: 2 tests passed, 13 skipped.
- `pnpm desktop:typecheck` passed.
- `git diff --check` passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The guarantee-method Python responsibility now contains only indispensable business semantics and a low-freedom implementation shape: normalize each record once, aggregate through one guarantee-by-risk accumulator, and build every category through one row function. Runtime-owned import, stdin/stdout, tool-call count, and report-generation rules are no longer duplicated in the Skill. Version 1.0.12 preserves the existing report Schema and template without increasing the Python output budget.

## Follow-up

Run a live model forward test after the user restarts the client.
