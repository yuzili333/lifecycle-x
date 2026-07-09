# 存续期数据探针智能体｜数据源 Schema Context 注入模块开发

你现在是一个资深 TypeScript / Node.js / Electron / AI Agent / 数据平台工程师。请使用 **goal 模式**，围绕项目 **“存续期数据探针智能体 / Cycle Data Intelligence Agent”** 开发一个可落地、可测试、可扩展的 **“数据源 Schema Context 注入”** 模块。

本模块用于在智能体会话中，将用户已配置或导入的数据源转化为大模型可理解、可控、可压缩、可审计的 **Schema Context**，为后续自然语言问数、SQL 生成、数据探索、图表生成、风险分析和报告生成提供基础上下文。

---

## 1. 项目背景

项目名称：**存续期数据探针智能体 / Cycle Data Intelligence Agent**

项目面向银行贷款后续尽职调查、贷后管理、存续期风险监测、数据源探索、数据库 Compass、CSV 补充数据导入、风险分析报告生成等业务场景。

当前模块为：

> **数据源 Schema Context 注入模块 / Data Source Schema Context Injection Module**

本模块的核心原则是：

> 不要将数据库表里的完整数据或原始 CSV 文件直接传入给大模型，而是将数据源的“结构画像、统计摘要、样例片段、相关数据片段、可调用工具句柄”注入到 Prompt 中。

模块职责边界如下：

```text
LLM = 意图理解 + 推理 + 解释
Parser = 文件解析
Database = 数据存储
Retriever = 相关内容检索
Tools = 精确计算
Context Builder = 控制进入 Prompt 的内容
```

---

## 2. 模块目标

请实现一个独立的 Schema Context 注入模块，支持以下目标：

1. 支持 SQL 数据库数据源；
2. 支持 CSV 导入数据源；
3. CSV 导入后默认存放在本地 SQLite 数据库临时表；
4. 不向大模型直接注入完整表数据；
5. 向大模型注入结构化数据源画像；
6. 向大模型注入字段结构、字段类型、缺失率、唯一值数量等摘要；
7. 向大模型注入数值列统计、类别列分布、时间范围等数据摘要；
8. 向大模型注入有限样例行和相关行；
9. 向大模型注入可调用的数据工具方法；
10. 当用户需求涉及精确统计、筛选、聚合、排序、去重、图表生成、趋势分析等任务时，引导模型调用工具，而不是凭 preview_rows 直接回答；
11. 支持 Context Token Budget 控制，避免 Prompt 过长；
12. 支持面向后续 Agent Runtime 的标准化上下文输出。

---

## 3. 推荐目录结构

请优先遵守当前项目结构，不要大规模重构无关模块。

---

## 4. 核心设计原则

请在实现中遵守以下原则：

1. **模型不直接接触完整数据**

   * 不要把全表数据、完整 CSV、完整 SQLite 临时表内容直接塞进 Prompt。

2. **模型只接收受控 Context**

   * 包括文件画像、表结构、字段摘要、统计摘要、样例数据、相关片段、工具句柄。

3. **精确计算必须走工具**

   * 全表求和、Top N、分组统计、去重计数、趋势分析、相关性分析、图表生成等，不允许模型基于样例行猜测。

4. **Context Builder 控制注入内容**

   * 由模块决定哪些内容进入 Prompt，而不是由模型自由读取数据。

5. **工具句柄优先**

   * 当任务需要完整数据时，向模型说明可以调用数据查询工具、SQL 工具、Python 工具或图表生成工具。

6. **Token Budget 可控**

   * 支持最大 token / 字符预算，优先保留数据源基本画像、字段结构、关键字段摘要、相关字段、工具说明。

7. **安全与合规优先**

   * 敏感字段默认脱敏；
   * 不暴露数据库密码、连接串、API Key；
   * 不注入超出用户权限的数据源、表或字段；
   * 数据源 Context 应可审计、可追踪。

---

## 5. 数据源范围

当前版本支持两类数据源：

### 5.1 SQL 数据库

