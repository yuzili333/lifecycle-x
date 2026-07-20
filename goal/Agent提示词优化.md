# 存续期数据探针智能体｜Agent 提示词与 `#字段` 上下文性能优化

你现在是一个资深 TypeScript / Electron / AI Agent / Prompt Engineering / Context Engineering / Tool Calling 工程师。围绕项目 **“存续期数据探针智能体 / Cycle Data Intelligence Agent”** 优化现有的 **Agent 提示词、Schema Context 和 Workflow Context**。

当前项目已经支持：

1. 用户在 ChatComposer 中上传 CSV 文件；
2. CSV 文件写入客户端 SQLite 会话临时表；
3. 用户通过快捷指令 `#` 选择当前 CSV 数据源中的字段；
4. 已选择字段通过 `ChatTokenizedText` 展示；
5. 消息元数据中保存结构化 `selectedFieldRefs`；
6. SQL 查询、Python 分析、图表绘制和报告生成工具可使用这些字段；
7. 临时 CSV 表字段可以是中文、英文或中英文混合。

新增 `#字段` 能力后，智能体对话耗时出现明显增长。初步怀疑现有提示词和上下文存在以下冗余行为：

* 大模型收到 `#字段` 后，仍然扫描和比较全表字段；
* 重复验证 `#字段` 是否存在于全量 Schema；
* 重复执行中文字段、英文物理字段和业务字段 ID 的映射；
* 将全部表字段和已选字段同时注入上下文；
* 要求模型判断快捷字段与全表字段是否匹配；
* Workflow Context 重复描述 Schema Context；
* 系统提示词同时包含互相冲突的字段选择和字段探索规则；
* 工具参数生成前进行了不必要的字段候选推理；
* 上下文体积增大，导致模型输入 Token、推理路径和工具调用耗时明显上升。

本次任务需要在不降低字段准确性和工具调用安全性的前提下，缩短模型推理链路，提高意图识别、工具选择和工具参数生成速度。

请直接检查当前仓库并推进实现，不要只输出方案设计。

请优先遵守当前项目结构，复用现有 ChatComposer、Schema Context Builder、Workflow Context Builder、Tool Input Resolver、Streaming Model Adapter 和工具调用协议，不要大规模重构无关模块。

---

## 1. 核心目标

请完成以下目标：

1. 明确定义 `#字段` 的语义；
2. 将 `#字段` 视为客户端已解析的结构化字段引用；
3. 大模型无需重新搜索全表字段；
4. 大模型无需比较快捷字段与全表字段的映射关系；
5. 大模型无需将 `#字段` 与中文别名、英文别名或业务字段 ID 重新匹配；
6. 删除系统提示词中要求模型重复验证字段映射的内容；
7. 当用户选择了 `#字段` 时，Schema Context 默认只注入这些字段；
8. 不再同时注入无关的全表字段列表；
9. Workflow Context 只引用字段选择结果，不重复字段详情；
10. 工具调用参数直接使用结构化字段引用；
11. SQL 工具获得真实表名、物理字段名和安全引用名；
12. Python 工具获得真实数据集字段名；
13. 图表和报告工具获得字段展示名称及上游 Artifact；
14. 保留字段不存在、字段过期和数据源失效的确定性客户端校验；
15. 字段有效性校验由程序完成，不由大模型重复完成；
16. 未选择 `#字段` 时，继续支持现有字段探索流程；
17. 缩小提示词和上下文体积；
18. 减少不必要的大模型推理步骤；
19. 提升工具选择与工具入参准确度；
20. 通过测试或埋点验证优化前后的输入规模和响应耗时变化。

---

## 2. `#字段` 的准确语义

请将 `#字段` 定义为：

> 用户通过 ChatComposer 的字段选择菜单，从当前已激活数据源中明确选择的、已经由客户端验证存在的字段引用。

`#字段` 的作用是：

