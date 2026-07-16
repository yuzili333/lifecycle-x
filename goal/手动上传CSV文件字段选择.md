# 存续期数据探针智能体｜手动上传 CSV 文件字段选择能力开发

你现在是一个资深 TypeScript / React / Electron / ChatComposer / SQLite / AI Agent 上下文工程师。围绕项目 **“存续期数据探针智能体 / Cycle Data Intelligence Agent”** 开发一个可落地、可测试、可扩展的 **“手动上传 CSV 文件字段选择”** 能力。

项目当前已经支持：

1. 在 ChatComposer 中通过统一“选择工具”入口手动上传 CSV 文件；
2. CSV 文件导入客户端 SQLite 会话临时表；
3. CSV 文件可作为当前会话的临时数据源；
4. 临时 CSV 数据可以用于 SQL 查询、Python 分析、图表绘制和报告生成；
5. CSV 表头可以是中文、英文或中英文混合；
6. ChatComposer 已有或计划使用 Astryx `DropdownMenu`；
7. 项目已有 `ChatTokenizedText` 组件；
8. 项目已有 ChatMessageBubble、消息上下文、Schema Context 和工具调用模块。

本次任务需要在现有能力基础上增量实现：

> 用户选中手动上传的 CSV 文件后，可以在 ChatComposer 输入框中输入 `#`，唤起字段选择菜单，选择本轮对话需要引用的 CSV 字段。只有用户明确选择的字段才进入该轮大模型上下文。

请直接检查当前仓库并推进实现，不要只输出设计方案。

请优先遵守当前项目结构、ChatComposer 输入模型、Astryx 组件使用方式、临时 CSV 数据源模型、Schema Context 和消息发送协议，不要大规模重构无关模块。

---

## 1. 当前需求

### 1.1 `#` 快捷字段选择

用户已经通过“文件”功能手动上传并选中 CSV 文件后，在 ChatComposer 输入框中输入：

```text
#
```

系统应打开 Astryx `DropdownMenu`，展示当前选中 CSV 文件中的字段名称列表。

用户可以继续输入：

```text
#贷款
```

菜单应过滤出：

```text
贷款余额
贷款金额
贷款日期
贷款状态
```

### 1.2 仅注入已选择字段

系统不应默认把上传 CSV 的全部字段放入大模型上下文。

只注入用户通过 `#` 明确选中的字段，包括：

* 字段原始名称；
* SQLite 实际字段名；
* 字段类型；
* 少量脱敏样例；
* 字段注释或推断说明；
* 所属临时数据源和临时表引用。

### 1.3 ChatComposer 内展示

用户选择字段后，在 ChatComposer 输入区域中使用现有：

```text
ChatTokenizedText
```

组件展示字段 Token。

例如用户输入：

```text
分析 #五级分类 和 #贷款余额 的分布情况
```

输入框中：

* `#五级分类`
* `#贷款余额`

应渲染为可识别、可删除的字段 Token。

### 1.4 用户消息 Bubble 展示边界

用户发送消息后：

* 字段引用应保留在消息正文语义中；
* 不要在 `ChatMessageBubble` 上方额外使用独立 `Token` 组件展示已选字段；
* 不要出现一份字段 Token 在消息正文内、一份字段 Token 在消息上方的重复展示；
* ChatMessageBubble 只按现有消息正文渲染规则展示消息。

---

## 2. 核心目标

请完成以下目标：

1. 支持从当前选中的会话临时 CSV 数据源读取字段元数据；
2. 输入 `#` 唤起字段选择 DropdownMenu；
3. 输入 `#关键词` 实时过滤字段；
4. 支持键盘和鼠标选择字段；
5. 支持选择多个字段；
6. 选择字段后使用 `ChatTokenizedText` 渲染；
7. 支持删除已选字段 Token；
8. 支持光标在 Token 前后继续编辑；
9. 支持字段 Token 和普通文本混合输入；
10. 发送消息时解析字段 Token；
11. 将选中字段写入结构化消息上下文；
12. 大模型上下文只包含选中字段，不默认包含全部 CSV 字段；
13. SQL、Python、图表和报告工具可以读取字段选择上下文；
14. 用户消息 ChatMessageBubble 不额外展示字段 Token 列表；
15. 如果未选择临时 CSV，输入 `#` 不应打开空菜单；
16. 临时 CSV 被移除或过期后，相关字段 Token 应标记失效或阻止发送；
17. 不破坏现有 `@` 工具选择能力；
18. `@` 与 `#` 使用不同触发语义：

    * `@`：Skill、数据源、添加文件；
    * `#`：当前 CSV 数据源字段；
