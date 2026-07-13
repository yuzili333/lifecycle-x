# 存续期数据探针智能体｜工作流模块优化

你现在是一个资深 TypeScript / Node.js / Electron / AI Agent / Workflow Runtime / 数据分析平台工程师。围绕项目 **“存续期数据探针智能体 / Cycle Data Intelligence Agent”** 优化和开发 **“工作流”** 模块。

本模块用于统一编排用户在对话中提出的 **数据查询、数据提取、数据分析、可视化分析、报告生成** 等连续任务，支持一轮完成，也支持多轮逐步确认、逐步缩小数据范围、再调用 Python 分析并生成报告。

请优先遵守当前项目结构，不要大规模重构无关模块。

---

## 1. 项目背景

项目名称：**存续期数据探针智能体 / Cycle Data Intelligence Agent**

项目面向银行贷款后续尽职调查、贷后管理、存续期风险监测、数据源探索、SQL 查询审批、Python 分析、图表生成、风险报告生成等业务场景。

当前需要优化的模块为：

> **工作流模块 / Workflow Module**

该模块需要把以下能力串联起来：

1. 用户自然语言需求识别；
2. SQL 查询请求生成；
3. SQL 审批；
4. SQL 执行；
5. SQL 结果物化为 SQLite 临时表；
6. 多轮对话中保留 SQL 结果状态；
7. 支持基于上一轮或前几轮 SQL 结果继续查询；
8. 支持用户确认数据提取结果；
9. 支持确认后发起 Python 分析；
10. 支持 Python 分析结果生成图表、摘要和报告内容；
11. 支持报告生成前再次基于最近一轮 SQL 结果进行精确查询；
12. 支持最终报告生成。

---

## 2. 核心目标

请实现一个可扩展的 Workflow Runtime，支持以下三类核心业务路径。

### 2.1 路径一：用户直接提出查询 + 分析 + 报告需求

示例：

```text
请查询近 6 个月存续期贷款客户的逾期情况，分析高风险客户特征，并生成一份风险分析报告。
```

工作流应支持：

```text
用户需求
→ 识别需要 SQL 查询 + Python 分析 + 报告生成
→ 生成 SQL 查询请求
→ 用户审批 SQL
→ 执行 SQL
→ 将 SQL 查询结果物化到 SQLite 临时表
→ 生成临时表元数据
→ 生成 Python 分析请求
→ 用户审批 Python
→ 执行 Python 分析
→ 生成图表和分析摘要
→ 生成报告内容
```

### 2.2 路径二：用户先做数据提取，再逐步缩小数据范围，确认后再分析

示例：

```text
先帮我提取今年以来到期的存续期客户数据。
```

随后用户继续：

```text
在上一轮结果中筛选出逾期超过 30 天的客户。
```

继续：

```text
再排除已结清客户。
```

继续：

```text
确认这批数据无误，现在分析风险特征并生成图表。
```

工作流应支持：

```text
第 1 轮 SQL 查询 → 结果落地 temp_table_1
第 2 轮基于 temp_table_1 查询 → 结果落地 temp_table_2
第 3 轮基于 temp_table_2 查询 → 结果落地 temp_table_3
用户确认 temp_table_3
Python 基于 temp_table_3 分析
生成图表和报告
```

### 2.3 路径三：报告生成过程中再次发起精确查询

示例：

```text
生成报告。
```

模型发现当前数据范围仍不够精确，需要进一步查询：

```text
基于最近一轮查询结果，再筛选出授信余额大于 500 万且近 3 个月流水下降超过 30% 的客户。
```

工作流应支持：

```text
报告生成请求
→ 检查最近 SQL 结果状态
→ 发现需要更精确数据范围
→ 基于最近临时表发起二次 SQL 查询
→ 结果落地新的 SQLite 临时表
→ Python 基于精确结果分析
→ 报告生成
```

---

## 3. 架构原则

请在实现中遵守以下原则。

### 3.1 SQL 查询结果必须物化

所有 SQL 查询结果都应物化为本地 SQLite 临时表或受控临时数据集。

原因：

