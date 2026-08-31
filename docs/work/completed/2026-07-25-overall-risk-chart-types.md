# Task: Overall Risk Chart Types

- Status: completed
- Archived: 2026-08-31
- Owner: human + agent
- Started: 2026-07-25

## Goal

Update the overall risk distribution Skill so its count chart is a labeled pie chart and its loan balance chart is a numeric vertical bar chart.

## Scope

- Add declarative dimension and measure labels to the generic chart tool.
- Render visible value and percentage labels for circular charts.
- Update the built-in Skill chart requirements and version.
- Add focused tests for normalization, rendering, and Skill contents.

## Non-goals

- No dedicated overall-risk chart renderer.
- No full regression or interactive page verification.
- No changes to report calculations or source-field matching.

## Constraints

- Preserve the controlled VisualizationSpec and Artifact flow.
- Keep chart behavior reusable outside this Skill.
- Do not expose model-generated ECharts options.

## Affected Areas

- `apps/desktop/src/main/toolOrchestration/types.ts`
- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/renderer/src/components/VisualizationRenderer.tsx`
- `apps/desktop/src/renderer/src/styles.css`
- `skill/overall-risk-distribution-report/`

## Invariants

- Chart data continues to come from authorized Artifacts.
- Y-axis ticks remain numeric and visible.
- Existing chart requests without labels remain compatible.

## Implementation Plan

1. Extend declarative chart parameters with optional field labels.
2. Add visible circular-chart value and percentage labels.
3. Update the Skill to request the pie and bar charts.
4. Run focused tests and desktop type checking.

## Acceptance Criteria

- Count distribution renders as a pie chart with visible count and percentage per slice.
- Loan balance renders as a vertical bar chart with Y-axis title `贷款余额（万元）` and numeric ticks.
- The Skill package validates as a built-in Skill.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/visualizationRenderer.test.tsx src/main/visualization.test.ts src/main/skills/SkillManagement.test.ts`
  - 4 files, 77 tests passed.
- `pnpm --filter @lifecycle-x/desktop typecheck`
  - Passed.
- `pnpm --filter @lifecycle-x/desktop build`
  - Passed.
- `git diff --check`
  - Passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The generic chart request now supports controlled field labels and accepts pie
and donut chart types. Circular charts visibly render value and percentage
labels, while vertical bar charts use the measure label as the numeric Y-axis
title. The built-in overall-risk Skill requests a pie count distribution and a
vertical loan-balance bar chart with the confirmed source unit.

## Follow-up

None.
