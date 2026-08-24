# Task: Overall Risk Recipe Runtime

- Status: completed
- Owner: human + agent
- Started: 2026-08-22

## Goal

Verify and harden the overall-risk report Skill so its Python step follows the same deterministic recipe boundary established by the guarantee-method postmortem.

## Scope

- Compare the latest overall-risk failure with the guarantee-method truncation evidence.
- Share one runtime marker between recipe compilation and Python script normalization.
- Add a focused dual-model runtime test for the overall-risk Skill.
- Record the selected-Skill state observed in the latest run.

## Non-goals

- Do not infer or auto-select a Skill from natural-language intent.
- Do not change generic no-Skill analysis behavior, report layout, chart rendering, or approval policy.
- Do not run the full regression suite or interactive page verification.

## Constraints

- A Skill recipe is applied only when the user selected that Skill for the current message.
- Python consumes the authorized SQL Dataset through stdin and emits statistics-only JSON.
- The execution model must not generate the prepared Python script.

## Affected Areas

- `apps/desktop/src/main/skills/SkillAnalysisRecipe.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`
- `skill/overall-risk-distribution-report/`

## Invariants

- Unselected Skills cannot hijack generic Agent requests.
- SQL remains read-only and Python remains sandboxed and approval-controlled.
- Artifact lineage and Skill result Schema validation remain unchanged.

## Implementation Plan

1. Inspect the latest Agent Run and model telemetry.
2. Compare input size, output expansion, fallback, and Skill snapshot state with the guarantee-method postmortem.
3. Centralize the prepared-recipe marker and use it in compilation and normalization.
4. Add a runtime test proving the selected overall-risk Skill bypasses Python model generation.
5. Run targeted verification and complete the design review.

## Acceptance Criteria

- Selected overall-risk requests use a locally prepared script.
- No Python execution-model request is made for the prepared statistics step.
- The prepared result passes the overall-risk output Schema.
- Requests without a selected Skill remain on the generic Agent path.

## Verification

- Latest failed run `agent_run_b356d487-d51a-4ee2-a566-d954a7fc754e`: no selected Skill or Skill snapshot; first Python response used all 8,192 completion tokens and produced 27,929 incomplete argument characters, while the compact retry used another 8,192 tokens and produced 20,905 incomplete characters.
- The two Python requests had only about 1,482 and 1,796 estimated input tokens, confirming output-program expansion rather than oversized input context.
- `pnpm --dir apps/desktop exec vitest run src/main/skills/SkillAnalysisRecipe.test.ts src/main/skills/SkillManagement.test.ts`: 20 passed.
- Focused dual-model runtime test `executes the overall-risk Skill recipe without a Python model request`: passed; one test passed and 40 were intentionally skipped by the test filter.
- `pnpm --dir apps/desktop typecheck`: passed.
- `git diff --check`: passed.
- Electron ABI restoration check passed: `better-sqlite3` loaded successfully under the bundled Electron runtime.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The overall-risk Skill had the same architectural failure mode as the guarantee-method Skill: asking the execution model to serialize an entire statistics program into one tool argument. The declarative recipe removes that generation mode when the Skill is selected. A shared marker now guarantees that prepared scripts survive Python normalization unchanged, and the focused runtime test proves that Python model generation is bypassed.

The latest failed user message did not select a Skill: both persisted `skill` and `skillSnapshot` were null. The runtime intentionally did not infer the overall-risk Skill from natural language, preserving the existing rule that an unselected local Skill cannot hijack a generic Agent request.

## Follow-up

After restarting the client, validate from the ChatComposer with the “整体风险分类分布分析报告” Skill token visibly selected. Generic requests without that token intentionally continue to use the generic Agent path.
