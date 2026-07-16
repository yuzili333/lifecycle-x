# 存续期数据探针智能体｜ChatComposer「选择工具」模块优化

你现在是一个资深 TypeScript / React / Electron / Chat UI / AI Agent 前端工程师。围绕项目 **“存续期数据探针智能体 / Cycle Data Intelligence Agent”** 优化现有的 **ChatComposer 工具栏模块**。

本次需要将现有分散的：

* 数据源选择；
* CSV 文件选择；
* Skill 选择；
* `@ Skill` 按钮；

整合为统一的 **“选择工具”** 入口。

请直接检查当前仓库并推进实现，不要只输出方案设计。

优先遵守当前项目结构、设计系统、状态管理方式、Electron IPC、ChatComposer 输入逻辑和现有数据源、Skill、CSV 导入能力，不要大规模重构无关模块。

---

## 1. 当前背景

项目当前已经或计划支持：

1. 连接数据库数据源；
2. 标准 CSV 数据导入；
3. ChatComposer 会话级临时 CSV 上传；
4. 本地 Skill 查询、选择和加载；
5. 通过 `@` 快捷唤起 Skill；
6. SQL 查询工具；
7. Python 数据分析工具；
8. 图表生成工具；
9. Markdown 报告生成工具。

当前 ChatComposer 工具栏可能分别存在以下按钮：

```text
数据源
选择 CSV
@ Skill
```

这会导致：

* 工具栏入口较多；
* 用户难以理解不同入口之间的关系；
* 数据源、临时 CSV 和 Skill 的选择体验不统一；
* `@ Skill` 按钮和输入框 `@` 快捷入口重复；
* 后续增加更多工具时扩展困难。

本次需要统一为：

```text
[ + 选择工具 ]
```

点击后通过 Astryx 组件库的 `DropdownMenu` 展示分类菜单。

---

## 2. 核心目标

请完成以下优化：

1. 将“数据源”“选择 CSV”“选择 Skill”按钮合并为一个“选择工具”按钮；
2. 按钮图标使用项目现有 Lucide 图标库中的 `Plus`；
3. 点击按钮后打开 Astryx 组件库的 `DropdownMenu`；
4. DropdownMenu 中分类展示：

   * 添加；
   * Skill；
   * 数据源；
5. “添加”分类支持用户选择本地 CSV 文件；
6. “Skill”分类展示本地已安装并启用的 Skill；
7. “数据源”分类展示：

   * 已连接数据库；
   * 已导入标准 CSV；
   * 当前会话临时 CSV；
8. 不同数据源类型使用不同 Badge 区分；
9. 删除原有独立的 `@ Skill` 工具栏按钮；
10. 用户在输入框输入 `@` 时，等同于点击“选择工具”按钮；
11. 通过 `@` 打开的菜单仍然展示全部分类；
12. 输入 `@关键词` 时优先搜索和过滤 Skill，同时允许匹配数据源；
13. 选择 Skill 后生成结构化 Skill mention；
14. 选择数据源后更新当前会话的数据源上下文；
15. 选择“添加 CSV”后复用现有 ChatComposer 临时 CSV 导入流程；
16. 不能破坏现有数据库选择、CSV 导入、Skill 加载和消息发送逻辑；
17. 优先增量修改，不要重写整个 ChatComposer。

---

## 3. 最终交互结构

ChatComposer 工具栏建议调整为：

```text
[ + ]  输入消息……                         [发送]
```

其中：

```text
+ = 选择工具
```

点击后展示：

```text
┌─────────────────────────────────────┐
│ 搜索工具、Skill 或数据源              │
├─────────────────────────────────────┤
│ 添加                                 │
│   上传 CSV 文件                       │
├─────────────────────────────────────┤
│ Skill                                │
│   整体风险分类分布（笔数+金额）        │
│   其他本地已安装 Skill                │
├─────────────────────────────────────┤
│ 数据源                               │
│   贷后业务数据库              [数据库] │
│   风险分类标准数据            [CSV]    │
│   当前会话上传数据            [临时]   │
└─────────────────────────────────────┘
```

