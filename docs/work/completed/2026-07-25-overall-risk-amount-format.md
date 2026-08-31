# Task: Overall Risk Amount Formatting

- Status: completed
- Archived: 2026-08-31
- Owner: human + agent
- Started: 2026-07-25

## Goal

Standardize converted amount totals to three decimal places and ensure every amount in report prose retains its business label and uses the converted display value.

## Scope

- Update the built-in overall risk distribution Skill instructions.
- Extend report data output fields for total, category, and detail amount displays.
- Make the contract amount summary clause self-describing.
- Add targeted package validation assertions.

## Non-goals

- No SQL, chart, or general report-runtime behavior changes.
- No full regression or interactive page verification.

## Acceptance Criteria

- Converted yuan/ten-thousand-yuan/100-million-yuan values display as billions of yuan with exactly three decimal places.
- The summary labels both loan balance and contract amount.
- Amount conclusions and normal-class details use converted values rather than raw ten-thousand-yuan values.
- Source-unit tables remain unchanged.

## Verification

- `pnpm --filter @lifecycle-x/desktop exec vitest run src/main/skills/SkillManagement.test.ts`
  - 11 tests passed.
- All Skill JSON files parsed successfully.
- `git diff --check` passed.
- Full regression and interactive page verification were not run.

## Design Review

- [x] Problem fit reviewed.
- [x] Skill/runtime boundaries preserved.
- [x] Data and unit semantics reviewed.
- [x] Failure and unknown-unit behavior reviewed.

## Outcome

Skill version `1.0.7` now requires fixed three-decimal 100-million-yuan display values for totals, five-level categories, and detailed classification rows. The report summary uses a self-contained contract amount clause, conclusions consume preformatted amount fields, and source-unit table values remain unchanged.