1. 帮助用户在自然语言描述中准确引用真实字段；
2. 避免用户手动输入错误字段名称；
3. 告诉 Agent 当前字段是数据源中的可用字段；
4. 为工具调用提供明确、结构化的字段参数；
5. 缩小本轮分析所需的字段范围。

`#字段` 不表示：

* 需要模型搜索字段；
* 需要模型翻译字段；
* 需要模型重新识别业务语义映射；
* 需要模型将其与全表字段逐一比较；
* 需要模型确认字段是否真实存在；
* 需要模型根据字段名推断物理字段；
* 需要模型重新生成字段候选列表。

---

## 3. 快捷字段与全表字段的边界

### 3.1 快捷字段

快捷字段来自结构化消息元数据：

```ts
export type SelectedFieldRef = {
  tokenId: string;

  dataSourceId: string;
  tableId: string;
  physicalTableName: string;

  fieldId: string;
  sourceHeader: string;
  physicalName: string;
  quotedPhysicalName: string;
  displayName: string;

  logicalType: string;
  sqliteType: string;

  status: 'valid' | 'expired' | 'missing';
};
```

客户端发送消息前已经完成：

* 数据源存在性校验；
* 临时表存在性校验；
* 字段存在性校验；
* 会话权限校验；
* 字段状态校验；
* SQLite 标识符安全引用；
* Token 与字段引用绑定。

因此，大模型可以直接信任状态为：

```text
valid
```

的字段引用。

### 3.2 全表字段

全表字段仅用于以下场景：

1. 用户未通过 `#` 选择字段；
2. 用户要求查找可用字段；
3. 用户要求自动探索表结构；
4. 已选字段不足以完成当前任务；
5. 工具执行返回明确的字段缺失错误；
6. 用户要求关联、筛选或计算其他字段。

### 3.3 禁止默认执行的行为

当存在有效 `selectedFieldRefs` 时，不应默认：

```text
读取全表 Schema
→ 遍历全部字段
→ 比较快捷字段
→ 计算名称相似度
→ 判断字段匹配关系
→ 再生成工具参数
```

应直接：

```text
读取 selectedFieldRefs
→ 理解用户业务意图
→ 选择工具
→ 使用结构化字段构建工具参数
```

---

## 4. 推荐处理链路

### 4.1 优化前的低效链路

```text
用户输入 #字段
→ 注入全部表字段
→ 注入 selectedFieldRefs
→ 模型搜索全表字段
→ 模型比较中英文名称
→ 模型检查映射关系
→ 模型确认字段存在
→ 模型选择工具
→ 模型生成参数
```

### 4.2 优化后的链路

```text
用户输入 #字段
→ 客户端校验 selectedFieldRefs
→ 仅注入选中字段上下文
→ 模型理解用户意图
→ 模型选择工具
→ 直接使用字段引用生成工具参数
```

### 4.3 字段不足时

```text
模型发现当前任务需要其他字段
→ 返回 missing_required_field
→ Agent 引导用户通过 # 选择额外字段
```

不要让模型自行展开全表字段并选择。

---

## 5. 推荐目录与修改范围

请先检查当前项目结构并增量修改。

重点检查：

```text
src/
  ai/
    prompts/
      system-prompt.ts
      agent-prompt-builder.ts
      tool-prompt-builder.ts

    schema-context/
      schema-context-builder.ts
      selected-field-context-builder.ts

    workflow/
      workflow-context-builder.ts
      workflow-runtime.ts

    tool-orchestration/
      tool-input-resolver.ts
      tool-intent-router.ts
      tool-plan-builder.ts

    context/
      context-assembler.ts
      context-budget.ts

  renderer/
    components/
      chat/
        ChatComposer.tsx
        ChatTokenizedText.tsx
```

如已有类似模块，请在原模块内修改，不要新建重复的 Prompt Builder 或 Context Builder。

---

## 6. 消息输入结构