包括但不限于：

* MySQL；
* SQLite；

SQL 数据库数据源的完整读取不在本模块直接完成，本模块主要使用已有元数据、字段摘要、样例数据和工具句柄构建 Context。

### 5.2 CSV 导入数据

CSV 文件导入后应存放在本地 SQLite 数据库临时表中。

CSV 解析需要考虑：

* 编码识别：UTF-8、GBK、UTF-8 BOM；
* 分隔符识别：逗号、制表符、分号；
* 表头识别；
* 空值处理；
* 日期字段识别；
* 数值字段识别；
* 异常行检测；
* 列类型推断；
* 大文件流式读取。

当前版本 **不要求支持 XLSX**，但需要预留扩展接口。

---

## 6. 核心类型设计

请实现清晰的 TypeScript 类型。

### 6.1 DataSourceType

```ts
export type DataSourceType = 'sql_database' | 'csv_sqlite_temp';
```

### 6.2 DataSourceRef

```ts
export type DataSourceRef = {
  dataSourceId: string;
  type: DataSourceType;
  name: string;
  description?: string;
  owner?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};
```

### 6.3 DataSourceProfile

```ts
export type DataSourceProfile = {
  dataSourceId: string;
  sourceType: DataSourceType;
  displayName: string;
  fileInfo?: FileProfile;
  databaseInfo?: DatabaseProfile;
  tables: TableProfile[];
  summary: DataSourceSummary;
  toolHandles: ToolHandle[];
  generatedAt: string;
};
```

### 6.4 FileProfile

```ts
export type FileProfile = {
  fileName: string;
  fileType: 'csv' | 'xlsx' | 'unknown';
  fileSizeBytes?: number;
  encoding?: string;
  delimiter?: string;
  sheetCount?: number;
  rowCount?: number;
  columnCount?: number;
};
```

### 6.5 DatabaseProfile

```ts
export type DatabaseProfile = {
  databaseType: string;
  databaseName?: string;
  schemaName?: string;
  tableCount?: number;
  viewCount?: number;
  isReadOnly?: boolean;
};
```

### 6.6 TableProfile

```ts
export type TableProfile = {
  tableId: string;
  tableName: string;
  displayName?: string;
  description?: string;
  rowCount?: number;
  columnCount?: number;
  columns: ColumnProfile[];
  primaryKeys?: string[];
  foreignKeys?: ForeignKeyProfile[];
  indexes?: IndexProfile[];
  sampleRows?: Record<string, unknown>[];
  tailRows?: Record<string, unknown>[];
  representativeRows?: Record<string, unknown>[];
  statistics?: TableStatistics;
  sensitivity?: SensitivityLevel;
  metadata?: Record<string, unknown>;
};
```

### 6.7 ColumnProfile

```ts
export type ColumnProfile = {
  columnName: string;
  displayName?: string;
  dataType: string;
  inferredType?: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime' | 'category' | 'text' | 'unknown';
  nullable?: boolean;
  missingRate?: number;
  uniqueCount?: number;
  sampleValues?: unknown[];
  min?: number | string;
  max?: number | string;
  mean?: number;
  median?: number;
  topValues?: Array<{ value: unknown; count: number; ratio?: number }>;
  timeRange?: {
    min?: string;
    max?: string;
  };
  businessMeaning?: string;
  sensitivity?: SensitivityLevel;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  metadata?: Record<string, unknown>;
};
```

### 6.8 SensitivityLevel

```ts
export type SensitivityLevel = 'public' | 'internal' | 'sensitive' | 'restricted';
```

### 6.9 ToolHandle

```ts
export type ToolHandle = {
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputDescription?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  requiresUserApproval?: boolean;
};
```

### 6.10 SchemaContext

```ts
export type SchemaContext = {
  contextId: string;
  conversationId?: string;
  dataSourceIds: string[];
  purpose?: string;
  systemInstruction: string;
  dataSourceProfiles: DataSourceProfile[];
  relevantSnippets: RelevantDataSnippet[];
  availableTools: ToolHandle[];
  safetyPolicy: SchemaContextSafetyPolicy;
  tokenBudget: ContextTokenBudget;
  markdown: string;
  raw: Record<string, unknown>;
  generatedAt: string;
};
```

