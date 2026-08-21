# Task: Python Fallback And Prompt Deduplication

- Status: completed
- Owner: human + agent
- Started: 2026-08-20

## Goal

Reduce Python parameter-generation latency and timeout amplification by removing the low-success reasoning-model fallback and eliminating repeated execution instructions.

## Scope

- Diagnose the latest guarantee-method report run and compare it with recent Python fallback traces.
- Retain one compact execution-model retry for truncated Python parameters.
- Remove reasoning-model Python parameter generation and its follow-up protocol/contract repairs.
- Make the Python tool schema the single owner of the stdin/stdout transport contract.
- Add focused runtime and prompt-composition coverage.

## Non-goals

- No SQL fallback changes.
- No model timeout, token-budget, Python sandbox, report, Skill business-rule, or UI changes.
- No full regression or interactive page validation.

## Constraints

- Incomplete tool-call JSON must never execute.
- Python still consumes only the authorized upstream JSON dataset.
- Tool approval, Artifact registration, lineage, and failure records remain unchanged.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`
- `apps/desktop/src/main/agentOrchestration/thinkingOptimization.test.ts`

## Invariants

- A valid initial or compact-retry script continues through the existing controlled runtime.
- A failed compact retry terminates the Python step without switching models.
- The execution model receives only the active Skill tool subsection, not the complete Skill or full source schema.

## Implementation Plan

1. Record the latest and recent fallback timing, output, and prompt-composition evidence.
2. Remove Python reasoning-model fallback branches while retaining one compact retry.
3. Deduplicate the generic Python execution prompt and keep the exact transport contract in the tool schema.
4. Update focused tests and run mechanical verification.
5. Complete an independent design review.

## Acceptance Criteria

- Two consecutive truncated Python parameter responses produce exactly two execution-model calls and no reasoning-model parameter call.
- Python provider timeout does not trigger a second model request.
- Initial Python messages do not repeat the exact stdin/stdout skeleton outside the tool schema.
- Existing successful Python parameter generation and local execution remain supported.

## Verification

- Latest Run `agent_run_008f1c28-cea6-47cd-820c-55977f169fd5`: Python parameter request contained 3,131 message characters plus a 471-character tool definition, 3,725 total context characters and an estimated 2,041 tokens. It returned no first event, content, or tool call and timed out at 180,012ms with `PROVIDER_TIMEOUT`.
- Recent prior fallback traces showed repeated 8,192-token truncation, missing tool calls, contract-invalid placeholders, and additional model timeouts. The reasoning-model fallback did not produce a successful Python execution in the reviewed runs.
- Prompt review confirmed that Python execution excludes the complete Skill, input/output schemas, report template, full source schema, conversation history, and full Artifact data. It includes only the active Python tool responsibility, upstream result shape, step metadata, and safety context.
- Removed duplicated exact stdin/stdout instructions from the Python execution system and user messages; the tool parameter schema is now authoritative for that transport contract.
- Focused prompt tests passed: 2 tests passed, 20 skipped.
- Focused dual-model runtime tests passed: 2 tests passed, 35 skipped.
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

Python parameter generation no longer falls back to the reasoning model. One compact execution-model retry remains for truncated output; a second truncation, timeout, or invalid result terminates the step and records the failure. Initial execution prompts are shorter and no longer repeat the exact transport skeleton across system, tool description, schema, and user instruction layers.

## Follow-up

Provider-side no-first-event timeouts remain observable but are not retried for Python. Reassess only if telemetry shows a repeatable provider issue independent of prompt size.
