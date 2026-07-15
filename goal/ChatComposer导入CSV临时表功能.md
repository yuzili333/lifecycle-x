# 存续期数据探针智能体｜CSV 数据模块与 ChatComposer 临时文件数据源优化

你现在是一个资深 TypeScript / React / Electron / SQLite / AI Agent / 数据导入 / 工具调用工程师。围绕项目 **“存续期数据探针智能体 / Cycle Data Intelligence Agent”** 优化现有的 **CSV 数据模块**，并新增 ChatComposer 会话级 CSV 文件上传与临时数据源能力。

项目此前已经完成：

1. 统一业务字段语义层 `Business Field Semantic Layer`；
2. CSV 数据文件与表字典文件联合导入；
3. CSV 字段的物理字段名、业务字段 ID、中文展示名称映射；
4. `overall-risk-classification-distribution` Skill 的标准业务字段映射；
5. 标准 CSV 数据导入后写入客户端 SQLite；
6. Schema Context 中的业务字段语义注入。

本次任务应在现有实现基础上增量优化，不要重新实现或推翻已有标准 CSV 导入链路。

请直接检查当前仓库并推进实现，不要只输出方案设计。优先遵守当前目录结构、数据库迁移机制、IPC 规范、ChatComposer 组件结构、工具调用协议和测试规范，不要大规模重构无关模块。

---

## 1. 本次核心目标

需要同时保留并支持两类 CSV 数据源。

### 1.1 标准 CSV 数据源

继续支持：

```text
CSV 表数据文件
+ 表字典文件
→ 字段映射
→ 类型与约束校验
→ Business Field Semantic Layer
→ SQLite 正式或项目级数据表
→ Schema Context
→ 配套 Skill
```

特点：

* 需要数据字典；
* 有稳定的 `businessFieldId`；
* 有中文展示名和英文物理字段名；
* 可被预置 Skill 使用；
* 适合规范化、可重复使用的数据分析场景；
* 数据生命周期不局限于当前会话。

### 1.2 ChatComposer 临时 CSV 数据源

新增支持：

```text
用户在 ChatComposer 选择 CSV 文件
→ 文件校验
→ CSV 解析
→ 写入 SQLite 会话临时表
→ 生成临时 Schema Context
→ 当前会话引用
→ SQL 查询
→ Python 分析
→ 图表生成
→ Markdown 报告生成
```

特点：

* 用户只上传一个 CSV 文件；
* 不要求同时上传表字典；
* 文件大小上限为 10 MB；
* 数据仅服务于当前会话；
* CSV 表头可以是中文、英文或中英文混合；
* SQLite 临时表字段允许保留经过安全处理的中文字段名；
* 不要求存量 Skill `overall-risk-classification-distribution` 兼容这类临时表；
* 临时表可被通用 SQL、Python、图表和报告工具使用；
* 会话结束、过期或用户删除后应清理临时数据。

---

## 2. 重要边界

### 2.1 两条导入链路不能相互替代

标准 CSV 导入与 ChatComposer 临时 CSV 导入应并行存在：

```text
标准导入
→ 强结构、强语义、字典约束、Skill 适配

ChatComposer 临时导入
→ 快速上传、轻量解析、会话临时数据分析
```

不要强制 ChatComposer 上传的 CSV 也必须提供字典表。

不要降低标准 CSV 联合导入的数据治理能力。

### 2.2 不要求存量 Skill 兼容临时 CSV

本次明确不要求：

```text
overall-risk-classification-distribution
```

自动适配 ChatComposer 上传后生成的 SQLite 临时表。

该 Skill 继续仅使用标准 CSV 导入生成的业务字段语义映射数据源。

ChatComposer 临时 CSV 应通过通用工具链完成：

* SQL 查询；
* Python 分析；
* 图表生成；
* 报告生成。

### 2.3 中文字段必须完整支持

ChatComposer 上传 CSV 的表头可能包含：

```text
合同编号
客户名称
五级分类
贷款余额（万元）
统计日期
```

系统需要支持：

* SQLite 临时表使用中文字段；
* SQL 工具生成带中文字段的安全 SQL；
* Python 输入数据保留中文列名；
* 图表协议引用中文字段；
* 报告展示中文字段；
* Schema Context 正确描述中文字段；
* 中文字段的引号和转义安全处理。

---

## 3. 推荐目录结构

请先检查当前仓库并复用已有目录。如果尚无对应模块，可参考：