请确保 Agent 接收到结构化消息，而不是只接收含 `#字段` 的纯文本。

```ts
export type AgentUserMessage = {
  conversationId: string;
  messageId: string;
  content: string;

  context: {
    activeDataSourceId?: string;
    activeTableId?: string;

    selectedFieldRefs?: SelectedFieldRef[];

    selectedSkillIds?: string[];
    selectedArtifactIds?: string[];
  };
};
```

示例：

```json
{
  "content": "分析 #五级分类 和 #贷款余额 的分布，并绘制图表",
  "context": {
    "activeDataSourceId": "temp_ds_001",
    "activeTableId": "temp_table_001",
    "selectedFieldRefs": [
      {
        "fieldId": "field_03",
        "displayName": "五级分类",
        "physicalName": "五级分类",
        "quotedPhysicalName": "\"五级分类\"",
        "logicalType": "category",
        "sqliteType": "TEXT",
        "status": "valid"
      },
      {
        "fieldId": "field_04",
        "displayName": "贷款余额",
        "physicalName": "贷款余额",
        "quotedPhysicalName": "\"贷款余额\"",
        "logicalType": "decimal",
        "sqliteType": "NUMERIC",
        "status": "valid"
      }
    ]
  }
}
```

模型不得从 `content` 字符串中重新解析并猜测字段元数据。

---

## 7. 系统提示词优化

请重写或精简当前 Agent 系统提示词中关于 `#字段` 的内容。

### 7.1 推荐系统提示词

```text
你是 Cycle Probe 数据分析智能体，负责理解用户的数据查询、数据分析、图表绘制和报告生成需求，并选择适当的工具执行。

用户消息可能包含通过“#”快捷选择的字段。系统会在 selectedFieldRefs 中提供这些字段的结构化信息。

关于 selectedFieldRefs：

1. selectedFieldRefs 中 status=valid 的字段已由客户端确认存在于当前数据源中。
2. 这些字段是用户本轮明确选择并希望引用的字段。
3. 你无需重新搜索全表字段。
4. 你无需比较这些字段与全表字段的名称或映射关系。
5. 你无需翻译、改写或猜测这些字段的物理名称。
6. 生成 SQL 时直接使用 physicalTableName 和 quotedPhysicalName。
7. 生成 Python 分析参数时使用 physicalName 或数据集中的真实字段名。
8. 生成图表和报告时使用 displayName 作为用户可见名称。
9. 不得把 displayName 当作 SQL 字段名，除非它与 physicalName 相同。
10. 当 selectedFieldRefs 足以满足用户需求时，不要加载或分析全量 Schema。
11. 当 selectedFieldRefs 不足以完成任务时，明确指出缺少的字段用途，并引导用户通过“#”继续选择字段。
12. 不要自行从未选择的全表字段中补充关键字段。
13. 不得编造不存在的字段、数据或工具结果。

工具选择：

- 精确查询、筛选、聚合、排序和关联数据：调用 SQL 查询工具。
- 对查询结果执行统计、趋势、相关性或异常分析：调用 Python 分析工具。
- 将 SQL 或 Python 结果可视化：调用图表工具。
- 基于真实查询、分析和图表结果生成完整 Markdown 报告：调用报告工具。

如果用户明确选择了字段，应优先围绕这些字段理解需求和构建工具参数。
```

### 7.2 删除或改写的混淆提示词

请检查并删除类似以下内容：

```text
将 #字段 与数据库完整字段清单进行匹配。
```

```text
根据字段中文名查找对应英文物理字段。
```

```text
验证快捷字段是否存在于 Schema Context。
```

```text
遍历所有表字段，选择与用户快捷字段最相似的字段。
```

```text
如果快捷字段和全表字段名称不同，推断其映射关系。
```

```text
对 selectedFieldRefs 再执行 BusinessFieldResolver。
```

