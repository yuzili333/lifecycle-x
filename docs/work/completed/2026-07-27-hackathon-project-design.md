# Task: Hackathon Project Design

- Status: completed
- Owner: human + agent
- Started: 2026-07-27

## Goal

Create a registration-ready project design for “溯据” that fits the
“数智领航” AI-native R&D track and accurately reflects the repository's
implemented capabilities, competition scope, and two-person delivery plan.

## Scope

- Create `prototype/黑客松参赛项目设计方案.md`.
- Define the core narrative, golden demo path, technical proof, scope freeze,
  originality statement, schedule, deliverables, and acceptance metrics.
- Distinguish current implementation, competition-period work, and future
  roadmap.

## Non-goals

- No application code changes.
- No slide deck, video, or demo dataset production in this task.
- No claim that planned capabilities or tests equal production acceptance.

## Constraints

- The project assists factual analysis and does not make risk decisions.
- SQL remains read-only; Python consumes controlled datasets only.
- Reports and charts must preserve Artifact lineage and may not fabricate data.
- The proposal must not disguise pre-existing or third-party work as new work.

## Affected Areas

- `prototype/黑客松参赛项目设计方案.md`
- `docs/work/active/2026-07-27-hackathon-project-design.md`

## Invariants

- Current, competition-period, and future capabilities remain clearly labeled.
- The golden path can be demonstrated with repository-supported functionality.
- The proposal is understandable to both business and technical judges.

## Implementation Plan

1. Review the competition context, product documents, architecture, and current
   work records.
2. Draft a registration-oriented design with one memorable end-to-end loop.
3. Check product claims against the repository and run Markdown checks.
4. Complete an independent design review and record the outcome.

## Acceptance Criteria

- The proposal contains a concise registration abstract and one-line category.
- It defines the problem, solution, innovation, architecture, demo, schedule,
  team split, risks, compliance, and success criteria.
- It contains one frozen golden path and a kill list.
- Claims about MySQL, PDF/JSON export, risk decisions, and production readiness
  remain within current implementation boundaries.

## Verification

- `git diff --check`: passed.
- `node scripts/verify-harness.mjs`: blocked by pre-existing format violations
  in other `docs/work/active/` records; the new task record was not reported.
- Repository claim audit:
  - confirmed the MySQL adapter remains explicitly simulated;
  - confirmed the version-bound `evidence_card` implementation;
  - confirmed the declarative overall-risk Skill package;
  - confirmed the report-regeneration and historical Artifact work record.
- Manual Markdown structure and independent claim review: passed.
- No runtime code changed, so application tests were not run.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Created a registration-ready design for “溯据” with a concise narrative, one
frozen overall-risk-distribution golden path, visible technical proof,
competition scope, two-person schedule, deliverable plan, fallback demo,
security boundaries, and an originality ledger. The proposal distinguishes
the current code baseline from competition-period validation and future
production work.

## Follow-up

- Confirm the organizer's exact rules for pre-existing code, open-source
  dependencies, AI assistance, and registration field limits.
- Produce the de-identified demo dataset, slide deck, video, Q&A sheet, and
  originality ledger as separate deliverables.