---

## 7. 数据摘要要求

请实现数据画像生成逻辑，至少覆盖以下内容。

### 7.1 文件元信息

对于 CSV 数据源，需要生成：

* 文件名；
* 文件类型；
* 文件大小；
* 编码；
* 分隔符；
* 行数；
* 列数。

如果未来扩展 XLSX，可支持：

* sheet 数；
* sheet 名称；
* 每个 sheet 的行列数。

当前版本不实现 XLSX。

### 7.2 表结构信息

每个表需要输出：

* 表名；
* 表说明；
* 行数；
* 列数；
* 字段名；
* 字段类型；
* 推断字段类型；
* 是否可空；
* 缺失率；
* 唯一值数量；
* 主键；
* 外键；
* 索引；
* 敏感等级；
* 业务含义。

### 7.3 数据摘要信息

根据字段类型生成摘要：

#### 数值列

* 最小值；
* 最大值；
* 均值；
* 中位数；
* 缺失率；
* 异常值提示，当前版本可先预留。

#### 类别列

* Top N 类别分布；
* 唯一值数量；
* 缺失率。

#### 时间列

* 最小时间；
* 最大时间；
* 时间跨度；
* 缺失率。

#### 文本列

* 样例值；
* 平均长度，当前版本可选；
* 超长文本提示，当前版本可选。

### 7.4 样例数据

支持注入：

* 前几行；
* 尾几行；
* 代表性样本；
* 相关行片段。

默认策略：

* 每张表最多注入 3～5 行 preview rows；
* 不允许将全表数据注入 Prompt；
* 敏感字段默认脱敏；
* 大字段默认截断；
* 样例行只用于帮助模型理解数据形态，不允许用于全量统计结论。

---

## 8. Prompt 注入策略

请实现一个 `SchemaContextBuilder`，负责将数据源画像转化为 Markdown Prompt Context。

### 8.1 需要注入的内容

默认注入：

1. 系统约束说明；
2. 数据源列表；
3. 文件画像；
4. 表结构；
5. 字段摘要；
6. 关键统计摘要；
7. 样例数据；
8. 可用工具；
9. 禁止事项；
10. 用户问题相关的字段或片段。

### 8.2 不应注入的内容

默认不注入：

* 原始完整 CSV 文件；
* SQL 数据库完整表数据；
* 超过预览限制的全量数据；
* 数据库密码；
* 数据库连接串；
* 用户无权限访问的数据源；
* 用户无权限访问的表；
* 用户无权限访问的字段；
* 未脱敏的敏感字段。

### 8.3 Prompt 中必须包含的系统约束

请在生成的 `systemInstruction` 或 `markdown` 中包含类似以下约束：

```text
你可以看到用户数据源的结构化摘要，但不一定能看到完整数据。
当用户的问题需要精确统计、筛选、聚合、计算、排序、去重、相关性分析、缺失值统计、异常值检测、趋势分析、多表关联或生成图表时，必须调用数据查询工具、SQL 工具、Python 工具或图表生成工具。
不要基于 preview_rows 或 sample_rows 直接推断全量数据结论。
回答中应说明分析基于哪个数据源、哪个表、哪些字段。
如果当前 Context 不足以回答，应说明需要调用哪个工具或需要用户授权。
```

---

## 9. 禁止模型直接执行的任务范围

请在模块的 `safety-policy.ts` 中维护禁止模型仅凭上下文直接完成的任务类型。

至少包括：

```ts
export type ToolRequiredTaskType =
  | 'full_table_sum'
  | 'top_n_sorting'
  | 'group_by_statistics'
  | 'distinct_count'
  | 'complex_filtering'
  | 'correlation_analysis'
  | 'missing_value_statistics'
  | 'outlier_detection'
  | 'trend_analysis'
  | 'multi_table_join'
  | 'chart_generation'
  | 'medical_data_analysis'
  | 'financial_data_analysis'
  | 'scientific_data_analysis';
```