19. 优先增量修改，不重写整个 ChatComposer。

---

## 3. 交互示例

### 3.1 用户上传 CSV

用户通过工具菜单上传：

```text
风险分类数据.csv
```

系统导入临时表：

```text
chat_csv_8fa31c_xxx
```

字段：

```text
合同编号
客户名称
五级分类
十二级分类
贷款余额（万元）
报告日期
```

### 3.2 输入 `#`

ChatComposer 中输入：

```text
分析 #
```

弹出：

```text
┌──────────────────────────────┐
│ 选择字段                      │
├──────────────────────────────┤
│ 合同编号             TEXT     │
│ 客户名称             TEXT     │
│ 五级分类             TEXT     │
│ 十二级分类           TEXT     │
│ 贷款余额（万元）     NUMERIC  │
│ 报告日期             TEXT     │
└──────────────────────────────┘
```

### 3.3 选择字段

选择：

```text
五级分类
贷款余额（万元）
```

输入框视觉效果：

```text
分析 [#五级分类] 和 [#贷款余额（万元）] 的分布，并绘制图表
```

其中方括号仅表示 Token 化视觉效果，实际显示使用 `ChatTokenizedText`。

### 3.4 发送消息

消息正文可显示为：

```text
分析 #五级分类 和 #贷款余额（万元） 的分布，并绘制图表
```

或保留 `ChatTokenizedText` 的只读渲染方式。

但不得在消息 Bubble 上方额外显示：

```text
五级分类
贷款余额（万元）
```

两个独立 Token。

---

## 4. 重要设计原则

### 4.1 字段引用必须结构化

不能只依赖输入文本中的：

```text
#五级分类
```

做字符串解析。

必须同时保存结构化字段引用：

```ts
selectedFieldRefs
```

### 4.2 不默认注入全量字段

当前临时 CSV 可能有数百个字段。

禁止：

```text
上传 CSV 后，把全部字段 Schema 自动放入每一轮 Prompt
```

应采用：

```text
用户通过 # 选择字段
→ 构建选中字段 Context
→ 仅注入这些字段
```

### 4.3 字段显示名与实际字段名分离

CSV 字段可能经过重复字段处理或 SQLite 安全处理。

例如：

```text
原始字段：金额
SQLite字段：金额_2
展示名称：金额
```

字段 Token 必须保存真实物理字段引用，不能只保存展示名称。

### 4.4 `@` 与 `#` 不冲突

* `@` 唤起统一工具菜单；
* `#` 唤起当前 CSV 字段菜单；
* 两者分别维护查询范围和 mention range；
* 同一时间只允许一个菜单处于激活状态；
* 打开 `#` 菜单时关闭 `@` 菜单，反之亦然。

### 4.5 消息展示不重复

选中字段 Token 只用于：

* ChatComposer 编辑态；
* 消息正文只读渲染；
* Agent 结构化上下文。

不用于在 ChatMessageBubble 上方生成额外附件 Token 列表。

---

## 5. 推荐目录结构

请先检查当前项目结构。如果已有类似模块，应增量修改。

参考目录：

```text
src/
  renderer/
    components/
      chat/
        ChatComposer.tsx
        ChatTokenizedText.tsx

        field-selector/
          ChatFieldSelector.tsx
          ChatFieldSelectorMenu.tsx
          ChatFieldSelectorItem.tsx
          ChatFieldToken.tsx
          index.ts

    hooks/
      useChatFieldSelector.ts
      useTokenizedChatInput.ts

    utils/
      chat-field-mention-parser.ts
      chat-token-utils.ts

  data-source/
    temporary-data-source/
      conversation-temp-source-manager.ts
      conversation-temp-field-service.ts

  ai/
    schema-context/
      selected-field-context-builder.ts

    tool-orchestration/
      tool-input-resolver.ts
```

