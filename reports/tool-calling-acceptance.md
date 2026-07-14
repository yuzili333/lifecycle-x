# 工具调用功能优化验收说明

## 1. 新增或修改的文件列表

- `apps/desktop/src/main/toolOrchestration/`：新增会话级工具编排模块，包含类型、工具定义、提示词、意图路由、计划构建/校验、输入解析、执行引擎、结果/Artifact 注册表和测试。
- `apps/desktop/src/main/assistantRuntime.ts`：接入四类模型工具定义、工具结果登记、SQLite 持久化、Memory 摘要、tool-state 流式事件、报告/图表 Artifact 登记。
- `apps/desktop/src/main/index.ts`、`apps/desktop/src/preload/index.ts`：新增工具状态、历史结果选择、Artifact 懒加载 IPC。
- `apps/desktop/src/renderer/src/DataAssistantWorkspace.tsx`：接入工具状态条、报告卡片、报告版本切换和 Artifact 懒加载。
- `apps/desktop/src/renderer/src/components/tool-calls/`：新增 `ReportToolCallCard`、`ReportMarkdownViewer`、`ToolCallStateCard`。
- `apps/desktop/src/renderer/src/components/VisualizationRenderer.tsx`：增强图表预览、Astryx neutral 主题色、二维坐标轴刻度。
- `apps/desktop/src/main/toolCallStateCard.test.tsx`、`apps/desktop/src/main/visualizationRenderer.test.tsx`、`apps/desktop/src/main/streamingModelAdapter/streamingModelAdapter.test.ts`：补充 UI、图表、模型工具流测试。

## 2. 四个工具定义示例

```ts
TOOL_NAMES = {
  sql_query: "request_sql_query_execution",
  python_analysis: "request_python_analysis_execution",
  chart_rendering: "request_chart_rendering",
  report_generation: "request_markdown_report_generation",
};
```

每个工具独立注册，输入 schema 由 `TOOL_SCHEMAS` 提供，不封装成固定流水线。

## 3. ToolIntentResult 示例

```json
{
  "conversationId": "c1",
  "userMessage": "查询近 6 个月逾期客户，分析风险特征，画图并生成报告",
  "intents": [
    { "toolKind": "sql_query", "action": "create", "purpose": "查询近 6 个月逾期客户", "dependsOn": [], "confidence": 0.9 },
    { "toolKind": "python_analysis", "action": "create", "purpose": "分析风险特征", "dependsOn": ["sql_query"], "confidence": 0.9 },
    { "toolKind": "chart_rendering", "action": "create", "purpose": "绘制风险特征图表", "dependsOn": ["python_analysis"], "confidence": 0.9 },
    { "toolKind": "report_generation", "action": "create", "purpose": "生成 Markdown 报告", "dependsOn": ["chart_rendering"], "confidence": 0.88 }
  ],
  "requiresClarification": false,
  "confidence": 0.88
}
```

## 4. ToolExecutionPlan 示例

```json
{
  "planId": "plan_xxx",
  "conversationId": "c1",
  "status": "ready",
  "steps": [
    { "toolKind": "sql_query", "toolName": "request_sql_query_execution", "dependencies": [], "inputStrategy": "none", "status": "planned" },
    { "toolKind": "python_analysis", "toolName": "request_python_analysis_execution", "dependencies": ["sql-step"], "inputStrategy": "none", "status": "planned" },
    { "toolKind": "chart_rendering", "toolName": "request_chart_rendering", "dependencies": ["python-step"], "inputStrategy": "none", "status": "planned" },
    { "toolKind": "report_generation", "toolName": "request_markdown_report_generation", "dependencies": ["chart-step"], "inputStrategy": "none", "status": "planned" }
  ]
}
```

## 5. 单工具调用示例

```ts
await tools.executeSingleTool({
  conversationId: "c3",
  userId: "u",
  userMessage: "查询逾期客户",
  toolKind: "sql_query"
});
```

## 6. 多工具组合调用示例