当识别到上述任务时，Context 中应提示模型：

* 不要直接基于样例行给出结论；
* 必须调用对应工具；
* 若需要执行 SQL 或 Python，应获取用户授权；
* 若用户未授权，应只给出分析计划或待执行脚本，不给出伪造结论。

---

## 10. 工具句柄注入要求

请实现 `ToolContextBuilder`，将可用工具注入到 Schema Context 中。

### 10.1 必须支持的工具句柄

#### 1. 获取数据源画像工具

用于在用户准备发起数据任务时，返回文件结构、表结构、字段、行列数、缺失值、样例数据等。

工具名建议：

```text
get_data_source_profile
```

#### 2. SQL 脚本执行工具

当用户需要查询数据库表数据时，大模型应生成 SQL 脚本，经安全检查和用户授权后执行，再将查询结果整理后返回给模型，禁止将查询出的原始数据直接传输给大模型。

工具名建议：

```text
execute_sql_query
```

工具要求：

* 只允许只读查询；
* 必须经过 SQL 安全网关；
* 必须进行权限校验；
* 必须支持行数限制；
* 必须支持超时；
* 必须支持审计；
* 高风险查询需要用户授权。

#### 3. Python 脚本执行工具

当用户需要执行数据分析任务时，大模型可生成 Python 脚本，经用户授权后执行，再将结果返回给模型。执行分析的数据可以来自工具`execute_sql_query`的查询数据结果。

工具名建议：

```text
execute_python_analysis
```

工具要求：

* 必须运行在沙箱中；
* 禁止访问未授权路径；
* 禁止网络访问，除非明确授权；
* 必须限制运行时间；
* 必须限制内存；
* 必须记录审计日志。

#### 4. 图表生成工具

根据分析结果绘制可视化图表。

工具名建议：

```text
generate_chart
```

策略：

* 1000 行以下，可根据分析结果使用前端图表库，例如 vis.js 或 ECharts；
* 1000 行及以上，建议调用 Python 绘图工具，例如 pandas、matplotlib；
* 图表主题和颜色应保持与应用主题一致；
* 图表生成应基于查询或分析结果，而不是基于 preview rows 猜测。

### 10.2 ToolHandle 输出格式

每个工具句柄需要包含：

* 工具名称；
* 工具用途；
* 输入参数 schema；
* 输出说明；
* 风险等级；
* 是否需要用户授权；
* 适用场景；
* 禁止场景。

---

## 11. Context Token Budget 与压缩策略

请实现 `ContextCompressor`，用于控制注入内容大小。

### 11.1 TokenBudget 类型

```ts
export type ContextTokenBudget = {
  maxChars?: number;
  maxTables?: number;
  maxColumnsPerTable?: number;
  maxSampleRowsPerTable?: number;
  maxTopValuesPerColumn?: number;
  includeTailRows?: boolean;
  includeRepresentativeRows?: boolean;
  includeStatistics?: boolean;
};
```

### 11.2 默认策略

建议默认值：

```ts
const DEFAULT_CONTEXT_BUDGET = {
  maxChars: 24000,
  maxTables: 8,
  maxColumnsPerTable: 30,
  maxSampleRowsPerTable: 5,
  maxTopValuesPerColumn: 5,
  includeTailRows: false,
  includeRepresentativeRows: true,
  includeStatistics: true,
};
```

### 11.3 压缩优先级

当 Context 超过预算时，按以下顺序压缩：

1. 删除尾部样例行；
2. 减少 representativeRows；
3. 减少 sampleRows；
4. 减少类别列 Top Values；
5. 截断长文本字段样例；
6. 限制每张表字段数量；
7. 限制表数量；
8. 仅保留与用户问题相关的表和字段；
9. 保留工具句柄和安全约束，不得删除。

安全约束和工具句柄必须优先保留。

---

## 12. 相关片段检索

