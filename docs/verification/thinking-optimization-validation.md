# Thinking 优化验证记录

验证日期：2026-07-23

## 自动化结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 全工作区测试 | `pnpm test` | 通过：Desktop 289 项，Server 77 项，共 366 项 |
| 全工作区类型检查 | `pnpm typecheck` | 通过 |
| 全工作区构建 | `pnpm build` | 通过 |
| ESLint | `pnpm lint` | 通过：0 error，13 条既有 Hooks 依赖 warning |
| 差异格式 | `git diff --check` | 通过 |

ESLint warning 位于既有 React Hook 依赖代码，本次未扩大规则修复范围；`rules-of-hooks`、`debugger`、`eval`、隐式 `eval` 和 `with` 均作为 error 执行。

## 需求验证矩阵

| 需求 | 证据 |
| --- | --- |
| L0/L1 跳过 Kimi | 动态运行时集成测试验证请求模型序列仅包含 Qwen |
| L2 使用 512 | 集成测试断言 SiliconFlow 请求 `thinking_budget=512` |
| L3 使用 1024 | 集成测试断言 `thinking_budget=1024` |
| L4 使用 4096 | 集成测试断言 `thinking_budget=4096` |
| Qwen Thinking 关闭 | L0-L4 与工具执行测试断言 `enable_thinking=false` 且无 `thinking_budget` |
| Kimi reasoning 不可见 | SSE 模拟测试断言事件和正文均不含原始 `reasoning_content` |
| Kimi 首事件超时降级 | 集成测试等待首事件超时后验证 Qwen 真实规划及 SQL 执行完成 |
| 非法 AnalysisPlan 修复与降级 | 两次非法 Kimi JSON 后验证 Qwen 调用 `submit_agent_execution_plan` |
| AnalysisPlan 嵌套结构约束 | Prompt 单元测试验证业务定义、数据需求、步骤、校验规则及空数组的完整 JSON 契约 |
| 最近数据集默认选择 | 集成测试验证多个临时 CSV 中最近更新的数据源写入规划上下文，并消解数据源选择歧义 |
| 禁止本地预制失败计划 | 集成测试断言失败路径无本地计划文案，Qwen 再失败时只保留模型可见响应 |
| SQL 异常诊断升级 | 集成测试断言首次诊断 1024、非法后受控升级至 2048 |
| 紧凑执行参数 | SQL/Python/Chart 集成测试断言模型 Schema 只包含当前步骤必要参数 |
| 客户端注入上下文 | 集成测试验证 Artifact 与用户目标由客户端注入，模型不生成血缘参数 |
| 上下文 Token 裁剪 | 单元测试验证优先级；集成测试验证脱敏裁剪观测日志 |
| Provider 重试、超时与取消 | Streaming adapter 测试覆盖网络/503 重试、总超时、首事件超时和 `USER_ABORTED` |
| 统一业务事件 | 单元测试验证 `planning.started/progress`、工具和终态事件在持久化前通过运行时校验 |
| 审批等待计时 | Orchestrator 测试验证 active/waiting 分段计时与恢复 |
| Markdown 流式输出 | Streaming adapter 与 streaming content 测试验证 chunk 顺序、去重和 report delta |
| 报告图表章节合并 | 单元测试验证图表分析结论与可视化 Artifact 合并为一个章节，且历史 Markdown 可即时规范化 |
| 重启不恢复已终止任务 | Progress store 启动迁移将遗留活动 Run 标记取消；终态 Run 不重新执行 |
| 可观测性 | 模型日志记录上下文、TTFT、usage、finish reason、tool call；终态记录延迟和质量计数 |

## 兼容性结果

- 现有消息、`tool_calls`、Artifact、Workflow Dataset 和报告卡片协议未改变。
- 新增 `agent_runs`、`agent_progress_events` 及向后兼容列迁移。
- `executionModelName` 和动态 Thinking 开关均为可选配置；关闭后进入既有双模型流程。
- SQL 只读、安全、权限和审批校验仍由原有本地工具运行时执行。

## 运行时验证

完成 Node 测试后需执行 `node apps/desktop/scripts/rebuild-native-deps.mjs`，将 `better-sqlite3` 恢复为 Electron ABI，再启动 `pnpm desktop:dev`。启动日志必须包含 Renderer URL，且不得出现主进程加载原生模块失败。

本次已执行上述步骤：原生模块重建成功，开发客户端启动于 `http://localhost:5173/`，DevTools 监听 `127.0.0.1:9333`，启动后未出现主进程或 SQLite 原生模块错误。
