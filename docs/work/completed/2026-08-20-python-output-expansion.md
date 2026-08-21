# Task: Python Tool Parameter Output Expansion

- Status: completed
- Owner: human + agent
- Started: 2026-08-20

## Goal

Prevent the Python execution model from expanding a moderate built-in Skill calculation into truncated tool-call arguments.

## Scope

- Diagnose the latest local Agent run and its compact retry.
- Add an explicit compact script-size contract to the Python tool Schema and execution prompt.
- Make the truncation retry regenerate from scratch with a data-driven algorithm.
- Tighten the guarantee-method Skill's Python implementation shape without changing its business semantics.
- Add focused prompt, retry, and Skill package assertions.

## Non-goals

- No model migration, output-token increase, deterministic local report workflow, Python runtime, SQL, report template, or UI changes.
- No full regression or interactive page validation.

## Constraints

- The Python model continues to generate the script and the controlled local runtime executes it.
- Python continues to consume only the authorized upstream JSON dataset through stdin.
- Incomplete or over-limit tool parameters are never executed.
- Existing tool approval and Artifact lineage remain unchanged.

## Affected Areas

- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/thinkingOptimization.test.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`
- `skill/guarantee-method-risk-distribution-report/SKILL.md`
- `skill/guarantee-method-risk-distribution-report/manifest.json`

## Invariants

- The Python model output budget remains 8,192 tokens.
- Guarantee grouping, risk grouping, amount conversion, count basis, professional-guarantee metric, and reconciliation semantics remain unchanged.
- Other built-in Skills keep the same runtime and tool sequence.

## Implementation Plan

1. Record prompt size, output size, finish reason, and retry behavior from the latest run.
2. Encode a bounded compact-script contract in the Python tool Schema and system prompt.
3. Rewrite truncation retry guidance to discard the prior expansion and regenerate a minimal data-driven script.
4. Add a single-accumulator implementation shape to the guarantee Skill and update its version.
5. Run focused tests, desktop typecheck, diff check, and design review.

## Acceptance Criteria

- The Python tool Schema declares a practical script-size ceiling below the provider's truncation range.
- Initial and retry prompts prohibit category-specific code duplication and report/presentation work.
- Retry explicitly regenerates from scratch rather than extending the failed approach.
- The guarantee Skill defines one normalized-record path, one aggregate structure, and one result-building loop.
- No output-token increase or reasoning-model parameter fallback is introduced.

## Verification

- Latest Run `agent_run_2bbf8984-0fa1-4e75-b51e-45bcb537c526`, conversation `725144d6-f3df-4237-9f47-ea3e292a990d`: the initial Python request had 2,625 total context characters and about 1,545 estimated input tokens, but consumed all 8,192 completion tokens and returned 20,613 incomplete argument characters after 83,825 ms.
- The compact retry had 2,925 context characters and about 1,719 estimated input tokens, again consumed all 8,192 completion tokens, and expanded to 29,330 incomplete argument characters after 95,734 ms. Both responses had `finishReason=length` and were not executed.
- The SQL result contained 200 rows and only four required fields, so the Python task was moderate aggregation rather than a genuinely oversized analysis.
- The Python tool Schema now declares `maxLength: 16000`; the execution prompt and compact retry use the same shared limit while the model output budget remains 8,192 tokens.
- Focused prompt and Skill tests passed: 3 tests passed, 34 skipped.
- Focused dual-model runtime tests passed: 2 tests passed, 36 skipped.
- `pnpm --dir apps/desktop typecheck` passed.
- `git diff --check` passed.
- `better-sqlite3` was temporarily rebuilt for Node-based tests and restored to the Electron ABI with `pnpm --dir apps/desktop native:rebuild`.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The Python tool contract now rejects scripts beyond the practical compact range and tells the execution model to use a single data-driven accumulator instead of category-specific code expansion. A provider-truncated response is retried once from scratch with an explicit 16,000-character ceiling and no reasoning-model fallback. The guarantee-method Skill defines the same low-freedom aggregation shape and is versioned at `1.0.16`.

## Follow-up

A fresh live request after the client reloads Skill version `1.0.16` is required to measure production model output length and latency. If the provider ignores JSON Schema `maxLength`, telemetry will still show a second truncation; do not increase the output budget before reviewing that trace.
