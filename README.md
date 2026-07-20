# 存续期业务数据探针智能体

面向银行贷后管理、后续尽职调查和存续期风险监测的本地优先智能分析工作台。

## 快速开始

```bash
pnpm install
pnpm dev
pnpm desktop:typecheck
pnpm desktop:build
```

## 当前工程结构

- `apps/desktop`: Electron + React + Vite 桌面客户端。
- `docs`: MVP、BRD、PRD 等业务确认文档。
- `plan`: 系统分析和方案设计输入。
- `reference`: 存续期业务背景资料。

## Agent 工作流流程示意图

当前版本的 Agent 工作流以 `AssistantRuntime.sendMessage` 为入口，围绕“会话上下文准备、缺参与断点恢复、大模型推理、受控工具调用、Artifact/报告产出、异常恢复”推进。下图参照 `beautiful-mermaid` 的 **System Architecture** 分层图样式组织，将流程拆为 Client、Runtime、Tool、Data 和 Recovery 五层；渲染时使用 `THEMES['dracula']` 主题，保持与示例站点 Dracula 主题图表风格一致。

```mermaid
graph LR
  %% Beautiful Mermaid / System Architecture style.
  %% beautiful-mermaid-theme: dracula

  subgraph client [Client Layer]
    U([用户输入])
    C[ChatComposer<br/>自然语言、数据源、Skill、CSV、#字段]
    M[MessageList + tool_calls<br/>展示推理、审批、结果、报告卡片]
    U --> C
  end

  subgraph runtime [Agent Runtime Layer]
    R[AssistantRuntime.sendMessage<br/>模型配置校验、防重放、会话写入]
    G{AgentGuidance<br/>缺参、字段纠错、Checkpoint 恢复}
    S{特殊路由<br/>Skill / 历史结果 / 直接工具代码}
    L[streamModelResponse<br/>系统提示词、Schema Context、Workflow Context<br/>大模型推理与工具调用]
    I[ToolIntentRouter<br/>intentModelAdapter 或规则识别<br/>查询 / 分析 / 图表 / 报告]
    P[ToolPlanBuilder + InputResolver<br/>依赖排序、显式引用、选中历史结果、最新结果]
    C --> R --> G
    G -->|输入完整| S
    S -->|普通任务| L
    L -.可选工具编排.-> I --> P
  end

  subgraph tools [Controlled Tool Layer]
    V[validateToolRequest<br/>校验必填参数、Artifact 输入、空脚本、空报告]
    A{审批策略<br/>request_approval / 自动执行 / 禁止}
    Q[request_sql_query_execution<br/>只读 SQL、安全校验、权限校验、风险评估]
    PY[request_python_analysis_execution<br/>读取 SQL / Workflow Dataset<br/>受限 Python 沙箱分析]
    CH[request_chart_rendering<br/>VisualizationSpec<br/>授权 Artifact 或可信 inline rows]
    RP[request_markdown_report_generation<br/>Markdown 报告 Artifact<br/>引用真实工具结果]
    P --> V
    L -->|大模型原生工具调用| V
    S -->|直接工具 / 历史复用 / Skill 流程| V
    V --> A
    A --> Q
    A --> PY
    A --> CH
    A --> RP
  end

  subgraph data [State and Artifact Layer]
    TC[(tool_calls<br/>状态、版本、审批、日志)]
    TS[(ToolResultRegistry<br/>latest / selected 指针)]
    AR[(ArtifactManager<br/>SQL / Python / 图表 / 报告 Artifact)]
    WD[(Workflow Dataset<br/>SQL 结果物化到本地 SQLite)]
    WM[(Workflow Memory + Checkpoint<br/>血缘、可恢复状态、审计事件)]
    Q --> TC --> TS
    PY --> TC
    CH --> TC
    RP --> TC
    TS --> AR
    Q --> WD
    WD --> PY
    AR --> RP
    TC --> WM
  end

  subgraph recovery [Recovery and Feedback Layer]
    W[等待用户审批<br/>tool_calls 中批准或拒绝]
    X[参数修复 Guidance<br/>缺 SQL / script / visualizationSpec / markdown]
    E[ToolErrorRecoveryManager<br/>执行失败、权限拒绝、空结果、Artifact 缺失]
    O[输出结果<br/>文本、数据摘要、图表、报告卡片、完整报告窗口]
    G -->|缺任务目标 / 数据源| O
    G -->|缺字段 / 字段打错| X
    A -->|需要审批| W
    W -->|批准| Q
    W -->|拒绝| E
    V -->|参数无效| X
    TC -->|failed / blocked / rejected| E
    TS --> O
    AR --> O
    WM --> O
    O --> M
    X --> M
    E --> M
  end
```
