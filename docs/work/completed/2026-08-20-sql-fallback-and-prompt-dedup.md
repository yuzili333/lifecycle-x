# Task: SQL Fallback And Prompt Deduplication

- Status: completed
- Owner: human + agent
- Started: 2026-08-20

## Goal

Improve first-pass SQL parameter generation for built-in report Skills and stop repeated reasoning-model fallback after short malformed or truncated SQL output.

## Scope

- Compare the SQL responsibilities of the guarantee-method, key-risk-customer, and overall-risk report Skills.
- Deduplicate the generic SQL parameter-generation prompt while preserving the verified table and field skeleton.
- Retain at most one execution-model correction for malformed or truncated SQL parameters.
- Remove reasoning-model SQL parameter fallback and update focused tests.

## Non-goals

- No SQL runtime safety, approval, data-source selection, report, Python, or Skill business-rule changes.
- No full regression or interactive page validation.

## Constraints

- Incomplete or structurally invalid SQL must never execute.
- SQL remains one read-only SQLite query against the selected source.
- Composite report Skills continue to query detail rows; Python owns statistical calculation.
- No silent source switch or fabricated identifiers.

## Affected Areas

- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/thinkingOptimization.test.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`

## Invariants

- The execution model receives the current step, verified SQL scope, and one SQL tool Schema.
- A valid initial or corrected SQL parameter proceeds through the existing local runtime.
- A second malformed or truncated result terminates the step without switching models.
- Skill-specific SQL text does not take over statistics or report generation.

## Implementation Plan

1. Record the Skill and latest-run comparison evidence.
2. Make the SQL tool Schema the authoritative parameter contract and remove repeated instructions.
3. Remove reasoning-model SQL fallbacks while retaining one execution-model correction.
4. Update focused tests and run desktop type checking plus diff checks.
5. Complete an independent design review.

## Acceptance Criteria

- SQL responsibilities across the three Skills remain equivalent and concise.
- Initial SQL prompt does not repeat the parameter-value contract across description, Schema, system, and user messages.
- Truncated SQL output retries once with the execution model, never the reasoning model.
- Two structurally invalid SQL responses do not trigger a third model request.
- Existing verified-skeleton correction can still produce and execute one valid SQL query.

## Verification

- Skill SQL sections are equivalent in scope: guarantee method 122 characters, key risk customer 111 characters, and overall risk distribution 125 characters. Each only requests the required detail fields and leaves statistics to Python.
- Latest reviewed run `agent_run_6a0033a3-42cc-47ff-980d-277b7b3a38e9` did not contain an oversized SQL parameter: the initial and repair SQL strings were 94 and 123 characters. Both failed local structure validation; a third reasoning-model request produced a 103-character valid parameter. This confirmed fallback amplification rather than Skill query complexity as the immediate cause.
- The initial SQL parameter contract now has one authoritative copy in the tool Schema. The tool description, execution system prompt, and user message retain only their distinct responsibilities.
- Focused prompt and runtime tests passed: 9 tests passed, 51 skipped.
- The runtime tests cover aggregate, structure, protocol, provider and truncation correction paths, one successful execution-model correction, terminal failure after a second malformed SQL response, and terminal failure after a second truncated response without a reasoning-model call.
- `pnpm --dir apps/desktop typecheck` passed.
- `git diff --check` passed.
- `better-sqlite3` was temporarily rebuilt for the Node test ABI and restored to the Electron ABI with `pnpm --dir apps/desktop native:rebuild`.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The guarantee-method report Skill no longer enters a reasoning-model SQL parameter fallback. SQL parameter generation uses one concise execution-model contract and shares one correction allowance across aggregate, structure, protocol, truncation and provider failures. A second invalid result is recorded as a failed SQL step instead of starting another expensive model request. The three report Skills keep their existing equivalent SQL responsibilities; no guarantee-specific query logic was added.

## Follow-up

Continue observing SQL argument length, finish reason, and first-pass validity. Reconsider additional retries only if telemetry demonstrates a provider issue independent of prompt size and identifier accuracy.
