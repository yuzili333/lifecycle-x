# Task: Remove Python Stdin Syntax Contract

- Status: completed
- Owner: human + agent
- Started: 2026-08-20
- Completed: 2026-08-20

## Goal

Stop rejecting executable Python analysis scripts because they do not match one statically recognized stdin/stdout coding pattern.

## Scope

- Always provide authorized upstream rows to Python analysis execution.
- Remove static stdin JSON-read and stdout JSON-write pattern validation.
- Remove exact first-two-line requirements from model prompts and repair prompts.
- Keep syntax, safety, approval, timeout, and runtime result validation.
- Update focused unit and dual-model tests.

## Non-goals

- No relaxation of Python sandbox, permission, syntax, timeout, or data-source boundaries.
- No model, SQL, report, Skill business logic, or UI changes.
- No full regression or interactive page validation.

## Constraints

- Models receive summaries and schemas, not full source datasets.
- The local runtime is the only component that supplies authorized data to the Python process.
- Empty or non-JSON analysis output remains a runtime failure when upstream rows are supplied.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/assistantRuntime.test.ts`
- `apps/desktop/src/main/agentOrchestration/thinkingOptimization.test.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`

## Invariants

- Python never connects directly to business data sources.
- Invalid syntax is rejected before approval and execution.
- Python output remains subject to runtime non-empty and JSON validation.
- Tool and Artifact lineage remain unchanged.

## Implementation Plan

1. Confirm every static-contract dependency and the data-injection coupling.
2. Decouple upstream-row delivery from script text inspection.
3. Delete static input/output pattern validation and exact-format prompt rules.
4. Add coverage for a valid noncanonical stdin reader and unchanged syntax/runtime checks.
5. Run focused tests, typecheck, diff check, and design review.

## Acceptance Criteria

- Python receives authorized upstream rows regardless of its source-code spelling.
- A syntactically valid noncanonical stdin reader is not rejected before execution.
- No prompt requires exact import order, variable name, or first-two-line layout.
- Syntax and runtime result validation remain active.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/agentOrchestration/thinkingOptimization.test.ts src/main/assistantRuntime.test.ts --reporter=dot`
  - 75 tests passed.
- `pnpm --dir apps/desktop exec vitest run src/main/assistantDualModelRuntime.test.ts -t "retries truncated Python parameters|fails after the compact Python retry|executes a syntax-safe noncanonical stdin reader" --reporter=dot`
  - 3 focused dual-model tests passed.
- `pnpm --dir apps/desktop typecheck`
  - Passed.
- `git diff --check`
  - Passed.
- Restored the Electron ABI build with `pnpm --dir apps/desktop native:rebuild` after the Node-based integration test.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear: the runtime supplies authorized data and the Python process chooses how to read it.
- [x] The implementation removes source-pattern recognition instead of adding another parser or accepted-pattern list.
- [x] No accidental coupling was introduced; Artifact lookup and lineage are unchanged.
- [x] Error and recovery paths remain explicit through syntax, sandbox, timeout, process-exit and result validation failures.
- [x] Generated code was reviewed for unnecessary abstraction; obsolete contract helpers were deleted.
- [x] No deferred debt is required for this scoped change.

## Outcome

Python analysis now always receives the latest authorized SQL row set, independent of script spelling. Syntactically valid scripts using noncanonical stdin access are no longer rejected or sent through a contract-repair model request. Prompts describe the available input and required usable output without prescribing import order, variable names or exact source lines.

## Follow-up

None for this task. Any future tightening should validate runtime behavior or security capabilities rather than Python source formatting conventions.
