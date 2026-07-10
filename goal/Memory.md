# 存续期数据探针智能体｜本地 Memory 与上下文压缩模块开发

你现在是一个资深 TypeScript / Node.js / Electron / AI Agent / 本地存储 / 上下文工程工程师。围绕项目 **“存续期数据探针智能体 / Cycle Data Intelligence Agent”** 开发一个可落地、可测试、可扩展的 **“本地 Memory 与上下文压缩”** 模块。

本模块用于为智能体提供本地会话记忆、任务记忆、用户偏好记忆、数据源上下文记忆和自动上下文压缩能力，保证在多轮对话、长任务、工具调用、多版本生成、SQL 查询、Python 分析和报告生成过程中，智能体能够稳定保留关键信息，同时避免 Prompt 过长、上下文污染、重复注入和敏感信息泄露。

请直接推进实现，不要只输出方案设计。优先遵守当前项目结构，不要大规模重构无关模块。

---

## 1. 项目背景

项目名称：**存续期数据探针智能体 / Cycle Data Intelligence Agent**

项目面向银行贷款后续尽职调查、贷后管理、存续期风险监测、数据源探索、Schema Context 注入、SQL 查询审批、Python 分析、图表生成和风险报告生成等业务场景。

当前模块为：

> **本地 Memory 与上下文压缩模块 / Local Memory & Context Compression**

该模块需要支持：

1. 本地 Memory 存储；
2. 多轮会话记忆；
3. 工具调用记忆；
4. 数据源上下文记忆；
5. 用户偏好与项目配置记忆；
6. 上下文自动压缩；
7. 长会话摘要；
8. 重要事实提取；
9. 上下文注入策略；
10. 敏感信息过滤；
11. 与 Streaming Model Adapter、Schema Context、SQL Tool、Python Runner、Agent Runtime 的集成接口。

---

## 2. 模块职责边界

本模块负责：

* 本地 Memory 类型定义；
* 本地 Memory 存储适配器；
* 会话消息存储；
* 工具调用记录存储；
* 任务状态摘要存储；
* 数据源上下文摘要存储；
* 用户偏好和项目配置记忆；
* 重要事实提取；
* 长上下文压缩；
* 上下文预算控制；
* Memory 检索；
* Memory 注入；
* Memory 过期和清理；
* 敏感信息过滤；
* 上下文压缩结果审计；
* 对外 API 导出。

本模块不负责：

* 大模型底层调用；
* SQL 执行；
* Python 执行；
* 图表渲染；
* 数据源连接管理；
* 前端 UI 组件；
* 向量数据库生产级实现。

但本模块应预留接口，方便与以下模块集成：

* Streaming Model Adapter；
* Schema Context Injection；
* SQL Tool Invocation & Approval Workflow；
* Python Runner；
* Tool Registry；
* Agent Runtime；
* Report Generator；
* Electron IPC；
* Audit Log Service。

---

## 3. 推荐目录结构

请优先复用现有结构，不要重构无关模块。

---

## 4. 核心原则

请在实现中遵守以下原则：

1. **本地优先**

   * Memory 默认存储在本地；
   * 不依赖云端服务；
   * 支持 Electron 桌面客户端运行场景。

2. **最小必要注入**

   * 不把所有历史消息都塞回 Prompt；
   * 只注入与当前任务相关、最新、重要、可用的 Memory。

3. **可压缩**

   * 长会话、长工具结果、长报告草稿、长 Schema Context 需要自动压缩；
   * 压缩后保留关键事实、决策、约束、工具结果摘要和待办事项。

4. **可追溯**

   * Memory 应保留来源，例如来自用户消息、assistant 消息、工具结果、系统配置、数据源 Context；
   * 压缩摘要应能追踪原始消息或原始事件 ID。

5. **安全优先**

   * 不存储明文数据库密码、API Key、Token、连接串；
   * 敏感字段、源表原始数据、大规模查询结果不得直接进入长期 Memory；
   * 工具结果需要摘要化后再写入 Memory。

6. **可替换存储**

   * P0 可使用 SQLite / 文件 JSON / IndexedDB 风格适配器；
   * 接口应支持后续替换为 SQLite、向量库。

