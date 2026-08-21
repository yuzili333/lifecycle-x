# Task: Guarantee Skill Parameter Context

- Status: completed
- Owner: human + agent
- Started: 2026-08-18

## Goal

Improve first-attempt SQL and Python parameter generation for the guarantee-method risk distribution Skill by removing duplicated and unrelated execution context.

## Scope

Add an optional per-tool Skill parameter contract, apply it to the guarantee-method Skill, and cover the context boundaries with focused tests.

## Non-goals

Do not change business calculations, tool permissions, model providers, report rendering, or other built-in Skill behavior.

## Constraints

SQL only reads detail rows, Python only computes structured statistics, and the report model owns Markdown composition. Existing Skills without a dedicated parameter contract remain compatible.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantRuntime.test.ts`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`
- `skill/guarantee-method-risk-distribution-report/`

## Invariants

- Tool parameters still use the existing Schema and local validation.
- Models only receive real source fields and summarized upstream result shape.
- No local business-specific SQL or Python generator is introduced.

## Implementation Plan

1. Audit the latest model and local-validation logs.
2. Add optional SQL/Python parameter-contract extraction with legacy fallback.
3. Restructure the guarantee-method Skill around concise, non-overlapping responsibilities.
4. Add focused context and Skill package assertions.
5. Run targeted tests, desktop typecheck, diff check, and design review.

## Acceptance Criteria

- Guarantee SQL context contains only its SQL contract and generic SQL safety rules.
- Guarantee Python context contains only its Python contract and generic Python runtime rules.
- Python context excludes field-binding prose, SQL instructions, report formatting, and report template/schema.
- Existing Skills without the new section preserve their current prompt behavior.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/skills/SkillManagement.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts` (89 passed).
- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- `git diff --check` passed.

## Design Review

- [x] The dedicated contract heading makes the stage boundary explicit without relying on tests.
- [x] Skill content remains declarative; orchestration and local validation stay in their existing owners.
- [x] One optional extractor with a legacy fallback is smaller than per-Skill runtime branching.
- [x] Other built-in Skills retain their existing context behavior.
- [x] Missing contracts fall back deterministically; invalid generated parameters still use existing local validation and repair.
- [x] The helper is limited to Markdown section extraction and adds no new interface or dependency.
- [x] Live-model success remains observable through existing parameter-shape telemetry.

## Outcome

The latest run showed that SQL already had a compact 1,155-character system context and no full Skill injection; its first two model results still contained empty identifiers before the reasoning fallback copied the verified query skeleton. Python received a 3,244-character system prompt containing overlapping shared and stage rules, then produced an unparseable 11,945-character argument at the 4,096-token limit. Its first fallback produced a 3,680-character script but failed syntax preflight with an unmatched closing parenthesis.

The runtime now supports an optional `## 参数生成契约` with isolated SQL and Python subsections. The guarantee-method Skill uses that format, so SQL receives only its field-query contract and Python receives only its calculation/output contract. Generic execution prompts no longer inject SQL rules into Python requests or Python rules into SQL requests. The Skill now specifies one accumulator-based algorithm and the exact required result keys while leaving Markdown, formatting, and review to the report model. The Skill version is `1.0.4`.

## Follow-up

Use the existing model observation logs to compare first-attempt parameter success on the next live guarantee-method report run; no interactive client run was performed for this scoped change.