```text
src/
  data-source/
    csv-import/
      standard-csv-import-service.ts
      chat-csv-import-service.ts
      csv-file-validator.ts
      csv-parser.ts
      csv-header-sanitizer.ts
      csv-type-inference.ts
      csv-import-errors.ts
      index.ts

    temporary-data-source/
      conversation-temp-source-manager.ts
      conversation-temp-table-repository.ts
      temp-table-name-generator.ts
      temp-schema-context-builder.ts
      temp-source-cleanup-service.ts
      index.ts

  ai/
    tool-orchestration/
      tool-input-resolver.ts

    schema-context/
      schema-context-builder.ts
      conversation-temp-schema-context.ts

    sql-tool/
      sql-identifier-quoting.ts
      sqlite-query-adapter.ts

    python-runner/
      dataset-resolver.ts

  renderer/
    components/
      chat/
        ChatComposer.tsx
        ChatCsvAttachmentButton.tsx
        ChatCsvAttachmentChip.tsx
        ChatCsvImportProgress.tsx
        ChatCsvDataSourceCard.tsx
```

如果项目已有：

* CSV Parser；
* File Upload；
* SQLite Repository；
* Artifact Manager；
* ChatComposer；
* Tool Registry；
* Schema Context Builder；
* Workflow；
* Memory；
* SQL Tool；
* Python Runner；

请增量复用，不要建立重复平行实现。

---

## 4. ChatComposer CSV 上传交互

请在现有 `ChatComposer` 中增加 CSV 文件选择能力。

### 4.1 上传入口

支持：

* 点击附件按钮选择 CSV；
* 可选支持拖拽上传；
* 文件选择器仅接受 `.csv`；
* 单次默认支持一个 CSV 文件；
* 当前 P0 不要求同时上传多个 CSV。

示例：

```tsx
<input
  type="file"
  accept=".csv,text/csv"
  onChange={handleCsvFileSelect}
/>
```

应复用项目现有文件选择、附件或上传组件。

### 4.2 文件限制

必须校验：

```text
文件类型：CSV
最大文件大小：10 MB
空文件：拒绝
文件名为空：拒绝
表头为空：拒绝
无数据行：可允许，但需警告
```

配置：

```ts
export const CHAT_CSV_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
```

不要仅依赖前端校验，主进程或数据导入服务也要再次校验。

### 4.3 上传状态

建议状态：

```ts
export type ChatCsvUploadStatus =
  | 'selected'
  | 'validating'
  | 'parsing'
  | 'importing'
  | 'ready'
  | 'failed'
  | 'removed';
```

UI 展示：

* 文件名；
* 文件大小；
* 解析状态；
* 数据行数；
* 字段数量；
* 临时表状态；
* 移除按钮；
* 错误信息。

### 4.4 消息发送行为

CSV 文件导入成功前：

* 禁止将其作为工具输入；
* 可根据当前产品交互决定是否禁止发送消息；
* 推荐允许用户继续输入文字，但发送时等待导入完成；
* 导入失败时不得保留无效数据源引用。

导入成功后：

* 当前消息或会话状态中增加临时数据源引用；
* 发送消息时将临时数据源 ID 注入 Agent 上下文；
* 不把完整 CSV 内容直接放入 Prompt。

---

## 5. ChatComposer CSV 输入类型

```ts
export type ChatCsvAttachment = {
  attachmentId: string;
  conversationId: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: 'text/csv';

  status: ChatCsvUploadStatus;

  tempDataSourceId?: string;
  tempTableId?: string;
  sqliteTableName?: string;

  rowCount?: number;
  columnCount?: number;
  columns?: ChatCsvColumnMetadata[];

  createdAt: string;
  error?: ChatCsvImportError;
};
```

字段元数据：

```ts
export type ChatCsvColumnMetadata = {
  ordinalPosition: number;

  sourceHeader: string;
  sqliteColumnName: string;
  displayName: string;

  inferredLogicalType:
    | 'string'
    | 'integer'
    | 'decimal'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'category'
    | 'text'
    | 'unknown';

  sqliteType:
    | 'TEXT'
    | 'INTEGER'
    | 'REAL'
    | 'NUMERIC'
    | 'BLOB';

  nullable?: boolean;
  sampleValues?: unknown[];
  warnings?: string[];
};
```

临时 CSV 数据源不强制要求：

```text
businessFieldId
```

但可以预留可选字段：