7. **不大规模重构**

   * 优先遵守当前项目结构；
   * 尽量通过 adapter 和接口接入现有模块。

---

## 5. Memory 类型设计

请实现清晰的 TypeScript 类型。

### 5.1 MemoryScope

```ts id="memory-scope"
export type MemoryScope =
  | 'conversation'
  | 'project'
  | 'user'
  | 'data_source'
  | 'tool'
  | 'report'
  | 'system';
```

### 5.2 MemoryType

```ts id="memory-type"
export type MemoryType =
  | 'message'
  | 'summary'
  | 'fact'
  | 'preference'
  | 'decision'
  | 'task_state'
  | 'tool_result_summary'
  | 'schema_context_summary'
  | 'sql_result_summary'
  | 'python_result_summary'
  | 'report_version_summary'
  | 'warning'
  | 'todo';
```

### 5.3 LocalMemoryRecord

```ts id="memory-record"
export type LocalMemoryRecord = {
  memoryId: string;
  scope: MemoryScope;
  type: MemoryType;
  title?: string;
  content: string;
  structured?: Record<string, unknown>;
  tags?: string[];
  importance: number;
  confidence?: number;
  source: MemorySource;
  visibility: MemoryVisibility;
  retention: MemoryRetentionPolicy;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  lastAccessedAt?: string;
  accessCount?: number;
  metadata?: Record<string, unknown>;
};
```

### 5.4 MemorySource

```ts id="memory-source"
export type MemorySource = {
  sourceType:
    | 'user_message'
    | 'assistant_message'
    | 'tool_call'
    | 'tool_result'
    | 'schema_context'
    | 'sql_execution'
    | 'python_execution'
    | 'report_generation'
    | 'manual'
    | 'system';
  conversationId?: string;
  messageId?: string;
  toolCallId?: string;
  requestId?: string;
  executionId?: string;
  dataSourceId?: string;
  versionId?: string;
};
```

### 5.5 MemoryVisibility

```ts id="memory-visibility"
export type MemoryVisibility =
  | 'private'
  | 'project'
  | 'session'
  | 'temporary'
  | 'system';
```

### 5.6 MemoryRetentionPolicy

```ts id="retention-policy"
export type MemoryRetentionPolicy = {
  mode: 'ephemeral' | 'session' | 'project' | 'persistent';
  ttlMs?: number;
  allowCompression: boolean;
  allowDeletion: boolean;
  allowPromptInjection: boolean;
};
```

---

## 6. 上下文压缩类型设计

### 6.1 ContextItem

```ts id="context-item"
export type ContextItem = {
  itemId: string;
  type:
    | 'system_instruction'
    | 'user_message'
    | 'assistant_message'
    | 'tool_result'
    | 'schema_context'
    | 'memory'
    | 'report_draft'
    | 'version'
    | 'approval_state'
    | 'task_state';
  content: string;
  priority: number;
  tokenEstimate?: number;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};
```

### 6.2 ContextBudget

```ts id="context-budget"
export type ContextBudget = {
  maxChars: number;
  maxItems?: number;
  reservedCharsForSystem?: number;
  reservedCharsForUserQuestion?: number;
  reservedCharsForTools?: number;
  reservedCharsForMemory?: number;
  reservedCharsForSchema?: number;
  reservedCharsForRecentMessages?: number;
};
```

### 6.3 CompressedContext

```ts id="compressed-context"
export type CompressedContext = {
  contextId: string;
  conversationId?: string;
  originalItemCount: number;
  compressedItemCount: number;
  originalChars: number;
  compressedChars: number;
  summary: string;
  retainedItems: ContextItem[];
  droppedItems: ContextItem[];
  memoryRefs: string[];
  warnings: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
};
```

---

## 7. 本地 Memory 存储设计

请实现 `LocalMemoryStore` 接口。

### 7.1 接口定义

```ts id="local-memory-store"
export type LocalMemoryStore = {
  create(record: LocalMemoryRecord): Promise<LocalMemoryRecord>;
  update(memoryId: string, patch: Partial<LocalMemoryRecord>): Promise<LocalMemoryRecord>;
  get(memoryId: string): Promise<LocalMemoryRecord | null>;
  delete(memoryId: string): Promise<void>;
  search(query: MemorySearchQuery): Promise<MemorySearchResult[]>;
  listByConversation(conversationId: string): Promise<LocalMemoryRecord[]>;
  listByProject(projectId: string): Promise<LocalMemoryRecord[]>;
  cleanup(input?: MemoryCleanupInput): Promise<MemoryCleanupResult>;
};
```

