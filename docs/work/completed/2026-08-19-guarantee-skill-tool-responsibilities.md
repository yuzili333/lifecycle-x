# Task: Guarantee Skill Tool Responsibilities

- Status: completed
- Owner: human + agent
- Started: 2026-08-19

## Goal

Align the guarantee-method risk distribution Skill with the concise `工具职责` structure used by other built-in report Skills.

## Scope

- Replace `参数生成契约` with SQL, Python and report-model responsibilities.
- Remove the fixed `T1` alias and fixed field-reference syntax from Skill-level instructions.
- Preserve the business calculation and report-output contract.
- Update package version and focused Skill validation assertions.

## Non-goals

- Do not change the generic SQL tool prompt, runtime-generated query skeleton or approval rules.
- Do not change report templates or schemas.
- Do not alter other built-in Skills.

## Constraints

The Skill describes business responsibilities. SQL syntax details remain controlled by the runtime-provided verified skeleton and generic tool contract.

## Affected Areas

- `skill/guarantee-method-risk-distribution-report/SKILL.md`
- `skill/guarantee-method-risk-distribution-report/manifest.json`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- SQL only returns real detail rows.
- Python only computes structured statistics.
- The report model owns Markdown, formatting, conclusions and review.
- No fixed physical field mapping or example value is introduced.

## Implementation Plan

1. Compare the four built-in report Skill structures.
2. Replace the parameter contract with concise tool responsibilities.
3. Remove fixed alias syntax and retain runtime-skeleton guidance.
4. Update version and focused assertions.
5. Run Skill validation tests, typecheck, diff check and design review.

## Acceptance Criteria

- The Skill contains `## 工具职责` and no `## 参数生成契约`.
- The Skill does not require alias `T1` or a fixed qualified-field form.
- SQL, Python and report responsibilities remain explicit and non-overlapping.

## Verification

- Compared `overall-risk-distribution-report`, `branch-asset-quality-report` and `key-risk-customer-analysis-report`; all use the concise `工具职责` structure.
- `pnpm --dir apps/desktop exec vitest run src/main/skills/SkillManagement.test.ts -t "uses a compact Python contract across built-in report skills|loads the built-in guarantee method risk distribution report without template example values" --reporter=dot`
  - 2 focused tests passed
- `pnpm --filter @lifecycle-x/desktop typecheck`
  - passed
- `git diff --check`
  - passed

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

Independent re-read conclusion: the Skill now owns business responsibilities and structured output requirements, while generic SQL syntax and the concrete alias remain owned by the runtime-generated verified skeleton. This removes duplicated prompt constraints without weakening source or field accuracy.

## Outcome

- Replaced `参数生成契约` and the separate report section with one `工具职责` section containing SQL, Python and report-model responsibilities.
- Removed the fixed `T1` alias and fixed qualified-field syntax. A runtime-provided alias may still appear in the concrete query skeleton and must then be used consistently.
- Preserved guarantee/risk classification, contract-count fallback, amount conversion, result structure and report-format rules.
- Advanced the built-in Skill version to `1.0.6`.

## Follow-up

None for this scoped change.
