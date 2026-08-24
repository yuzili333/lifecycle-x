# Task: Hackathon Video Production

- Status: active
- Owner: human + agent
- Started: 2026-08-22

## Goal

Produce the local working package and final three-minute hackathon introduction
video for “溯据” using Kap for screen recording and Jianying Pro for narration,
editing, captions, packaging, and export.

## Scope

- Create the two-day production plan and local ignored asset workspace.
- Prepare the timed subtitle draft, shot manifest, recording checklist, graphics,
  and automated export verification.
- Validate the same real Golden Path twice before recording P01-P12.
- Assemble, review, and export the master and submission videos from approved
  de-identified evidence and the user-authorized Jianying narration track.

## Non-goals

- No Lifecycle X product feature changes.
- No fabricated tool states, business data, reports, evidence, or narration.
- No Remotion, HyperFrames, Adobe, Canva, digital avatar, or non-Jianying cloud
  media flow.

## Constraints

- Final duration must not exceed 180 seconds; target 179.8 seconds.
- Product footage and edit assets remain local; the user explicitly replaced
  human recording with Jianying's built-in text-to-speech narration workflow.
- All report, chart, evidence, and version footage comes from one successful
  de-identified conversation.
- The final narration uses a clear Mandarin Jianying voice at normal speed and
  remains subject to business-content approval.

## Affected Areas

- `prototype/黑客松项目作品介绍视频制作计划.md`
- `scripts/build-hackathon-asset-manifest.mjs`
- `scripts/verify-hackathon-subtitles.mjs`
- `scripts/verify-hackathon-video.mjs`
- `output/hackathon-video/` (Git-ignored production workspace)

## Invariants

- SQL/Python execution and Artifact lineage shown in the video are real.
- The product does not make automated risk decisions.
- Accelerated execution footage remains explicitly labeled.
- Sensitive data, credentials, and local absolute paths are not exposed.

## Implementation Plan

1. Build the local production workspace, manifests, subtitle draft, and checks.
2. Verify the current app session and de-identified demo data against the
   Golden Path gate.
3. Record P01-P12 with Kap after the gate passes.
4. Assemble narration, captions, graphics, and the final timeline in Jianying.
5. Export, mechanically verify, review, and freeze the deliverables.

## Acceptance Criteria

- The production workspace and directly executable checklists exist.
- A real Golden Path passes twice before recording is approved.
- P01-P12 each have an approved take from one conversation.
- The final master and submission files pass technical and content review.
- A business lead approves narration content and business accuracy.

## Verification

- Confirmed local Kap 3.6.0 and Jianying Pro 11.3.0 installations.
- Created the ignored production workspace, shot manifest, gate checklist,
  subtitle draft, packaging graphics, and final-video verifier.
- Rendered G01-G04 to 1920x1080 PNG and visually reviewed all four assets.
- `node scripts/verify-hackathon-subtitles.mjs` passes: 30 cues, 179.8
  seconds, at most two lines, and at most 18 Chinese characters per line.
- `node --check` passes for all added JavaScript verification/render scripts.
- Smoke-tested `scripts/verify-hackathon-video.mjs` with a valid two-second
  H.264/AAC fixture; the verifier correctly rejected only its short duration.
- `pnpm harness:test`, `pnpm lint`, and `pnpm typecheck` pass. Lint reports only
  seven pre-existing React Hook warnings and no errors.
- `pnpm verify:fast` is blocked before those checks by legacy active-task files
  that do not match the current task template; this task did not modify them.
- `git diff --check` passes.
- Verified the user-confirmed repository dataset
  `de-identified-data/信贷风险.csv` has 200 data rows and 80 columns, including
  the three required fields; recorded its SHA-256 in the production run log.
- Golden Path run 01: SQL completed; Python failed because stdout was not
  valid JSON after one automatic repair attempt.
- Golden Path run 02: SQL completed; Python parameter generation retried after
  an overlong output, then failed with the same invalid-JSON error after
  approval and one automatic repair attempt.
- Golden Path run 03 used the repository-fixed de-identified CSV and the user-
  prepared dedicated conversation. SQL completed with 200 rows; Python compact
  retry ended in an execution-model request timeout, blocking chart and report.