### 7.2 Search Query

```ts id="memory-search"
export type MemorySearchQuery = {
  text?: string;
  scope?: MemoryScope[];
  type?: MemoryType[];
  tags?: string[];
  conversationId?: string;
  projectId?: string;
  dataSourceId?: string;
  limit?: number;
  minImportance?: number;
  includeExpired?: boolean;
};
```

### 7.3 Search Result

```ts id="memory-search-result"
export type MemorySearchResult = {
  record: LocalMemoryRecord;
  score: number;
  reason: string;
};
```

### 7.4 P0 存储实现

P0 请至少实现一个本地内存存储或文件存储：

* `InMemoryLocalMemoryStore`：用于测试和 MVP；
* 如项目已有 SQLite，本模块可实现 `SQLiteLocalMemoryStore`；
* 如果当前项目结构已有本地数据库层，请优先复用。

---

## 8. Memory 写入策略

请实现 `MemoryWriter` 或 `MemoryManager.writeMemory`。

### 8.1 可写入 Memory 的内容

支持写入：

* 用户明确要求记住的偏好；
* 当前任务目标；
* 当前报告版本摘要；
* 工具调用结果摘要；
* SQL 查询结果摘要；
* Python 分析结果摘要；
* Schema Context 摘要；
* 已确认的业务规则；
* 用户选择的版本；
* 用户审批状态；
* 风险分析中的重要发现；
* 未完成事项。

### 8.2 默认不写入长期 Memory 的内容

默认不写入：

* 明文数据库密码；
* API Key；
* Token；
* 完整连接串；
* 大规模源表数据；
* 完整 SQL 查询结果；
* 完整 Python stdout；
* 未脱敏敏感字段；
* 临时错误堆栈；
* 低价值寒暄内容；
* 与项目无关的闲聊。

### 8.3 写入 API

```ts id="write-api"
export type WriteMemoryInput = {
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  title?: string;
  structured?: Record<string, unknown>;
  tags?: string[];
  importance?: number;
  source: MemorySource;
  visibility?: MemoryVisibility;
  retention?: Partial<MemoryRetentionPolicy>;
};
```

---

## 9. Memory 检索策略

请实现 `MemoryRetriever`。

### 9.1 检索因素

检索排序应考虑：

* 与当前用户问题的文本相关性；
* conversationId 匹配；
* projectId 匹配；
* dataSourceId 匹配；
* Memory 类型；
* Memory 重要性；
* Memory 新鲜度；
* 是否允许注入 Prompt；
* 是否过期；
* 是否敏感。

### 9.2 排序策略

P0 可实现简单加权打分：

```text id="ranking-rule"
score = textSimilarityScore * 0.4
      + importanceScore * 0.25
      + recencyScore * 0.2
      + scopeMatchScore * 0.15
```

不要求引入向量库，但需预留 embedding retriever 接口。

### 9.3 检索 API

```ts id="retrieve-api"
export type RetrieveMemoryInput = {
  conversationId?: string;
  projectId?: string;
  dataSourceIds?: string[];
  userQuestion?: string;
  purpose?:
    | 'chat'
    | 'sql_generation'
    | 'python_analysis'
    | 'report_generation'
    | 'risk_analysis'
    | 'context_compression';
  limit?: number;
  maxChars?: number;
};
```

---

## 10. 上下文压缩策略

请实现 `ContextCompressor`。

### 10.1 压缩输入

```ts id="compress-input"
export type CompressContextInput = {
  conversationId?: string;
  userQuestion?: string;
  items: ContextItem[];
  budget: ContextBudget;
  compressionMode?: 'lossless_priority' | 'summary' | 'hybrid';
  preserveTypes?: ContextItem['type'][];
};
```

### 10.2 压缩模式

#### 1. lossless_priority

* 不生成摘要；
* 按优先级、相关性和新鲜度保留 item；
* 超预算时删除低优先级 item；
* 适合工具定义、系统约束、短上下文。

#### 2. summary

