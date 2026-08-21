# Task: Guarantee Skill Tool Parameter Focus

- Status: completed
- Owner: human + agent
- Started: 2026-08-19

## Goal

Improve first-pass SQL and Python parameter generation for the guarantee-method report and stop showing resolved SQL fallback messages as ongoing work.

## Evidence

- Latest SQL parameter generation produced two empty-identifier queries (26 and 100 characters) before the verified 103-character query succeeded.
- The Python executor first exhausted 8192 output tokens; two reasoning fallbacks then returned 395- and 335-character scripts that did not consume stdin.
- Execution-model user messages still contained the original request `重新生成报告` instead of the active SQL/Python step instruction.
- Fallback progress stored `stepId` only inside `detail`, so the renderer could not associate and retire it when that step completed.

## Scope

- Focus non-report execution-model user messages on the active step.
- Associate fallback events with their step and hide resolved fallback events.
- Tighten and deduplicate the guarantee Skill's SQL/Python entry instructions.
- Add focused unit and dual-model tests.

## Non-goals

- No removal or bypass of SQL/Python safety, syntax, permission, or stdin contracts.
- No deterministic business script or fabricated fallback result.
- No full regression or interactive page verification.

## Acceptance Criteria

- SQL/Python parameter requests no longer use a report-level original prompt as the operative user instruction.
- A successful SQL step no longer leaves its repair fallback visible as ongoing work.
- Valid stdin scripts remain accepted and scripts without authorized upstream JSON remain rejected.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/agentOrchestration/thinkingOptimization.test.ts src/main/agentProgressPanel.test.tsx src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts --reporter=dot`：95 项通过。
- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantDualModelRuntime.test.ts -t "uses the verified SQL skeleton and reasoning fallback after repeated incomplete SQL|falls back after Python truncation" --reporter=dot`：2 项双模型场景通过。
- `pnpm desktop:typecheck`：通过。
- `pnpm --filter @lifecycle-x/desktop native:rebuild`：已恢复 Electron ABI。
- `git diff --check`：通过。

## Design Review

- Problem fit: the change addresses both observed causes: conflicting execution-model user instructions and unresolved step fallback presentation.
- Architecture: parameter focus remains in the execution adapter; progress association remains in the orchestrator/presenter; Skill business rules remain in the Skill package.
- Safety: SQL/Python syntax, security, approval, stdin, JSON output and Artifact rules are unchanged and still enforced locally.
- Simplicity: no local business script, deterministic SQL execution bypass, new service, or persistence migration was introduced.
- Failure behavior: unresolved parameter errors remain visible and fail normally; only fallback notices for a subsequently successful step are hidden.

## Outcome

Non-report execution-model calls now receive the active tool step as their user instruction instead of the original report-level request. SQL requests repeat the verified-skeleton rule; Python requests repeat the stdin/JSON contract. Fallback events carry their step ID, and the progress presenter retires repair notices after that step succeeds. The guarantee Skill is version 1.0.11 with concise single-purpose SQL/Python entry instructions.
