# Task: Python Skill Context Isolation

- Status: completed
- Owner: human + agent
- Started: 2026-08-19

## Goal

Ensure the Python parameter stage injects only the selected Skill's Python tool responsibility when that section exists.

## Scope

- Refine stage-specific Skill instruction selection.
- Update focused context-isolation tests.

## Non-goals

- Change Python execution, report generation, schemas, or model budgets.
- Run full regression or page validation.

## Constraints

- Preserve compatibility for legacy Skills that only define parameter contracts or unstructured instructions.
- Preserve system security rules and verified upstream Artifact context.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/assistantRuntime.test.ts`

## Invariants

- Python receives no SQL responsibility, report responsibility, Schema, template, or tool policy from a structured Skill.
- Legacy dedicated Python parameter contracts remain supported when no Python responsibility exists.

## Implementation Plan

1. Prefer the Python responsibility section over all other Skill content.
2. Update context isolation assertions.
3. Run focused tests, type checking, diff check, and design review.

## Acceptance Criteria

- Guarantee-method and similarly structured Skills inject only `### Python 工具` content at the Python stage.
- Unrelated Skill sections and bundled schemas are absent.

## Verification

- `pnpm exec vitest run src/main/assistantRuntime.test.ts` - 54 passed.
- `pnpm --filter @lifecycle-x/desktop typecheck` - passed.
- `git diff --check` - passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Structured Skills now inject only their `### Python 工具` section during Python parameter generation. Dedicated legacy Python parameter contracts remain the fallback when a responsibility section is absent, followed by the old unstructured Skill compatibility path.

## Follow-up

None identified.