* 将长内容压缩成摘要；
* 保留关键事实、约束、决策、工具结果；
* 适合长对话、长报告草稿、长工具结果。

#### 3. hybrid

* 高优先级内容原样保留；
* 中优先级内容摘要；
* 低优先级内容丢弃；
* 默认推荐使用 hybrid。

### 10.3 必须优先保留的内容

压缩时必须优先保留：

* 当前用户问题；
* system instruction；
* 安全约束；
* 工具调用规则；
* 审批状态；
* 最近若干轮对话；
* 用户明确指定的要求；
* 当前任务目标；
* 已选中的报告版本；
* SQL / Python 执行的结果摘要；
* 与当前问题强相关的 Schema Context；
* 用户未解决的问题和待办事项。

### 10.4 可优先压缩的内容

可优先压缩：

* 较早的普通对话；
* 长工具结果；
* 重复的 Schema 字段列表；
* 中间草稿；
* 未选中的旧版本；
* 大量样例数据；
* 冗余解释文本。

### 10.5 必须删除或禁止注入的内容

不得注入：

* 数据库密码；
* API Key；
* Token；
* 明文连接串；
* 未脱敏敏感字段原值；
* 大规模源表数据；
* 完整 SQL 查询结果；
* 完整 Python stdout；
* 用户无权限访问的数据；
* 已过期且不允许注入的 Memory。

---

## 11. 上下文组装器

请实现 `ContextAssembler`。

该模块负责把以下内容组合成最终可传给模型的 Prompt Context：

* System Instruction；
* 当前用户消息；
* 最近消息；
* 检索到的 Memory；
* Schema Context；
* 工具定义说明；
* SQL / Python 结果摘要；
* 当前任务状态；
* 报告版本摘要；
* 审批状态；
* 安全策略说明。

### 11.1 API

```ts id="assemble-api"
export type AssembleContextInput = {
  conversationId: string;
  projectId?: string;
  userQuestion: string;
  systemInstruction?: string;
  recentMessages?: ContextItem[];
  schemaContextItems?: ContextItem[];
  toolContextItems?: ContextItem[];
  taskStateItems?: ContextItem[];
  budget: ContextBudget;
  purpose:
    | 'chat'
    | 'sql_generation'
    | 'python_analysis'
    | 'report_generation'
    | 'risk_analysis';
};
```

### 11.2 输出

```ts id="assemble-output"
export type AssembleContextOutput = {
  contextId: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  compressedContext: CompressedContext;
  injectedMemoryIds: string[];
  warnings: string[];
  createdAt: string;
};
```

---

## 12. 敏感信息过滤

请实现 `SensitiveMemoryFilter`。

### 12.1 需要识别并过滤的内容

至少包括：

* API Key；
* Token；
* Bearer Token；
* 数据库连接串；
* 数据库密码；
* URL 中的账号密码；
* SSH 私钥；
* `.env` 内容；
* 身份证号；
* 手机号；
* 银行卡号；
* 邮箱，当前可配置是否脱敏；
* 大量源表行数据，当前可通过结构判断。

### 12.2 过滤策略

支持：

* `mask`：脱敏；
* `drop`：删除；
* `block`：阻止写入；
* `warn`：允许写入但生成 warning。

### 12.3 API

```ts id="filter-api"
export type SensitiveFilterResult = {
  safeContent: string;
  action: 'none' | 'masked' | 'dropped' | 'blocked';
  issues: Array<{
    type: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    message: string;
  }>;
};
```

---

## 13. Memory 压缩器

请实现 `MemoryCompressor`。

### 13.1 用途

当同一会话 Memory 数量过多或内容过长时，将多个 Memory 压缩成摘要 Memory。

### 13.2 压缩对象

可压缩：

* 多轮历史消息；
* 多个工具结果摘要；
* 多个报告版本摘要；
* 多个数据源 Context 摘要；
* 多个风险分析中间结论。

### 13.3 输出

```ts id="memory-compress-output"
export type MemoryCompressionResult = {
  compressedMemory: LocalMemoryRecord;
  sourceMemoryIds: string[];
  droppedMemoryIds: string[];
  warnings: string[];
};
```

P0 可以使用规则式摘要，不强制调用大模型。可预留 `SummarizerAdapter`，后续接入模型摘要。