```ts
suggestedBusinessFieldId?: string;
```

不要在 P0 中强制实现 Skill 字段语义映射。

---

## 6. 中文表头处理策略

ChatComposer 临时 CSV 需要支持直接使用中文表头。

### 6.1 保留原始中文名称

例如 CSV：

```csv
合同编号,客户名称,五级分类,贷款余额（万元）
HT001,客户A,正常,1200.50
```

SQLite 临时表可以创建为：

```sql
CREATE TABLE "chat_csv_xxx" (
  "合同编号" TEXT,
  "客户名称" TEXT,
  "五级分类" TEXT,
  "贷款余额（万元）" NUMERIC
);
```

必须通过统一的 SQLite 标识符转义函数处理，禁止直接字符串拼接。

### 6.2 标识符安全函数

请实现或复用：

```ts
export function quoteSqliteIdentifier(identifier: string): string;
```

规则：

* 使用 SQLite 双引号转义；
* 内部双引号替换为两个双引号；
* 禁止 NUL 字符；
* 禁止空字段名；
* 限制字段名称长度；
* 处理重复字段；
* 不把字段名当作 SQL 值参数；
* SQL 值仍使用参数化查询。

示例：

```ts
quoteSqliteIdentifier('贷款余额（万元）');
// => "贷款余额（万元）"
```

包含双引号：

```ts
quoteSqliteIdentifier('客户"名称');
// => "客户""名称"
```

### 6.3 重复表头

如果 CSV 中出现重复字段：

```text
金额,金额,金额
```

生成：

```text
金额
金额_2
金额_3
```

同时保留：

```ts
sourceHeader: '金额'
sqliteColumnName: '金额_2'
```

### 6.4 空表头

空表头生成：

```text
未命名字段_1
未命名字段_2
```

并记录 warning。

### 6.5 禁止直接把表头拼入 SQL

无论中文还是英文，所有字段和表名都必须通过：

```ts
quoteSqliteIdentifier()
```

生成安全 SQL。

---

## 7. CSV 解析能力

请复用已有 CSV Parser，并确保支持：

* UTF-8；
* UTF-8 BOM；
* GBK，若当前已有能力则复用，否则 P1；
* 逗号分隔；
* 制表符；
* 分号；
* 引号包裹字段；
* 字段内换行；
* 字段内逗号；
* 空值；
* 中文表头；
* 大小写英文混合表头；
* 流式或分批解析。

文件最大 10 MB，仍需避免一次性构造过多副本。

### 7.1 类型推断

P0 支持：

* INTEGER；
* DECIMAL；
* BOOLEAN；
* DATE；
* DATETIME；
* TEXT。

类型推断不能破坏原始值。

存在混合类型时优先使用：

```text
TEXT
```

并记录推断 warning。

---

## 8. SQLite 会话临时表

### 8.1 表命名

不要使用用户文件名直接作为物理表名。

建议：

```text
chat_csv_{conversationIdShort}_{timestamp}_{random}
```

例如：

```text
chat_csv_8fa31c_1721001123_a91f
```

类型：

```ts
export type ConversationTempCsvTable = {
  tempTableId: string;
  tempDataSourceId: string;
  conversationId: string;

  fileName: string;
  sqliteTableName: string;

  rowCount: number;
  columnCount: number;
  columns: ChatCsvColumnMetadata[];

  status:
    | 'creating'
    | 'ready'
    | 'failed'
    | 'expired'
    | 'deleted';

  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};
```

### 8.2 写入要求

支持：

* 自动创建临时表；
* 参数化批量写入；
* 事务；
* 分批提交；
* 失败回滚；
* 导入进度；
* 用户取消；
* 重复字段处理；
* 中文字段名；
* 空值；
* SQLite 类型转换；
* 导入失败清理残留表。

### 8.3 临时数据生命周期

临时表作用域：

```text
conversation
```

清理条件：

* 用户手动移除文件；
* 用户删除会话；
* 会话临时数据过期；
* 应用启动时清理过期记录；
* 导入失败；
* 可配置在会话关闭后保留一定时间。

P0 推荐默认 TTL：

```ts
const DEFAULT_CHAT_CSV_TTL_MS = 24 * 60 * 60 * 1000;
```

具体值应可配置。

---

## 9. 临时数据源管理器

请实现：

