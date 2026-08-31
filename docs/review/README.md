# 溯据源码评审指南

“溯据”是面向银行存续期业务的本地优先数据分析智能体。它把自然语言任务转换为可审批的 SQL/Python 工具执行，再将真实结果沉淀为图表、版本化报告和溯据卡。产品边界不是自动替银行作出风险结论，而是降低分析门槛并保留数据、口径、执行与报告之间的证据链。

## 五分钟启动

推荐在 macOS Apple Silicon 上验证：

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
pnpm run setup
pnpm verify
pnpm dev
```

注意：必须使用 `pnpm run setup`。`pnpm setup` 是 pnpm 自身的全局环境配置命令，并不会运行本项目脚本。

本地演示账号：

- 账号：`analyst`
- 密码：`Lifecycle@123`
- 性质：公开的本地演示凭据，禁止用于生产环境

对话功能要求评委在“设置 → 模型配置”中填写自己的 SiliconFlow API Key。Key 通过 Electron `safeStorage` 加密后保存在本机，不进入源码包、日志或验证记录。

## 建议评审顺序

1. 按[部署文档](deployment.md)完成环境诊断。
2. 运行 `pnpm verify` 查看 Harness、测试、类型、构建和 Electron 原生模块证据。
3. 按[运行说明](runbook.md)执行同一条 Golden Path。
4. 查看[架构与安全边界](architecture-security.md)，重点关注审批、工具控制和 Artifact 血缘。
5. 查看[原创性与依赖说明](originality-dependencies.md)及[验证记录](verification.md)。

## 核心可见闭环

```text
脱敏 CSV + #字段 + 领域 Skill + 自然语言任务
→ Agent 规划
→ 用户审批
→ 只读 SQL
→ 受控 Python
→ 图表与版本化报告
→ 溯据卡与 PDF/DOCX/Markdown 导出
→ 追问复用已有 Artifact 并生成新版报告
```

核心源码位于 `apps/desktop`、`apps/server` 和 `skill`；评审包刻意排除了个人配置、用户数据库、媒体素材、内部草稿和历史工作记录。
