# Task: Hackathon Video Content Design

- Status: completed
- Owner: human + agent
- Started: 2026-08-21

## Goal

Create a production-ready three-minute introduction-video content design for
“溯据” that makes the core product loop and AI-native innovations obvious to
hackathon judges.

## Scope

- Create `prototype/黑客松项目作品介绍视频内容设计.md`.
- Define the video objective, narrative, timed storyboard, voice-over,
  on-screen text, recording assets, editing rules, and verification checklist.
- Use one complete overall-risk-distribution demo as the main proof and show
  other built-in Skills only as reuse evidence.
- Reflect current report export and built-in Skill capabilities.

## Non-goals

- No application code changes.
- No actual screen recording, voice recording, editing, or video export.
- No claims about production deployment or automated risk decisions.

## Constraints

- Value must be clear in the first 20 seconds.
- The middle of the video must show a real end-to-end product loop.
- SQL/Python execution, Artifact lineage, and evidence must not be fabricated.
- Any accelerated or pre-recorded product execution must be labeled honestly.

## Affected Areas

- `prototype/黑客松项目作品介绍视频内容设计.md`
- `docs/work/active/2026-08-21-hackathon-video-content-design.md`

## Invariants

- The product performs factual analysis assistance; humans retain risk
  judgment and decision authority.
- SQL remains read-only and Python consumes controlled datasets only.
- Reports and evidence are derived from real persisted tool and Artifact data.
- The video distinguishes the main demo from the broader Skill portfolio.

## Implementation Plan

1. Review the current proposal, architecture, built-in Skills, report export,
   and visible UI actions.
2. Lock a three-minute narrative and one golden path.
3. Write a shot-by-shot script with exact voice-over and on-screen captions.
4. Add recording, editing, fallback, and final QA checklists.
5. Run document checks and complete an independent design review.

## Acceptance Criteria

- A single table maps every time segment to visuals, actions, narration,
  captions, and proof.
- The script demonstrates natural-language analysis, controlled execution,
  charts/report, follow-up exploration, evidence, and export.
- The innovation section covers workflow ownership, deterministic gates,
  Artifact-first multi-turn analysis, evidence, and Skill reuse.
- Recording and final-export checklists are directly executable.

## Verification

- Confirmed four current built-in Skill manifests and their display names.
- Confirmed the current report UI exposes PDF, DOCX, and Markdown export.
- Confirmed the architecture boundaries for read-only SQL, controlled Python,
  Artifact lineage, and system-built evidence.
- Full voice-over length: approximately 565 Chinese characters, leaving room
  for product-state pauses within a three-minute edit.
- Required-content scan passed for natural-language input, approval,
  SQL/Python execution, multi-turn analysis, report versions, evidence, export,
  Skill reuse, and the human-decision boundary.
- Main-section and trailing-whitespace checks passed.
- `node scripts/verify-harness.mjs`: blocked by pre-existing format violations
  in older `docs/work/active/` records; this task record was not reported.
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

Created a production-ready three-minute video design centered on one real
overall-risk-distribution golden path. The storyboard shows value in the first
20 seconds, then proves planning, approval, SQL/Python execution, charts,
dynamic report versions, evidence, and export. Five innovation labels are
attached to corresponding real product states, while the other three built-in
Skills appear only as reuse proof. The artifact also includes exact narration,
recording assets, editing rules, a two-minute cut, honest fallback behavior,
and final QA checklists.

## Follow-up

- Record P01-P12 against one frozen, de-identified demo dataset.
- Verify the chosen follow-up prompt produces a materially different report
  version before voice recording.
- Confirm the organizer's exact duration, codec, file-size, and naming rules
  before final export.