```ts
export type ConversationTempSourceManager = {
  importCsv(input: ImportConversationCsvInput): Promise<ConversationTempCsvTable>;

  getTempSource(
    tempDataSourceId: string
  ): Promise<ConversationTempCsvTable | null>;

  listByConversation(
    conversationId: string
  ): Promise<ConversationTempCsvTable[]>;

  removeTempSource(
    tempDataSourceId: string
  ): Promise<void>;

  cleanupExpired(): Promise<{
    removedSources: number;
    removedTables: number;
    warnings: string[];
  }>;
};
```

输入：

```ts
export type ImportConversationCsvInput = {
  conversationId: string;
  userId: string;

  fileName: string;
  fileSizeBytes: number;
  filePath?: string;
  fileBuffer?: Uint8Array;

  ttlMs?: number;
};
```

所有文件路径访问需要遵守 Electron IPC 和本地文件安全策略。

---

## 10. Electron 安全边界

### 10.1 渲染进程

渲染进程只负责：

* 选择文件；
* 展示文件信息；
* 展示进度和结果；
* 持有受控 attachment ID。

不要让渲染进程：

* 直接创建 SQLite 表；
* 任意访问本地文件路径；
* 直接读取数据库文件；
* 持有 SQLite 连接实例。

### 10.2 主进程或本地服务

主进程或受控 Node 服务负责：

* 文件大小二次校验；
* CSV 解析；
* 表头处理；
* SQLite 临时表创建；
* 数据写入；
* 元数据存储；
* 临时表清理。

### 10.3 IPC

如果已有 IPC 规范，请复用。

可参考：

```ts
export type ChatCsvClientApi = {
  importCsv(input: {
    conversationId: string;
    fileRef: LocalFileRef;
  }): Promise<ChatCsvAttachment>;

  getCsvAttachment(
    attachmentId: string
  ): Promise<ChatCsvAttachment | null>;

  removeCsvAttachment(
    attachmentId: string
  ): Promise<void>;
};
```

不要暴露任意数据库操作 IPC。

---

## 11. 会话状态集成

当前会话需要保存临时数据源引用。

```ts
export type ConversationDataContext = {
  conversationId: string;

  standardDataSourceIds: string[];
  temporaryDataSourceIds: string[];

  activeTemporaryDataSourceId?: string;
  latestTemporaryDataSourceId?: string;

  updatedAt: string;
};
```

发送消息时，Agent Runtime 应获得：

```ts
export type ChatMessageDataContext = {
  selectedDataSourceIds?: string[];
  selectedTempDataSourceIds?: string[];
};
```

默认规则：

* 用户本轮上传 CSV 后，该临时数据源成为当前轮默认数据源；
* 用户明确选择其他数据源时，以显式选择为准；
* 同一会话后续轮次可继续引用该临时表；
* 用户删除附件后，不再自动引用；
* 多个临时 CSV 的自动选择策略可作为 P1。

---

## 12. 临时 Schema Context

请实现或扩展 Schema Context Builder，使其支持临时 CSV 数据源。

### 12.1 注入内容

模型应看到：

```markdown
## 会话临时数据源

- 文件名：风险分类数据.csv
- SQLite 临时表：chat_csv_8fa31c_1721001123_a91f
- 行数：1250
- 列数：5
- 数据范围：当前会话
- 生命周期：临时

| 字段名 | SQLite 字段 | 推断类型 | 示例 |
|---|---|---|---|
| 合同编号 | 合同编号 | TEXT | HT001 |
| 五级分类 | 五级分类 | TEXT | 正常 |
| 贷款余额（万元） | 贷款余额（万元） | NUMERIC | 1200.50 |
```

### 12.2 结构化 Context

```ts
export type ConversationTempSchemaContext = {
  tempDataSourceId: string;
  sqliteTableName: string;
  fileName: string;

  rowCount: number;
  columnCount: number;

  columns: Array<{
    sourceHeader: string;
    physicalName: string;
    displayName: string;
    logicalType: string;
    sqliteType: string;
    sampleValues?: unknown[];
  }>;

  scope: 'conversation';
  expiresAt?: string;
};
```

### 12.3 系统提示词

增加：

```text
当前会话可能包含用户临时上传的 CSV 数据源。

临时 CSV 数据源的 SQLite 表字段可以是中文、英文或中英文混合。生成 SQLite SQL 时必须使用 Schema Context 中给出的真实表名和字段名，并对表名、字段名使用 SQLite 双引号转义。

不要假设临时 CSV 字段具备 businessFieldId。应根据实际字段名称、类型、样例和用户需求理解字段含义。

需要精确查询、统计、排序、聚合或筛选时，必须调用 SQL 查询工具。
```