`BusinessFieldResolver` 仅用于标准业务语义映射场景，不应对已经选中的临时 CSV 快捷字段重复执行。

---

## 8. Schema Context 优化

请区分两种 Schema Context 模式：

```ts
export type SchemaContextMode =
  | 'selected_fields'
  | 'full_schema'
  | 'schema_summary';
```

### 8.1 selected_fields 模式

当：

```ts
selectedFieldRefs.length > 0
```

时默认使用。

只注入：

* 当前数据源 ID；
* 当前表 ID；
* 当前物理表名；
* 已选字段；
* 字段物理名称；
* 字段安全引用名称；
* 字段显示名称；
* 字段逻辑类型；
* 必要的少量说明。

示例：

```markdown
## 本轮已选字段

数据源：风险分类数据.csv
数据表：chat_csv_8fa31c

| 显示名称 | SQL字段引用 | 逻辑类型 |
|---|---|---|
| 五级分类 | "五级分类" | category |
| 贷款余额 | "贷款余额" | decimal |

以上字段已经由客户端确认存在。无需再与全表字段清单匹配。
```

结构化数据：

```ts
export type SelectedFieldsSchemaContext = {
  mode: 'selected_fields';

  dataSourceId: string;
  tableId: string;
  physicalTableName: string;
  quotedTableName: string;

  fields: Array<{
    fieldId: string;
    displayName: string;
    physicalName: string;
    quotedPhysicalName: string;
    logicalType: string;
    sqliteType: string;
  }>;
};
```

### 8.2 full_schema 模式

仅在以下情况使用：

* 没有选中字段；
* 用户明确要求查看字段；
* 用户要求自动识别字段；
* 当前 Skill 要求字段解析；
* 工作流确实需要未选择字段。

### 8.3 schema_summary 模式

用于仅需要了解表规模和数据类型概况，但不需要所有字段的情况。

### 8.4 禁止重复注入

当使用 `selected_fields` 模式时，不要同时注入：

* 完整字段列表；
* 字段别名列表；
* Business Field Semantic Layer 全量字典；
* 全量字段样例；
* 所有候选字段；
* 无关表结构。

---

## 9. Schema Context Builder 路由

请实现明确路由：

```ts
export function resolveSchemaContextMode(input: {
  selectedFieldRefs?: SelectedFieldRef[];
  requiresFullSchema?: boolean;
  userRequestedFieldDiscovery?: boolean;
}): SchemaContextMode {
  if (
    input.selectedFieldRefs?.length &&
    !input.requiresFullSchema &&
    !input.userRequestedFieldDiscovery
  ) {
    return 'selected_fields';
  }

  if (input.requiresFullSchema || input.userRequestedFieldDiscovery) {
    return 'full_schema';
  }

  return 'schema_summary';
}
```

不要让大模型决定是否注入完整 Schema。应由程序根据当前工作流状态确定。

---

## 10. Workflow Context 优化

Workflow Context 只负责描述当前工作流状态，不应复制 Schema Context。

### 10.1 推荐内容

```ts
export type OptimizedWorkflowContext = {
  workflowId?: string;
  status: string;

  currentGoal: string;
  activeDataSourceId?: string;
  activeDatasetId?: string;

  selectedFieldIds: string[];
  selectedFieldDisplayNames: string[];

  latestSuccessfulTool?: {
    toolKind: string;
    toolCallId: string;
    artifactIds: string[];
  };

  pendingAction?: string;
  missingInputs?: string[];
};
```

### 10.2 Workflow Context 示例

```markdown
## 当前工作流

目标：分析风险分类与贷款余额分布并绘制图表
状态：准备执行
本轮选中字段：五级分类、贷款余额
当前数据源：风险分类数据.csv
尚无工具执行结果
```

不要重复注入：

```markdown
五级分类的 physicalName 是……
贷款余额的 sqliteType 是……
所有表字段包括……
```

这些内容已经由 Schema Context 提供。

### 10.3 删除冗余内容

