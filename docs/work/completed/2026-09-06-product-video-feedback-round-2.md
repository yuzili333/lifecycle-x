# Task: Product Video Feedback Round 2

- Status: completed
- Owner: human + agent
- Started: 2026-09-06

## Goal

Revise the 54-second “溯据” product segment so every visual guide has a clear
semantic purpose and the field selection, Skill, follow-up, result, and report
evidence are immediately readable.

## Scope

- Replace the ambiguous S09 opening line with a direct “溯据” brand reveal.
- Align S10 and S11 focus treatments with the real input and Skill chip.
- Remove the ambiguous execution-stage connector line.
- Give S17 explicit focus states for the follow-up question and generated result.
- Replace rapid report scrolling with stable, source-derived report views.
- Rerender all four deliverables and refresh QA/manifest records.

## Non-goals

- No Lifecycle X application, API, data, or workflow changes.
- No fabricated report content or generated product UI.
- No change to the approved narration, subtitle text, or 90-second total duration.

## Constraints

- Preserve the locked S09—S20 timing and existing voice-over synchronization.
- Use only authentic, de-identified source material from the recorded Golden Path.
- Keep all product evidence readable at 1920×1080 and retain a 3840×2160 master.

## Affected Areas

- `output/hackathon-video/cinematic-90s/product-shotcraft/src/`
- `output/hackathon-video/cinematic-90s/product-shotcraft/public/product/`
- `output/hackathon-video/cinematic-90s/product-shotcraft/manifest/`
- `output/hackathon-video/cinematic-90s/product-shotcraft/exports/`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/plans/product-video-plan.md`

## Invariants

- All product evidence remains from the same de-identified successful session.
- Product footage remains native full-screen and 30 fps.
- Real interface content is never reconstructed or altered.
- Rendering remains deterministic.

## Implementation Plan

1. Replace ambiguous decorative connectors with direct semantic focus treatments.
2. Align field, Skill, approval, follow-up, and result highlights to the real UI.
3. Replace rapid report scrolling with stable source-derived report views.
4. Rerender all deliverables and refresh technical and visual QA artifacts.
5. Complete an independent clean-context final review.

## Acceptance Criteria

- The opening communicates “溯据” without connector-line clutter.
- The `#` field list, selected fields, and Skill chip are precisely highlighted.
- No ambiguous connector appears around product second 22.
- The follow-up question and second report are both explicitly readable.
- The first report overview, chart, and conclusion are held long enough to inspect.
- All four deliverables pass decode, duration, codec, audio, and visual review.

## Verification

- TypeScript compilation and repository Harness checks.
- Per-shot still review for S09, S10, S11, S13, S16, and S17.
- Full render, decode, duration, codec, loudness, and frame-match checks.
- Independent clean-context visual review before release.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

All five readability issues were resolved without changing the approved timing,
narration, subtitles, product behavior, or source session. Four deliverables were
rerendered and passed full decode, exact-duration, codec, loudness, parameterized
frame-match, deterministic still, Harness, and independent visual review gates.

## Follow-up

The independent reviewer noted that the report segment is optimized for reading
the structure, fields, chart, and core conclusion rather than every paragraph;
this is accepted for the locked 90-second review format.