---

## 13. SQL 查询支持中文字段

请优化 SQL Tool 或 SQLite Adapter，不要改变原始数据库的 SQL 方言处理逻辑。

### 13.1 数据源方言

临时 CSV 表应明确标记：

```ts
dialect: 'sqlite'
```

SQL 生成和安全校验使用 SQLite 规则。

### 13.2 SQL 示例

```sql
SELECT
  "五级分类",
  COUNT(DISTINCT "合同编号") AS "合同笔数",
  SUM("贷款余额（万元）") AS "贷款余额"
FROM "chat_csv_8fa31c_1721001123_a91f"
GROUP BY "五级分类"
ORDER BY "贷款余额" DESC;
```

### 13.3 SQL 安全要求

继续遵守：

* 只读查询；
* 用户审批；
* SQL Safety Gateway；
* 禁止 DML / DDL；
* 禁止多语句；
* 禁止附加数据库；
* 禁止 PRAGMA；
* 禁止访问非授权临时表；
* 查询结果物化或生成 Artifact；
* 不直接把完整结果输入模型。

### 13.4 标识符处理

SQL 工具应获得结构化字段信息，不要让模型自行猜测是否需要引号。

可在 SQL 生成上下文中提供：

```json
{
  "table": {
    "name": "chat_csv_8fa31c_1721001123_a91f",
    "quotedName": "\"chat_csv_8fa31c_1721001123_a91f\""
  },
  "columns": [
    {
      "name": "贷款余额（万元）",
      "quotedName": "\"贷款余额（万元）\""
    }
  ]
}
```

安全网关需要重新解析和校验实际引用字段。

---

## 14. Python 分析支持中文字段

Python Runner 继续禁止直连数据库。

临时 CSV 数据应通过：

* CSV 副本；
* JSONL；
* SQLite 临时结果导出；
* DatasetResolver materialize；

注入沙箱。

### 14.1 中文列名示例

```python
import pandas as pd

df = pd.read_csv("input/dataset.csv")

summary = (
    df.groupby("五级分类", dropna=False)
      .agg(
          合同笔数=("合同编号", "nunique"),
          贷款余额=("贷款余额（万元）", "sum")
      )
      .reset_index()
)
```

### 14.2 编码

导出给 Python 的 CSV 建议统一为：

```text
UTF-8
```

并保留中文表头。

### 14.3 Python 工具描述补充

```text
输入数据的字段名可能是中文、英文或中英文混合。编写 Python 脚本时必须使用数据集 Schema 中的真实字段名称，不得自行翻译或改名后假设字段存在。

如果需要临时重命名列，应在脚本内部显式执行 rename，并保留来源映射。
```

### 14.4 输入验证

Python 请求创建前校验：

* datasetId 属于当前会话；
* 临时数据源未过期；
* 用户有访问权限；
* 字段存在；
* 文件 materialize 成功；
* 输入规模符合 Python Runner 策略。

---

## 15. 图表工具支持临时 CSV

绘制图表工具可以使用：

* 临时 CSV 的 SQL 查询结果 Artifact；
* Python 分析结果 Artifact；
* 受控小型临时数据集。

不建议直接让图表组件读取 SQLite 表。

流程：

```text
临时 CSV 表
→ SQL 或 Python 工具
→ Artifact
→ VisualizationSpec
→ 图表渲染
```

图表协议中的字段可以使用中文：

```json
{
  "type": "bar",
  "title": "各风险分类贷款余额",
  "data": {
    "mode": "artifact",
    "artifactId": "artifact_xxx"
  },
  "encoding": {
    "x": "五级分类",
    "y": ["贷款余额"]
  }
}
```

模型不得输出完整 ECharts option。

---

## 16. 报告工具支持临时 CSV

报告工具可以引用：

* 临时数据源概要；
* SQL 查询结果摘要；
* Python 分析结果；
* 图表 Artifact；
* 数据质量 warning。

报告中可使用中文字段名称。

报告数据来源应标记：

```text
数据来源：用户在当前会话上传的 CSV 文件
文件名：风险分类数据.csv
数据范围：会话临时数据源
```

不得在报告中暴露：

* SQLite 绝对路径；
* 客户端内部数据库路径；
* 临时文件绝对路径；
* 未脱敏敏感字段；
* 完整原始数据。

