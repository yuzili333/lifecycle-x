# Task: Report Export Regression Fixes

- Status: complete
- Owner: human + agent
- Started: 2026-08-31

## Goal

修复评审回归中发现的报告展示与导出问题，并重新生成可验证的精选源码包。

## Scope

- 正常图表展示时移除内部图表占位符。
- Markdown 导出展开溯据卡，并包含数据来源、工具执行记录和上下游关系。
- 修复报告导出时离屏图表快照的 React 提交时序，确保三种格式均能取得当前图表。
- PDF、DOCX 和 Markdown 报告使用跨平台安全的系统字体策略。
- 执行报告专项自动化与人工回归，并更新评审验证记录和精选源码包。

## Non-goals

- 本轮不修复或改变“审批前检查脚本”的行为。
- 不改变审批、SQL、Python、Artifact、EvidenceCard 或 IPC 协议。
- 不新增产品功能或重构智能体运行时。

## Constraints

- Renderer 继续通过 preload IPC 访问主进程能力。
- SQL 保持只读、受控并可审计；Python 仅处理受控数据集。
- 报告中的图表与溯据信息必须从当前会话和当前报告版本解析，不得伪造。
- 同一源码包需兼容 macOS Apple Silicon 与 Windows 11 x64。

## Affected Areas

- `apps/desktop/src/shared/visualization/reportMarkdown.ts`
- `apps/desktop/src/main/reportExportService.ts`
- `apps/desktop/src/main/reportExportDocument.ts`
- `apps/desktop/src/renderer/src/DataAssistantWorkspace.tsx`
- `apps/desktop/src/renderer/src/report-export/prepareReportExport.tsx`
- 对应报告展示与导出测试
- `docs/review/verification.md`
- `artifacts/review/`

## Invariants

- 无法解析的图表或溯据仍应进入明确错误路径，不能静默伪造结果。
- Markdown、PDF、DOCX 使用相同的报告版本与证据解析边界。
- 导出的图表快照只来自已授权并成功解析的当前报告图表。

## Implementation Plan

1. 为内部图表占位符、Markdown 溯据展开和字体策略增加回归断言。
2. 实现最小修复并运行报告相关测试。
3. 运行完整质量门禁与独立设计复核。
4. 按 runbook 回归报告展示、版本、溯据卡及 PDF/DOCX/Markdown 导出。
5. 更新验证记录、提交代码并从干净 HEAD 重新生成精选源码包。

## Acceptance Criteria

- 报告图表正常显示时，界面和三种导出格式均不出现 `{{chart:...}}`。
- Markdown 不再保留 `<evidence-card .../>`，且可读地展示数据来源、工作/工具执行记录和上下游关系。
- DOCX 不强制声明 FangSong/仿宋字体；PDF/HTML 使用跨平台系统字体回退。
- 报告专项回归通过，已知的审批前检查脚本问题明确记录为延期事项。
- 新源码压缩包、SHA-256 和发布清单与最终提交一致。

## Verification

- 报告定向测试：`pnpm exec vitest run apps/desktop/src/main/reportExportDocument.test.ts apps/desktop/src/main/reportExportService.test.ts apps/desktop/src/main/reportVisualizationMarkdown.test.tsx`，24/24 通过。
- 完整门禁：`pnpm verify` 通过；Harness 6项、评审工具3项、打包工具4项、服务端79项、桌面端400项，共492项检查/测试；Lint 零警告，类型、构建和 doctor 通过。
- 人工专项回归：同一 Golden Path 会话报告版本2的图表、表格、版本与溯据卡正常；界面无图表占位符；数据来源、SQL/Python 工作记录和上下游关系完整。
- 导出专项回归：PDF 4页逐页检查通过；DOCX 通过 macOS Quick Look、`textutil` 和 OOXML 结构检查；Markdown 的图表内嵌、溯据展开和内部协议清理检查通过。
- 字体检查：PDF/HTML 使用系统回退；DOCX 按平台选择系统字体，macOS 与 Windows 路径均无 FangSong/仿宋声明。

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

独立复核结论：图表标记过滤仍位于共享 Markdown 解析层；证据解析和最终文件生成仍位于主进程；Renderer 只负责从已授权 Artifact 生成快照并经 preload IPC 提交。未改变 Tool、Artifact、EvidenceCard 或 IPC 协议，无法解析或缺失图表时仍明确取消导出。平台字体映射保持为一个小型纯函数，没有新增不必要抽象。

## Outcome

正常图表的传输占位符已从报告展示中移除；Markdown 与 PDF/DOCX 使用同一报告版本、证据展开和图表校验链路，并生成可移植的内嵌图表 Markdown。DOCX 已改为平台系统字体策略，避免 Windows/Office 因强制仿宋导致内容显示异常。报告专项人工与自动回归均通过，验证结论已同步到评审文档。

## Follow-up

- 按用户决定，审批前检查脚本问题延期到后续版本。