请删除 Workflow Context 中的：

* 完整表字段；
* 字段匹配候选；
* 中英文映射说明；
* 字段别名；
* 重复 Schema；
* 重复工具描述；
* 与当前工作流无关的历史字段。

---

## 11. Context Assembler 优化

请调整 Context Assembler 的注入顺序：

```text
1. 精简系统提示词
2. 当前用户消息
3. selected_fields Schema Context
4. 当前 Workflow Context
5. 本轮可用工具定义
6. 必要的最近工具结果摘要
```

避免：

```text
系统提示词
+ 完整 Schema
+ selected fields
+ Workflow 完整 Schema
+ Memory 中旧 Schema
+ 工具描述中的字段规则
```

### 11.1 去重规则

请实现或扩展上下文去重：

```ts
export type ContextSectionKey =
  | 'system'
  | 'user_message'
  | 'selected_fields'
  | 'full_schema'
  | 'workflow'
  | 'tools'
  | 'memory'
  | 'tool_results';
```

规则：

* `selected_fields` 与 `full_schema` 默认互斥；
* Workflow 不得包含字段详情；
* Memory 中同一数据源旧 Schema 不注入；
* 工具描述不重复系统提示词中的字段规则；
* 同一字段只出现一次结构化定义。

---

## 12. 工具选择优化

模型只需要识别业务动作，不需要重新解析字段映射。

### 12.1 SQL 查询

用户：

```text
按 #五级分类 统计 #贷款余额 的分布。
```

应直接识别：

```json
{
  "tool": "request_sql_query_execution",
  "intent": "group_and_aggregate",
  "fields": {
    "dimension": "field_03",
    "measure": "field_04"
  }
}
```

Tool Input Resolver 再将字段 ID 解析为：

```json
{
  "table": "\"chat_csv_8fa31c\"",
  "dimension": "\"五级分类\"",
  "measure": "\"贷款余额\""
}
```

不要要求模型在工具参数中再次输出完整字段元数据。

### 12.2 Python 分析

模型工具参数可以引用：

```json
{
  "selectedFieldIds": ["field_03", "field_04"],
  "analysisGoal": "分析五级分类和贷款余额的分布"
}
```

程序负责从消息上下文解析真实字段。

### 12.3 图表工具

```json
{
  "sourceArtifactId": "artifact_sql_001",
  "dimensionFieldId": "field_03",
  "measureFieldId": "field_04",
  "businessSemantic": "risk_distribution"
}
```

### 12.4 报告工具

报告工具应主要使用：

* SQL Artifact；
* Python Artifact；
* 图表 Artifact；
* 字段显示名称。

不需要重新读取全表字段。

---

## 13. Tool Input Resolver 优化

请将字段解析从模型推理转为确定性程序逻辑。

```ts
export type ToolSelectedFieldInput = {
  fieldId: string;
  role?:
    | 'dimension'
    | 'measure'
    | 'filter'
    | 'group'
    | 'sort'
    | 'label';
};
```

解析：

```ts
export function resolveSelectedToolFields(
  requestedFields: ToolSelectedFieldInput[],
  selectedFieldRefs: SelectedFieldRef[]
): ResolvedToolField[] {
  // 根据 fieldId 精确匹配，不进行模糊名称匹配
}
```

必须：

* 使用 `fieldId` 精确匹配；
* 不使用 displayName 模糊匹配；
* 不遍历全表字段；
* 字段缺失时返回结构化错误；
* 不允许同名字段静默替代。

---

## 14. 工具提示词精简

四个工具描述中删除重复字段验证要求。

### 14.1 SQL 工具补充

```text
如果工具输入包含 selectedFieldRefs 或 fieldId，这些字段已由客户端验证存在。直接使用系统解析后的 physicalName 或 quotedPhysicalName，不要重新匹配全表字段。
```

### 14.2 Python 工具补充