---

## 17. 工具输入解析规则

请优化 Tool Input Resolver。

### 17.1 SQL 工具

当当前轮或会话中存在激活的临时 CSV 数据源时：

```text
用户未明确指定其他数据源
→ 默认使用当前激活临时数据源
```

### 17.2 Python 工具

默认输入优先级：

```text
1. 用户显式指定的 Artifact 或数据集
2. 当前轮最近 SQL 查询结果
3. 当前会话最近 SQL 查询结果
4. 当前激活临时 CSV 数据源
5. 无输入时返回 waiting_input
```

### 17.3 图表工具

默认输入优先级：

```text
1. 最新 Python 分析结果
2. 最新 SQL 查询结果
3. 用户显式选择的临时 CSV Artifact
4. 无输入时返回 waiting_input
```

### 17.4 报告工具

默认输入优先级：

```text
1. 最新 Python 分析结果
2. 最新图表 Artifact
3. 最新 SQL 查询摘要
4. 当前临时 CSV 数据源概要
```

---

## 18. 标准 CSV 导入继续保留

不要破坏现有标准 CSV 导入链路。

标准导入继续支持：

* 数据文件；
* 字典文件；
* 字段中文名称；
* 英文物理字段名；
* `businessFieldId`；
* SQLite 类型；
* MySQL 类型；
* 约束；
* 示例；
* 注释；
* aliases；
* sensitivity；
* Skill 字段映射。

标准数据源与临时数据源应通过类型区分：

```ts
export type CsvDataSourceMode =
  | 'standard_dictionary_import'
  | 'conversation_temporary_import';
```

### 18.1 标准数据源

```ts
scope: 'project' | 'persistent'
hasBusinessSemanticLayer: true
skillCompatible: true
```

### 18.2 对话临时数据源

```ts
scope: 'conversation'
hasBusinessSemanticLayer: false
skillCompatible: false
```

这里的 `skillCompatible: false` 指不承诺兼容现有预置 Skill，而不是禁止任何通用 Agent 分析。

---

## 19. 数据源类型模型

```ts
export type CsvDataSourceDescriptor = {
  dataSourceId: string;
  mode: CsvDataSourceMode;

  name: string;
  fileName: string;

  scope:
    | 'conversation'
    | 'project'
    | 'persistent';

  sqliteTableName: string;

  hasDictionary: boolean;
  hasBusinessSemanticLayer: boolean;
  skillCompatible: boolean;

  conversationId?: string;

  rowCount: number;
  columnCount: number;

  status:
    | 'creating'
    | 'ready'
    | 'failed'
    | 'expired'
    | 'deleted';

  createdAt: string;
  expiresAt?: string;
};
```

---

## 20. 数据管理与 ChatComposer 展示差异

### 20.1 标准 CSV

显示：

* 中文字段名称；
* 英文物理字段；
* 业务字段 ID；
* 字段注释；
* 字典状态；
* Skill 兼容性。

### 20.2 ChatComposer 临时 CSV

显示：

* 文件名；
* 行列数；
* 字段列表；
* 推断类型；
* 临时状态；
* 当前会话标识；
* 过期时间；
* “移除数据源”操作。

不要强制展示：

* businessFieldId；
* Skill 兼容状态；
* MySQL 类型；
* 数据字典状态。

---

## 21. 临时表元数据存储

请复用现有数据库迁移机制。

如果当前已有临时数据源表，请扩展；否则可以增加：

```sql
CREATE TABLE IF NOT EXISTS conversation_temp_data_sources (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  file_name TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,

  sqlite_table_name TEXT NOT NULL,

  row_count INTEGER,
  column_count INTEGER,
  columns_json TEXT NOT NULL,

  status TEXT NOT NULL,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);
```

建议索引：

```sql
CREATE INDEX IF NOT EXISTS
idx_conversation_temp_sources_conversation
ON conversation_temp_data_sources(conversation_id);

CREATE INDEX IF NOT EXISTS
idx_conversation_temp_sources_expires
ON conversation_temp_data_sources(expires_at);
```

临时业务表本身不需要进入标准业务字段语义表。

---

## 22. 上传错误处理

定义：

