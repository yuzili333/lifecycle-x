# Task: Storyboard Pain Reframe

- Status: completed
- Owner: human + agent
- Started: 2026-09-02

## Goal

将“溯据”90秒电影级 Storyboard 的核心痛点重新定位为：存续期业务人员无需等待科技研发排期、无需直接编写 SQL/Python，即可通过受控工具链获得真实、可复核、可继续钻探加工的数据结果报告。

## Scope

- 重写前40秒办公剧情、全片旁白和镜头画面描述。
- 同步更新项目脚本、视觉母题、SHOTBOOK、资产计划和 QA 门禁。
- 保持前半段叙事、后半段真实产品证明的既定结构。

## Non-goals

- 不生成视频、图片、旁白或最终 MP4。
- 不修改产品功能、运行协议或演示数据。
- 不改变90秒总时长和20镜头结构。
- 不宣称替代科技研发、数据治理、人工审批或风险判断。

## Constraints

- 办公剧情必须真实体现需求沟通、研发排期、一次性报表和追问返工。
- 产品段只使用同一成功会话的真实录屏。
- 不生成概念 UI，不伪造 SQL/Python、审批、图表、报告或溯据链。
- 旁白保持专业、自然和正常语速。

## Affected Areas

- `hackathon/storyboard-workspace/`
- `docs/work/completed/2026-09-02-storyboard-pain-reframe.md`

## Invariants

- 总时长精确90秒，11个段落的时间结构不变。
- 0—40秒为人物与办公冲突，40—90秒为真实产品证明与品牌收束。
- 报告、图表、版本和溯据卡来自同一真实执行链。
- 最终金句保持“让每份报告有据可溯，让每次分析沉淀为能力”。

## Implementation Plan

1. 冻结真实痛点、人物目标、障碍和转折问题。
2. 重写项目旁白、S01—S20脚本与画面描述。
3. 同步视觉规范、SHOTBOOK、资产计划和QA门禁。
4. 校验结构、时长、旁白密度、业务边界和文档一致性。

## Acceptance Criteria

- 前15秒可识别主角、任务和“业务懂问题但无法独立完成数据报告”的矛盾。
- 15—32秒清晰呈现沟通、排期、一次性交付和追问重排队。
- 32—40秒将矛盾转化为“不写代码也能自主推进受控分析”的产品命题。
- 后50秒逐项证明自然语言、审批、真实工具、钻探、版本和溯据能力。
- 文案不贬低科技研发，也不暗示无审批、全自动或替代人工判断。

## Verification

- Workspace结构校验：项目索引与标题一致；`project.json` 可解析；20个镜头；总时长90.0秒；镜头时长序列、类型、媒体类型、生成器、画面提示和备注均合法；结果0错误。
- 旁白节奏校验：全片309个有效字符，平均约206字/分钟；除跨S19—S20完整6秒表达的金句外，单镜最高约240字/分钟，无需加速。
- 旧痛点扫描：未发现“数字离开执行现场”“怎么算、依据什么”“不会SQL就只能等待”等旧定位残留。
- 核心语义复核：README、DESIGN、SHOTBOOK、VOICEOVER和QA均覆盖研发排期、代码门槛、一次性报表、多轮钻探与受控执行边界。
- 可移植与敏感信息扫描：未发现个人绝对路径、Bearer Token、密钥形态字符串或尾随空格。
- `pnpm harness:check`：通过。
- `pnpm harness:test`：6/6通过。
- `git diff --check`：通过。

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

独立复核结论：新版冲突由真实协作结构产生，而非研发失误或数据错误；“自主”明确受权限、审批和工具边界约束。前40秒的需求卡在沟通、排期和追问之间循环，后50秒由真实产品动作逐项解除冲突，因果闭合。改动只涉及制作资料，不耦合产品代码或既有三分钟视频资产。

## Outcome

完成核心痛点重构。新版电影剧情以“上午九点收到临时分析任务”为触发事件，依次呈现需求转写与解释、研发正常排期、一次性报表交付、会议追问和再次等待；32秒后提出“不写代码，业务能否自主推进受控分析”，再由真实字段选择、业务Skill、计划确认、只读SQL、受控Python、版本化报告、多轮追问和溯据卡完成证明。旁白、项目JSON、视觉规范、资产计划和QA门禁已保持一致。

## Follow-up

- 先制作新版 S01、S05、S08 三个叙事 look-dev，再决定是否批量生成 S02—S07。
