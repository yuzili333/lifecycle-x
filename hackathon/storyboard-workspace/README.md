# “溯据”电影级演示 Storyboard Workspace

本目录是一套可移植的 Codex Storyboard 数据目录，面向90秒、16:9电影级产品演示。它将[视频设计基线](../presentation-video.md)展开为20个镜头：前半段讲述存续期业务人员经历需求沟通、研发排期、一次性报表和追问返工的真实办公困境，后半段用真实产品证明业务人员无需直接编写 SQL/Python，也能自主推进经用户确认、真实执行、可复核、可继续钻探的受控分析链。

## 项目入口

- 项目索引：[`projects.json`](projects.json)
- 标准项目数据：[`project.json`](projects/sujudata-cinematic-demo/project.json)
- 视觉规范：[`DESIGN.md`](projects/sujudata-cinematic-demo/DESIGN.md)
- 镜头执行册：[`SHOTBOOK.md`](projects/sujudata-cinematic-demo/SHOTBOOK.md)
- 旁白与声音：[`VOICEOVER.md`](projects/sujudata-cinematic-demo/VOICEOVER.md)
- 资产计划：[`ASSET_PLAN.md`](projects/sujudata-cinematic-demo/ASSET_PLAN.md)
- 验收门禁：[`QA_CHECKLIST.md`](projects/sujudata-cinematic-demo/QA_CHECKLIST.md)
- 叙事人物与连续性 Bible：[`bible/`](projects/sujudata-cinematic-demo/bible/)
- S01—S08镜头导演：[`shots/`](projects/sujudata-cinematic-demo/shots/)
- S01—S08图像提示词：[`prompts/`](projects/sujudata-cinematic-demo/prompts/)
- Keyframe清单：[`KEYFRAME_MANIFEST.md`](projects/sujudata-cinematic-demo/media/keyframes/KEYFRAME_MANIFEST.md)
- Keyframe合并审看图：[`narrative-keyframes-contact-sheet.jpg`](projects/sujudata-cinematic-demo/reviews/narrative-keyframes-contact-sheet.jpg)
- 叙事段十二宫格：[`scene-01.png`](projects/sujudata-cinematic-demo/storyboard/scene-01.png)
- 十二宫格视频生成提示词：[`scene-01.md`](projects/sujudata-cinematic-demo/storyboard/scene-01.md)
- 故事板登录页参考：[`sujudata-login-concept.png`](projects/sujudata-cinematic-demo/storyboard/references/sujudata-login-concept.png)
- 故事板真实报告图表参考：[`sujudata-report-chart.png`](projects/sujudata-cinematic-demo/storyboard/references/sujudata-report-chart.png)

## 打开方式

Codex Storyboard 插件可用时，将数据目录指向本目录：

```bash
export CODEX_STORYBOARD_DATA_DIR="$(pwd)/hackathon/storyboard-workspace"
```

随后打开 Storyboard Workspace。项目 ID 为 `sujudata-cinematic-demo`。

## 制作原则

1. 0—36秒采用真实办公叙事，冲突来自跨角色沟通、排期和一次性报表，不把研发人员塑造成障碍。
2. 36—40秒产品揭示由品牌动态图形完成。
3. 40—86秒只使用真实产品录屏与基于真实状态制作的运动包装。
4. 86—90秒使用品牌收束和已批准金句。
5. 不生成概念 UI，不伪造数据、工具、审批、报告版本或溯据链。

## 推荐生产顺序

1. 先完成 S01临时任务、S05一次性交付、S08转折三个叙事验证镜头。
2. 再完成 S09 Product Reveal、S13审批与SQL两个产品验证镜头，随后锁定 `DESIGN.md`。
3. 通过五镜头门禁后生成 S02—S07 的其余叙事素材。
4. 按 `ASSET_PLAN.md` 录制或复用 S10—S19 的真实产品素材。
5. 用 Remotion 合成 UI 镜头、证据线、字幕和品牌包装。
6. 完成旁白、音乐、音效和最终混音，再按 `QA_CHECKLIST.md` 验收。