如果已经存在：

* `ChatTokenizedText`
* `SkillMentionToken`
* `useSkillMention`
* `ChatToolSelector`
* `ConversationTempSourceManager`
* `SchemaContextBuilder`

请优先复用其通用 Token、mention、DropdownMenu 和数据源接口。

不要复制现有 mention 系统。

---

## 6. CSV 字段元数据

请复用会话临时 CSV 的字段元数据模型。

如需补充，可定义：

```ts
export type ConversationCsvField = {
  fieldId: string;

  tempDataSourceId: string;
  tempTableId: string;

  ordinalPosition: number;

  sourceHeader: string;
  physicalName: string;
  displayName: string;

  logicalType:
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
  fieldComment?: string;
  sampleValues?: unknown[];

  status:
    | 'active'
    | 'expired'
    | 'deleted';
};
```

字段菜单必须使用当前临时数据源的真实字段元数据。

---

## 7. 字段引用 Token

请定义结构化字段 Token。

```ts
export type ChatFieldToken = {
  tokenId: string;
  type: 'csv_field';

  tempDataSourceId: string;
  tempTableId: string;

  fieldId: string;

  sourceHeader: string;
  physicalName: string;
  displayName: string;

  logicalType: string;
  sqliteType: string;

  rawText: string;

  start: number;
  end: number;

  createdAt: string;

  status:
    | 'valid'
    | 'expired'
    | 'missing';
};
```

示例：

```json
{
  "tokenId": "field_token_01",
  "type": "csv_field",
  "tempDataSourceId": "temp_ds_123",
  "tempTableId": "temp_table_123",
  "fieldId": "field_05",
  "sourceHeader": "贷款余额（万元）",
  "physicalName": "贷款余额（万元）",
  "displayName": "贷款余额（万元）",
  "logicalType": "decimal",
  "sqliteType": "NUMERIC",
  "rawText": "#贷款余额（万元）",
  "start": 12,
  "end": 23,
  "createdAt": "2026-07-16T00:00:00.000Z",
  "status": "valid"
}
```

---

## 8. ChatComposer 输入模型

如果当前 `ChatTokenizedText` 已有统一 token 类型，请扩展而不是重写。

建议：

```ts
export type ChatInputToken =
  | ChatSkillToken
  | ChatFieldToken;
```

输入状态：

```ts
export type ChatComposerInputState = {
  plainText: string;
  tokens: ChatInputToken[];

  selectedSkillIds: string[];
  selectedFieldRefs: ChatFieldToken[];

  activeTempDataSourceId?: string;
};
```

注意：

* `plainText` 可以包含 Token 的显示文本；
* `tokens` 保存结构化引用；
* 编辑或删除 Token 后同步更新；
* 不应仅用正则在发送时重新猜测字段归属。

---

## 9. `#` 触发规则

请实现 `useChatFieldSelector`。

### 9.1 打开条件

只有同时满足以下条件时，输入 `#` 才打开菜单：

1. 当前会话存在已选中的手动上传 CSV；
2. 临时数据源状态为 `ready`；
3. 临时数据源未过期；
4. 当前输入位置允许 mention；
5. 当前没有 IME composition；
6. 当前不是代码块或行内代码环境；
7. 当前没有打开其他工具选择菜单。

### 9.2 触发位置

支持：

* 行首；
* 空格后；
* 换行后；
* 常规标点后。

例如：

```text
#五级
分析 #贷款
基于（#客户名称）
```

### 9.3 不触发场景

不应触发：

* URL fragment；
* Markdown 标题标记，例如行首 `# 标题`；
* 代码块；
* 行内代码；
* 已选字段 Token 内部；
* 临时 CSV 未选中；
* 临时数据源已过期；
* 中文输入法 composition 中。

### 9.4 Markdown 标题冲突处理

`#` 同时可能是 Markdown 标题。

建议触发规则：

