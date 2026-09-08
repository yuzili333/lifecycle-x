# Task: Cinematic Storyboard Workspace

- Status: completed
- Owner: human + agent
- Started: 2026-09-01

## Goal

为“溯据”创建一套兼容 Codex Storyboard 数据结构的90秒电影级产品演示分镜工作区，供后续素材生成、实机录制、Remotion 合成和声音制作直接使用。

## Scope

- 将 `hackathon/presentation-video.md` 的11段叙事结构展开为逐镜头 shot array。
- 创建 `projects.json`、项目级 `project.json`、`DESIGN.md` 及制作辅助文档。
- 冻结旁白、画面描述、生成方式、真实产品镜头边界、资产清单和质量门禁。
- 保留 Storyboard Workspace 的可移植目录结构，便于后续通过 `CODEX_STORYBOARD_DATA_DIR` 打开。

## Non-goals

- 本轮不生成图片、视频、配音或最终 MP4。
- 不修改 Lifecycle X 产品功能、协议或数据。
- 不创建概念 UI，不伪造工具、审批、图表、报告或溯据状态。
- 不覆盖现有三分钟剪映项目和已冻结素材。

## Constraints

- 成片结构为16:9、90秒，电影级叙事但以真实产品证明为核心。
- 40—86秒产品段只使用同一成功会话的脱敏真实素材。
- 系统不替银行作风险判断；所有业务定性和处置仍由有权人员完成。
- 生成式镜头不得出现真实银行标识、客户信息、账号、密钥或本地路径。

## Affected Areas

- `hackathon/presentation-video.md`
- `hackathon/storyboard-workspace/`
- `docs/work/completed/2026-09-01-cinematic-storyboard-workspace.md`

## Invariants

- Shot array 总时长精确为90秒，时间码连续且无重叠。
- 每个产品卖点都由真实界面动作证明，不由旁白或包装单独宣称。
- 图表、报告版本和溯据卡来自同一真实执行链。
- `project.json` 使用 Codex Storyboard 当前支持的项目与镜头字段。

## Implementation Plan

1. 冻结故事弧、旁白和20个镜头的时间分配。
2. 创建标准 Workspace 索引、项目 JSON 和 `DESIGN.md`。
3. 补齐 SHOTBOOK、资产计划、旁白脚本和 QA 门禁。
4. 校验 JSON、总时长、镜头字段、文档链接和产品边界。

## Acceptance Criteria

- Workspace 能被识别为一个16:9项目，包含20个镜头和视觉规范。
- 11个视频段落与 `presentation-video.md` 的0—90秒结构一致。
- 每个镜头具备类型、媒体类型、时长、旁白、画面描述、生成方式和备注。
- 产品实机、生成素材、动态图形和声音资产边界清晰。
- 后续制作人员可仅凭 Workspace 文档进入素材生产。

## Verification

- 自定义 Workspace 校验：`projects.json` 与 `project.json` 可解析；项目索引一致；20个镜头；总时长90.0秒；所有镜头类型、媒体类型、生成器、画面提示和备注字段合法；结果0错误。
- 旁白密度：308个有效字符，约205字/分钟；最终金句跨S19—S20完整6秒表达，无需加速。
- 可移植与敏感信息扫描：未发现个人绝对路径、Bearer Token或密钥形态字符串；未发现尾随空格。
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

复核结论：叙事镜头、抽象动态图形和真实产品证明采用三层边界；产品段不依赖生成式概念UI，失败与素材回退均有门禁。Workspace只新增可移植制作资料，不耦合产品运行时代码，也不覆盖既有三分钟视频项目。

## Outcome

完成 `hackathon/storyboard-workspace/`：包含标准项目索引与20镜头项目JSON，以及视觉规范、镜头执行册、旁白、资产计划和QA门禁。故事从“结论必须有出处”进入业务与技术协同痛点，再以真实字段选择、Skill、规划、审批、受控SQL/Python、版本化报告和溯据卡完成证明，最后以批准金句收束。当前未生成媒体，工作区可作为后续素材生产和Remotion合成的唯一制作基线。

## Follow-up

- 安装或启用 Codex Storyboard 插件后，用本 Workspace 作为 `CODEX_STORYBOARD_DATA_DIR` 打开。
- 先制作 S01、S09、S13 三个 look-dev/产品验证镜头，通过后再批量生成其余素材。
