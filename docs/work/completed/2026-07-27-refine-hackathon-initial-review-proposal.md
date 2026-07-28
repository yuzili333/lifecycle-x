# Task: Refine Hackathon Initial Review Proposal

- Status: completed
- Owner: human + agent
- Started: 2026-07-27

## Goal

Restructure the “溯据” project design into a concise organizer-facing initial
review proposal that foregrounds business value, AI-native architecture,
visible proof, and incubation potential.

## Scope

- Rewrite `prototype/黑客松参赛项目设计方案.md` into ten external-review
  sections.
- Strengthen the Agent architecture, execution loop, technical decisions, and
  implemented proof.
- Condense originality, security, and technical reliability statements.
- Remove internal scoring, kill lists, judge loops, fallback scripts, and other
  team-only material from the submission draft.

## Non-goals

- No application code changes.
- No slide deck, video, demo dataset, or Q&A artifact changes.
- No attempt to infer or imitate unpublished scoring weights.

## Constraints

- Preserve the product's factual-analysis and human-decision boundary.
- SQL remains read-only; Python consumes controlled datasets only.
- Models do not create authoritative data results or evidence.
- Existing, competition-period, and future capabilities remain distinguishable.

## Affected Areas

- `prototype/黑客松参赛项目设计方案.md`
- `docs/work/active/2026-07-27-refine-hackathon-initial-review-proposal.md`

## Invariants

- The proposal remains truthful about current implementation.
- The organizer can understand the project, differentiation, and demo loop
  without repository knowledge.
- Internal competition tactics do not appear in the submission draft.

## Implementation Plan

1. Map current sections to the recommended ten-section initial review structure.
2. Rewrite the proposal and add a dedicated Agent architecture design.
3. Verify claims against architecture and work records.
4. Run Markdown/diff checks and complete an independent design review.

## Acceptance Criteria

- The document contains exactly ten main sections.
- It includes one concise abstract, one golden path, one Agent architecture
  diagram, technical decisions, current proof, value metrics, and a two-week
  plan.
- Originality and security appear as concise formal statements.
- Internal scoring, kill lists, judge loops, fallback scripts, and media
  storyboards are removed.

## Verification

- Main-section count check: passed; the proposal contains exactly ten `##`
  sections.
- Internal-only content scan: passed; no internal score table, kill list,
  judge loop, fallback script, media storyboard, or unpublished-weight
  speculation remains.
- Current-boundary scan: passed; the proposal explicitly preserves the
  read-only SQL, controlled Python, human-decision, simulated MySQL, and
  Markdown-only export boundaries.
- `git diff --check`: passed.
- `node scripts/verify-harness.mjs`: blocked by pre-existing format violations
  in other `docs/work/active/` records; the new task record was not reported.
- Independent full-document re-read: passed.
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

Reworked the organizer-facing proposal from 21 mixed-purpose sections into ten
initial-review sections. The new version leads with the business outcome and
golden path, adds a five-layer Agent architecture and control loop, explains
hard-to-fake technical objects and current proof, and retains concise safety,
human-decision, and originality statements. Internal competition tactics and
delivery runbooks were removed.

## Follow-up

- Confirm any organizer-imposed page or character limit and produce a shorter
  form-field version if required.
- Keep the detailed originality ledger, demo fallback, internal scorecard, and
  Q&A pack as separate team artifacts.
