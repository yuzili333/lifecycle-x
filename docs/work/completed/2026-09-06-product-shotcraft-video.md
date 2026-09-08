# Task: Product Shotcraft Video

- Status: completed
- Owner: human + agent
- Started: 2026-09-06
- Completed: 2026-09-06

## Goal

Produce the 54-second cinematic product segment for the 90-second “溯据” demo,
using real full-screen product evidence and the approved shotcraft storyboard.

## Scope

- Validate native full-screen capture and approved same-session Kap sources.
- Build an ignored Remotion project for S09-S20, audio, QA frames, and exports.
- Assemble a 36-second narrative preview and a 90-second combined preview.
- Produce deterministic BGM/no-BGM product renders and a 4K master.

## Non-goals

- No Lifecycle X feature, API, data, or workflow changes.
- No fabricated product state or generated product UI.
- No changes to the approved narration or closing slogan.

## Constraints

- Product footage must be native full-screen, 30 fps, and de-identified.
- Product segment is exactly 54 seconds; combined preview is exactly 90 seconds.
- Real SQL, Python, report versions, lineage, and export evidence remain intact.
- Existing unrelated untracked files and user work are preserved.

## Affected Areas

- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/plans/`
- `output/hackathon-video/cinematic-90s/product-shotcraft/`

## Invariants

- Renderer/preload/main/server boundaries remain unchanged.
- The same successful session supplies all analytical result footage.
- Captions and motion overlays never cover key product controls or evidence.
- Rendering is deterministic and contains no time-based or unseeded randomness.

## Implementation Plan

1. Pass the full-screen and Kap preflight gate.
2. Freeze approved source ranges and material hashes.
3. Build S09-S20 from the approved recipe-card implementations.
4. Add relative-frame SFX and render BGM/no-BGM variants.
5. Assemble the narrative preview, render QA frames, and run independent review.

## Acceptance Criteria

- Full-screen test and source audit pass.
- All required product functions are visible and readable.
- Product and combined renders have exact durations and delivery codecs.
- BGM/no-BGM renders share identical video frames and SFX timing.
- Independent review reports no blocking visual, data, or continuity issue.

## Verification

- `pnpm exec tsc --noEmit`: passed in the isolated Remotion project.
- `pnpm harness:check`: passed in the repository root.
- Full decode, codec, resolution, frame-rate, duration, audio, and contact-sheet checks: passed.
- Product segment: 1620 frames / 54.000 seconds; combined preview: 2700 frames / 90.000 seconds.
- BGM/no-BGM decoded video frame comparison: passed.
- Fixed S13 90-frame deterministic render comparison: passed.
- Final 90-second mix: -16.2 LUFS, -1.2 dBFS true peak.
- SHA-256 deliverable and asset manifests regenerated and verified.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

Independent re-read conclusion: the deliverable stays outside product runtime,
uses real de-identified evidence, keeps one principal motion grammar per shot,
and does not alter application boundaries or business state. The refactor
checkpoint found no release-blocking duplication or abstraction debt.

## Outcome

Completed the native-full-screen 54-second product segment, BGM and no-BGM
variants, 4K master, and exact 90-second combined preview. The final correction
pass moved captions into a dedicated safe band, preserved full navigation and
status context, removed the duplicated S19 slogan, strengthened the S20 brand
landing, and brought the final mix within the strict peak target. Independent
visual review reported no remaining blocker.

## Follow-up

Optional external screening approval and any distributor-specific re-encode can
be performed from the locked master without changing the picture timeline.