请实现轻量 `RelevantSnippetRetriever`，用于根据用户问题从数据源画像中筛选相关表、字段和样例片段。

当前版本不需要复杂向量检索，可以先实现关键词匹配与简单打分。

### 12.1 相关性来源

可基于：

* 表名；
* 表说明；
* 字段名；
* 字段业务含义；
* 字段样例值；
* 用户问题关键词；
* 同义词字典，当前可预留。

### 12.2 输出类型

```ts
export type RelevantDataSnippet = {
  snippetId: string;
  dataSourceId: string;
  tableName?: string;
  columnNames?: string[];
  reason: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
};
```

### 12.3 检索策略

要求：

* 优先返回与用户问题相关的表；
* 优先返回与用户问题相关的字段；
* 对高敏感字段进行脱敏；
* 不返回用户无权限字段；
* 不返回全量数据；
* 对大字段样例进行截断。

---

## 13. CSV Profiler 实现要求

请实现 `CsvProfiler` 或类似模块。

输入可以是：

* 已导入 SQLite 临时表的引用。

当前阶段优先支持 **已导入 SQLite 临时表** 的画像生成；如果项目已有 CSV 解析模块，可与其对接。

CSV Profiler 应输出：

* 文件画像；
* SQLite 临时表名称；
* 行数；
* 列数；
* 字段类型推断；
* 缺失率；
* 唯一值数量；
* 数值列统计；
* 类别列 Top Values；
* 时间列范围；
* 样例行；
* 敏感字段初步识别。

注意：

* 大文件不要一次性加载到内存；
* 对 SQLite 临时表统计时应加行数、时间和字段限制；
* 统计失败时不要中断整个画像生成，应返回部分画像和 warning。

---

## 14. SQL Profiler 实现要求

请实现 `SqlProfiler` 或类似模块。

输入可以是：

* 已同步的数据库元数据；
* 数据源 ID；
* 表列表；
* 字段列表；
* 统计摘要缓存。

SQL Profiler 应输出：

* 数据库画像；
* Schema 信息；
* 表列表；
* 字段列表；
* 主键；
* 外键；
* 索引；
* 表说明；
* 字段说明；
* 行数估算；
* 样例行；
* 字段摘要；
* 敏感字段标记。

要求：

* 不默认执行全表扫描；
* 行数优先使用元数据估算值；
* 样例数据必须限制行数；
* 大表样例读取必须经过策略限制；
* 无权限字段不得进入 Context；
* 敏感字段默认脱敏；
* 生产库只注入结构和摘要，不注入大量样例数据。

---

## 15. 安全策略

请实现 `SchemaContextSafetyPolicy`。

```ts
export type SchemaContextSafetyPolicy = {
  disallowFullDataInjection: boolean;
  requireToolForPreciseComputation: boolean;
  requireUserApprovalForSqlExecution: boolean;
  requireUserApprovalForPythonExecution: boolean;
  maskSensitiveFields: boolean;
  maxPreviewRowsPerTable: number;
  forbiddenDirectAnswerTasks: ToolRequiredTaskType[];
};
```

默认策略：

```ts
const DEFAULT_SCHEMA_CONTEXT_SAFETY_POLICY = {
  disallowFullDataInjection: true,
  requireToolForPreciseComputation: true,
  requireUserApprovalForSqlExecution: true,
  requireUserApprovalForPythonExecution: true,
  maskSensitiveFields: true,
  maxPreviewRowsPerTable: 5,
  forbiddenDirectAnswerTasks: [
    'full_table_sum',
    'top_n_sorting',
    'group_by_statistics',
    'distinct_count',
    'complex_filtering',
    'correlation_analysis',
    'missing_value_statistics',
    'outlier_detection',
    'trend_analysis',
    'multi_table_join',
    'chart_generation',
    'medical_data_analysis',
    'financial_data_analysis',
    'scientific_data_analysis'
  ]
};
```

---

## 16. 对外 API 设计

请实现清晰的 TypeScript API。

建议暴露：

