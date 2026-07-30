# Task: Key Risk Customer Skill

- Status: completed
- Owner: human + agent
- Started: 2026-07-30

## Goal

Add a read-only built-in Skill that produces the key risk customer analysis
report from real selected data.

## Scope

Create the Skill package, report template, input/output schemas, tool policy,
and focused catalog validation.

## Non-goals

Do not add dedicated Agent routing, physical field mappings, chart generation,
or model-authored evidence.

## Constraints

Fields must resolve from the selected source schema. SQL retrieves full-scope
detail rows, Python performs deterministic counting and amount analysis, and
the report never copies sample values.

## Affected Areas

- `skill/key-risk-customer-analysis-report/`
- Built-in Skill validation tests

## Invariants

- SQL remains read-only and non-aggregating.
- Python consumes controlled Workflow data only.
- Amounts retain Decimal precision through reconciliation.
- Missing optional dimensions are disclosed rather than fabricated.

## Implementation Plan

1. Define field roles, classification rules, counting grain, and amount units.
2. Add the manifest, instructions, template, schemas, and tool policy.
3. Add catalog and content safety tests.
4. Run focused tests, typecheck, diff checks, and design review.

## Acceptance Criteria

- The Skill appears as an enabled, read-only system Skill.
- It generates all risk-customer rows from real non-normal records.
- Count and amount percentages reconcile to full-sample denominators.
- Template sample values and contradictory conclusions are never reused.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/skills/SkillManagement.test.ts`
  - Passed: 13 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck`
  - Passed.
- `git diff --check`
  - Passed.
- The shared Skill quick validator could not start because the local Python
  environment does not provide `PyYAML`; the repository validator covered the
  Manifest, referenced files, JSON Schemas, tool policy, and system catalog.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

The independent re-read confirmed that the Skill uses the existing dynamic
system catalog and generic SQL, Python, and report tools. It adds no dedicated
Agent route, physical field mapping, chart dependency, or source-data fallback.
Full-sample denominators, contract-level detail, Decimal reconciliation, and
missing-field behavior are stated in the Skill and represented in its schemas.

## Outcome

Added the read-only `key-risk-customer-analysis-report` system Skill. It resolves
real source fields dynamically, queries full-scope detail rows, computes
contract-level non-normal exposure and migration statistics in Python, and
renders the report template without copying its inconsistent sample values.

## Follow-up

None identified.