```ts
export type ChatCsvImportErrorCode =
  | 'CSV_FILE_TOO_LARGE'
  | 'CSV_FILE_EMPTY'
  | 'CSV_FILE_TYPE_INVALID'
  | 'CSV_PARSE_FAILED'
  | 'CSV_HEADER_MISSING'
  | 'CSV_COLUMN_DUPLICATED'
  | 'CSV_ENCODING_UNSUPPORTED'
  | 'CSV_SQLITE_TABLE_CREATE_FAILED'
  | 'CSV_SQLITE_IMPORT_FAILED'
  | 'CSV_TEMP_SOURCE_SAVE_FAILED'
  | 'CSV_TEMP_SOURCE_EXPIRED'
  | 'CSV_TEMP_SOURCE_NOT_FOUND'
  | 'CSV_TEMP_SOURCE_PERMISSION_DENIED'
  | 'UNKNOWN_ERROR';
```

错误要求：

* 文件超过 10 MB 时明确提示；
* 不暴露本地绝对路径；
* 导入失败时清理临时表；
* 单个文件失败不影响 ChatComposer；
* 中文字段解析失败时显示具体字段；
* 用户移除文件时取消未完成导入；
* 会话已删除时拒绝继续使用临时表。

---

## 23. 安全要求

必须遵守：

1. CSV 文件大小不超过 10 MB；
2. 仅允许 CSV；
3. 文件内容不能作为可执行内容；
4. 防止 CSV Formula Injection；
5. 不提供渲染预览；
6. SQLite 表名由系统生成；
7. SQLite 字段名必须安全转义；
8. SQL 查询只读；
9. SQL 工具必须审批；
10. Python 工具必须审批并在沙箱执行；
11. Python 不直连数据库；
12. 临时数据只允许当前用户、当前会话访问；
13. 不把完整 CSV 注入模型；
14. 不把 SQLite 绝对路径注入模型；
15. 临时表过期后不得继续查询；
16. 应支持手动清理和自动清理。

---

## 24. 测试要求

优先使用当前项目测试框架；TypeScript 项目可使用 Vitest，React 使用 Testing Library。

### 24.1 文件校验测试

覆盖：

* 小于 10 MB；
* 等于 10 MB；
* 大于 10 MB；
* 非 CSV；
* 空文件；
* 无表头；
* 只有表头；
* UTF-8；
* UTF-8 BOM；
* 中文文件名。

### 24.2 中文字段测试

覆盖：

* 全中文表头；
* 中英文混合；
* 含括号；
* 含空格；
* 含 `%`；
* 含 `/`；
* 含双引号；
* 重复中文字段；
* 空字段；
* 中文字段 SQL 引用；
* 中文字段 Python groupby。

### 24.3 SQLite 导入测试

覆盖：

* 创建临时表；
* 写入数据；
* 批量事务；
* 类型推断；
* 中文列；
* 失败回滚；
* 删除临时表；
* TTL 清理；
* 会话隔离。

### 24.4 ChatComposer 测试

覆盖：

* 点击选择 CSV；
* 文件大小错误；
* 上传进度；
* 解析成功；
* attachment chip；
* 移除文件；
* 消息发送包含 tempDataSourceId；
* 导入失败不发送无效引用；
* 会话后续消息继续使用临时数据源。

### 24.5 Schema Context 测试

覆盖：

* 临时 CSV Context；
* 中文字段；
* 表名和字段 quotedName；
* 不包含完整数据；
* 不包含本地路径；
* scope 为 conversation；
* 标记非 Skill 语义数据源。

### 24.6 SQL Tool 测试

覆盖：

* 查询中文列；
* 分组中文列；
* 中文别名；
* 双引号转义；
* 禁止 DML；
* 禁止访问其他会话临时表；
* 临时表过期；
* 查询结果 Artifact。

### 24.7 Python Runner 测试

覆盖：

* 中文 CSV 输入；
* pandas 中文列访问；
* 中文列 groupby；
* 中文图表标签；
* 不直连 SQLite；
* 临时数据集权限；
* 过期数据拒绝。

### 24.8 图表与报告测试

覆盖：

* 中文字段生成 VisualizationSpec；
* 中文标题；
* 中文维度字段；
* 图表 Artifact；
* 报告引用临时 CSV；
* 报告不暴露 SQLite 路径；
* 报告显示原文件名；
* 报告卡片正常展示。

### 24.9 标准导入回归测试

覆盖：

* CSV + 字典联合导入；
* businessFieldId；
* 中文列头展示；
* Skill 字段解析；
* `overall-risk-classification-distribution` 行为不受影响；
* 标准数据源与临时数据源正确区分。

---

## 25. 实现约束

