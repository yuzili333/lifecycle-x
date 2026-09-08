# Task: 十二宫格真实产品屏幕替换

- Status: completed
- Owner: human + agent
- Started: 2026-09-03

## Goal

将十二宫格故事板中虚构的电脑屏幕替换为“溯据”客户端登录页与报告展示页，并保持原叙事、人物和镜头连续性。

## Scope

- 复用真实报告页截图作为视觉基准。
- 按当前客户端代码与设计系统生成登录页概念参考。
- 使用图像生成模型局部编辑故事板中的可见电脑屏幕。
- 同步更新 `scene-01.md` 中关于屏幕内容的描述与限制。

## Non-goals

- 不修改客户端代码或产品功能。
- 不改变十二格顺序、镜头时长或人物剧情。
- 不将故事板中的小尺寸屏幕宣传为逐字可读的功能截图。

## Constraints

- 遵循 `video-storyboard`、`product-design:index` 与 `imagegen` 技能要求。
- 登录页必须基于现有 `LoginPage.tsx` 与设计主题；报告页必须基于真实脱敏演示截图。
- 保持原 4×3 网格、1—12 编号、每格 `3s` 标签与电影摄影风格。

## Affected Areas

- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/storyboard/`
- `hackathon/storyboard-workspace/README.md`

## Invariants

- 36 秒总时长及十二个叙事节拍不变。
- 主角、研发角色、服装、办公室、光线和流程图形保持一致。
- 不出现真实客户数据、账号、密钥或外部品牌。

## Implementation Plan

1. 固化真实产品视觉基准与登录页设计规格。
2. 生成登录页概念参考图。
3. 编辑十二宫格，替换可见电脑屏幕内容。
4. 复核图像、更新视频提示词并完成验证。

## Acceptance Criteria

- 登录页与报告页在故事板中可被识别为同一“溯据”客户端。
- 原 12 格布局、编号、时长与叙事动作不变。
- `scene-01.md` 与新图一致，不再要求所有屏幕为抽象占位。
- 视觉复核与 Harness 检查通过。

## Verification

- 视觉对照：将登录页参考、真实报告页截图与最终故事板并排检查；登录卡层级、深色主题、报告三栏结构、屏幕透视和景深一致。
- 故事板：1449×1086，4×3 十二格；人工确认 1—12 编号与每格 `3s` 标签完整，人物、服装、办公室和 11—12 格流程图形未漂移。
- 提示词：12 个镜头，时间码从 `00:00—00:03` 连续到 `00:33—00:36`，累计 36 秒。
- 敏感内容扫描：未发现个人绝对路径、API Key、Bearer Token、“兴业”或“CIB”。
- `git diff --check`：通过。
- `pnpm harness:check`：通过。
- `pnpm harness:test`：6/6 通过。

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

以真实脱敏报告截图为权威基准，并按当前 `LoginPage.tsx` 与产品主题生成登录页参考；随后仅替换故事板内可见显示器内容。最终画面保留原十二格镜头、人物与剧情，但已能辨认“溯据”登录页和报告页。旧版故事板保留为 `scene-01-v1.png`，便于回溯。

## Follow-up

故事板远景中的小字号内容有意按景深软化，不能替代真实产品截图作功能验收。后续制作视频时应继续使用同一登录页参考和真实报告素材，避免产品外观漂移。