```text
输入数据集字段已由系统解析。脚本必须使用工具输入提供的真实字段名称，不要重新翻译或猜测字段。
```

### 14.3 图表工具补充

```text
图表字段来自上游 Artifact 或已选字段引用。不要重新扫描数据源 Schema。
```

### 14.4 报告工具补充

```text
报告使用上游工具结果和字段 displayName，不需要重新验证原始表字段。
```

---

## 15. 快捷字段不足时的处理

`#字段` 是用户选中的可用字段，但不代表一定足够完成任务。

例如用户只选择：

```text
#五级分类
```

却要求：

```text
按金额分析分布。
```

系统应返回：

```text
当前已选择“五级分类”，但金额分析还需要一个数值字段，例如贷款余额或合同金额。请通过“#”继续选择金额字段。
```

不得：

* 自动扫描全表并选择贷款余额；
* 自行假设金额字段；
* 直接生成模拟分析结果。

可以定义：

```ts
export type SelectedFieldRequirementIssue = {
  missingRole: 'dimension' | 'measure' | 'time' | 'identifier';
  reason: string;
  suggestedAction: 'select_field';
};
```

---

## 16. 未选择快捷字段时的兼容行为

不能破坏原有自然语言查询能力。

当用户没有选择 `#字段` 时：

1. 根据当前数据源生成精简 Schema Summary；
2. 判断是否能直接识别字段；
3. 存在歧义时引导用户使用 `#` 选择；
4. 用户明确要求字段探索时加载完整 Schema；
5. 标准 Skill 可以继续通过 Business Field Semantic Layer 解析字段。

即：

```text
有 #字段
→ 直接使用已选字段

无 #字段
→ 使用现有 Schema / Skill 字段解析流程
```

---

## 17. Memory Context 优化

请检查本地 Memory 是否保存并重复注入旧字段上下文。

当本轮存在 `selectedFieldRefs` 时：

* 不注入历史全表 Schema；
* 不注入上一轮已选但本轮未选的字段；
* 可保留当前数据源和工作流结果；
* 字段选择以当前消息 metadata 为准。

不要让 Memory 中的旧字段覆盖当前选择。

---

## 18. 性能埋点

请增加轻量性能观测，验证优化效果。

```ts
export type AgentPromptPerformanceMetrics = {
  conversationId: string;
  messageId: string;

  schemaContextMode: SchemaContextMode;

  selectedFieldCount: number;
  injectedSchemaFieldCount: number;

  systemPromptChars: number;
  schemaContextChars: number;
  workflowContextChars: number;
  totalContextChars: number;

  contextBuildDurationMs: number;
  modelFirstTokenDurationMs?: number;
  toolIntentDurationMs?: number;

  createdAt: string;
};
```

不得记录：

* 完整用户数据；
* CSV 原始行；
* 敏感字段样例；
* API Key；
* 数据库凭据。

---

## 19. 性能目标

请以当前可测基线为准，至少验证：

1. 使用两个 `#字段` 时，不注入全表 Schema；
2. `injectedSchemaFieldCount` 等于用户选中字段数；
3. Schema Context 字符数明显下降；
4. Context Builder 不调用全表字段匹配；
5. 不调用 BusinessFieldResolver 处理临时快捷字段；
6. 工具参数不再由模型生成完整字段描述；
7. 首 Token 时间和工具意图识别时间不劣于优化前；
8. 对宽表场景应有明显改善。

建议增加宽表测试：

```text
50 个字段
200 个字段
500 个字段
```

在仅选择 2 个字段时，注入字段数始终为 2。

---

## 20. Prompt 缓存与稳定性

如果当前模型适配器支持 Prompt 缓存或固定前缀缓存：

* 保持系统提示词稳定；
* 不在系统提示词中动态拼接全表字段；
* 动态字段放入独立 Schema Context；
* 避免系统提示词每轮大幅变化；
* 工具定义保持稳定；
* selectedFieldRefs 使用紧凑 JSON 或短表格。

