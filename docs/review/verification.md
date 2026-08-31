# 验证记录

## 平台状态

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| macOS Apple Silicon | 已验证 | 主开发平台；安装、诊断、完整自动门禁、启动、登录和无 Key 门禁已通过 |
| Windows 11 x64 | 待真实验证 | 已实现跨平台命令和 Python/Electron 适配，但未在 Windows 实机跑通前不声明“已验证” |

## 自动门禁

发布候选必须依次通过：

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm doctor
pnpm harness:check
pnpm harness:test
pnpm review-tooling:test
pnpm submission:test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

其中 `pnpm test` 先为 Node.js 重建 `better-sqlite3`，运行工作区测试，再在 `finally` 中恢复 Electron ABI；失败路径也必须恢复。

## 人工验收

- 本地认证服务健康检查和通用演示账号登录。
- 未配置模型 Key 时显示配置门禁，不崩溃、不生成虚假结果。
- 按[运行说明](runbook.md)完成同一 Golden Path。
- 报告版本、图表和溯据卡来自同一会话及执行链。
- PDF、DOCX、Markdown 均能导出并打开。
- `Ctrl+C` 后不残留由项目启动的服务或 Electron 子进程。

## macOS Apple Silicon 实测结果（2026-08-31）

- 环境：macOS Apple Silicon、Node.js 24.12.0、pnpm 11.7.0、Python 3.11.9、Electron 33.4.11。
- `pnpm run setup` 通过，标准 Electron 安装和 `better-sqlite3` Electron ABI 查询通过。
- `pnpm verify` 通过：Harness 6项、评审工具3项、打包工具4项、服务端79项、桌面端400项，共492项自动检查/测试通过；Lint 为零警告，类型和生产构建通过。
- `pnpm dev` 成功等待认证服务健康后启动标准 Electron。
- `analyst` 通用演示账号登录通过；未配置 Key 时显示模型配置门禁，关闭提示后工作台可正常使用。
- `Ctrl+C` 后 `127.0.0.1:4317` 停止响应，未发现项目认证服务或 Electron 子进程残留。
- 当前功能基线此前已完成同一脱敏 CSV 的 Golden Path 2/2：SQL、Python、图表、报告版本1/2、溯据卡及 PDF/DOCX/Markdown 导出均成功。本次仅修改交付工程、跨平台运行入口、通用账号和配置常量，未修改 Tool/Artifact/报告协议；评委复验仍须使用自己的 Key 按运行说明执行。

## 报告专项回归（2026-08-31）

- 在同一 Golden Path 会话的报告版本2复验：报告图表正常显示，界面不再显示 `{{chart:...}}` 传输占位符。
- 溯据卡正常展示数据来源、分析范围、SQL/Python 工作记录，以及“会话 CSV → SQL 数据集 → Python 分析 → 可视化 → Markdown 报告”的上下游关系。
- PDF、DOCX、Markdown 均从当前报告版本成功导出；图表来自当前会话的真实可视化快照，三种格式均未残留内部图表或溯据协议标记。
- PDF 共4页，已逐页完成视觉检查：中文、图表、表格及溯据章节清晰，无内容截断或遮挡。
- DOCX 已通过 macOS 原生 Quick Look 视觉检查和 `textutil` 全文检查；中文、图表及溯据章节存在且可读。文档不再强制声明 FangSong/仿宋：macOS 使用 Helvetica Neue/PingFang SC，Windows 代码路径使用 Segoe UI/Microsoft YaHei UI，其他平台使用 Arial/Noto Sans CJK SC。
- Markdown 已验证为可移植单文件：图表以内嵌 PNG data URL 保存，并展开 `4.1 数据来源`、`4.5 工具执行记录`、`4.6 源数据与分析产物`；不包含 `<evidence-card>`、`{{chart:...}}` 或内部 Artifact 协议。
- 报告相关24项定向测试通过；完整 `pnpm verify` 同步通过。

## 已知限制

- Windows 11 x64 仍需在独立机器上完成安装、构建、启动、中文路径、导出和 Golden Path 验证。
- 模型 Golden Path 依赖评审人员自己的有效 Key、模型权限和网络。
- 当前版本不提供签名安装包或离线模型回放。
- “审批前检查脚本”问题按本轮范围决定延期处理，未纳入本次修复及源码包能力声明。

验证结论只记录实际完成项；平台机器、命令结果和人工签字缺失时保持“待验证”。
