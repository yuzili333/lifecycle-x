# Task: 十二宫格报告、知识与 Skill 重构

- Status: completed
- Owner: human + agent
- Started: 2026-09-04

## Goal

将十二宫格第 6 格替换为真实脱敏报告图表，并将第 11、12 格改为“业务专家知识沉淀”和“研发专家 Skill 生成”，增强故事板与“溯据”的产品关联。

## Scope

- 第 6 格保留双人审看构图，大屏使用真实脱敏报告图表截图。
- 第 11 格表现业务主管把已确认的报告口径、流程和证据沉淀为结构化知识。
- 第 12 格表现研发工程师将已对齐的业务知识封装为可复用 Skill，并由业务主管确认。
- 同步更新 `scene-01.md` 的连续性、节奏、镜头、声音和限制说明。

## Non-goals

- 不改动第 1—5、7—10 格剧情和构图。
- 不修改产品代码或新增真实 Skill 功能。
- 不生成真实客户数据、账号、密钥或可辨认源码。

## Constraints

- 遵循 `video-storyboard` 与 `imagegen` 技能要求。
- 保持 4×3 网格、1—12 编号、每格 `3s` 和 36 秒总时长。
- 保持主角、研发工程师、服装、办公室、光线和产品主题连续。
- 第 11、12 格是叙事化能力沉淀表达，不得表现为系统自动替银行作出风险判断。

## Affected Areas

- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/storyboard/`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/bible/continuity_rules.md`

## Invariants

- 研发角色始终专业协作，冲突来自流程与工具门槛。
- 报告画面使用真实脱敏演示内容作为视觉基准。
- 知识与 Skill 的形成来自业务、研发共同核验，不是模型凭空生成。

## Implementation Plan

1. 锁定真实报告图表参考和第 11、12 格视觉语义。
2. 使用图像生成模型定向替换第 6、11、12 格。
3. 视觉复核人物、报告、知识到 Skill 的因果关系。
4. 同步提示词、连续性规范并完成 Harness 验证。

## Acceptance Criteria

- 第 6 格大屏可辨认真实报告页和柱状图结构。
- 第 11 格明确表达业务知识沉淀；第 12 格明确表达 Skill 生成与共同确认。
- 其余九格、所有编号和时长标签保持一致。
- 视频提示词与新故事板顺序、动作和时间完全一致。

## Verification

- 视觉复核：第 6 格大屏可辨认“溯据”三栏界面与五级风险柱状图；第 11 格以业务主管为知识所有者，第 12 格以研发工程师为 Skill 封装者，双方身份、服装和协作关系连续。
- 故事板：1448×1086，4×3 十二格；1—12 编号和每格 `3s` 标签完整。
- 提示词：12 个镜头从 `00:00—00:03` 连续到 `00:33—00:36`，累计 36 秒；包含真实脱敏报告、业务专家、Skill 和受控 SQL/Python 约束。
- 敏感内容扫描：未发现个人绝对路径、API Key、Bearer Token、“兴业”或“CIB”。
- `git diff --check`：通过。
- `pnpm harness:check`：通过。
- `pnpm harness:test`：6/6 通过。
- 故事板 SHA-256：`31bc7f188463b20913c6d13419e074332da51a9f4fa9597bdf976b0b59fbf5fa`。

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

已使用真实脱敏报告截图替换第 6 格大屏，并以同一业务主管、研发工程师和办公空间重构第 11、12 格。新的结尾形成“共同核验真实报告—业务知识沉淀—研发 Skill 封装”的因果链，明确呈现组织能力沉淀，同时不暗示自动风险判断。替换前版本保留为 `scene-01-v2.png`。

## Follow-up

后续视频镜头应继续使用同一报告截图、人物锚点与“知识—Skill”视觉语言。