- Golden Path run 04 used a second clean conversation and the same repository
  CSV. SQL completed with 200 rows; Python failed the JSON stdout contract after
  approval and one automatic repair attempt.
- Post-fix protocol calibration confirmed that the overall-risk deterministic
  Python path succeeds when the Skill is visibly selected. A follow-up without
  the Skill produced an empty dataset, so the recording script now selects the
  same Skill and three fields again for the follow-up.
- Post-fix clean run 06 completed both the main task and controlled follow-up:
  SQL, Python, chart, and report all succeeded twice; report version 2 retained
  200 contracts, 373,780.35 ten-thousand yuan, one chart, three-field evidence,
  lineage, decision boundary, and PDF/DOCX/Markdown export options.
- After restarting the desktop app to load the follow-up inheritance fix, two
  consecutive clean runs completed the main task and a plain-language follow-
  up without reselecting the Skill or three fields. Both retained 200 contracts,
  373,780.35 ten-thousand yuan, three-field evidence, execution lineage,
  decision boundary, and PDF/DOCX/Markdown export options. G0 is now 2/2 and
  passed.
- Kap 3.6.0 was verified with cursor enabled, click highlighting disabled,
  30 fps, and audio recording disabled. The user completed the macOS screen-
  recording authorization locally; microphone and system audio remained off.
- Formal recording run 09 used one conversation
  `c24dadc5-f3df-4707-94cd-d83d8e7c5db1` for the main task and plain-language
  follow-up. SQL, Python, report versions 1/2, evidence, and export options all
  completed with 200 records and a total balance of 373,780.35 ten-thousand
  yuan.
- Three reviewed formal Kap sources were frozen: P02-P03/P12 (16.93s),
  P04-P07 (22.87s), and P08-P11 (59.13s). Each is silent H.264,
  2880x1620, 30 fps. P01-P12 fallback screenshots and the exact version-2
  Markdown Artifact were saved from the same conversation.
- Three reviewed second-take Kap sources were frozen: P02-P03/P12 (38.07s),
  P04-P07 (38.40s), and P08-P11 (54.43s). Each is silent H.264,
  2880x1620, 30 fps. Contact sheets confirm that the usable ranges show the
  Lifecycle X product without Kap controls, notifications, credentials, or
  local paths.
- Earlier diagnostic and calibration recordings exposed the wrong foreground
  window, a Kap overlay, a notification banner, or an inherited native save
  dialog. Every exported failure is explicitly listed as excluded in
  `recording-review.md` and the generated asset manifest.
- A real version-2 PDF was exported from Lifecycle X, opened in Preview, and
  recorded twice with Kap. Take 02 is the approved 31.90-second source. An
  exact 16-second P11 replacement combines eight seconds of the real export
  interaction with eight seconds of the exported PDF content.
- P11 was replaced in place in Jianying. The timeline was reviewed at
  `00:02:28:16`, where the exported PDF page is readable, and the project still
  ends at `00:02:59:24` (179.8 seconds).
- The approved 30-cue SRT was imported at `00:00:00:00`; all cues are on the
  subtitle track without changing total duration. Jianying generated all 30
  narration cues with the free `新闻男声` voice at 1.00x speed. Every final cue
  fits its approved window with no adjacent overlap; a 179.8-second PCM backup
  track is stored at `output/hackathon-video/audio/VO_full_t01.wav`.
- Five approved innovation callouts and the execution flow bar were burned into
  a single reviewed visual master. It is H.264, 1920x1080, 30 fps, 5,394 frames,
  and exactly 179.8 seconds; the approved P11 PDF-content shot is included.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