---

## 4. 推荐目录结构

请优先复用当前目录。如果当前项目没有对应结构，可参考：

```text
src/
  renderer/
    components/
      chat/
        ChatComposer.tsx
        ChatComposerToolbar.tsx

        tool-selector/
          ChatToolSelector.tsx
          ChatToolSelectorTrigger.tsx
          ChatToolSelectorMenu.tsx
          ChatToolSelectorSearch.tsx
          ChatToolSelectorSection.tsx
          ChatToolSelectorItem.tsx
          ChatToolSelectorBadge.tsx
          index.ts

    hooks/
      useChatToolSelector.ts
      useChatToolMention.ts

  ai/
    skills/
      skill-client-api.ts

  data-source/
    data-source-client-api.ts
    temporary-data-source-client-api.ts
```

如果已有：

* `SkillMentionPopover`
* `useSkillMention`
* `ChatCsvAttachmentButton`
* `DataSourceSelector`
* `DropdownMenu`
* `Command`
* `Popover`

请优先复用和整合，不要建立重复实现。

---

## 5. 统一“选择工具”按钮

### 5.1 按钮设计

使用项目已有的 Lucide React 集成：

```tsx
import { Plus } from 'lucide-react';
```

按钮建议：

```tsx
<Button
  type="button"
  variant="ghost"
  size="icon"
  aria-label="选择工具"
  onClick={openToolSelector}
>
  <Plus />
</Button>
```

要求：

* 图标为 `Plus`；
* 不使用自定义 SVG；
* 不保留原有独立“数据源”“选择 CSV”“@ Skill”按钮；
* hover、focus、disabled 状态复用 Astryx 主题；
* 按钮需要 tooltip：

```text
选择工具
```

---

## 6. Astryx DropdownMenu

使用当前项目实际安装的 Astryx `DropdownMenu` 组件。

不要假设不存在的 API；应先检查当前仓库中 Astryx DropdownMenu 的实际导入方式和用法。

可能包含：

```tsx
<DropdownMenu>
  <DropdownMenuTrigger />
  <DropdownMenuContent />
  <DropdownMenuLabel />
  <DropdownMenuSeparator />
  <DropdownMenuItem />
  <DropdownMenuGroup />
</DropdownMenu>
```

如果 Astryx 现有组件不支持搜索输入，可以：

1. 在 `DropdownMenuContent` 内嵌现有搜索输入；
2. 复用 Astryx `Command` 组件；
3. 或在不破坏设计系统的前提下封装轻量搜索逻辑。

不要自行实现一套与 Astryx 风格不一致的浮层。

---

## 7. 菜单数据模型

请定义统一菜单项类型。

```ts
export type ChatToolSelectorItem =
  | AddCsvToolSelectorItem
  | SkillToolSelectorItem
  | DataSourceToolSelectorItem;
```

### 7.1 基础类型

```ts
export type BaseChatToolSelectorItem = {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  disabled?: boolean;
};
```

### 7.2 添加 CSV

```ts
export type AddCsvToolSelectorItem =
  BaseChatToolSelectorItem & {
    type: 'add_csv';
    category: 'add';
  };
```

### 7.3 Skill

```ts
export type SkillToolSelectorItem =
  BaseChatToolSelectorItem & {
    type: 'skill';
    category: 'skill';

    skillId: string;
    version?: string;
    sourceType:
      | 'local_builtin'
      | 'local_project'
      | 'local_user';

    tags?: string[];
  };
```

### 7.4 数据源

```ts
export type DataSourceToolSelectorItem =
  BaseChatToolSelectorItem & {
    type: 'data_source';
    category: 'data_source';

    dataSourceId: string;
    dataSourceType:
      | 'database'
      | 'standard_csv'
      | 'conversation_csv';

    status:
      | 'connected'
      | 'ready'
      | 'expired'
      | 'disabled'
      | 'error';

    scope:
      | 'persistent'
      | 'project'
      | 'conversation';

    databaseType?: string;
    rowCount?: number;
    columnCount?: number;
  };
```

---

## 8. 菜单分类