```text
行首输入 "# "（井号后立即空格）
→ 视为 Markdown 标题，不打开字段菜单

行首输入 "#字"
→ 如果存在激活 CSV，则打开字段菜单

文本中输入 " #"
→ 打开字段菜单
```

必须补充相关测试。

---

## 10. 字段菜单

使用当前 Astryx `DropdownMenu`。

不要重新创建与设计系统不一致的 Popover。

### 10.1 菜单标题

```text
选择 CSV 字段
```

副信息可以显示：

```text
风险分类数据.csv
```

### 10.2 字段列表项

每个字段项展示：

* 中文或原始字段名；
* 推断类型；
* 可选字段注释；
* 是否已选择。

示例：

```text
五级分类                 TEXT
贷款余额（万元）         NUMERIC
报告日期                 DATE
```

### 10.3 字段显示名称优先级

```text
1. displayName
2. sourceHeader
3. physicalName
4. 未命名字段
```

### 10.4 搜索

输入：

```text
#贷款
```

搜索以下字段：

* displayName；
* sourceHeader；
* physicalName；
* fieldComment；
* logicalType。

### 10.5 已选字段

已经选中的字段：

* 可以显示勾选状态；
* 默认不允许重复插入同一个字段；
* 或再次选择时定位现有 Token；
* 不应生成重复 Token。

### 10.6 空状态

```text
未找到匹配字段
```

临时数据源无字段：

```text
当前 CSV 文件没有可用字段
```

---

## 11. useChatFieldSelector Hook

建议接口：

```ts
export type UseChatFieldSelectorInput = {
  inputValue: string;
  cursorPosition: number;

  activeTempDataSource?: ConversationTempCsvTable;
  fields: ConversationCsvField[];

  tokens: ChatInputToken[];

  onInputChange: (value: string) => void;
  onTokensChange: (tokens: ChatInputToken[]) => void;
};
```

输出：

```ts
export type UseChatFieldSelectorOutput = {
  open: boolean;
  query: string;

  results: ConversationCsvField[];
  activeIndex: number;

  mentionRange?: {
    start: number;
    end: number;
  };

  openSelector: (
    range: { start: number; end: number }
  ) => void;

  closeSelector: () => void;

  moveNext: () => void;
  movePrevious: () => void;

  selectActive: () => void;

  selectField: (
    field: ConversationCsvField
  ) => void;

  removeFieldToken: (
    tokenId: string
  ) => void;
};
```

---

## 12. 字段 Token 插入

选择字段后：

1. 替换当前 `#关键词` 范围；
2. 插入字段 Token；
3. Token 显示文本为：

```text
#五级分类
```

4. 在 Token 后自动插入空格，便于继续输入；
5. 光标移动到 Token 后；
6. 关闭 DropdownMenu；
7. 焦点返回输入框；
8. 更新 `selectedFieldRefs`。

示例：

输入前：

```text
分析 #五级
```

选择后：

```text
分析 [#五级分类] 
```

---

## 13. ChatTokenizedText 集成

请检查当前 `ChatTokenizedText` 组件能力。

需要支持：

```ts
type: 'csv_field'
```

### 13.1 编辑态

在 ChatComposer 中：

* 字段以 Token 样式展示；
* Token 内显示 `#字段名称`；
* 支持删除；
* 支持键盘 Backspace 删除；
* 支持鼠标点击；
* 支持在 Token 前后插入文本；
* Token 不应破坏输入法；
* 不应使用不可编辑 DOM 导致光标异常。

### 13.2 样式

复用当前 Astryx 主题和 Token 样式。

可与 Skill Token 做视觉区分，但不要硬编码颜色。

建议使用语义 variant：

```text
Skill Token → skill
CSV Field Token → field
```

### 13.3 Token Tooltip

可以展示：

```text
字段：贷款余额（万元）
类型：decimal
来源：风险分类数据.csv
```

不得展示：

* SQLite 本地绝对路径；
* 内部数据库文件路径；
* 敏感样例原值。

---

## 14. 消息发送结构

发送消息时生成：