* 支持后续多轮查询；
* 支持 Python 读取授权数据集；
* 支持报告生成溯源；
* 支持数据状态追踪；
* 避免将大规模源表数据直接传给模型。

### 3.2 SQL 查询不设置业务层固定行数上限

本工作流需要支持用户提取完整业务范围内的数据，因此 **SQL 查询结果不应设置固定业务行数上限**。

但必须保留工程安全保护：

* 只读 SQL；
* 用户审批；
* 权限校验；
* 查询超时；
* 连接池控制；
* 任务取消；
* 查询熔断；
* 流式读取；
* 分批写入 SQLite；
* 临时表大小监控；
* 磁盘空间监控；
* 审计日志；
* 不允许直接把完整结果注入大模型。

也就是说：

> 不设置固定业务行数上限，不等于无资源保护。查询结果可以完整物化，但必须通过流式、分批、可取消、可审计的方式落地到 SQLite 临时表。

### 3.3 Python 不直连业务数据库

Python Runner 不允许直接连接业务数据库。

Python 只能处理：

* SQL 工具输出的 SQLite 临时表；
* SQL 工具输出的 CSV / JSONL / Parquet 受控数据集；
* 用户上传并授权的数据集；
* 工作流生成的派生数据集。

### 3.4 多轮状态必须可追踪

每一轮 SQL 查询结果、Python 分析结果、报告草稿都必须有状态记录。

需要支持：

* 当前活跃数据集；
* 最近一轮 SQL 结果；
* 前几轮 SQL 结果；
* 数据集父子关系；
* 用户是否确认；
* 是否可用于 Python 分析；
* 是否可用于报告生成；
* 是否已过期；
* 是否已清理。

### 3.5 模型只接收摘要和引用

大模型不应直接接收完整查询结果。

模型可以接收：

* SQLite 临时表引用；
* 数据集 profile；
* 字段 schema；
* 行数；
* 列数；
* 抽样预览；
* 数据质量摘要；
* 查询目的；
* 上游 SQL 摘要；
* Python 分析摘要；
* artifact 引用。

---

## 4. 模块职责边界

本模块负责：

* Workflow 类型定义；
* Workflow Runtime；
* 用户意图到工作流类型的映射；
* SQL 查询步骤编排；
* SQL 审批状态跟踪；
* SQL 执行结果物化为 SQLite 临时表；
* 临时表注册；
* 多轮数据集状态管理；
* 基于上一轮结果继续查询；
* 数据确认状态管理；
* Python 分析步骤编排；
* Python 审批状态跟踪；
* Python 结果和 artifact 跟踪；
* 报告生成步骤编排；
* 工作流状态持久化；
* 工作流事件日志；
* 与 Memory / Context Assembler 对接。

本模块不负责：

* SQL 安全校验具体实现；
* SQL 执行器具体实现；
* Python Runner 具体执行；
* 图表具体渲染；
* 大模型底层调用；
* 报告生成模型实现；
* UI 重构。

但本模块需要对接或复用以下模块：

* SQL Tool Invocation & Approval Workflow；
* Python Runner & Sandbox；
* Schema Context Injection；
* Local Memory & Context Compression；
* Streaming Model Adapter；
* Tool Registry；
* Data Source Manager；
* SQLite 临时表管理；
* Report Generator；
* Audit Logger。

---

## 5. 推荐目录结构

请优先复用当前结构，不要大规模重构无关模块。

---

## 6. 核心数据模型

请实现清晰的 TypeScript 类型。

### 6.1 WorkflowType

```ts
export type WorkflowType =
  | 'direct_query_analysis_report'
  | 'data_extraction'
  | 'refine_extracted_dataset'
  | 'confirm_dataset'
  | 'python_analysis'
  | 'report_generation'
  | 'report_generation_with_refinement';
```

### 6.2 WorkflowStatus

```ts
export type WorkflowStatus =
  | 'draft'
  | 'planning'
  | 'waiting_sql_approval'
  | 'executing_sql'
  | 'materializing_dataset'
  | 'waiting_user_confirmation'
  | 'waiting_python_approval'
  | 'executing_python'
  | 'generating_report'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';
```

### 6.3 WorkflowSession