```ts
const plan = await tools.buildPlan({
  conversationId: "c5",
  userId: "u",
  userMessage: "查询近 6 个月逾期客户，分析风险特征，画图并生成报告"
});
await tools.executePlan(plan);
```

## 7. SQL 多轮调整示例

- SQL v1：`查询逾期客户`
- SQL v2：`把逾期天数改成 60 天后重新查`
- v2 即使失败也不会覆盖 v1 的 latest 指针。
- `ToolCallRecord.metadata` 记录 `previousToolCallId`、`changedRequestKeys`、`requestDeltaSummary`。

## 8. Python 多轮调整示例

```ts
await tools.executeSingleTool({
  conversationId: "c4",
  userId: "u",
  userMessage: "分析上一轮结果",
  toolKind: "python_analysis"
});
```

未显式指定输入时，`ToolInputResolver` 默认选择用户手动选中的 SQL 结果，否则选择最新成功 SQL 结果。

## 9. 图表多轮调整示例

```ts
await tools.resolveToolInput({
  conversationId: "c4",
  toolKind: "chart_rendering"
});
```

图表默认优先使用 Python 分析结果，无 Python 时回退到 SQL 结果。`VisualizationRenderer` 支持图表预览、Artifact 引用状态、Astryx neutral 色系和二维坐标轴范围。

## 10. 报告多轮调整示例

- 报告 v1：生成初稿。
- 报告 v2：基于报告 v1 或指定 Artifact 继续修改。
- UI 支持报告版本下拉切换、完整 Markdown 懒加载、复制 Markdown、继续修改入口。

## 11. 会话最新结果解析示例

```ts
await tools.selectHistoricalResult({
  conversationId: "c4",
  toolKind: "sql_query",
  toolCallId: "sql-v1"
});

await tools.resolveToolInput({
  conversationId: "c4",
  toolKind: "report_generation"
});
```

选择历史 SQL 后，报告输入会聚合用户选择的 SQL 结果与可用的最新 Python / 图表结果，返回 `selected_result`。

## 12. 数据血缘示例

```json
{
  "toolCallId": "report-v3",
  "parentToolCallIds": ["chart-v5"],
  "sourceArtifactIds": ["chart-artifact-v5"],
  "outputArtifactIds": ["report-markdown-v3"]
}
```

模块支持 `listArtifactDependencies` 和 `deleteArtifactSafely`。删除上游 Artifact 前会扫描下游 `sourceArtifactIds`，如已被引用则抛出 `TOOL_RESULT_INCOMPATIBLE`。

## 13. 报告标题卡片和 Markdown 展示示例

`ReportToolCallCard` 默认展示：

- 报告标题
- 版本
- 生成时间
- 摘要
- 图表数量
- 数据来源数量
- 查看完整报告
- 基于此版本继续修改
- 复制 Markdown

点击后由 `ReportMarkdownViewer` 懒加载并渲染完整 Markdown Artifact。

## 14. 测试运行结果

已通过：

```text
pnpm --filter @lifecycle-x/desktop test -- toolOrchestration.test.ts toolCallStateCard.test.tsx visualizationRenderer.test.tsx streamingModelAdapter.test.ts
pnpm --filter @lifecycle-x/desktop typecheck
pnpm --filter @lifecycle-x/desktop build
git diff --check
```

覆盖重点：

- 独立工具意图识别和组合调用
- 非固定全局顺序的计划构建
- latest 指针、失败不覆盖、版本递增和血缘
- 显式历史版本、多个 Artifact、选中历史结果
- 审批等待与恢复
- SQLite 状态和 Artifact 持久化
- Artifact 删除依赖保护
- 四类工具 UI 状态卡片
- 图表预览和坐标轴刻度
- 模型工具调用后的继续生成

## 15. 尚未完成或后续补充事项

- 无依赖工具并行执行属于 P1 预留，当前仍按串行执行。
- 工具计划可视化、Artifact 血缘图、报告版本对比、多报告合并属于 P1 预留。
- 当前多轮参数差异记录为字段级摘要，不做业务语义级 SQL 条件 AST diff。
