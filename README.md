# 溯据：存续期业务数据探针智能体

面向银行贷后管理、后续尽职调查和存续期风险监测的本地优先数据分析工作台。业务人员通过自然语言、`#`字段引用和领域 Skill 发起任务；系统将任务转换为可审批的只读 SQL、受控 Python、图表、版本化报告和溯据卡。

## 快速开始

推荐使用 macOS Apple Silicon；同时提供 Windows 11 x64 兼容链路。完整要求见[部署文档](docs/review/deployment.md)。

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
pnpm run setup
pnpm verify
pnpm dev
```

必须使用 `pnpm run setup`；`pnpm setup` 是 pnpm 自带的全局环境配置命令。

## 评审入口

- [五分钟源码评审指南](docs/review/README.md)
- [运行说明与 Golden Path](docs/review/runbook.md)
- [智能体架构与安全边界](docs/review/architecture-security.md)
- [原创性与第三方依赖](docs/review/originality-dependencies.md)
- [验证记录](docs/review/verification.md)

## 工程结构

- `apps/desktop`：Electron 主进程、preload IPC 和 React 工作台。
- `apps/server`：本地认证、数据管理、SQL、Python、Schema 和 Memory 服务。
- `skill`：领域 Skill、分析配方、工具策略和报告模板。
- `docs`：架构、Harness 任务记录、质量门禁和评审文档。

## Harness 工作方式

1. 从 [`AGENTS.md`](AGENTS.md) 和[仓库地图](docs/repo-map.md)定位模块。
2. 非平凡任务在 `docs/work/active` 建立任务记录。
3. 使用 `pnpm verify:fast` 做快速机械校验，使用 `pnpm verify` 完整验证。
4. 测试通过后仍需完成[设计审查](docs/quality/design-review.md)和必要的[重构检查点](docs/quality/refactor-checkpoint.md)。

架构与数据边界见[架构概览](docs/architecture/overview.md)和[边界约束](docs/architecture/boundaries.md)。