```ts
export type WorkflowSession = {
  workflowId: string;
  conversationId: string;
  projectId?: string;
  userId: string;
  type: WorkflowType;
  status: WorkflowStatus;
  title?: string;
  userGoal: string;
  activeDatasetId?: string;
  latestSqlDatasetId?: string;
  confirmedDatasetId?: string;
  latestPythonExecutionId?: string;
  latestReportVersionId?: string;
  steps: WorkflowStep[];
  datasets: WorkflowDatasetRef[];
  events: WorkflowEvent[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};
```

### 6.4 WorkflowStep

```ts
export type WorkflowStep = {
  stepId: string;
  type:
    | 'intent_detection'
    | 'sql_request'
    | 'sql_approval'
    | 'sql_execution'
    | 'sqlite_materialization'
    | 'dataset_profile'
    | 'user_confirmation'
    | 'python_request'
    | 'python_approval'
    | 'python_execution'
    | 'report_generation'
    | 'memory_update';
  status:
    | 'pending'
    | 'running'
    | 'waiting'
    | 'success'
    | 'failed'
    | 'skipped'
    | 'blocked'
    | 'cancelled';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  error?: WorkflowError;
  metadata?: Record<string, unknown>;
};
```

### 6.5 WorkflowDatasetRef

```ts
export type WorkflowDatasetRef = {
  datasetId: string;
  workflowId: string;
  conversationId: string;
  name: string;
  sourceType:
    | 'sql_execution_result'
    | 'refined_sql_result'
    | 'python_derived_result'
    | 'uploaded_file'
    | 'manual';
  sqliteTableName?: string;
  sqliteDatabasePath?: string;
  parentDatasetIds?: string[];
  sourceSqlRequestId?: string;
  sourceSqlExecutionId?: string;
  sourcePythonExecutionId?: string;
  rowCount?: number;
  columnCount?: number;
  schema?: Record<string, string>;
  profile?: WorkflowDatasetProfile;
  status:
    | 'creating'
    | 'ready'
    | 'confirmed'
    | 'rejected'
    | 'expired'
    | 'deleted'
    | 'failed';
  canQuery: boolean;
  canAnalyze: boolean;
  canUseForReport: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
};
```

### 6.6 WorkflowDatasetProfile

```ts
export type WorkflowDatasetProfile = {
  datasetId: string;
  rowCount: number;
  columnCount: number;
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    sampleValues?: unknown[];
    missingRate?: number;
  }>;
  previewRows?: Record<string, unknown>[];
  warnings: string[];
  generatedAt: string;
};
```

### 6.7 WorkflowEvent

```ts
export type WorkflowEvent = {
  eventId: string;
  workflowId: string;
  conversationId: string;
  type:
    | 'workflow_created'
    | 'workflow_planned'
    | 'sql_request_created'
    | 'sql_approved'
    | 'sql_executed'
    | 'dataset_materialized'
    | 'dataset_confirmed'
    | 'dataset_refined'
    | 'python_request_created'
    | 'python_approved'
    | 'python_executed'
    | 'report_generated'
    | 'workflow_completed'
    | 'workflow_failed'
    | 'workflow_cancelled';
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};
```

---

## 7. Workflow Runtime API

请实现清晰的 TypeScript API。

```ts
createWorkflowModule(config)

workflow.start(input)
workflow.continue(input)
workflow.get(workflowId)
workflow.listByConversation(conversationId)
workflow.getActiveDataset(conversationId)
workflow.confirmDataset(input)
workflow.rejectDataset(input)
workflow.refineDataset(input)
workflow.startPythonAnalysis(input)
workflow.generateReport(input)
workflow.cancel(workflowId)
```

### 7.1 WorkflowModuleConfig

```ts
export type WorkflowModuleConfig = {
  stateStore: WorkflowStateStore;
  sqlToolBridge: SqlWorkflowBridge;
  pythonBridge: PythonWorkflowBridge;
  reportBridge?: ReportWorkflowBridge;
  memoryBridge?: MemoryWorkflowBridge;
  datasetStateManager: DatasetStateManager;
  tempTableRegistry: TempTableRegistry;
  sqliteMaterializer: SQLiteMaterializer;
  defaultDatasetTtlMs?: number;
  maxTempDatabaseSizeBytes?: number;
  enableAutoMemoryUpdate?: boolean;
};
```

