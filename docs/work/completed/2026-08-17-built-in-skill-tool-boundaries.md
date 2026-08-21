# Task: 系统预置 Skill 工具职责边界清理

- Status: completed
- Owner: human + agent
- Started: 2026-08-17

## Goal

统一系统预置 Skill 的职责边界，确保 SQL 只查询明细、Python 只计算结构化指标，报告模型负责报告拼装、结构组织、格式化、结论撰写和内容审核，从根源降低 Python 参数体积。

## Scope

- 审计并调整四个系统预置 Skill 的指令和报告数据 Schema。
- 强化通用 SQL、Python、报告执行模型提示词的职责约束。
- 为 Skill 包增加禁止工具承担报告职责的定向测试。
- 保留统计口径、字段绑定、工具安全与 Artifact 血缘。

## Non-goals

- 不新增 Skill 专用运行时或硬编码 Python 脚本。
- 不修改 SQL/Python 工具 IPC 和执行协议。
- 不执行全量回归或页面交互验证。

## Constraints

- Python 可以执行字段清洗、去重、分组、聚合、占比和确定性对账。
- Python 不输出 Markdown、报告标题、章节、结论段落、展示字符串或数据质量文案。
- 报告模型不得重新统计原始数据，只能格式化和解释 Python 已计算指标。

## Affected Areas

- `skill/*/SKILL.md`
- `skill/*/schemas/report-data.schema.json`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/skills/SkillManagement.test.ts`

## Invariants

- SQL 保持只读、审批和审计边界。
- Python 只消费受控 Workflow Dataset，不访问业务数据库。
- 报告所有事实和数值仍可追溯至真实 Artifact。

## Implementation Plan

1. 从最新日志确认参数长度、重试耗时和输出职责膨胀点。
2. 明确通用执行模型的三类职责约束。
3. 清理四个预置 Skill 的越界指令及输出 Schema。
4. 更新定向测试并执行类型检查和 diff 检查。
5. 完成独立设计复核并记录结果。

## Acceptance Criteria

- 所有预置 Skill 的 Python 输出 Schema 不包含结论、Markdown、报告结构和展示值字段。
- Skill 明确 SQL、Python、报告模型的独立职责。
- Python 截断重试不再要求生成展示值或结论正文。
- 定向测试和桌面端类型检查通过。

## Verification

- `pnpm exec vitest run src/main/skills/SkillManagement.test.ts src/main/assistantRuntime.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts`：83 项通过。
- `pnpm --filter @lifecycle-x/desktop typecheck`：通过。
- `git diff --check`：通过；新增担保方式 Skill 文件执行 `git diff --no-index --check` 通过。
- 四个报告数据 Schema 搜索确认不包含 `Display`、`conclusion`、`Markdown`、`dataQuality`、报告标题或摘要子句字段。
- 按约定未执行全量回归和页面交互验证。

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

- 最新日志显示担保方式 Skill 的 Python 首轮在 118.5 秒后输出 26,334 字符并截断，重试又在 119.4 秒后输出 18,708 字符并截断；输入上下文仅约 10 KB，证明根因是输出职责膨胀。
- 通用工具提示词已明确：SQL 只查询，Python 只计算，报告模型负责格式、结构、结论和审核。
- 四个系统预置 Skill 均按同一职责拆分，版本分别升级为 overall 1.0.8、branch 1.1.2、guarantee 1.0.2、key-risk 1.1.1。
- Python 输出契约仅保留字段映射、结构化口径、纯数值指标、必要明细和对账状态。
- 四个 Skill 指令缩减为约 3.7–4.4 KB，分析结果 Schema 缩减为约 3.4–5.3 KB。

## Follow-up

需要重启客户端后使用同一担保方式数据重新生成报告，以采集新版 Skill 的实际 Python 参数字符数和模型耗时；本轮未执行页面验证。
