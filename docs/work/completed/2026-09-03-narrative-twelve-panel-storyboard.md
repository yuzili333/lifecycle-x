# Task: 叙事段十二宫格故事板

- Status: completed
- Owner: human + agent
- Started: 2026-09-03

## Goal

为“溯据”电影级演示视频的前半段叙事制作一张十二宫格故事板，并提供与每格严格对应的视频生成提示词。

## Scope

- 将现有 0:00—0:36 业务痛点叙事拆分为十二个 3 秒镜头。
- 复用既有角色、办公环境与视觉风格参考，生成单张 4×3 故事板图。
- 新增中文视频生成提示词，覆盖动作、镜头、转场、声音与连续性约束。

## Non-goals

- 不改动产品功能、业务文档或后半段产品演示结构。
- 不生成可读业务数据、真实机构标识或产品界面。
- 不制作最终视频。

## Constraints

- 遵循 `video-storyboard` 与 `imagegen` 技能要求。
- 十二格顺序、时长和提示词必须一一对应，总时长保持 36 秒。
- 角色身份、服装、办公环境、晨间光线保持连续。

## Affected Areas

- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/storyboard/`
- `hackathon/storyboard-workspace/README.md`

## Invariants

- 真实痛点仍是：业务人员无需等待研发排期、无需直接编写 SQL/Python，也能通过受控工具链获得可复核、可继续钻探的报告。
- 研发人员不被反派化，冲突来自流程与协作成本。
- 叙事段在 0:36 结束，并自然转入产品段。

## Implementation Plan

1. 冻结十二格镜头节拍和视觉连续性。
2. 使用既有关键帧作为参考生成单张十二宫格图。
3. 视觉复核并按需定向修正。
4. 编写逐格视频提示词并完成仓库验证。

## Acceptance Criteria

- 生成 `scene-01.png`，包含清晰的 4×3 十二宫格。
- 每格标记 1—12 和 `3s`，动作可独立识别。
- 生成 `scene-01.md`，十二段提示词与故事板顺序及时间完全一致。
- 角色、服装、场景和视觉风格连续，无品牌、真实数据或无关文字。

## Verification

- `scene-01.png`：1448×1086，4:3 整体画幅，内含 4×3 十二格；逐格人工检查编号 1—12、`3s` 标签、角色与空间连续性通过。
- 时间码脚本检查：12 个镜头、首段 `00:00—00:03`、末段 `00:33—00:36`，累计 36 秒。
- `pnpm harness:check`：通过。
- `pnpm harness:test`：6/6 通过。
- `git diff --check`：通过。
- 敏感词与本机路径扫描：未发现机构名称、API Key、Bearer Token 或个人绝对路径。
- 图片 SHA-256：`cbf62ecc96775d05d980daa7e0015624ff1584e9430afe7771878bd7a18e0bee`。

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

已生成单张模型原生十二宫格故事板，并完成与 12 个 3 秒镜头严格对应的中文视频生成提示词。独立复核确认：真实业务痛点、非反派化研发角色和 0:36 产品转场均被保留；没有引入产品 UI、真实数据或额外产品能力。

## Follow-up

后续可使用本提示词制作连续视频片段，并与 0:36 后的产品演示画面衔接。