---

## 8. 用户意图识别与工作流路由

请实现 `WorkflowIntentRouter`。

### 8.1 意图类型

```ts
export type WorkflowIntent =
  | 'query_only'
  | 'extract_data'
  | 'refine_previous_dataset'
  | 'confirm_dataset'
  | 'analyze_confirmed_dataset'
  | 'query_analyze_report'
  | 'generate_report'
  | 'generate_report_with_more_query'
  | 'unknown';
```

### 8.2 路由规则

需要支持：

* 用户直接要求查询 + 分析 + 报告 → `direct_query_analysis_report`
* 用户先要求提取数据 → `data_extraction`
* 用户提到“上一轮结果”“刚才的数据”“在前面结果中” → `refine_extracted_dataset`
* 用户说“确认数据无误”“就用这批数据” → `confirm_dataset`
* 用户要求“基于这批数据分析” → `python_analysis`
* 用户要求“生成报告” → `report_generation`
* 报告生成过程中需要再查询 → `report_generation_with_refinement`

P0 可使用规则式判断，不强制调用模型分类器。

---

## 9. SQL 查询结果物化为 SQLite 临时表

请实现 `SQLiteMaterializer`。

### 9.1 目标

将 SQL Tool 执行结果物化为 SQLite 临时表，以便：

* 多轮对话继续查询；
* Python Runner 读取；
* 报告生成引用；
* 数据集状态追踪；
* 避免反复查询业务数据库。

### 9.2 输入

```ts
export type MaterializeSqlResultInput = {
  workflowId: string;
  conversationId: string;
  sqlRequestId: string;
  sqlExecutionId: string;
  sourceDataSourceId: string;
  resultColumns: Array<{
    name: string;
    type: string;
  }>;
  rows?: Record<string, unknown>[];
  rowsStream?: AsyncIterable<Record<string, unknown>>;
  targetTableName?: string;
  parentDatasetIds?: string[];
  metadata?: Record<string, unknown>;
};
```

### 9.3 输出

```ts
export type MaterializeSqlResultOutput = {
  datasetId: string;
  sqliteDatabasePath: string;
  sqliteTableName: string;
  rowCount: number;
  columnCount: number;
  schema: Record<string, string>;
  createdAt: string;
};
```

### 9.4 物化要求

必须支持：

* rows 批量写入；
* rowsStream 流式写入；
* 自动创建 SQLite 临时表；
* 自动推断 SQLite 字段类型；
* 批量事务提交；
* 大数据量分批写入；
* 写入进度事件；
* 写入失败回滚；
* 临时表命名防冲突；
* 临时表元数据注册；
* 记录父数据集；
* 记录来源 SQL request / execution；
* 不将完整数据写入大模型上下文。

### 9.5 关于查询上限

工作流层不应强制给业务查询设置固定行数上限。

但必须支持：

* 流式读取；
* 分批写入；
* 查询取消；
* 物化取消；
* 最大磁盘占用保护；
* SQLite 数据库大小监控；
* 审计日志；
* 物化进度反馈；
* 超过本地资源阈值时中止并提示用户。

---

## 10. DatasetStateManager

请实现 `DatasetStateManager`。

### 10.1 职责

* 注册数据集；
* 查询当前活跃数据集；
* 查询最近 SQL 数据集；
* 查询已确认数据集；
* 根据上一轮数据集生成新数据集；
* 标记数据集 confirmed / rejected / expired / deleted；
* 维护数据集 lineage；
* 判断数据集是否可用于 Python 分析；
* 判断数据集是否可用于报告生成。

### 10.2 API

