# Task: Branch Asset Quality Skill

- Status: completed
- Owner: human + agent
- Started: 2026-07-28

## Goal

Add a read-only built-in Skill that generates the “各分行资产质量状况（笔数+金额）” report from the selected real data source.

## Scope

- Create a system Skill package with manifest, instructions, template, schemas, and tool policy.
- Dynamically resolve branch, five-level classification, loan balance, and optional contract serial fields.
- Calculate branch-level count and balance distributions and template-aligned conclusions.
- Reconcile every branch row against the full Python result before report generation.
- Pass the complete Python analysis Artifact to report generation instead of a truncated preview.
- Reuse the latest successful Python Artifact when a later turn asks to regenerate the report.
- Add targeted package validation and catalog tests.

## Non-goals

- No dedicated Agent route or hard-coded physical field mapping.
- No chart generation.
- No full regression or interactive page verification.

## Constraints

- Data dictionaries remain optional.
- SQL stays read-only and returns detail rows.
- Python performs all grouping, deduplication, rates, and ranking.
- Models never receive full source data directly.

## Acceptance Criteria

- The system Skill appears as enabled and read-only.
- The report contains the branch count/balance table and numbered conclusions.
- “不良” consistently means 次级、可疑、损失.
- Contract count uses contract serial deduplication when reliable and valid rows otherwise.
- Missing or ambiguous real fields trigger actionable clarification instead of fabricated results.
- The branch table contains every real branch exactly once; branch totals reconcile to the overall total.
- Report generation cannot copy the overall count into a branch row or infer missing rows from a truncated preview.

## Verification

- Latest local conversation data was inspected: 200 source rows, 35 distinct real branches, and 6 distinct Beijing contracts.
- Desktop TypeScript check: `../../node_modules/.bin/tsc --noEmit`.
- Report data Schema JSON parse check.
- Targeted Vitest: complete cross-turn Python analysis Artifact is present in report execution context, including the final real branch row.
- Full regression and interactive page verification were intentionally not run.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] No deferred technical debt was identified for this fix.

## Outcome

Report generation now consumes the complete derived Python analysis Artifact rather than a truncated preview and can reuse it across turns. The Skill requires full-branch reconciliation before emitting report data, so branch rows cannot inherit the all-bank count or be reduced to a fabricated Top N list.