请严格遵守：

1. 优先使用 TypeScript；
2. 优先遵守当前项目结构；
3. 不要大规模重构无关模块；
4. 保留现有标准 CSV 联合导入；
5. 不要求现有 `overall-risk-classification-distribution` Skill 支持临时 CSV；
6. ChatComposer CSV 最大 10 MB；
7. ChatComposer CSV 仅作用于当前会话；
8. 中文字段名必须支持 SQLite SQL；
9. 中文字段名必须支持 Python 分析；
10. 中文字段名必须支持图表和报告；
11. 所有 SQL 标识符必须安全引用；
12. 不允许 Python 直连数据库；
13. 不把完整 CSV 内容传给模型；
14. 临时表和标准表必须有明确类型区分；
15. 临时 CSV 不强制建立 Business Field Semantic Layer；
16. 不要修改现有 Skill 字段映射逻辑来兼容临时 CSV；
17. 所有公开 API 从现有模块入口或新增模块 `index.ts` 导出；
18. 如已有 CSV Parser、SQLite Repository、ChatComposer、Tool Input Resolver、Schema Context，请复用；
19. 完成后运行数据库迁移、类型检查和测试，如环境允许。

---

## 26. 验收标准

完成后应满足：

1. 标准 CSV + 字典联合导入继续可用；
2. 标准 CSV 的 Business Field Semantic Layer 不受影响；
3. ChatComposer 支持选择 CSV；
4. 文件大小最大 10 MB；
5. 文件导入 SQLite 会话临时表；
6. 临时表仅当前会话可访问；
7. CSV 中文表头可以保留为 SQLite 字段；
8. SQL 工具可以安全查询中文字段；
9. Python 可以分析包含中文列名的数据集；
10. 图表工具可以使用中文字段；
11. 报告工具可以展示中文字段；
12. 当前轮可使用临时 CSV 查询、分析、绘图和生成报告；
13. 后续轮次可继续引用当前会话临时表；
14. 用户可移除临时 CSV 数据源；
15. 临时数据可过期和自动清理；
16. 模型不会接收完整 CSV 原始数据；
17. 不要求 `overall-risk-classification-distribution` 兼容临时 CSV；
18. 标准数据源与临时数据源区分明确；
19. 有完整回归测试；
20. 未大规模重构现有项目。

---

## 27. 开发优先级

### P0：本次必须完成

* ChatComposer CSV 选择入口；
* 10 MB 文件校验；
* CSV 解析复用；
* 中文表头处理；
* 安全 SQLite 标识符引用；
* SQLite 会话临时表创建；
* 临时表元数据；
* ConversationTempSourceManager；
* 临时 Schema Context；
* 会话数据源状态；
* SQL 查询中文字段；
* Python DatasetResolver 支持临时 CSV；
* 图表和报告 Artifact 链路；
* 手动删除；
* TTL 清理基础实现；
* 标准 CSV 导入回归测试；
* 拖拽 CSV；
* 应用重启后恢复未过期临时数据；
* 导入进度取消；
* ChatComposer 和工具链测试。

### P1：预留接口

* 多文件 Join；
* XLSX；
* Parquet；
* 大文件分片导入；
* 多 CSV 会话数据源；
* 用户手动选择当前激活临时表；
* GBK 自动识别；
* 远端对象存储。

---

## 28. 最终输出要求

执行完成后，请输出：

1. 新增或修改的文件列表；
2. 复用的现有模块；
3. ChatComposer 修改说明；
4. CSV 文件校验实现；
5. 中文表头处理实现；
6. SQLite 临时表创建示例；
7. 会话临时数据源模型；
8. Schema Context 示例；
9. 中文字段 SQL 查询示例；
10. Python 中文列分析示例；
11. 图表工具输入示例；
12. 报告工具输入和输出示例；
13. 标准导入回归结果；
14. 数据库迁移内容；
15. 测试运行结果；
16. 未完成的 P1事项。

请直接推进实现，不要停留在设计文档。

开始前先检查当前仓库中的：

* CSV 标准导入模块；
* 表字典联合导入；
* Business Field Semantic Layer；
* `ChatComposer`；
* 附件或文件选择组件；
* SQLite Repository；
* Schema Context Builder；
* SQL Tool；
* Python DatasetResolver；
* Tool Input Resolver；
* Artifact Manager；
* 临时表清理逻辑。

优先采用增量修改，避免复制和重建已有能力。