不要为了减少字符而牺牲明确字段 ID 和物理字段信息。

---

## 21. 错误处理

定义：

```ts
export type AgentPromptOptimizationErrorCode =
  | 'SELECTED_FIELD_CONTEXT_INVALID'
  | 'SELECTED_FIELD_NOT_FOUND'
  | 'SELECTED_FIELD_EXPIRED'
  | 'SCHEMA_CONTEXT_MODE_INVALID'
  | 'CONTEXT_DUPLICATION_DETECTED'
  | 'TOOL_FIELD_RESOLUTION_FAILED'
  | 'PROMPT_BUILD_FAILED'
  | 'UNKNOWN_ERROR';
```

要求：

* 快捷字段失效时阻止工具调用；
* 提示用户重新上传或重新选择字段；
* 不退回模糊全表匹配；
* Context 构建失败时不得虚构字段；
* 错误不暴露本地路径；
* 保留用户原始输入。

---

## 22. 测试要求

优先使用当前测试框架。TypeScript 可使用 Vitest。

### 22.1 系统提示词测试

覆盖：

* 包含 `#字段` 的准确定义；
* 明确无需全表比较；
* 明确无需名称映射；
* 明确 SQL/Python/图表/报告字段使用方式；
* 删除旧的模糊匹配指令；
* 不包含互相冲突规则。

### 22.2 Schema Context 路由测试

覆盖：

* 有 selectedFieldRefs → selected_fields；
* 无 selectedFieldRefs → schema_summary；
* 明确字段探索 → full_schema；
* selected_fields 与 full_schema 不同时注入；
* 2 个已选字段只注入 2 个字段；
* 500 字段宽表仍只注入已选字段。

### 22.3 Workflow Context 测试

覆盖：

* 只包含字段 ID 和显示名摘要；
* 不重复 physicalName 详情；
* 不包含全表 Schema；
* 不重复工具定义；
* 保留工作流状态。

### 22.4 Tool Input Resolver 测试

覆盖：

* 根据 fieldId 精确解析；
* 不执行名称模糊匹配；
* 不扫描全表；
* 中文字段；
* 英文字段；
* 特殊字符字段；
* 同名字段属于不同表；
* 字段失效；
* 字段不存在。

### 22.5 工具选择测试

覆盖：

```text
分析 #五级分类 的分布
```

识别 SQL 或分析意图。

```text
按 #五级分类 汇总 #贷款余额
```

生成准确 SQL 工具输入。

```text
分析 #五级分类 和 #贷款余额 并绘图
```

选择 SQL、Python或图表的合理组合。

### 22.6 字段不足引导测试

覆盖：

* 只有分类字段但要求金额分析；
* 只有金额字段但要求分组；
* 要求趋势但没有日期字段；
* 要求去重笔数但没有唯一标识；
* 引导用户通过 `#` 补充字段；
* 不自动选择全表字段。

### 22.7 兼容测试

覆盖：

* 未使用 `#字段`；
* 标准 CSV Skill；
* Business Field Semantic Layer；
* 全表字段探索；
* ChatComposer 临时 CSV；
* 中文字段 SQL；
* Python 分析；
* 图表生成；
* 报告生成。

### 22.8 性能测试

覆盖：

* 50 字段表；
* 200 字段表；
* 500 字段表；
* 分别选择 1、2、5 个字段；
* Context 字符数；
* Context 构建时间；
* 全表 resolver 调用次数为 0；
* Schema 注入字段数准确。

---

## 23. 实现约束

请严格遵守：

