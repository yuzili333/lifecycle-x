# Task: 即梦叙事段生成与剪映合成

- Status: active
- Owner: human + agent
- Started: 2026-09-04

## Goal

使用即梦 Seedance 2.0 Fast VIP 将十二宫格故事板生成18段5秒候选素材，筛选并剪成36秒叙事段，再在剪映完成三角色配音、字幕、声音与90秒成片合成。

## Scope

- 生成P01—P12参考图、提示词与素材清单。
- 在即梦网页端生成12个基础Take及6个关键镜头备选Take。
- 在剪映建立1080P、30fps时间线，完成叙事段、配音、字幕和全片合成。
- 输出36秒叙事中间版和90秒完整版本。

## Non-goals

- 不修改Lifecycle X产品代码或接口。
- 不改写审定旁白、产品段结构和最终金句。
- 不把概念Skill界面描述为真实运行结果。

## Constraints

- 即梦设置：Seedance 2.0 Fast VIP、16:9、720P、5秒、无音频。
- 只上传脱敏参考素材。
- P06报告屏幕必须在后期使用真实脱敏截图替换。
- 叙事段36.0秒，全片90.0秒。

## Affected Areas

- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/plans/`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/generation/`
- `output/hackathon-video/cinematic-90s/`

## Invariants

- 人物、服装、空间和光线连续。
- 不生成字幕、对白口型、客户数据、机构标识或自动风险决策。
- 旁白以 `VOICEOVER.md` 为唯一文字基线。

## Implementation Plan

1. 裁切十二宫格并编制逐镜提示词。
2. 生成并验收P01、P05、P06、P12门禁素材。
3. 批量生成其余素材并完成18段候选。
4. 在剪映完成36秒画面、三角色配音、字幕和屏幕替换。
5. 合并产品段并完成技术及人工验收。

## Acceptance Criteria

- 12个镜头均有连续3秒可用画面，6个关键镜头有两个Take。
- P06报告真实可辨，P11/P12因果明确。
- 三角色声音可区分、字幕无错字和遮挡。
- 输出符合1920×1080、30fps、H.264、AAC及精确时长要求。

## Verification

- 素材尺寸、时长、编码和文件数检查。
- 即梦门禁逐镜人工复核。
- 剪映静音画面审片与纯声音审听。
- `ffprobe`核验中间版和最终版。

## Design Review

- [ ] The design is understandable without relying on tests.
- [ ] Module boundaries remain clear.
- [ ] The implementation is simpler than plausible alternatives.
- [ ] No accidental coupling was introduced.
- [ ] Error and recovery paths are explicit.
- [ ] Generated code was reviewed for unnecessary abstraction.
- [ ] Technical debt and follow-up work are recorded.

## Outcome

执行中。

## Follow-up

无。
