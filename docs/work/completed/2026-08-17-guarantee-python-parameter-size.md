# Task: 担保方式 Skill Python 参数体积优化

- Status: completed
- Owner: human + agent
- Started: 2026-08-17

## Goal

消除担保方式风险分布 Skill 的 Python 参数超长和扩容重试造成的额外等待，同时保持统计口径与报告内容完整。

## Scope

- 压缩该 Skill 的 Python 指令与报告数据 Schema。
- 删除重复展示字段和由 Python 生成的结论文本，改由报告阶段基于已计算指标叙述。
- 撤回 Python 截断后的 16000 token 扩容重试。
- 增加防止 Skill 输出契约再次膨胀的定向测试。

## Non-goals

- 不改造 Python 运行时或数据源访问链路。
- 不新增 Skill 专用 Agent 路由或硬编码统计脚本。
- 不执行全量回归或页面交互验证。

## Constraints

- SQL 仍只读取明细，Python 仍负责确定性统计。
- 报告不得重新计算指标，只可格式化或叙述 Python 已计算结果。
- 保持工具审批、安全校验和 Artifact 血缘语义不变。

## Affected Areas

- `skill/guarantee-method-risk-distribution-report/`
- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`
- `apps/desktop/src/main/assistantDualModelRuntime.test.ts`

## Invariants

- 五类担保方式、合同去重降级、Decimal 金额计算及合计对账规则保持不变。
- 模型输出截断的参数不得进入审批或工具执行。
- 不静默减少用户要求的报告指标。

## Implementation Plan

1. 根据最新日志确认输入、输出、重试耗时和失败阶段。
2. 精简 Skill 指令和输出 Schema，保留可验证统计结果。
3. 调整报告模板及模型重试预算。
4. 更新并运行定向测试、类型检查和 diff 检查。
5. 完成独立设计复核并记录结果。

## Acceptance Criteria

- Python 输出 Schema 不再包含成对的数值/展示字段和结论正文。
- Python 首轮参数目标可在现有 8192 token 上限内完成。
- 截断重试不再提升至 16000 token。
- 定向测试及桌面端类型检查通过。

## Verification

- `pnpm exec vitest run src/main/skills/SkillManagement.test.ts src/main/assistantRuntime.test.ts`：62 项通过。
- `pnpm --filter @lifecycle-x/desktop typecheck`：通过。
- `git diff --check`：通过；新增 Skill 文件分别执行 `git diff --no-index --check` 通过。
- 双模型截断集成用例未能启动：当前 `better-sqlite3` 为 Electron ABI 130，Node 测试进程要求 ABI 137；未重编译以避免破坏桌面运行时。

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

- 最新日志确认首轮 Python 参数生成耗时 81 秒、输出 38,425 字符并在 8,192 token 截断，随后 16,000 token 重试等待 180 秒超时。
- Skill 指令由约 9.7 KB 降至 6.1 KB，报告数据 Schema 由约 8.6 KB 降至 4.7 KB。
- 删除重复数值/展示字段及 Python 结论正文，改为紧凑嵌套指标和信号字段；统计与对账责任仍在 Python。
- 截断重试恢复为标准 8,192 token，不再因扩容重试产生额外 180 秒等待。

## Follow-up

需要在 Electron 客户端使用同一数据源重新生成一次报告，以采集优化后的实际 Python 参数字符数和模型耗时；本轮按约定未执行页面交互验证。