菜单固定分为三个一级分类。

### 8.1 添加

显示：

```text
上传 CSV 文件
```

建议描述：

```text
导入当前会话使用的临时 CSV 数据
```

点击后：

1. 关闭 DropdownMenu；
2. 调用现有本地 CSV 文件选择器；
3. 复用 ChatComposer 临时 CSV 导入流程；
4. 限制文件最大 10 MB；
5. 导入成功后设置为当前会话激活临时数据源；
6. 展示已有 CSV attachment chip 或数据源卡片；
7. 不重复实现 CSV Parser 和 SQLite 写入逻辑。

### 8.2 Skill

显示所有本地已安装且启用的 Skill。

至少支持：

```text
整体风险分类分布（笔数+金额）
```

数据来源：

```ts
skillClientApi.listSkills()
```

或复用现有 Skill Registry。

Skill 菜单项建议展示：

* Skill 中文展示名称；
* 简短描述；
* 分类或标签；
* 本地预置标识；
* 最近使用状态，P1 可选。

禁用 Skill 不显示或展示为 disabled。

### 8.3 数据源

展示：

1. 已成功连接数据库；
2. 已成功导入标准 CSV；
3. 当前会话临时 CSV，不展示导入失败的CSV。

数据来源：

* Data Source Manager；
* 标准 CSV 数据源列表；
* ConversationTempSourceManager。

需要去重并按状态排序。

建议排序：

```text
当前已选数据源
→ 当前会话临时 CSV
→ 已连接数据库
→ 标准 CSV
→ 不可用数据源
```

---

## 9. 数据源 Badge

不同数据源类型显示不同 Badge。

建议文案：

| 数据源类型     | Badge    |
| --------- | -------- |
| 已连接数据库    | `数据库`    |
| 标准 CSV 导入 | `CSV`    |
| 当前会话 CSV  | `临时 CSV` |

建议类型：

```ts
export type DataSourceBadgeType =
  | 'database'
  | 'standard_csv'
  | 'conversation_csv'
```

请复用 Astryx 的 `Badge` 组件和当前主题。

不要在组件中散落硬编码颜色。

可通过 variant 或语义 token 表达：

```text
database         → neutral / info
standard_csv     → secondary
conversation_csv → accent
```

---

## 10. 数据源菜单项展示

数据库示例：

```text
贷后业务数据库
MySQL · 已连接                         [数据库]
```

标准 CSV 示例：

```text
风险分类标准数据
10,000 行 · 15 个字段                    [CSV]
```

会话 CSV 示例：

```text
风险分类临时数据.csv
1,250 行 · 10个字段                   [临时 CSV]
```

不可用数据源应：

* 显示状态；
* 禁止选择；
* 提供合理 tooltip；
* 不因单个数据源异常阻断菜单加载。

---

## 11. 选择 Skill 行为

选择 Skill 后：

1. 关闭菜单；
2. 记录 Skill 使用；
3. 将 Skill 插入输入框；
4. 更新 `selectedSkills`；
5. 不立即发送消息；
6. 用户仍可继续输入需求。

Skill 内部展示文本：

```text
@整体风险分类分布（笔数+金额）
```

内部结构：

```ts
export type SelectedChatSkill = {
  skillId: string;
  displayName: string;
  version?: string;
  sourceType: string;
  selectedAt: string;
};
```

发送消息时包含：

```ts
export type ChatMessageToolContext = {
  selectedSkills: SelectedChatSkill[];
  selectedDataSourceIds: string[];
  selectedTempDataSourceIds: string[];
};
```

---

## 12. 选择数据源行为

选择数据源后：

1. 关闭菜单；
2. 更新当前会话的数据源上下文；
3. 在 ChatComposer 附近显示已选数据源 Chip 或状态；
4. 不立即执行查询；
5. 用户继续输入查询、分析、绘图或报告需求；
6. 发送消息时将数据源 ID 注入 Agent Runtime。

支持：

* 选中一个主数据源；
* 如现有系统支持多个数据源，则保留多选能力；
* P0 可保持当前已有选择策略；
* 不要因菜单整合改变底层数据源权限规则。