```ts
export type DatasetStateManager = {
  registerDataset(input: WorkflowDatasetRef): Promise<WorkflowDatasetRef>;
  getDataset(datasetId: string): Promise<WorkflowDatasetRef | null>;
  getActiveDataset(conversationId: string): Promise<WorkflowDatasetRef | null>;
  getLatestSqlDataset(conversationId: string): Promise<WorkflowDatasetRef | null>;
  getConfirmedDataset(conversationId: string): Promise<WorkflowDatasetRef | null>;
  listDatasets(conversationId: string): Promise<WorkflowDatasetRef[]>;
  confirmDataset(datasetId: string): Promise<WorkflowDatasetRef>;
  rejectDataset(datasetId: string, reason?: string): Promise<WorkflowDatasetRef>;
  expireDataset(datasetId: string): Promise<WorkflowDatasetRef>;
  deleteDataset(datasetId: string): Promise<void>;
};
```

---

## 11. 基于上一轮 SQL 结果继续查询

请实现 `refineDataset` 工作流能力。

### 11.1 场景

用户说：

```text
在上一轮结果中筛选逾期超过 30 天的客户。
```

系统应：

1. 找到当前 conversation 的 activeDataset；
2. 将 activeDataset 对应 SQLite 临时表作为查询源；
3. 生成针对 SQLite 临时表的 SQL；
4. 执行本地 SQLite 查询；
5. 将结果物化为新的 SQLite 临时表；
6. 记录 parentDatasetIds；
7. 将新数据集设置为 activeDataset。

### 11.2 注意

* 这类查询不应重新访问原始业务数据库，除非用户明确要求；
* 应优先基于本地 SQLite 临时表继续筛选；
* 新数据集应保留 lineage；
* 需要更新 Memory 和 Workflow 状态；
* 仍然需要遵守本地查询安全规则。

---

## 12. 用户确认数据集

请实现 `confirmDataset`。

用户可能表达：

```text
确认这批数据无误。
就用当前数据继续分析。
可以，基于这批客户做分析。
```

系统应：

1. 找到当前 activeDataset；
2. 标记为 confirmed；
3. 设置 confirmedDatasetId；
4. 标记 canAnalyze = true；
5. 标记 canUseForReport = true；
6. 写入 Memory；
7. 返回确认摘要。

---

## 13. Python 分析工作流

请实现 `startPythonAnalysis`。

### 13.1 输入

```ts
export type StartPythonAnalysisInput = {
  conversationId: string;
  workflowId?: string;
  userId: string;
  userRequest: string;
  datasetId?: string;
  analysisGoal: string;
  expectedOutputs?: Array<'summary' | 'chart' | 'table' | 'json' | 'report_section'>;
};
```

### 13.2 行为

系统应：

1. 优先使用用户指定 datasetId；
2. 若未指定，则使用 confirmedDataset；
3. 若无 confirmedDataset，则使用 activeDataset，并提示需要确认或自动进入确认等待；
4. 创建 Python 分析请求；
5. Python 输入数据引用 SQLite 临时表或其导出副本；
6. 用户审批 Python；
7. 审批后执行 Python；
8. 收集图表 artifact 和分析摘要；
9. 更新 Workflow 状态；
10. 写入 Memory；
11. 为报告生成提供 analysis payload。

---

## 14. 报告生成工作流

请实现 `generateReport`。

### 14.1 报告生成输入

```ts
export type GenerateWorkflowReportInput = {
  conversationId: string;
  workflowId?: string;
  userId: string;
  reportGoal: string;
  datasetId?: string;
  pythonExecutionId?: string;
  allowRefineBeforeReport?: boolean;
};
```

### 14.2 行为

系统应：

1. 识别最近可用数据集；
2. 检查是否已有 Python 分析结果；
3. 若已有分析结果，则直接生成报告；
4. 若没有分析结果，但有 confirmedDataset，则先发起 Python 分析；
5. 若用户或模型判断需要进一步缩小数据范围，允许基于 latestSqlDataset / activeDataset 再发起本地 SQLite 精确查询；
6. 将精确查询结果作为新的 activeDataset；
7. 再发起 Python 分析；
8. 最后生成报告；
9. 报告中引用数据集 ID、SQL 执行 ID、Python 执行 ID 和图表 artifact ID。

---

## 15. Workflow Context Builder

请实现 `WorkflowContextBuilder`。

用于向 Agent Runtime / LLM 提供当前工作流状态摘要，但不注入完整数据。

### 15.1 输出内容

包括：