1. 优先使用 TypeScript；
2. 优先遵守当前项目结构；
3. 不要大规模重构无关模块；
4. `#字段` 必须使用结构化 `selectedFieldRefs`；
5. 不要从用户纯文本重新猜测字段元数据；
6. 不要把快捷字段与全表字段重复比较；
7. 不要对临时快捷字段重复调用 BusinessFieldResolver；
8. 有已选字段时不要默认注入全表 Schema；
9. Schema Context 与 Workflow Context 不得重复字段详情；
10. 工具参数优先使用 fieldId；
11. 字段解析由程序确定性完成；
12. 模型只负责业务意图、工具选择和分析规划；
13. 快捷字段不足时引导用户补充；
14. 不允许模型自动选择关键缺失字段；
15. 不允许模拟或编造数据；
16. 不破坏无快捷字段的现有流程；
17. 所有公开 API 从当前模块入口或现有 `index.ts` 导出；
18. 完成后运行类型检查、单元测试和性能测试，如环境允许。

---

## 24. 验收标准

完成后应满足：

1. 系统提示词准确定义 `#字段`；
2. 大模型知道 `#字段` 已由客户端验证；
3. 大模型不再校验快捷字段与全表字段映射；
4. 大模型不再翻译或猜测快捷字段物理名称；
5. 有快捷字段时只注入选中字段；
6. 不同时注入全表 Schema；
7. Workflow Context 不重复 Schema Context；
8. Tool Input Resolver 使用 fieldId 精确解析；
9. SQL 使用真实 quotedPhysicalName；
10. Python 使用真实字段名称；
11. 图表使用 Artifact 和显示字段名；
12. 报告使用上游结果和 displayName；
13. 字段不足时引导用户通过 `#` 补充；
14. 不自动扫描全表选择缺失字段；
15. 无 `#字段` 时原有字段探索能力正常；
16. 标准 Skill 字段映射能力不受影响；
17. 宽表场景上下文明显缩小；
18. 工具选择和入参准确度不下降；
19. 对话首 Token 或工具调用耗时有所改善；
20. 有完整回归测试和性能指标；
21. 未大规模重构当前项目。

---

## 25. 开发优先级

### P0：本次必须完成

* 精简系统提示词；
* 删除冲突字段匹配指令；
* selected_fields Schema Context；
* Schema Context 模式路由；
* Workflow Context 去重；
* Context Assembler 去重；
* Tool Input Resolver 使用 fieldId；
* SQL/Python/图表/报告工具描述精简；
* 快捷字段不足引导；
* 临时字段不再调用 BusinessFieldResolver；
* 工具意图识别耗时监控；
* 基础性能指标；
* 单元测试和回归测试。


### P1：预留接口

* 自动 Prompt A/B 测试；
* Context 去重诊断；
* 不同模型提示词模板；
* 模型路由；
* Prompt 版本管理；

---

## 26. 最终输出要求

执行完成后，请输出：

1. 新增或修改的文件列表；
2. 当前耗时增长的代码根因；
3. 删除或改写的旧提示词；
4. 新系统提示词内容；
5. Schema Context 模式路由实现；
6. selected_fields Context 示例；
7. Workflow Context 精简结果；
8. Tool Input Resolver 修改内容；
9. SQL 工具参数示例；
10. Python 工具参数示例；
11. 字段不足引导示例；
12. 优化前后 Context 字符数对比；
13. 优化前后字段注入数量对比；
14. 性能测试结果；
15. 回归测试结果；
16. 未完成的 P1/P2 事项。

请直接推进实现，不要停留在设计文档。

开始前请先检查当前仓库中的：

* Agent 系统提示词；
* Prompt Builder；
* Schema Context Builder；
* SelectedFieldContextBuilder；
* Workflow Context Builder；
* Context Assembler；
* Tool Input Resolver；
* Tool Intent Router；
* SQL Tool 描述；
* Python Tool 描述；
* Visualization Tool 描述；
* Report Tool 描述；
* BusinessFieldResolver；
* Local Memory Context；
* Streaming Model Adapter；
* Prompt 性能日志。

优先删除重复、冲突和误导模型的提示词内容，在当前实现基础上增量优化。