```ts
createSchemaContextBuilder(config)

builder.buildContext({
  conversationId,
  userQuestion,
  dataSourceRefs,
  purpose,
  tokenBudget,
  userPermissionContext
})

builder.buildPromptMarkdown(context)

builder.buildSystemInstruction(context)

builder.getAvailableTools(context)

builder.getRelevantSnippets(context)
```

示例类型：

```ts
export type BuildSchemaContextInput = {
  conversationId?: string;
  userQuestion?: string;
  dataSourceRefs: DataSourceRef[];
  purpose?: 'data_exploration' | 'sql_generation' | 'risk_analysis' | 'report_generation' | 'chart_generation';
  tokenBudget?: Partial<ContextTokenBudget>;
  userPermissionContext?: UserPermissionContext;
};
```

输出：

```ts
export type BuildSchemaContextOutput = SchemaContext;
```

---

## 17. Prompt Markdown 输出示例

请生成类似如下结构的 Markdown：

```markdown
# Data Source Context

## Usage Policy

你可以看到用户数据源的结构化摘要，但不一定能看到完整数据。
当用户的问题需要精确统计、筛选、聚合、计算、排序或生成图表时，必须调用工具。
不要基于 preview_rows 直接推断全量数据结论。

## Data Sources

### 数据源 1：loan_contracts.csv

- 类型：CSV 导入数据
- 存储位置：SQLite 临时表
- 行数：12000
- 列数：18

## Tables

### temp_loan_contracts

字段摘要：

| 字段名 | 类型 | 缺失率 | 唯一值 | 说明 |
|---|---|---:|---:|---|
| customer_id | string | 0% | 8500 | 客户编号 |
| loan_amount | number | 0% | 11000 | 贷款金额 |
| due_date | date | 2.1% | 360 | 到期日 |

## Sample Rows

仅展示少量样例行，不代表全量统计结论。

## Available Tools

- get_data_source_profile：获取数据源画像
- execute_sql_query：执行只读 SQL 查询，需授权
- execute_python_analysis：执行 Python 分析，需授权
- generate_chart：生成可视化图表
```

---

## 18. 错误处理要求

请设计统一错误类型。

至少包括：

```ts
export type SchemaContextErrorCode =
  | 'DATA_SOURCE_NOT_FOUND'
  | 'DATA_SOURCE_UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'PROFILE_GENERATION_FAILED'
  | 'CSV_PROFILE_FAILED'
  | 'SQL_PROFILE_FAILED'
  | 'CONTEXT_BUILD_FAILED'
  | 'CONTEXT_BUDGET_EXCEEDED'
  | 'SENSITIVE_FIELD_MASK_FAILED'
  | 'UNKNOWN_ERROR';
```

要求：

* 单个数据源画像失败，不应导致整个 Context 构建失败；
* 应返回 warnings；
* 敏感信息不得进入错误 message；
* 数据源权限不足时应跳过或输出受限说明；
* CSV / SQL 画像失败时应尽量返回部分结果。

---

## 19. 测试要求

请补充测试用例。优先使用 Vitest。如果项目已有测试框架，请遵守现有框架。

### 19.1 SchemaContextBuilder 测试

覆盖：

* 单个 SQL 数据源 Context 构建；
* 单个 CSV SQLite 临时表 Context 构建；
* 多数据源 Context 构建；
* 无用户问题时构建通用 Context；
* 有用户问题时筛选相关字段；
* 超过 token budget 时自动压缩；
* 安全策略始终保留；
* 工具句柄始终保留；
* 权限不足数据源不注入；
* 敏感字段脱敏。

### 19.2 CSV Profiler 测试

覆盖：

* UTF-8 CSV；
* GBK CSV，当前可用 mock；
* 逗号分隔；
* 制表符分隔；
* 分号分隔；
* 表头识别；
* 缺失值统计；
* 数值字段识别；
* 日期字段识别；
* 类别字段 Top Values；
* 样例行限制；
* 大文件流式读取，当前可 mock；
* 统计失败返回 warning。