* 当前 workflowId；
* 当前 workflow status；
* 当前 activeDataset；
* 最近 SQL 数据集；
* 已确认数据集；
* 数据集 lineage；
* 当前可用数据集列表；
* 每个数据集的 rowCount / columnCount / schema；
* 最近 Python 分析结果摘要；
* 最近报告版本摘要；
* 当前待审批事项；
* 当前建议下一步动作。

### 15.2 禁止注入

不得注入：

* SQLite 临时表完整数据；
* 完整 SQL 查询结果；
* 完整 Python stdout；
* 敏感字段原值；
* 数据库连接信息；
* 用户无权限访问的数据。

---

## 16. WorkflowStateStore

请实现状态存储接口。

```ts
export type WorkflowStateStore = {
  create(session: WorkflowSession): Promise<WorkflowSession>;
  update(workflowId: string, patch: Partial<WorkflowSession>): Promise<WorkflowSession>;
  get(workflowId: string): Promise<WorkflowSession | null>;
  listByConversation(conversationId: string): Promise<WorkflowSession[]>;
  getActiveByConversation(conversationId: string): Promise<WorkflowSession | null>;
  appendEvent(workflowId: string, event: WorkflowEvent): Promise<void>;
};
```

P0 可使用 InMemory 实现；如果项目已有 SQLite 本地存储，优先复用或预留适配器。

---

## 17. 与 SQL Tool 的桥接

请实现 `SqlWorkflowBridge`。

```ts
export type SqlWorkflowBridge = {
  createSqlRequest(input: {
    conversationId: string;
    userId: string;
    userRequest: string;
    sqlPurpose: string;
    sourceDatasetId?: string;
    sourceSqliteTableName?: string;
    useLocalSqlite?: boolean;
  }): Promise<{
    sqlRequestId: string;
    status: 'pending_approval' | 'blocked' | 'completed' | 'failed';
  }>;

  executeApprovedSqlRequest(sqlRequestId: string): Promise<{
    sqlExecutionId: string;
    columns: Array<{ name: string; type: string }>;
    rows?: Record<string, unknown>[];
    rowsStream?: AsyncIterable<Record<string, unknown>>;
  }>;
};
```

要求：

* 访问原始数据库时走 SQL Tool；
* 基于上一轮结果继续查询时优先走本地 SQLite；
* SQL 请求和执行必须可审计；
* SQL 结果必须能传给 SQLiteMaterializer。

---

## 18. 与 Python Runner 的桥接

请实现 `PythonWorkflowBridge`。

```ts
export type PythonWorkflowBridge = {
  createPythonRequest(input: {
    conversationId: string;
    userId: string;
    analysisGoal: string;
    inputDataset: WorkflowDatasetRef;
    expectedOutputs?: string[];
  }): Promise<{
    pythonRequestId: string;
    status: 'pending_approval' | 'blocked' | 'completed' | 'failed';
  }>;

  executeApprovedPythonRequest(pythonRequestId: string): Promise<{
    pythonExecutionId: string;
    summary: string;
    artifacts: Array<{
      artifactId: string;
      type: string;
      description?: string;
    }>;
    safeModelPayload?: Record<string, unknown>;
    reportVisualizationPayload?: Record<string, unknown>;
  }>;
};
```

---

## 19. 与 Memory 的桥接

请实现 `MemoryWorkflowBridge`。

用于在关键状态变更时写入本地 Memory。

至少写入：

* 数据提取目标；
* SQL 结果数据集摘要；
* 数据集确认状态；
* Python 分析结果摘要；
* 报告生成状态；
* 用户明确偏好；
* 当前工作流下一步建议。

不得写入：

* 完整查询结果；
* 完整 SQLite 表数据；
* 明文敏感字段；
* 数据库连接信息。

---

## 20. 状态流转

请用代码实现状态流转，并在测试中覆盖。

### 20.1 直接查询分析报告

```text
planning
→ waiting_sql_approval
→ executing_sql
→ materializing_dataset
→ waiting_python_approval
→ executing_python
→ generating_report
→ completed
```

### 20.2 分阶段数据提取

```text
planning
→ waiting_sql_approval
→ executing_sql
→ materializing_dataset
→ waiting_user_confirmation
```