---

## 14. 对外 API 设计

请实现清晰的 TypeScript API。

建议暴露：

```ts id="public-api"
createLocalMemoryModule(config)

memory.writeMemory(input)
memory.getMemory(memoryId)
memory.updateMemory(memoryId, patch)
memory.deleteMemory(memoryId)
memory.searchMemory(query)
memory.retrieveForContext(input)
memory.compressContext(input)
memory.assembleContext(input)
memory.compressMemories(input)
memory.cleanup(input)
```

### 14.1 模块配置

```ts id="module-config"
export type LocalMemoryModuleConfig = {
  store?: LocalMemoryStore;
  defaultContextBudget: ContextBudget;
  sensitiveFilterEnabled: boolean;
  summarizerAdapter?: MemorySummarizerAdapter;
  embeddingRetriever?: MemoryEmbeddingRetriever;
  maxMemoryRecordsPerConversation?: number;
  maxMemoryCharsPerConversation?: number;
  enableAutoCompression?: boolean;
};
```

### 14.2 SummarizerAdapter 预留

```ts id="summarizer-adapter"
export type MemorySummarizerAdapter = {
  summarize(input: {
    content: string;
    purpose: string;
    maxChars: number;
  }): Promise<{
    summary: string;
    warnings: string[];
  }>;
};
```

### 14.3 EmbeddingRetriever 预留

```ts id="embedding-retriever"
export type MemoryEmbeddingRetriever = {
  search(input: {
    query: string;
    limit: number;
    filters?: Record<string, unknown>;
  }): Promise<MemorySearchResult[]>;
};
```

---

## 15. 错误处理

请设计统一错误类型。

```ts id="error-codes"
export type LocalMemoryErrorCode =
  | 'MEMORY_NOT_FOUND'
  | 'MEMORY_WRITE_BLOCKED'
  | 'MEMORY_UPDATE_FAILED'
  | 'MEMORY_DELETE_FAILED'
  | 'MEMORY_SEARCH_FAILED'
  | 'MEMORY_COMPRESSION_FAILED'
  | 'CONTEXT_COMPRESSION_FAILED'
  | 'CONTEXT_BUDGET_EXCEEDED'
  | 'SENSITIVE_CONTENT_BLOCKED'
  | 'STORE_UNAVAILABLE'
  | 'UNKNOWN_ERROR';
```

要求：

* 所有错误结构化；
* 不暴露敏感内容；
* 压缩失败时应尽量返回未压缩但已过滤的安全内容；
* 单条 Memory 写入失败不应影响整个会话；
* 搜索失败应返回空结果和 warning，而不是中断主流程。

---

## 16. 测试要求

请补充测试用例。优先使用 Vitest。如果项目已有测试框架，请遵守现有测试框架。

### 16.1 LocalMemoryStore 测试

覆盖：

* create；
* update；
* get；
* delete；
* search；
* listByConversation；
* cleanup；
* expired memory 不默认返回。

### 16.2 MemoryManager 测试

覆盖：

* 写入会话 Memory；
* 写入项目 Memory；
* 写入工具结果摘要；
* 阻止写入敏感内容；
* 自动生成默认 retention；
* update 和 delete；
* 搜索 Memory。

### 16.3 MemoryRetriever 测试

覆盖：

* 按文本相关性检索；
* 按 conversationId 检索；
* 按 projectId 检索；
* 按 dataSourceId 检索；
* 按 importance 排序；
* 过滤过期 Memory；
* 过滤不允许注入的 Memory。

### 16.4 SensitiveMemoryFilter 测试

覆盖：

* API Key 脱敏；
* Bearer Token 脱敏；
* 数据库连接串脱敏；
* 密码字段脱敏；
* 手机号脱敏；
* 身份证号脱敏；
* 银行卡号脱敏；
* SSH 私钥阻断；
* 大量源表数据阻断或 warning。

### 16.5 ContextCompressor 测试

覆盖：

* lossless_priority 模式；
* summary 模式；
* hybrid 模式；
* 保留 system instruction；
* 保留当前用户问题；
* 保留安全约束；
* 保留最近消息；
* 保留高优先级 Memory；
* 删除低优先级 item；
* 压缩长工具结果；
* 不注入敏感内容；
* 输出 droppedItems 和 warnings。

