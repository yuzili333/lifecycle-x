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
- `pnpm verify` 通过：Harness 6项、评审工具3项、打包工具4项、服务端79项、桌面端396项，共488项自动检查/测试通过；Lint 为零警告，类型和生产构建通过。
- `pnpm dev` 成功等待认证服务健康后启动标准 Electron。
- `analyst` 通用演示账号登录通过；未配置 Key 时显示模型配置门禁，关闭提示后工作台可正常使用。
- `Ctrl+C` 后 `127.0.0.1:4317` 停止响应，未发现项目认证服务或 Electron 子进程残留。
- 当前功能基线此前已完成同一脱敏 CSV 的 Golden Path 2/2：SQL、Python、图表、报告版本1/2、溯据卡及 PDF/DOCX/Markdown 导出均成功。本次仅修改交付工程、跨平台运行入口、通用账号和配置常量，未修改 Tool/Artifact/报告协议；评委复验仍须使用自己的 Key 按运行说明执行。

## 已知限制

- Windows 11 x64 仍需在独立机器上完成安装、构建、启动、中文路径、导出和 Golden Path 验证。
- 模型 Golden Path 依赖评审人员自己的有效 Key、模型权限和网络。
- 当前版本不提供签名安装包或离线模型回放。

验证结论只记录实际完成项；平台机器、命令结果和人工签字缺失时保持“待验证”。