### 20.3 数据集精炼

```text
waiting_user_confirmation
→ executing_sql
→ materializing_dataset
→ waiting_user_confirmation
```

### 20.4 确认后分析

```text
waiting_user_confirmation
→ waiting_python_approval
→ executing_python
→ completed
```

### 20.5 报告前再查询

```text
generating_report
→ executing_sql
→ materializing_dataset
→ waiting_python_approval
→ executing_python
→ generating_report
→ completed
```

---

## 21. 错误处理

请设计统一错误类型。

```ts
export type WorkflowErrorCode =
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_INVALID_STATE'
  | 'WORKFLOW_INTENT_UNKNOWN'
  | 'SQL_REQUEST_FAILED'
  | 'SQL_APPROVAL_REQUIRED'
  | 'SQL_EXECUTION_FAILED'
  | 'SQL_RESULT_EMPTY'
  | 'SQLITE_MATERIALIZATION_FAILED'
  | 'DATASET_NOT_FOUND'
  | 'DATASET_NOT_READY'
  | 'DATASET_NOT_CONFIRMED'
  | 'DATASET_EXPIRED'
  | 'PYTHON_REQUEST_FAILED'
  | 'PYTHON_APPROVAL_REQUIRED'
  | 'PYTHON_EXECUTION_FAILED'
  | 'REPORT_GENERATION_FAILED'
  | 'MEMORY_UPDATE_FAILED'
  | 'UNKNOWN_ERROR';
```

要求：

* 所有错误结构化；
* 错误中保留 workflowId、stepId；
* 单步失败应更新 Workflow 状态；
* 可恢复错误应允许用户继续；
* 不暴露数据库连接信息；
* 不暴露完整源表数据。

---

## 22. 测试要求

请补充测试用例。优先使用 Vitest。如果项目已有测试框架，请遵守现有测试框架。

### 22.1 Workflow Runtime 测试

覆盖：

* 创建工作流；
* 继续工作流；
* 获取 activeDataset；
* 状态流转；
* 取消工作流；
* 错误状态更新。

### 22.2 直接查询分析报告测试

覆盖：

* 用户一次性提出查询 + 分析 + 报告；
* 创建 SQL 请求；
* SQL 执行后物化 SQLite；
* 创建 Python 请求；
* Python 执行后生成报告；
* workflow completed。

### 22.3 分阶段数据提取测试

覆盖：

* 用户先提取数据；
* SQL 结果物化为 temp table；
* workflow 等待用户确认；
* activeDataset 正确设置。

### 22.4 基于上一轮结果精炼测试

覆盖：

* 基于 activeDataset 查询；
* 使用本地 SQLite 而不是原始数据库；
* 生成新 dataset；
* parentDatasetIds 正确；
* 新数据集成为 activeDataset。

### 22.5 数据集确认测试

覆盖：

* confirmDataset；
* confirmedDatasetId 正确；
* canAnalyze = true；
* canUseForReport = true；
* 写入 Memory。

### 22.6 Python 分析测试

覆盖：

* 使用 confirmedDataset；
* 无 confirmedDataset 时提示确认；
* 创建 Python 请求；
* 执行 Python 后记录 artifact；
* 更新 workflow 状态。

### 22.7 报告前再查询测试

覆盖：

* generateReport 时触发 refine；
* 基于最近 SQL dataset 精确查询；
* 物化新 dataset；
* Python 基于新 dataset 分析；
* 报告生成引用最新 dataset。

### 22.8 SQLiteMaterializer 测试

覆盖：

* rows 写入；
* rowsStream 写入；
* schema 推断；
* 批量事务；
* 写入失败回滚；
* 临时表命名；
* rowCount / columnCount；
* 大量数据分批写入 mock。

### 22.9 WorkflowContextBuilder 测试

覆盖：

* 输出 workflow 状态摘要；
* 输出 dataset lineage；
* 不注入完整数据；
* 不注入敏感字段；
* 包含建议下一步。

---

## 23. 实现约束

请遵守以下约束：

