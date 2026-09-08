# Continuity Review

## Pre-generation review

| Shot | Status | Issue | Required check |
|---|---|---|---|
| scene_01_shot_001 | ready | 首个身份锚点尚未审定 | 人物年龄、低位马尾、服装、腕表、工位、光向 |
| scene_01_shot_002 | ready | 依赖S01身份参考 | 不表现无助；报告与字典无可读数据 |
| scene_01_shot_003 | ready | 新增研发角色 | 专业协作、不负面化；主角身份不漂移 |
| scene_01_shot_004 | ready | 看板易生成乱码 | 所有标签不可读；任务卡比例一致 |
| scene_01_shot_005 | ready | 手势和静态报告易误读 | 报告正确、追问自然、手部结构正常 |
| scene_01_shot_006 | ready | 背景代码易生成伪文本 | 脚本完全不可读；腕表、袖口和任务卡连续 |
| scene_02_shot_007 | ready | 抽象图易被误认产品UI | 无文字、无真实控件、需求卡可识别 |
| scene_02_shot_008 | ready | 转折易被拍成AI魔法 | 路径受控有序，无机器人或自动决策隐喻 |

## Prompt safety review

| Item | Status | Issue | Fix |
|---|---|---|---|
| NSFW / sexual content | pass | 无 | — |
| Minors | pass | 全部人物明确为成年人 | — |
| Violence / gore | pass | 无 | — |
| Real-person likeness | pass | 人物为虚构角色，不引用真人 | — |
| Copyrighted characters / brands | pass | 禁止品牌、Logo和特定软件界面 | — |
| Hate / harassment | pass | 无 | — |
| Sensitive personal data | pass | 所有数据、账号和文字均禁止生成 | — |

## Post-generation review

| Shot | Status | Review | Production note |
|---|---|---|---|
| scene_01_shot_001 | pass | 墙钟为9:00；主角、服装、腕表、工位和光线可作为锚点 | 任务准确中文后期叠加 |
| scene_01_shot_002 | pass | 身份、低位马尾、炭灰外套、青绿色衬衫和光向连续；手部自然 | 保持“专业停顿”，不加困惑表情 |
| scene_01_shot_003 | pass | 主角连续；研发角色专业协作；需求页无可读敏感文字 | 动态化只做轻微手势和镜头横移 |
| scene_01_shot_004 | pass | 正常任务队列与日历清楚；无错误或负面研发隐喻 | 看板标签由Remotion添加 |
| scene_01_shot_005 | pass | 报告是正确交付物；追问手势自然，无责难或错误标记 | 图表只作剧情道具，不冒充产品结果 |
| scene_01_shot_006 | pass | 主角、服装、腕表和报告色彩连续；背景脚本不可读 | 任务卡状态变化由后期控制 |
| scene_02_shot_007 | pass | 循环、时钟和需求卡构图清楚；不是产品UI | 四节点标签后期叠加 |
| scene_02_shot_008 | pass | 旧循环退场、青色路径拉直、中央光圈形成S09匹配点 | 检查点仅表示受控流程，不表示风险自动判断 |

## Global notes

- 八张图均为1672×941 PNG，横纵比约16:9。
- S01—S06人物、发型、服装、腕表、办公环境和冷暖光线保持连续。
- 未发现可识别银行Logo、真实账号、客户数据、可读代码、品牌水印或概念产品UI。
- 手部在关键可见镜头结构自然；S03与S05协作姿态中性专业。
- S07—S08保持同一任务卡和深海蓝材质逻辑；S08的检查点仅作为后期受控步骤占位。
- 合并审看图：`narrative-keyframes-contact-sheet.jpg`。
