# Task: 电影演示旁白场景化与对白优化

- Status: completed
- Owner: human + agent
- Started: 2026-09-04

## Goal

将“溯据”90秒电影级演示的旁白改写为真实办公场景中的人物行动与对白，去除说明性和通用AI表达，同时保持既定时长、产品事实与收尾金句。

## Scope

- 重写 `VOICEOVER.md` 的前36秒场景对白和后54秒产品叙述。
- 区分业务主管、研发同事和参会同事的语言习惯与潜台词。
- 同步 `project.json` 和 `SHOTBOOK.md` 中的台词及S07—S08转折描述。

## Non-goals

- 不重新生成故事板图片或视频。
- 不调整90秒总时长和20镜头结构。
- 不新增产品功能、业务结论或产品承诺。
- 不修改已批准的收尾金句。

## Constraints

- 前半段保持叙事、后半段保持真实产品证明。
- 研发角色保持专业协作形象，不被塑造成阻碍者。
- SQL只读、Python受控输入、用户审批和Artifact血缘等边界不变。
- 对白应能以正常语速落入现有镜头时长。

## Affected Areas

- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/VOICEOVER.md`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/SHOTBOOK.md`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/project.json`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/DESIGN.md`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/ASSET_PLAN.md`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/QA_CHECKLIST.md`

## Invariants

- 总时长保持90.0秒。
- 最终金句保持“让每份报告有据可溯，让每次分析沉淀为能力”。
- 产品演示内容必须与真实能力一致。

## Implementation Plan

1. 按真实办公事件链重写前36秒场景。
2. 将产品段改为业务主管第一人称现场操作叙述。
3. 二次润色对白，强化角色声纹、潜台词和节奏。
4. 同步项目元数据与导演说明并检查一致性。

## Acceptance Criteria

- 前36秒通过动作与对白呈现任务、排期、追问和知识沉淀。
- 三类角色仅看文字即可区分。
- 产品段不再连续使用“系统/业务/智能体”式功能说明句。
- 每句适配既定镜头时长，技术边界无夸大。
- 三份制作基线中的台词一致。

## Verification

- `project.json` JSON解析：通过。
- `VOICEOVER.md` 与 `project.json` 19条定时台词逐条匹配：通过。
- 正常语速启发式检查：全部台词不超过每秒4.00个口语单位。
- 旧旁白与旧S07—S08转折表述检查：主要制作基线中无残留。
- `pnpm harness:check`：通过。
- 已按 `docs/quality/design-review.md` 完成独立设计复核。

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

完成前36秒三角色场景对白、后54秒业务主管第一人称操作旁白，以及项目元数据、导演说明、视觉规范、资产计划和QA门禁同步。保留90秒时长、真实产品边界和审定收尾金句。

## Follow-up

录音前由制作人员按三种角色声线完成一次90秒全片试读；若使用合成声音，保持角色可辨但不做夸张戏剧化表演。