```ts
export type ChatMessageFieldContext = {
  tempDataSourceId: string;
  tempTableId: string;

  selectedFields: Array<{
    fieldId: string;
    sourceHeader: string;
    physicalName: string;
    displayName: string;
    logicalType: string;
    sqliteType: string;
  }>;
};
```

消息结构：

```ts
export type ChatMessageWithFieldRefs = {
  content: string;

  metadata: {
    selectedTempDataSourceIds?: string[];
    selectedFieldRefs?: ChatFieldToken[];
  };
};
```

发送前校验：

* 字段所属临时数据源仍存在；
* 字段所属临时数据源未过期；
* 字段仍存在；
* 用户仍有权限；
* Token 状态为 `valid`。

---

## 15. 大模型上下文最小注入

请实现或优化：

```text
SelectedFieldContextBuilder
```

### 15.1 禁止全量注入

对于 ChatComposer 临时 CSV，不要默认注入所有字段。

只有当用户未选择任何字段，但问题明确需要自动字段探索时，才可以通过现有工具调用获取字段画像；不能在每轮对话默认全量注入。

### 15.2 只注入已选字段

示例：

```markdown
## 本轮选中的 CSV 字段

数据源：风险分类数据.csv
临时表：chat_csv_xxx

| 展示名称 | 实际字段名 | 类型 | 说明 |
|---|---|---|---|
| 五级分类 | 五级分类 | category | CSV字段 |
| 贷款余额（万元） | 贷款余额（万元） | decimal | CSV字段 |
```

### 15.3 结构化 Context

```ts
export type SelectedFieldContext = {
  tempDataSourceId: string;
  sqliteTableName: string;

  fields: Array<{
    fieldId: string;
    physicalName: string;
    quotedPhysicalName: string;
    displayName: string;
    logicalType: string;
    sqliteType: string;
  }>;
};
```

### 15.4 SQL 提示

注入：

```text
本轮用户明确选择了以上字段。

生成 SQL 时优先使用这些字段。
SQLite 表名和字段名必须使用双引号安全引用。
不得假设未选择字段存在。
如果当前需求确实需要其他字段，应先说明并请求用户选择，或调用受控 Schema 查询能力。
```

### 15.5 Python 提示

```text
Python 分析时只应使用当前已选字段及工具返回结果中明确存在的字段。
不得自行猜测或改写字段名称。
```

---

## 16. Tool Input Resolver 集成

请更新工具输入解析。

### 16.1 SQL 查询

如果消息中包含 `selectedFieldRefs`：

* 使用当前临时数据源；
* 将选中字段加入 SQL Schema Context；
* SQL 生成优先限制在选中字段；
* 仍允许用于 WHERE、GROUP BY、ORDER BY；
* 字段名通过 SQLite Identifier Quote 处理。

### 16.2 Python 分析

Python 输入应来自：

```text
临时 CSV
→ SQL 查询结果 Artifact
→ Python Runner
```

或者在允许直接分析临时 CSV 时：

```text
临时 CSV DatasetResolver
→ 仅 materialize 已选字段
→ Python Runner
```

P0 推荐优先通过 SQL 查询或字段裁剪后生成受控数据集。

### 16.3 图表

图表使用：

* SQL 查询结果；
* Python 分析结果；
* 已选字段映射。

图表协议不得引用不存在字段。

### 16.4 报告

报告中可以展示用户选择的字段范围：

```text
本次分析使用字段：五级分类、贷款余额（万元）
```

但不得暴露内部 Token ID。

---

## 17. 用户消息 ChatMessageBubble

本次明确要求：

> 不要在用户消息 `ChatMessageBubble` 上方使用独立 `Token` 组件展示已选字段。

### 17.1 需要删除或禁用的行为

如果当前消息 Bubble 存在：

```tsx
<FieldTokenList fields={message.metadata.selectedFieldRefs} />
```

或：

```tsx
<Token>五级分类</Token>
<Token>贷款余额</Token>
```

请删除该额外展示。

### 17.2 推荐展示

用户消息正文继续使用：

```text
分析 #五级分类 和 #贷款余额（万元） 的分布
```

可以：

* 使用普通文本；
* 或使用 `ChatTokenizedText` 的只读模式。

但不能同时在正文上方再次展示字段列表。

