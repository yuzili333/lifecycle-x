# Task: Narrative Storyboard Keyframes

- Status: completed
- Owner: human + agent
- Started: 2026-09-02

## Goal

为“溯据”电影级演示的叙事段 S01—S08 完成可执行的分镜导演文件，并生成八张16:9 Keyframe 图像。

## Scope

- 建立人物、视觉和连续性 Bible。
- 建立两幕场景、八镜头导演表、八份标准图像提示词和连续性审查表。
- 使用内置 Image Generation 为 S01—S08 逐镜生成项目内 Keyframe。
- 回填 Keyframe 清单、尺寸和人工审查结果。

## Non-goals

- 不生成 S09—S20 产品镜头。
- 不生成视频、旁白、字幕或最终 MP4。
- 不制作概念产品 UI，不在生成图中呈现真实数据、代码、机构或人员信息。

## Constraints

- S01—S06保持同一主角、服装、工位、清晨光线和需求卡视觉连续性。
- S07—S08从写实办公平滑过渡到深海蓝抽象流程空间。
- 所有准确中文、看板标签和流程名称由后期叠加，不依赖图像模型生成。
- 研发角色保持专业、协作和中性，不被塑造成问题来源。

## Affected Areas

- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/bible/`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/scenes/`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/shots/`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/prompts/`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/reviews/`
- `hackathon/storyboard-workspace/projects/sujudata-cinematic-demo/media/keyframes/`

## Invariants

- 剧情含义与 `SHOTBOOK.md` 的 S01—S08一致。
- 画幅统一16:9，风格为克制、真实的企业电影摄影。
- 不出现银行Logo、真实账号、客户数据、可识别机构或真实人物肖像。
- Keyframe仅为叙事资产，不冒充真实产品运行状态。

## Implementation Plan

1. 冻结人物、场景、道具、色彩和连续性规则。
2. 完成两幕八镜头导演表与图像提示词。
3. 逐镜生成并保存八张 Keyframe。
4. 完成尺寸、内容、安全和连续性复核。

## Acceptance Criteria

- 推荐项目目录结构完整且文件可独立交接。
- 八个镜头均有符合 Prompt Output Contract 的提示词。
- 八张 Keyframe 均保存到项目目录并登记来源。
- S01—S06人物与办公环境连续，S07—S08视觉转折成立。
- 生成图不存在可识别敏感信息、品牌、概念产品UI或误导性文字。

## Verification

- Storyboard结构：`bible/`、`scenes/`、`shots/`、`prompts/`、`reviews/`和`media/keyframes/`完整。
- Prompt Contract：8/8提示词均包含SHOT ID、目的、人物、摄影、灯光、情绪、构图、环境、连续性、负面约束和可直接生成的IMAGE PROMPT。
- YAML解析：两幕场景文件与两份镜头文件全部通过Ruby YAML解析。
- 图像生成：使用内置Image Generation逐镜生成S01—S08；S01经过一次局部修正，将墙钟调整为9:00、状态点改为琥珀色并补足青绿色领口。
- 图像规格：8/8均为1672×941 PNG，横纵比约16:9；合并审看图为2560×720 JPEG。
- 完整性：清单中的8个SHA-256全部复核通过。
- 人工视觉复核：S01—S06人物、发型、服装、腕表、工位和冷暖光线连续；S03研发协作中性专业；S05为正确报告加自然追问；S07—S08完成等待循环到受控路径的转折。
- 安全复核：未发现可识别机构Logo、真实账号、客户数据、可读代码、品牌水印、概念产品UI或真实人物肖像；提示词安全审查全部通过。
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

独立复核结论：写实办公幕与抽象转折幕边界清楚，八镜头均只承担一个故事动作。准确文字保留给后期，避免图像乱码；生成资产不承担产品功能证明。S07—S08使用相同任务卡与材质建立因果，S08检查点只表示受控步骤，不表示系统自动作出风险判断。

## Outcome

完成可独立交接的叙事分镜包和八张Keyframe。S01建立上午九点的任务与人物锚点；S02—S04表现业务能力、需求解释和正常排期；S05—S06呈现正确静态报表遇到新追问后重新返工；S07—S08把等待循环拉直为受控分析路径。所有最终图片、提示词、连续性Bible、镜头表、审查记录、哈希和合并审看图已保存到Storyboard项目目录。

## Follow-up

- 经人工确认的 Keyframe 再进入 HyperFrames 或 Remotion 动态化阶段。
