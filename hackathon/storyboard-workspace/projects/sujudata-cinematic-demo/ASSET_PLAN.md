# 资产计划

## 1. 资产分层

| 层 | 范围 | 生产方式 | 真实性要求 |
|---|---|---|---|
| Narrative | S01—S08 | HyperFrames / Image Generation后动画 | 同一业务主管、研发同事和通用办公环境，无真实机构信息 |
| Motion | S09、S20 | Remotion | 只表现抽象证据线与真实品牌资产 |
| Product | S10—S19 | 真实录屏 + Remotion | 同一成功会话、同一报告链、脱敏数据 |
| Audio | 全片 | 真人或审定TTS、授权音乐、原创SFX | 正常语速，无云端敏感数据 |

## 2. 真实产品素材

建议优先从现有已审定素材中复用，缺失时再按同一 Golden Path 补录。

| 资产ID | 对应镜头 | 必须包含 | 建议文件名 |
|---|---|---|---|
| UI01 | S09 | 产品工作台干净全景 | `UI01_workspace_clean_t01.mp4` |
| UI02 | S10 | CSV、键入`#`、字段列表、三个已选字段 | `UI02_field_selector_t01.mp4` |
| UI03 | S11 | 整体风险Skill、任务发送 | `UI03_skill_task_t01.mp4` |
| UI04 | S12 | 查询、分析、绘图、报告计划 | `UI04_plan_t01.mp4` |
| UI05 | S13 | 待审批、批准、SQL running/completed、Dataset | `UI05_approval_sql_t01.mp4` |
| UI06 | S14 | Python状态及上游数据集关系 | `UI06_python_lineage_t01.mp4` |
| UI07 | S15 | 图表、报告Artifact生成 | `UI07_result_build_t01.mp4` |
| UI08 | S16 | 报告版本1、图表、200笔、373,780.35万元 | `UI08_report_v1_t01.mp4` |
| UI09 | S17 | 追问、版本2、版本1/2切换 | `UI09_followup_v2_t01.mp4` |
| UI10 | S18 | 数据来源、SQL/Python记录、上下游关系 | `UI10_evidence_card_t01.mp4` |
| UI11 | S19 | PDF/DOCX/Markdown导出菜单 | `UI11_export_t01.mp4` |

现有可复用参考：`output/hackathon-video/fallback/P02_field-selector.png`、`P03_skill-fields.png`、`P04_agent-plan.png`、`P05_approval.png`、`P06_tool-running.png`、`P07_chart-report.png`、`P08_follow-up.png`、`P09_report-v2.png`、`P10_evidence-card.png`、`P11_report-export.png`。静态截图只作为构图与应急兜底，不替代主产品视频。

## 3. 生成式素材

### 3.1 剧情连续性资产

| 资产ID | 用途 | 连续性要求 |
|---|---|---|
| CHAR01 | S01—S06存续期业务主管 | 同一人物、服装、工位和办公时段；以侧面、背面和手部为主 |
| ENV01 | 通用金融办公区 | 无机构Logo；S01—S04保持同一清晨冷暖光线 |
| PROP01 | 临时分析需求卡 | 同一版式贯穿S01、S03、S04和S06；精确文字由Remotion叠加 |
| PROP02 | 一次性静态报表 | S02上一期报告与S05交付报告风格一致，但不使用真实产品报告冒充剧情道具 |
| PROP03 | 迭代看板与日历 | 仅表现正常排期，不出现真实项目、人员姓名或负面化标识 |
| PROP04 | 业务知识卡与Skill构建界面 | S07三组知识卡与S08三个输入节点构图对应；只表达知识封装，不冒充工具运行结果 |

先冻结 CHAR01、ENV01 和 PROP01 的参考帧，再生成叙事镜头，避免人物、工位和需求卡在连续剪辑中漂移。

### 3.2 镜头生成计划

| 资产ID | 镜头 | 首选方式 | 生成前提 |
|---|---|---|---|
| GEN01 | S01 | HyperFrames | “下午会前”任务提醒、九点时钟、业务主管与办公环境通过look-dev |
| GEN02 | S02 | HyperFrames | 复用S01人物、服装、工位和光线；桌面报告与数据均脱敏 |
| GEN03 | S03 | HyperFrames | 需求文档、线上沟通和研发同事均为通用办公道具，不出现真实账号 |
| GEN04 | S04 | HyperFrames | 任务看板与日历为剧情道具；不出现真实项目，不把研发团队负面化 |
| GEN05 | S05 | HyperFrames | 静态报表正确交付，新问题由会议中的自然追问触发 |
| GEN06 | S06 | HyperFrames | 复用同一需求卡，脚本仅为不可读纹理，不冒充真实代码 |
| GEN07 | S07 | HyperFrames | 真实报告、指标/流程/证据知识卡和林主管落笔动作连续 |
| GEN08 | S08 | HyperFrames | 复用研发同事与知识卡构图，Skill节点受控、无自动决策隐喻 |

生成素材一律保存到 `generation/`，审定后再回填到 `media/`。每个镜头至少保留提示词、模型/方法、时间、版本和人工审定结论。

## 4. Remotion组件

- `EvidenceThread`：证据线与节点连接。
- `FocusFrame`：产品UI焦点框，不覆盖交互区域。
- `CinematicCamera`：5%—12% 2.5D平移缩放。
- `ApprovalNode`：琥珀色用户审批节点。
- `ArtifactFlow`：SQL Dataset → Python Analysis → Chart/Report。
- `VersionSwitch`：报告版本1/2切换。
- `TaglineLockup`：品牌字标与两行金句。
- `SubtitleBand`：产品镜头底部独立字幕带。

组件只消费真实截图/录屏和审定文案，不生成新的业务事实。

## 5. 资产命名与版本

```text
S01_GEN01_hook_v01.mp4
S09_MG01_product-reveal_v01.mov
S10_UI02_field-selector_t01.mp4
S13_UI05_approval-sql_t01.mp4
S20_MG07_tagline_v01.mov
VO_full_v01.wav
MUSIC_main_v01.wav
SFX_pack_v01/
```

- 原始素材不覆盖；用 `t01/t02` 区分Take，用 `v01/v02` 区分加工版本。
- 通过 look-dev 后锁定色彩、字体和动效，不在批量阶段变更母规范。
- 所有产品镜头记录来源会话、报告版本、字段与导出文件。

## 6. 生成队列策略

1. 先生成 S01、S05、S08 的关键帧/视频，验证“临时任务—一次性交付—知识封装为Skill”的剧情是否成立。
2. 再完成 S09 和 S13，验证品牌与真实UI能否属于同一视觉世界。
3. 通过后批量生成 S02—S07，并锁定人物、工位、需求卡和办公时间连续性。
4. S09—S20 的 Remotion任务按镜头顺序排队；产品资产未审定时不得生成最终合成。
5. 任何任务失败均保留错误记录，不能以静态假状态回填为完成。
