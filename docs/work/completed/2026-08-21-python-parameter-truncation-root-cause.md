# Task: Python Parameter Truncation Root Cause

- Status: complete
- Owner: human + agent
- Started: 2026-08-21

## Goal

Eliminate repeated Python tool-parameter truncation for the built-in guarantee
method risk distribution Skill.

## Scope

- Record evidence from the latest local conversation and model observations.
- Add a validated declarative analysis recipe to built-in Skill snapshots.
- Compile the recipe into a bounded local Python script using the latest SQL
  Dataset schema.
- Preserve approval, Python sandbox execution, Artifact lineage, and output
  Schema validation.

## Non-goals

- No full regression suite or interactive page verification.
- No change to personal Skill trust or executable-file policy.
- No change to SQL, report, or visualization tool protocols.

## Constraints

- Models receive schemas and summaries, not full source datasets.
- The generated script must consume only the authorized upstream SQL rows.
- Missing or ambiguous field bindings must fail explicitly; they must not fall
  back to model-generated full programs.

## Affected Areas

- `apps/desktop/src/shared/skills.ts`
- `apps/desktop/src/main/skills/`
- `apps/desktop/src/main/assistantRuntime.ts`
- `skill/guarantee-method-risk-distribution-report/`

## Invariants

- Python remains permission-controlled and runs in the existing isolated local
  process.
- Skill packages cannot ship executable source files.
- Result validation and Artifact lineage remain unchanged.

## Implementation Plan

1. Extend and validate the optional analysis recipe protocol.
2. Implement a generic grouped-risk-distribution recipe compiler.
3. Resolve real fields from the latest SQL Dataset and execute prepared Python
   parameters.
4. Add the guarantee Skill recipe and focused tests.
5. Run targeted checks and complete the design review.

## Acceptance Criteria

- The latest scenario no longer makes an execution-model request for a full
  Python script.
- The prepared script is bounded, syntax-valid, and produces data matching the
  Skill output Schema.
- Ambiguous or missing fields return a deterministic actionable error.
- Approval and tool execution records are still created normally.

## Verification

- Latest local run: `2026-08-21 10:18:51` Asia/Shanghai.
- First Python parameter request: about 1,980 prompt tokens, 8,192 completion
  tokens, 46,101 argument characters, `finish_reason=length`.
- Compact retry: about 2,190 prompt tokens, 8,192 completion tokens, 43,258
  argument characters, `finish_reason=length`.
- `pnpm exec vitest run src/main/skills/SkillAnalysisRecipe.test.ts`: 3 passed.
- `pnpm exec vitest run src/main/skills/SkillManagement.test.ts`: 15 passed.
- Focused dual-model recipe test: 1 passed; only planner and SQL model
  requests were made, while Python used prepared local parameters.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- Electron `better-sqlite3` ABI was restored and verified after the focused
  Node test.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The repeated failure was caused by asking the execution model to emit an entire
business statistics program inside one JSON tool argument. The input context
was small; the provider exhausted its completion budget while the JSON string
was still open. Retrying with more instructions increased latency without
changing that generation mode.

The guarantee Skill now carries a validated declarative recipe. The runtime
binds it to the latest SQL Dataset's real fields and compiles a 6.4k-character
trusted Python script, then uses the existing approval and sandbox execution
path. Recipe compilation errors do not fall back to model-written programs.
The result validator now validates the JSON inside the Python execution
envelope's `stdout` rather than the `{stdout, stderr}` wrapper.

## Follow-up

Consider adopting the same declarative recipe mechanism for other built-in
Skills only after their statistics contracts are stable.