### 16.6 ContextAssembler 测试

覆盖：

* 组装聊天上下文；
* 组装 SQL 生成上下文；
* 组装 Python 分析上下文；
* 组装报告生成上下文；
* 注入 Memory；
* 注入 Schema Context；
* 注入工具说明；
* 超预算时自动压缩；
* 输出 messages 格式正确。

---

## 17. 实现约束

请遵守以下约束：

1. 优先使用 TypeScript；
2. 保持模块可独立测试；
3. 不要依赖具体 UI；
4. 不要依赖云端服务；
5. P0 不强制引入向量库；
6. 不要存储明文密钥、Token、数据库密码、连接串；
7. 不要把完整源表数据写入长期 Memory；
8. 不要把完整 SQL 查询结果写入长期 Memory；
9. 不要把完整 Python stdout 写入长期 Memory；
10. Memory 注入 Prompt 前必须经过敏感信息过滤；
11. 上下文压缩不能删除 system instruction 和安全约束；
12. 所有公开 API 应从 `index.ts` 导出；
13. 如果项目已有 lint / format / test 规范，请遵守；
14. 优先遵守当前项目结构，不要大规模重构无关模块；
15. 如发现已有 `model-adapter`、`schema-context`、`sql-tool`、`python-runner`、`tool-registry`、`data-source`、`audit` 模块，请复用其类型与接口；
16. 完成后运行类型检查和测试，如环境允许。

---

## 18. 验收标准

完成后应满足以下标准：

1. 可以创建、更新、查询、删除本地 Memory；
2. 可以按会话、项目、数据源和文本相关性检索 Memory；
3. 可以写入用户偏好、任务状态、工具结果摘要、数据源摘要和报告版本摘要；
4. 可以阻止或脱敏敏感信息；
5. 可以根据上下文预算自动压缩上下文；
6. 可以保留 system instruction、安全约束、当前用户问题和最近消息；
7. 可以将 Memory、Schema Context、工具说明、任务状态组合成模型 messages；
8. 可以输出压缩详情，包括保留项、删除项、摘要、warnings；
9. 可以对长会话进行 Memory 压缩；
10. 不会把完整源表数据、完整 SQL 查询结果、完整 Python stdout 注入模型；
11. 有基础测试覆盖；
12. 模块可与 Streaming Model Adapter、Schema Context Injection、SQL Tool、Python Runner、Agent Runtime 对接。

---

## 19. 开发优先级

请按以下优先级实现。

### P0：必须完成

* 类型定义；
* InMemoryLocalMemoryStore；
* MemoryManager；
* MemoryWriter；
* MemoryRetriever；
* SensitiveMemoryFilter；
* ContextBudget；
* ContextCompressor；
* ContextAssembler；
* MemoryCompressor 规则式实现；
* 统一错误类型；
* 基础测试；
* SQLiteLocalMemoryStore；
* 自动 Memory 压缩；
* 按 purpose 的上下文组装策略；
* 长工具结果摘要策略；
* 报告版本摘要策略；
* 与现有 Agent Runtime 类型对齐；
* 与 Streaming Model Adapter 消息类型对齐;
* index.ts 导出。

### P1：预留接口

* 向量检索；
* embedding 召回；
* LLM 摘要压缩；
* Memory 可视化管理；
* Memory 手动编辑；
* Memory 导入导出；
* 多项目隔离；
* 多用户隔离；
* 加密存储；
* 与审计系统深度集成；
* 与 Electron IPC 深度集成。

---

## 20. 请最终输出

执行完成后，请输出：

1. 新增或修改的文件列表；
2. 核心 API 使用示例；
3. 写入 Memory 示例；
4. 检索 Memory 示例；
5. 上下文压缩示例；
6. 上下文组装示例；
7. 敏感信息过滤示例；
8. 测试运行结果；
9. 尚未完成或需要后续补充的事项。

请直接推进实现，不要停留在设计文档。请优先遵守当前仓库目录结构，不要大规模重构无关模块；如发现已有 `model-adapter`、`schema-context`、`sql-tool`、`python-runner`、`tool-registry`、`data-source`、`audit` 模块，请复用其类型与接口。