### 17.3 结构化元数据仍保留

UI 不显示独立 Token，不等于删除字段元数据。

`selectedFieldRefs` 仍应保留用于：

* 工具输入；
* Schema Context；
* 数据血缘；
* 消息恢复；
* 会话持久化。

---

## 18. 字段 Token 失效处理

以下情况会导致 Token 失效：

* 临时 CSV 被用户移除；
* 临时数据源过期；
* 临时表被清理；
* 字段被重新命名；
* 会话切换导致数据源不可访问。

失效 Token：

```ts
status: 'expired' | 'missing'
```

UI 应：

* 显示失效状态；
* 禁止直接发送；
* 或允许删除失效 Token 后继续；
* 给出明确提示：

```text
字段“贷款余额（万元）”所属的临时 CSV 已失效，请重新上传文件。
```

不得静默改用同名字段。

---

## 19. 多个 CSV 的处理

P0 可以限制：

```text
字段选择只针对当前激活的一个手动上传 CSV
```

如果当前会话存在多个 CSV：

* 以 `activeTempDataSourceId` 为准；
* 菜单标题显示当前文件名；
* 用户切换数据源后更新字段列表；
* 已选旧数据源字段 Token 可以保留，但必须带数据源引用；
* 不要仅根据字段名合并不同文件字段。

多 CSV 聚合和跨文件字段选择可列入 P1。

---

## 20. `@` 与 `#` 菜单协调

建议统一控制器：

```ts
export type ChatComposerMenuType =
  | 'tool_selector'
  | 'field_selector'
  | null;
```

规则：

```text
输入 @
→ activeMenu = tool_selector

输入 #
→ activeMenu = field_selector

打开任一菜单
→ 关闭另一菜单
```

Escape：

```text
→ 关闭当前 activeMenu
```

不得出现两个 DropdownMenu 同时打开。

---

## 21. 键盘操作

字段菜单支持：

* `ArrowDown`：下一项；
* `ArrowUp`：上一项；
* `Enter`：选择；
* `Tab`：可选选择；
* `Escape`：关闭；
* `Backspace`：光标紧邻 Token 时删除 Token。

要求：

* disabled 项跳过；
* 当前项自动滚动到可见区域；
* 选择后焦点回输入框；
* 不破坏 IME；
* 不影响正常输入 `#` 字符的场景。

---

## 22. 数据接口

请复用当前临时数据源 API。

如需扩展，可定义：

```ts
export type ConversationTempFieldClientApi = {
  listFields(input: {
    tempDataSourceId: string;
  }): Promise<ConversationCsvField[]>;

  validateFields(input: {
    tempDataSourceId: string;
    fieldIds: string[];
  }): Promise<{
    validFields: ConversationCsvField[];
    missingFieldIds: string[];
    expired: boolean;
  }>;
};
```

不要让渲染进程直接查询 SQLite 表结构。

---

## 23. 状态管理

字段选择状态应按会话和草稿保存。

```ts
export type ConversationDraftFieldState = {
  conversationId: string;

  activeTempDataSourceId?: string;

  selectedFieldTokens: ChatFieldToken[];

  updatedAt: string;
};
```

要求：

* 切换会话时恢复当前草稿字段 Token；
* 发送消息后清空当前输入中的 Token；
* 历史消息保留其字段元数据；
* 不把上一轮选择自动填入下一轮输入框，除非当前产品已有“保持引用”策略；
* 会话中的临时数据源仍可继续被下一轮重新选择。

---

## 24. 性能要求

字段数量可能较多。

P0 至少需要：

* 菜单搜索本地执行；
* 输入查询防抖或轻量过滤；
* 字段元数据缓存；
* 打开菜单不重复访问 SQLite；
* Token 更新不导致整个会话重新渲染；
* 精确订阅 ChatComposer 草稿状态；
* 字段列表超过 200 时预留虚拟滚动；
* 不把 sampleValues 大量加载到菜单。

---

## 25. 安全要求

必须遵守：

