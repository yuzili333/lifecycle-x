# 部署文档

> 推荐组委会优先在 macOS Apple Silicon 环境验证。该环境是本项目的主开发与完整回归平台，安装链路更短、原生依赖风险更低。项目已准备 Windows 11 x64 兼容链路，但只有真实 Windows 验证完成后才会标记为“已验证”；Windows 首次安装需额外准备 Python 与 Visual Studio C++ Build Tools。

本交付物是源码评审包，不提供预编译或签名安装程序。

## 环境基线

| 项目 | macOS 首选环境 | Windows 兼容环境 |
| --- | --- | --- |
| 系统 | macOS，Apple Silicon | Windows 11 x64 |
| Node.js | 24.12.x | 24.12.x x64 |
| pnpm | 11.7.0 | 11.7.0 |
| Python | 3.11.x | 3.11.x x64，安装时加入 PATH |
| 原生构建 | Xcode Command Line Tools | Visual Studio 2022 Build Tools、Desktop development with C++、Windows SDK |

不在本轮范围：Intel macOS、Windows 10、Windows ARM64。

## 安装

在解压后的源码根目录执行：

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
pnpm run setup
pnpm doctor
```

`pnpm run setup` 会先检查平台、Node、pnpm 和 Python，再安装/修复 Electron，按 Electron ABI 重建 `better-sqlite3`，最后运行完整诊断。Windows 原生编译失败时，先确认 C++ 工作负载和 Windows SDK 已安装，再重新执行该命令。

如需指定非默认 Python，可在启动前设置 `LIFECYCLE_X_PYTHON` 为 Python 可执行文件的完整路径。macOS 默认使用 `python3`，Windows 默认使用 `python.exe`。

## 启动与停止

```bash
pnpm dev
```

该命令启动本地认证服务，确认 `http://127.0.0.1:4317/health` 返回正确服务标识后才启动 Electron。按 `Ctrl+C` 停止；进程管理脚本会清理自己启动的服务和桌面端子进程。若 4317 端口被其他程序占用，`pnpm doctor` 会给出失败信息。

## 模型配置

1. 使用公开演示账号登录。
2. 打开“设置 → 模型配置”。
3. 渠道选择 SiliconFlow。
4. 推理模型可填写 `Pro/moonshotai/Kimi-K2.6`，执行模型可填写 `Qwen/Qwen3-32B`。
5. 填写评委自己的 API Key 并保存。

未配置 Key 时，数据助手会要求打开模型配置，不会生成伪造分析结果。请勿把 Key 写入 `.env`、命令行、源码或评审记录。

## 数据与清理

- 业务演示使用仓库内 `de-identified-data/信贷风险.csv`。
- 默认数据目录为当前用户目录下的 `.cycle-probe`；可通过 `LIFECYCLE_X_DATA_DIR` 指定独立评审目录。
- Electron 会在系统应用数据目录保存会话数据库、工具日志及经过系统加密的模型 Key。
- 清理前先停止应用并备份需要保留的报告；只删除本次评审明确创建的数据目录，不使用递归命令清理用户主目录。

## 常见问题

- Electron 安装失败：确认网络可访问 Electron 镜像，重新执行 `pnpm install --frozen-lockfile` 和 `pnpm run setup`。
- SQLite ABI 不匹配：执行 `pnpm run setup`；`pnpm test` 结束后也会自动恢复 Electron ABI。
- Python 未发现：执行 `python3 --version`（macOS）或 `python.exe --version`（Windows），或设置 `LIFECYCLE_X_PYTHON`。
- 模型请求失败：确认 Key、模型权限和网络；系统不会切换到模拟数据。