Pre-production is ready, G0 and G1 have passed, and the first approved Kap take
plus a reviewed second Take for P01-P12 are frozen from one real successful
conversation. The follow-up
inheritance behavior, report versions, evidence card, and export menu are all
visible in the formal footage. `sujudata_v01_rough` now contains G01,
P01-P12, and G03 in the planned order, totals 179.8 seconds, and has been
played continuously from `00:00:00:00` to `00:02:59:24` in Jianying. All four
Day 1 completion gates are passed. Day 2 machine work is complete: P11 includes
the real exported PDF content, 30 normal-speed Jianying narration cues and the
approved SRT are synchronized, the five innovation callouts are packaged, and
`sujudata_v02_picture-lock` played continuously to `00:02:59:24`. The final
master and 10.99-Mbps CBR submission MP4s are exactly 179.8 seconds and pass
codec, duration, complete-decode, contact-sheet, and SHA-256 verification.
After review feedback, v04 reduced all bottom subtitles from size 7 to 5, moved
the interaction callout to the upper-right in amber/white, and enabled Jianying
SVIP loudness normalization. A full-resolution 25-second review then found that
the size-5 subtitle still covered the input area, so v04 was rejected and
archived. v05 disables that embedded subtitle track and renders the approved 30
SRT cues in a dedicated 72-pixel dark subtitle band. The 16:9 product picture is
scaled proportionally to 1792x1008 and centered without cropping or stretching.
Full-resolution checks at 25, 34, 70, 145, and 177 seconds confirm that the `#`
input, Skill dropdown, execution state, PDF export, and closing frame remain
unobstructed. Both v05 MP4s are exactly 179.8 seconds, fully decode, and pass the
codec, subtitle, duration, and hash verification scripts.
After the closing narration was approved, v06 replaced only the final sentence
with “溯据——让每份报告有据可溯，让每次分析沉淀为能力。” Jianying's free
`新闻男声` generated the sentence at 1.00x speed; the approved v05 narration and
SVIP loudness treatment remain unchanged before 172 seconds. SRT cues 29 and 30
were updated for 172.0—174.7 and 174.7—179.8 seconds, respectively, while the
72-pixel subtitle-safe layout and all visuals stayed fixed. Full-resolution
closing-frame review passed, both v06 files contain 5,394 frames and fully
decode, and the final audio measures -23.0 LUFS integrated with a -7.7 dBFS true
peak. v05 remains recoverable under `exports/archive/v05-before-slogan/`.
Final visual review then found that v06 still displayed the superseded sentence
inside the closing card. v07 updates the 172.0—179.8-second G03 visual to the
same approved slogan shown by the narration and captions: “让每份报告有据可溯 / 让每次分析沉淀为能力”. The product title and four human-machine
responsibility cards remain unchanged. Full-resolution checks at 172.3, 174.8,
177.5, and 179.5 seconds pass; both outputs still contain 5,394 frames, fully
decode, and preserve the -23.0 LUFS / -7.7 dBFS audio. v06 is archived under
`exports/archive/v06-before-visual-slogan/`.

## Current Blocker

No production or machine-verification blocker remains. The only outstanding
acceptance items are human narration review, playback on a second computer, and
the business/engineering sign-off required by the production plan.

## Independent Design Review

- Problem fit: the package now includes a real same-conversation first Take and
  a reviewed second Take for every P01-P12 shot; the Jianying rough cut is also
  complete and independently backed up.
- Architecture: no renderer, main-process, server, SQL, Python, or public API
  code changed; production utilities remain under `scripts/` and ignored output.
- Simplicity: three reusable source clips cover the twelve shots through explicit
  source ranges; no redundant P01-P12 copies were fabricated.
- Data and safety: formal clips contain only the authorized de-identified CSV,
  aggregate results, report lineage, and abbreviated user avatar; the full
  sidebar username, credentials, customer data, notifications, and local paths
  are absent. Two bad-foreground Takes are retained only as explicitly excluded
  diagnostics.
- Correctness: the manifest now says one combined chart because that is what the
  real Skill generated; it does not preserve the older two-chart wording.
- Recovery: P01-P12 screenshots, the version-2 Markdown Artifact, exact clip
  hashes, contact sheets, and the formal conversation ID are recorded under
  `output/hackathon-video/`. Exported failed takes are retained only as
  explicitly excluded diagnostics; discarded transient captures were never
  promoted to files.

## Follow-up

- Preserve the frozen `sujudata_v01_rough` backup under
  `output/hackathon-video/drafts/` and make later changes only in copied
  versions.
- Play the final submission MP4 on a second computer, complete the business
  narration/terminology review, and record the business and engineering sign-off.