1. 字段菜单只能展示当前用户有权限的临时数据源字段；
2. 临时数据源必须属于当前会话；
3. 不展示 SQLite 绝对路径；
4. 不展示本地文件绝对路径；
5. 字段物理名称不得直接拼接 SQL；
6. SQL 标识符必须经过安全引用；
7. 不向模型注入全量字段；
8. 不向模型注入完整 CSV；
9. 样例值需要脱敏和限量；
10. 字段 Token 不能注入可执行代码；
11. 字段名称中的特殊字符需要安全渲染；
12. CSV Formula Injection 内容不得在 UI 中执行；
13. 失效字段不能静默继续使用。

---

## 26. 错误类型

```ts
export type ChatFieldSelectorErrorCode =
  | 'NO_ACTIVE_TEMP_CSV'
  | 'TEMP_CSV_NOT_FOUND'
  | 'TEMP_CSV_EXPIRED'
  | 'TEMP_CSV_PERMISSION_DENIED'
  | 'FIELD_LIST_LOAD_FAILED'
  | 'FIELD_NOT_FOUND'
  | 'FIELD_TOKEN_INVALID'
  | 'FIELD_TOKEN_EXPIRED'
  | 'FIELD_CONTEXT_BUILD_FAILED'
  | 'UNKNOWN_ERROR';
```

要求：

* 单个字段加载失败不应导致 ChatComposer 崩溃；
* 菜单加载失败时输入内容不丢失；
* 临时 CSV 失效时给出明确提示；
* 错误不暴露本地路径；
* 输入框仍可正常编辑。

---

## 27. 测试要求

优先使用当前测试框架。React 可使用 Testing Library，TypeScript 可使用 Vitest。

### 27.1 `#` 触发测试

覆盖：

* 行首 `#字段`；
* 空格后 `#字段`；
* 换行后；
* 输入 `#` 打开菜单；
* 输入 `#贷款` 过滤；
* Markdown `# 标题` 不触发；
* URL fragment 不触发；
* 代码块不触发；
* 行内代码不触发；
* IME composition 不触发；
* 未选 CSV 时不触发。

### 27.2 字段列表测试

覆盖：

* 中文字段；
* 英文字段；
* 中英文混合；
* 特殊字符；
* 类型显示；
* 字段搜索；
* 已选字段状态；
* 空列表；
* 数据源过期。

### 27.3 Token 插入测试

覆盖：

* 替换 mention range；
* 插入字段 Token；
* Token 后追加空格；
* 光标位置；
* 不重复选择同一字段；
* 多字段 Token；
* 删除 Token；
* Backspace 删除；
* 普通文本保留。

### 27.4 ChatTokenizedText 测试

覆盖：

* Skill Token；
* CSV Field Token；
* 两类 Token 混合；
* 普通文本和 Token 混合；
* 中文 Token；
* Token tooltip；
* 失效 Token；
* 只读模式。

### 27.5 消息发送测试

覆盖：

* selectedFieldRefs 写入 metadata；
* 正文保留字段引用；
* 字段有效性校验；
* 失效字段阻止发送；
* 发送后清空草稿 Token；
* 历史消息字段元数据保留。

### 27.6 上下文注入测试

覆盖：

* 只注入选中字段；
* 未选字段不注入；
* 不注入全量 Schema；
* 中文字段正确；
* physicalName 正确；
* quotedPhysicalName 正确；
* 不包含绝对路径；
* 不包含完整 CSV。

### 27.7 ChatMessageBubble 测试

覆盖：

* 用户消息正常展示；
* 不在 Bubble 上方显示独立 Field Token；
* 字段引用在正文中显示；
* selectedFieldRefs 元数据仍存在；
* 不重复展示字段名称。

### 27.8 菜单协调测试

覆盖：

* `@` 打开工具菜单；
* `#` 打开字段菜单；
* 打开一个关闭另一个；
* Escape 关闭当前菜单；
* 不出现双菜单。

### 27.9 回归测试

覆盖：

* CSV 上传；
* 临时表查询；
* SQL 工具；
* Python 分析；
* 图表；
* 报告；
* Skill mention；
* ChatComposer 发送；
* 流式输出。

---

## 28. 实现约束

请严格遵守：