选中状态应在菜单中标识，例如：

```text
✓ 贷后业务数据库
```

---

## 13. `@` 快捷唤起

删除原有工具栏中的：

```text
@ Skill
```

按钮。

但保留输入框 `@` 快捷能力，并将其行为调整为：

> 输入 `@` 等同于手动点击“选择工具”按钮。

### 13.1 触发规则

以下情况输入 `@` 时打开统一 DropdownMenu：

* 输入框行首；
* 空格后；
* 换行后；
* 常规标点后；
* 当前不存在打开的菜单。

以下情况不触发：

* Markdown 代码块中；
* 行内代码中，当前可按现有实现；
* 邮箱地址中；
* 已存在 Skill mention token 内；
* IME 中文输入尚未结束；
* DropdownMenu 已打开且状态正常。

### 13.2 `@关键词`

用户输入：

```text
@风险
```

菜单应进行搜索。

搜索优先级建议：

```text
Skill 展示名称
→ Skill 关键词和标签
→ 数据源名称
→ 数据源类型
→ 添加操作
```

示例：

```text
@风险
```

可命中：

* 整体风险分类分布（笔数+金额）；
* 风险分类标准数据；
* 风险分析数据库。

### 13.3 `@` 与按钮使用相同状态

手动点击 Plus 和输入 `@` 必须复用同一个：

```text
useChatToolSelector
```

状态和菜单组件。

不要维护两个独立浮层。

---

## 14. `@` 查询文本处理

当通过 `@` 唤起菜单时，需要记录：

```ts
export type ChatToolMentionState = {
  trigger: 'button' | 'at_symbol';
  open: boolean;

  query: string;

  mentionRange?: {
    start: number;
    end: number;
  };

  activeIndex: number;
};
```

选择 Skill 时：

* 替换 `@关键词`；
* 插入 Skill mention。

选择数据源时：

* 可以删除触发用的 `@关键词`；
* 不必在正文中插入数据源名称；
* 数据源应进入结构化上下文；
* 可在输入框外展示数据源 Chip。

选择“上传 CSV”时：

* 删除触发用 `@关键词`；
* 打开文件选择器。

---

## 15. 推荐 Hook

请实现或整合：

```ts
export type UseChatToolSelectorInput = {
  inputValue: string;
  cursorPosition: number;

  skills: SkillMetadata[];
  dataSources: ChatToolDataSource[];

  onInputChange: (value: string) => void;
  onSkillSelect: (skill: SkillMetadata) => void;
  onDataSourceSelect: (dataSource: ChatToolDataSource) => void;
  onAddCsv: () => void;
};
```

输出：

```ts
export type UseChatToolSelectorOutput = {
  open: boolean;
  trigger: 'button' | 'at_symbol' | null;
  query: string;

  sections: ChatToolSelectorSection[];
  activeItemId?: string;

  openByButton: () => void;
  openByAtSymbol: (range: { start: number; end: number }) => void;
  close: () => void;

  setQuery: (query: string) => void;

  moveNext: () => void;
  movePrevious: () => void;
  selectActive: () => void;
  selectItem: (item: ChatToolSelectorItem) => void;
};
```

---

## 16. 菜单搜索与过滤

请实现轻量本地搜索。

```ts
export type ChatToolSelectorSection = {
  id: 'add' | 'skill' | 'data_source';
  label: string;
  items: ChatToolSelectorItem[];
};
```

### 16.1 空搜索词

展示：

```text
添加
Skill
数据源
```

### 16.2 有搜索词

只展示包含匹配结果的分类。

### 16.3 无结果

展示：

```text
未找到匹配的 Skill 或数据源
```

同时保留：

```text
上传 CSV 文件
```

可选入口，除非查询词明显不匹配。

### 16.4 搜索字段

Skill：

* displayName；
* name；
* description；
* tags；
* keywords。

数据源：

* name；
* databaseType；
* fileName；
* dataSourceType；
* description。

---

## 17. 键盘交互

统一菜单支持：