### 19.3 SQL Profiler 测试

覆盖：

* 使用元数据构建画像；
* 表结构注入；
* 字段注入；
* 主键外键注入；
* 行数估算；
* 样例行限制；
* 大表不全量扫描；
* 生产库只注入结构摘要；
* 敏感字段脱敏；
* 权限不足字段过滤。

### 19.4 ContextCompressor 测试

覆盖：

* 限制最大表数量；
* 限制每表字段数量；
* 限制样例行；
* 截断长文本；
* 减少 top values；
* 保留 safety policy；
* 保留 tool handles；
* 根据用户问题优先保留相关表字段。

### 19.5 ToolContextBuilder 测试

覆盖：

* 注入 get_data_source_profile；
* 注入 execute_sql_query；
* 注入 execute_python_analysis；
* 注入 generate_chart；
* 工具风险等级；
* 工具是否需要授权；
* 工具 schema 格式。

---

## 20. 实现约束

请遵守以下约束：

1. 优先使用 TypeScript；
2. 保持模块可独立测试；
3. 不要依赖具体 UI；
4. 不要直接调用真实生产数据库；
5. 不要将完整数据注入 Prompt；
6. 不要在日志或错误中暴露数据库密码、连接串、Token；
7. 敏感字段默认脱敏；
8. 大文件、大表处理要有行数、字段数和时间限制；
9. 当前版本不实现 XLSX，但预留扩展；
10. 当前相关片段检索先用关键词匹配，不强制引入向量库；
11. 当前版本管理存储可先内存实现或 mock；
12. Context 输出应可直接传给流式模型调用适配器；
13. 所有公开 API 应从 `index.ts` 导出；
14. 如项目已有 lint、format、test 规范，请遵守；
15. 完成后运行类型检查和测试，如环境允许。

---

## 21. 验收标准

完成后应满足以下标准：

1. 可以根据 SQL 数据源生成 Schema Context；
2. 可以根据 CSV SQLite 临时表生成 Schema Context；
3. 生成的 Context 包含数据源画像、表结构、字段摘要、统计摘要、样例数据、工具句柄和安全策略；
4. 不会向 Prompt 注入完整数据；
5. 不会向 Prompt 注入敏感连接信息；
6. 精确计算类任务会被标记为必须调用工具；
7. 样例行会明确提示不能代表全量结论；
8. 支持 token budget 压缩；
9. 支持相关表字段筛选；
10. 支持敏感字段脱敏；
11. 支持权限过滤；
12. 支持工具句柄注入；
13. 有基础测试用例；
14. 公开 API 清晰；
15. 模块可被后续 Agent Runtime 或 Streaming Model Adapter 调用。

---

## 22. 开发优先级

请按以下优先级实现。

### P0：必须完成

* 类型定义；
* SchemaContextBuilder；
* ToolContextBuilder；
* SafetyPolicy；
* ContextCompressor；
* 关键词相关片段检索；
* SQL 数据源画像 mock / adapter 接口；
* CSV SQLite 临时表画像 mock / adapter 接口；
* Markdown Prompt 输出；
* 敏感字段脱敏；
* 工具句柄注入；
* CSV Profiler 实际 SQLite 临时表统计；
* SQL Profiler 与现有元数据模块对接；
* warnings 输出；
* 语义字段匹配；
* 持久化 Context 缓存；
* 字段类型推断；
* 基础测试。

### P1：预留接口
* XLSX 支持；

---

## 23. 请最终输出

执行完成后，请输出：

1. 新增或修改的文件列表；
2. 核心 API 使用示例；
3. SQL 数据源 Context 构建示例；
4. CSV SQLite 临时表 Context 构建示例；
5. 生成的 Prompt Markdown 示例；
6. 工具句柄注入示例；
7. 测试运行结果；
8. 尚未完成或需要后续补充的事项。

请直接推进实现，不要停留在设计文档。

请优先遵守当前仓库目录结构，不要重构无关模块。

## 上下文

该子任务属于【数据助手】中的一部分。