1. 优先使用 TypeScript；
2. 优先遵守当前项目结构；
3. 不要大规模重构无关模块；
4. 使用 Astryx `DropdownMenu`；
5. 复用现有 `ChatTokenizedText`；
6. 不要重写 CSV 临时导入模块；
7. 不要把全部 CSV 字段默认注入模型；
8. 只注入用户通过 `#` 选择的字段；
9. 不要求现有 Skill 兼容该字段选择能力；
10. `#` 仅用于当前激活手动上传 CSV 字段；
11. 不要在 ChatMessageBubble 上方额外展示字段 Token；
12. 消息元数据仍需保留字段引用；
13. `@` 和 `#` 菜单不能同时打开；
14. 不要在渲染进程直接访问 SQLite；
15. 所有字段 SQL 引用必须安全转义；
16. 完成后运行类型检查和测试，如环境允许。

---

## 29. 验收标准

完成后应满足：

1. 选中手动上传 CSV 后可输入 `#`；
2. `#` 可以打开字段 DropdownMenu；
3. 菜单展示当前 CSV 字段列表；
4. `#关键词` 可以过滤字段；
5. 支持中文字段名称；
6. 支持多字段选择；
7. 字段使用 `ChatTokenizedText` 渲染；
8. 支持删除字段 Token；
9. 普通文本和字段 Token 可混合编辑；
10. 发送消息时包含结构化字段引用；
11. 大模型上下文只注入选中字段；
12. 未选字段不进入本轮上下文；
13. SQL 工具可使用选中字段；
14. Python 工具可使用选中字段；
15. 图表和报告工具可获取字段范围；
16. 用户消息 Bubble 不额外显示字段 Token 列表；
17. 字段正文不重复展示；
18. 临时 CSV 失效后字段 Token 可识别失效；
19. `@` 工具菜单能力不受影响；
20. 有完整回归测试；
21. 未大规模重构现有项目。

---

## 30. 开发优先级

### P0：本次必须完成

* 当前临时 CSV 字段读取；
* `#` 触发检测；
* Astryx DropdownMenu；
* 字段搜索；
* 字段 Token 类型；
* ChatTokenizedText 扩展；
* 多字段选择；
* Token 删除；
* 消息 metadata；
* SelectedFieldContextBuilder；
* 只注入已选字段；
* ChatMessageBubble 去除独立字段 Token 展示；
* `@`/`#` 菜单协调；
* 大字段列表虚拟滚动；
* 最近使用字段排序；
* 基础测试和回归测试。

### P1：预留接口

* 跨 CSV 字段选择；
* 字段别名；
* 业务语义字段映射；
* 字段收藏；
* 字段搜索索引；
* 模型智能推荐字段；
* 字段使用频率分析；
* 字段分组；
* 字段 Tooltip；
* 草稿跨重启恢复；
* 多 CSV 字段源切换；
* 失效 Token 一键移除。
* 字段级权限管理 UI。

---

## 31. 最终输出要求

执行完成后，请输出：

1. 新增或修改的文件列表；
2. 当前项目中复用的组件和服务；
3. `#` 触发逻辑；
4. DropdownMenu 字段菜单实现；
5. 字段 Token 数据模型；
6. `ChatTokenizedText` 修改说明；
7. 字段选择和删除示例；
8. 消息 metadata 示例；
9. SelectedFieldContext 示例；
10. SQL 工具输入示例；
11. Python 分析输入示例；
12. ChatMessageBubble 修改说明；
13. `@`/`#` 菜单协调实现；
14. 测试运行结果；
15. 未完成的 P1/P2 事项。

请直接推进实现，不要停留在设计文档。

开始前先检查当前仓库中的：

* `ChatComposer`
* `ChatTokenizedText`
* `ChatMessageBubble`
* `ChatToolSelector`
* `useSkillMention` 或 mention 通用逻辑
* Astryx `DropdownMenu`
* ConversationTempSourceManager
* 临时 CSV 字段元数据
* Schema Context Builder
* Tool Input Resolver
* Chat message metadata
* Draft state store

优先在现有实现上增量扩展，避免重复构建 Token、mention 或 DropdownMenu 基础设施。