* `ArrowDown`：选择下一项；
* `ArrowUp`：选择上一项；
* `Enter`：选择当前项；
* `Tab`：可选，选择当前项；
* `Escape`：关闭；
* `Home`：第一项，P1 可选；
* `End`：最后一项，P1 可选。

要求：

* 分类标题不可被选中；
* Separator 不可被选中；
* disabled 项跳过；
* 菜单滚动跟随 active item；
* 选择后焦点回到输入框；
* 文件选择结束后焦点恢复。

---

## 18. ChatComposer UI 改造

### 18.1 删除旧按钮

删除或停止渲染：

* 数据源按钮；
* 选择 CSV 按钮；
* `@ Skill` 按钮。

确保相关功能不被删除，只是入口合并。

### 18.2 新增统一按钮

```tsx
<ChatToolSelector
  skills={skills}
  dataSources={dataSources}
  onAddCsv={handleAddCsv}
  onSkillSelect={handleSkillSelect}
  onDataSourceSelect={handleDataSourceSelect}
/>
```

### 18.3 已选择内容展示

ChatComposer 下方或输入框附近可继续显示：

* 已选 Skill Chip；
* 已选数据源 Chip；
* CSV attachment chip。

不要把所有状态塞进 DropdownMenu Trigger 内。

### 18.4 响应式

菜单需要适配：

* 桌面 Electron 窗口；
* 较窄窗口；
* 菜单最大高度；
* 长数据源名称截断；
* 描述最多两行；
* 可滚动结果区。

---

## 19. 数据加载

打开菜单时加载：

1. 本地 Skill 列表；
2. 数据源列表；
3. 当前会话临时 CSV。

要求：

* 优先使用已有缓存；
* 打开菜单不应阻塞输入；
* 加载时展示 Skeleton 或加载状态；
* Skill 加载失败不影响数据源分类；
* 数据源加载失败不影响 Skill 分类；
* 单个数据源异常不影响整体菜单。

可定义：

```ts
export type ChatToolSelectorDataState = {
  skills: {
    loading: boolean;
    items: SkillMetadata[];
    error?: string;
  };

  dataSources: {
    loading: boolean;
    items: ChatToolDataSource[];
    error?: string;
  };
};
```

---

## 20. 数据源归一化

标准数据库、标准 CSV、临时 CSV 的原始数据结构可能不同。

请实现轻量归一化层：

```ts
export type ChatToolDataSource = {
  dataSourceId: string;
  name: string;

  type:
    | 'database'
    | 'standard_csv'
    | 'conversation_csv';

  badge:
    | '数据库'
    | 'CSV'
    | '临时 CSV';

  status:
    | 'connected'
    | 'ready'
    | 'expired'
    | 'disabled'
    | 'error';

  description?: string;
  databaseType?: string;
  fileName?: string;

  rowCount?: number;
  columnCount?: number;

  selected?: boolean;
  disabled?: boolean;
};
```

不要修改底层数据源实体，只在 UI 选择器层做归一化。

---

## 21. 与 CSV 临时导入集成

点击“上传 CSV 文件”后，必须复用现有：

```text
ChatComposer 临时 CSV 导入
```

流程。

不要重新实现：

* 文件大小校验；
* CSV 解析；
* 中文字段处理；
* SQLite 临时表创建；
* 临时数据源 TTL；
* Schema Context。

成功后：

1. 新临时数据源加入菜单；
2. 自动选中该临时数据源；
3. ChatComposer 显示 CSV attachment chip；
4. 当前会话可用于查询、分析、绘图和报告。

---

## 22. 与 Skill 集成

选择 Skill 后，复用当前：

* Skill Registry；
* Skill Loader；
* Skill mention token；
* selectedSkills；
* Skill Context Builder。

不要重新解析 Skill 文件。

对于：

```text
整体风险分类分布（笔数+金额）
```

菜单应正常显示并可被：

```text
@
@整体
@风险分类
```

搜索命中。

---

## 23. 与数据源上下文集成

选择数据源后，应更新当前会话：