1. 优先使用 TypeScript；
2. 保持模块可独立测试；
3. 不要依赖具体 UI；
4. 不要大规模重构无关模块；
5. 不要绕过 SQL Tool 审批和权限体系；
6. Python 不允许直接连接业务数据库；
7. SQL 查询结果必须物化为 SQLite 临时表或受控数据集；
8. 工作流层不设置固定业务行数上限；
9. 但必须支持资源保护、流式写入、取消、超时、磁盘限制和审计；
10. 不允许将完整 SQLite 临时表数据注入大模型；
11. 多轮对话必须保持数据集状态；
12. 数据集 lineage 必须可追踪；
13. 所有公开 API 应从 `index.ts` 导出；
14. 如果项目已有 lint / format / test 规范，请遵守；
15. 优先遵守当前项目结构；
16. 如发现已有 `model-adapter`、`schema-context`、`sql-tool`、`python-runner`、`memory`、`tool-registry`、`data-source`、`report` 模块，请复用其类型与接口；
17. 完成后运行类型检查和测试，如环境允许。

---

## 24. 验收标准

完成后应满足以下标准：

1. 支持用户一次性提出数据查询 + 分析 + 报告需求；
2. 支持 SQL 查询结果物化为 SQLite 临时表；
3. 支持 SQL 查询结果不设置固定业务行数上限；
4. 支持流式 / 分批写入 SQLite；
5. 支持多轮对话保持数据集状态；
6. 支持基于上一轮或前几轮 SQL 结果继续查询；
7. 支持用户确认数据集；
8. 支持确认数据集后发起 Python 分析；
9. 支持 Python 分析结果用于报告生成；
10. 支持报告生成前基于最近 SQL 结果再次精确查询；
11. 支持 dataset lineage；
12. 支持 Workflow Context 摘要；
13. 不将完整数据注入模型；
14. 不绕过 SQL 审批和 Python 审批；
15. 有基础测试覆盖；
16. 模块可与 SQL Tool、Python Runner、Memory、Report Generator、Agent Runtime 对接。

---

## 25. 开发优先级

请按以下优先级实现。

### P0：必须完成

* 类型定义；
* WorkflowRuntime；
* WorkflowStateStore InMemory 实现；
* WorkflowIntentRouter 规则实现；
* DatasetStateManager；
* TempTableRegistry；
* SQLiteMaterializer；
* SqlWorkflowBridge 接口；
* PythonWorkflowBridge 接口；
* WorkflowContextBuilder；
* 直接查询分析报告工作流；
* 分阶段数据提取工作流；
* 基于上一轮结果精炼工作流；
* 数据集确认；
* rowsStream 分批写入；
* SQLite 临时表 profile；
* dataset lineage 完整展示；
* MemoryWorkflowBridge；
* 报告前再查询；
* 物化进度事件；
* 查询取消；
* 基础测试；
* 磁盘空间保护；
* 与现有 SQL Tool / Python Runner 类型对齐；
* 更完整状态流转测试；
* 工作流 UI 状态；
* 可视化工作流步骤；
* 人工确认节点 UI；
* 跨会话复用数据集；
* 临时表自动清理策略；
* index.ts 导出。


### P2：预留接口

* 工作流恢复；
* 工作流版本管理；
* 大数据集分区物化；
* 分布式任务队列；
* 审计系统深度集成；
* 临时表 TTL；
* Agent Runtime 状态机深度集成。

---

## 26. 请最终输出

执行完成后，请输出：

1. 新增或修改的文件列表；
2. 核心 API 使用示例；
3. 直接查询分析报告工作流示例；
4. 分阶段数据提取工作流示例；
5. 基于上一轮结果继续查询示例；
6. 数据集确认示例；
7. Python 分析工作流示例；
8. 报告前再查询示例；
9. SQLite 临时表物化示例；
10. Workflow Context 示例；
11. 测试运行结果；
12. 尚未完成或需要后续补充的事项。

请直接推进实现，不要停留在设计文档。请优先遵守当前仓库目录结构，不要大规模重构无关模块；如发现已有 `model-adapter`、`schema-context`、`sql-tool`、`python-runner`、`memory`、`tool-registry`、`data-source`、`report` 模块，请复用其类型与接口。
