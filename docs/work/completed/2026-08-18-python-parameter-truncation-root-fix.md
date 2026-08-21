# Task: Python Parameter Truncation Root Fix

- Status: completed
- Owner: human + agent
- Started: 2026-08-18

## Goal

Eliminate recurring truncated Python tool parameters for built-in Skill workflows.

## Scope

Align Python output budget with observed scripts, remove duplicated execution context, normalize built-in Skill constraints, and implement the planned reasoning-model parameter fallback.

## Non-goals

Do not add business-specific local Python generators, change tool permissions, or move report composition into Python.

## Constraints

Python remains a controlled local statistics tool over authorized Artifact rows. Incomplete model output must never execute.

## Affected Areas

- Agent execution profiles and parameter orchestration
- Python execution context construction and preflight
- Built-in Skill Python responsibility sections
- Focused orchestration and Skill tests

## Invariants

- SQL only queries data, Python only calculates statistics, and the report model composes the report.
- Truncated or invalid scripts never enter approval or execution.
- Parameter fallback does not change data source, fields, metrics, or execution order.

## Implementation Plan

1. Audit the latest failed run and compare successful built-in Skill observations.
2. Align Python output and local size budgets with observed controlled scripts.
3. Remove redundant workflow, artifact, and conversation context from Python parameter generation.
4. Normalize built-in Skill Python length wording under the shared runtime contract.
5. Add reasoning-model fallback after one failed execution-model parameter repair.
6. Run focused tests, typecheck, diff check, and design review.

## Acceptance Criteria

- Python requests have sufficient output budget for existing built-in Skill calculations.
- All built-in Skills use the same shared script-size contract.
- Repeated executor truncation falls back once to the reasoning model.
- Only the complete validated fallback script can create and execute a tool call.

## Verification

- Latest run audit: Python context was about 6323 characters, while two executor responses exhausted 4096 output tokens with incomplete argument payloads of about 8270 and 15337 characters.
- Historical built-in Skill comparison: successful controlled Python scripts ranged from 7744 to 16770 characters, proving the 4096-token/6000-character limits were below existing task requirements rather than protecting a real runtime boundary.
- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts src/main/skills/SkillManagement.test.ts` passed (87 tests).
- `pnpm exec vitest run src/main/assistantDualModelRuntime.test.ts -t "falls back to the reasoning model"` passed.
- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- `git diff --check` passed.
- Native `better-sqlite3` was restored to the Electron ABI after focused integration testing.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Python parameter generation now has an 8192-token output budget and a 24000-character main-process safety limit, matching observed controlled scripts while still rejecting pathological output before approval. Python execution context omits duplicate workflow pointers, Artifact pointers, and conversation history, retaining only the current Skill rules and real upstream result shape. All built-in report Skills use one shared compact-script contract without conflicting numeric targets. A Python parameter gets at most one executor repair; if it is still truncated or invalid, the reasoning model receives one parameter-generation fallback without changing task scope. SQL, Python, report, permission, and Artifact ownership boundaries remain unchanged.

## Follow-up

Continue monitoring parameter-shape telemetry. If a future valid statistics script approaches 24000 characters, split the analytical step in the planner instead of raising the limit again.