```ts
export type ConversationSelectedToolContext = {
  selectedSkillIds: string[];
  selectedDataSourceIds: string[];
  selectedTempDataSourceIds: string[];
};
```

发送消息时写入：

```ts
export type ChatMessageContextMetadata = {
  selectedSkills?: SelectedSkill[];
  selectedDataSourceIds?: string[];
  selectedTempDataSourceIds?: string[];
};
```

不要把完整数据源连接信息放入消息。

只能传：

* dataSourceId；
* tempDataSourceId；
* Skill ID；
* 必要展示元数据。

---

## 24. 可访问性

要求：

* Plus 按钮有 `aria-label="选择工具"`；
* DropdownMenu 支持键盘操作；
* 当前选中项有 `aria-selected`；
* 分类有语义标签；
* Badge 不作为唯一识别手段；
* 状态同时有文字；
* 屏幕阅读器能读出：

  * Skill；
  * 数据源类型；
  * 数据源状态；
  * 是否已选。

---

## 25. 错误处理

定义：

```ts
export type ChatToolSelectorErrorCode =
  | 'SKILL_LIST_LOAD_FAILED'
  | 'DATA_SOURCE_LIST_LOAD_FAILED'
  | 'TEMP_SOURCE_LIST_LOAD_FAILED'
  | 'CSV_FILE_SELECTION_FAILED'
  | 'CSV_IMPORT_FAILED'
  | 'SKILL_SELECTION_FAILED'
  | 'DATA_SOURCE_SELECTION_FAILED'
  | 'TOOL_SELECTOR_STATE_INVALID'
  | 'UNKNOWN_ERROR';
```

要求：

* 一个分类加载失败不影响其他分类；
* 选择失败时菜单保持或给出提示；
* CSV 导入失败时显示原有错误；
* 不暴露本地文件绝对路径；
* 不暴露数据库连接串和密码；
* 输入框内容不能因菜单错误丢失。

---

## 26. 测试要求

优先使用当前项目测试框架。React 可使用 Testing Library，TypeScript 可使用 Vitest。

### 26.1 Trigger 测试

覆盖：

* Plus 图标显示；
* 点击 Plus 打开菜单；
* aria-label；
* 菜单关闭；
* 不再显示旧按钮；
* 不再显示独立 `@ Skill` 按钮。

### 26.2 分类测试

覆盖：

* 添加分类；
* Skill 分类；
* 数据源分类；
* 分类顺序；
* 空分类隐藏或显示空状态；
* Separator 正确。

### 26.3 添加 CSV 测试

覆盖：

* 点击上传 CSV；
* 关闭菜单；
* 调用现有 CSV 选择逻辑；
* 导入成功后自动选择；
* 导入失败；
* 临时数据源出现在数据源分类。

### 26.4 Skill 测试

覆盖：

* 本地 Skill 列表；
* 显示整体风险分类分布 Skill；
* Skill 搜索；
* Skill 选择；
* 插入 mention；
* selectedSkills 更新；
* disabled Skill 不可选择。

### 26.5 数据源测试

覆盖：

* 数据库显示；
* 标准 CSV 显示；
* 临时 CSV 显示；
* Badge 正确；
* 异常状态；
* 选中状态；
* 数据源上下文更新。

### 26.6 `@` 快捷测试

覆盖：

* 行首输入 `@` 打开；
* 空格后输入 `@` 打开；
* 输入 `@风险` 搜索；
* 输入 `@` 与点击 Plus 使用同一菜单；
* Esc 关闭；
* 删除 `@` 关闭；
* 代码块中不触发；
* 邮箱中不触发；
* IME 输入不误触发。

### 26.7 键盘测试

覆盖：

* ArrowDown；
* ArrowUp；
* Enter；
* Escape；
* disabled 项跳过；
* 选择后焦点回输入框。

### 26.8 ChatComposer 回归测试

覆盖：

* 输入文本不丢失；
* 发送消息正常；
* Skill context 正常；
* 数据源 context 正常；
* CSV attachment 正常；
* 流式输出不受影响；
* 工具栏布局稳定。

---

## 27. 实现约束

请严格遵守：

1. 优先使用 TypeScript；
2. 使用项目当前 Lucide 集成中的 `Plus`；
3. 使用当前 Astryx `DropdownMenu`；
4. 优先遵守当前项目结构；
5. 不要大规模重构无关模块；
6. 不要重新实现 CSV 导入；
7. 不要重新实现 Skill Registry；
8. 不要重新实现数据源管理；
9. 删除独立 `@ Skill` 按钮；
10. 输入框 `@` 仍然可用；
11. `@` 与 Plus 按钮复用同一菜单状态；
12. 不要通过 UI 归一化修改底层数据源实体；
13. 不要暴露数据库凭据；
14. 不要暴露本地绝对路径；
15. 不要因菜单加载阻塞 ChatComposer；
16. 所有公开 API 从当前模块入口或新增 `index.ts` 导出；
17. 完成后运行类型检查和测试，如环境允许。

---

## 28. 验收标准

完成后应满足：

1. ChatComposer 仅保留一个“选择工具”入口；
2. 入口使用 Lucide `Plus` 图标；
3. 点击后展示 Astryx `DropdownMenu`；
4. 菜单包含“添加”“Skill”“数据源”三个分类；
5. 添加分类支持上传本地 CSV；
6. Skill 分类展示本地已安装 Skill；
7. 数据源分类展示数据库、标准 CSV 和临时 CSV；
8. 不同数据源显示不同 Badge；
9. 删除原独立数据源按钮；
10. 删除原选择 CSV 按钮；
11. 删除独立 `@ Skill` 按钮；
12. 输入 `@` 可打开统一菜单；
13. 输入 `@关键词` 可搜索 Skill 和数据源；
14. Skill 选择后插入结构化 mention；
15. 数据源选择后更新会话上下文；
16. CSV 导入成功后成为当前会话临时数据源；
17. 现有 SQL、Python、图表和报告工具链不受影响；
18. ChatComposer 输入和发送功能不受影响；
19. 支持键盘和鼠标操作；
20. 有完整回归测试；
21. 未大规模重构当前项目。

---

## 29. 开发优先级

### P0：本次必须完成

* Plus 统一按钮；
* Astryx DropdownMenu；
* 三类菜单；
* CSV 添加入口；
* Skill 列表；
* 数据源归一化；
* 数据源 Badge；
* 选择 Skill；
* 选择数据源；
* 删除旧按钮；
* `@` 打开统一菜单；
* `@关键词` 搜索；
* 键盘交互；
* 常用 Skill；
* 菜单虚拟列表；
* ChatComposer 回归测试。

### P1：尽量完成

* 菜单搜索框；
* 菜单 loading skeleton；

### P1：预留接口

* 工具推荐；
* 大模型自动推荐 Skill；
* 数据源语义搜索；
* Skill 分类管理；
* 多数据源选择；
* 最近使用历史同步；
* 用户自定义菜单排序；
* 快捷键打开菜单。

---

## 30. 最终输出要求

执行完成后，请输出：

1. 新增或修改的文件列表；
2. 当前 ChatComposer 工具栏结构；
3. 删除的旧按钮说明；
4. Plus 触发按钮实现；
5. Astryx DropdownMenu 实现；
6. 菜单分类数据模型；
7. Skill 列表示例；
8. 数据源归一化示例；
9. Badge 映射示例；
10. CSV 添加流程；
11. `@` 快捷唤起实现；
12. Skill 选择结果示例；
13. 数据源选择结果示例；
14. 消息上下文输出示例；
15. 测试运行结果；
16. 未完成的 P1/P2 事项。

请直接推进实现，不要停留在设计文档。

开始前先检查当前仓库中的：

* `ChatComposer`
* 工具栏按钮组件
* `SkillMentionPopover`
* `useSkillMention`
* CSV 文件选择入口
* ConversationTempSourceManager
* Data Source Manager
* Skill Registry
* Astryx DropdownMenu
* Astryx Badge
* Lucide 图标使用方式
* Chat message metadata
* Tool Input Resolver

优先在现有实现上增量整合，避免复制功能或重新建设平行模块。
