# 存续期数据探针智能体｜Skill 查询、选择、加载和 @ 快捷输入模块开发

你现在是一个资深 TypeScript / React / Electron / AI Agent / 前端交互工程师。围绕项目 **“存续期数据探针智能体 / Cycle Data Intelligence Agent”** 开发一个可落地、可测试、可扩展的 **“Skill 查询、选择、加载和 @ 快捷输入”** 模块。

本模块用于支持用户在本地项目中查询、选择和加载 Skill，并在对话输入框中通过输入 `@` 快捷唤起 Skill 选择弹层，使用户能够快速将某个 Skill 注入当前对话或智能体任务中，从而提升智能体能力选择、任务编排和交互效率。

请优先遵守当前项目结构，不要大规模重构无关模块。

---

## 1. 项目背景

项目名称：**存续期数据探针智能体 / Cycle Data Intelligence Agent**

项目面向银行贷款后续尽职调查、贷后管理、存续期风险监测、数据源探索、Schema Context 注入、SQL 查询审批、Python 分析、图表生成、报告生成等业务场景。

当前模块为：

> **Skill 查询、选择、加载和 @ 快捷输入模块 / Skill Search, Selection, Loading and @ Quick Input Module**

该模块需要支持：

1. 本地 Skill 查询；
2. 本地 Skill 选择；
3. 本地 Skill 加载；
4. Skill 元数据解析；
5. Skill 内容读取；
6. Skill 可用性校验；
7. Skill 分类、标签、关键词检索；
8. 对话输入框中输入 `@` 时唤起 Skill 选择弹层；
9. 输入 `@关键词` 时实时筛选 Skill；
10. 通过键盘或鼠标选择 Skill；
11. 将选中的 Skill 以可解析的 mention token 方式插入输入框；
12. 在发送消息或执行 Agent 任务时加载已选择 Skill；
13. 与后续 Agent Runtime、Context Assembler、Streaming Model Adapter 对接。

---

## 2. 模块职责边界

本模块负责：

* Skill 类型定义；
* Skill 本地扫描；
* Skill 元数据解析；
* Skill 查询；
* Skill 排序；
* Skill 选择；
* Skill 加载；
* Skill 缓存；
* Skill 可用性校验；
* Skill mention token 解析；
* `@` 快捷输入识别；
* Skill 选择弹层数据逻辑；
* Skill 选择弹层基础 UI；
* 输入框内 Skill mention 插入；
* 已选择 Skill 列表管理；
* 对外 API 导出。

本模块不负责：

* 大模型底层调用；
* Skill 具体执行逻辑；
* Agent 多步骤任务编排；
* SQL 查询执行；
* Python 执行；
* 报告生成；
* 数据源连接管理；
* 完整设计系统重构。

但本模块应预留接口，方便与以下模块集成：

* Agent Runtime；
* Context Assembler；
* Local Memory；
* Streaming Model Adapter；
* Tool Registry；
* Schema Context Injection；
* SQL Tool；
* Python Runner；
* Electron IPC；
* 本地文件系统服务。

---

## 3. 推荐目录结构

请优先复用现有结构，不要大规模重构无关模块。

---

## 4. 核心原则

请在实现中遵守以下原则：

1. **本地优先**

   * Skill 默认从本地目录读取；
   * 不依赖远端服务；
   * 支持 Electron 桌面客户端运行场景。

2. **轻量可扩展**

   * P0 实现本地 Skill 查询、加载和 `@` 选择；
   * 预留远端 Skill、市集 Skill、项目级 Skill、用户自定义 Skill 扩展。

3. **输入体验优先**

   * 用户输入 `@` 后快速唤起弹层；
   * 用户输入 `@关键词` 后实时过滤；
   * 支持键盘上下选择、回车确认、Esc 关闭；
   * 支持鼠标点击选择；
   * 不能明显影响输入框性能。

4. **Skill 选择可追踪**

   * 输入框中选择的 Skill 应形成结构化 mention token；
   * 发送消息时能解析出 selectedSkills；
   * Agent Runtime 能知道当前轮对话使用了哪些 Skill。

5. **安全可控**

   * Skill 内容加载前需要做基础校验；
   * 不执行 Skill 中的任意代码；
   * 不加载非法路径；
   * 不允许通过 `@` 输入访问任意文件系统路径；
   * Skill prompt 内容注入前应保留来源信息。

6. **不大规模重构**

   * 优先遵守当前项目结构；
   * 尽量通过 adapter、hook、service 接入现有输入框和 Agent 流程。

---

## 5. Skill 数据模型设计

请实现清晰的 TypeScript 类型。

### 5.1 SkillId

```ts
export type SkillId = string;
```

### 5.2 SkillSourceType

```ts
export type SkillSourceType =
  | 'local_builtin'
  | 'local_project'
  | 'local_user'
  | 'remote'
  | 'unknown';
```

### 5.3 SkillMetadata

```ts
export type SkillMetadata = {
  skillId: SkillId;
  name: string;
  displayName: string;
  description?: string;
  version?: string;
  author?: string;
  category?: string;
  tags?: string[];
  keywords?: string[];
  icon?: string;
  sourceType: SkillSourceType;
  sourcePath?: string;
  entryFile?: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};
```

### 5.4 LoadedSkill

```ts
export type LoadedSkill = {
  metadata: SkillMetadata;
  prompt?: string;
  systemPrompt?: string;
  instructions?: string;
  toolHints?: string[];
  requiredTools?: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  examples?: SkillExample[];
  rawContent?: string;
  loadedAt: string;
};
```

### 5.5 SkillExample

```ts
export type SkillExample = {
  title?: string;
  userInput?: string;
  expectedBehavior?: string;
  outputExample?: string;
};
```

### 5.6 SkillSearchQuery

```ts
export type SkillSearchQuery = {
  keyword?: string;
  category?: string;
  tags?: string[];
  sourceType?: SkillSourceType[];
  enabledOnly?: boolean;
  limit?: number;
};
```

### 5.7 SkillSearchResult

```ts
export type SkillSearchResult = {
  skill: SkillMetadata;
  score: number;
  matchedFields: string[];
  reason?: string;
};
```

### 5.8 SelectedSkill

```ts
export type SelectedSkill = {
  skillId: SkillId;
  name: string;
  displayName: string;
  mentionText: string;
  sourceType: SkillSourceType;
  insertedAt: string;
  metadata?: Record<string, unknown>;
};
```

---

## 6. Skill 文件格式与解析

请实现 `SkillParser`。

### 6.1 推荐支持的 Skill 文件结构

P0 支持 Markdown Skill 文件。

示例：

```markdown
---
name: due-diligence-report
displayName: 后续尽调报告生成
description: 根据存续期业务数据生成后续尽调报告
version: 1.0.0
category: report
tags:
  - 存续期
  - 尽调
  - 报告
keywords:
  - 贷后
  - 风险分析
  - 报告生成
enabled: true
---

# Skill: 后续尽调报告生成

## Instructions

你是一名银行贷后管理与后续尽调专家。请根据用户提供的数据摘要、SQL 查询结果和风险信号，生成结构化后续尽调报告。

## Output Requirements

- 输出 Markdown；
- 包含风险摘要；
- 包含数据依据；
- 包含处置建议；
- 不得编造数据。

## Examples

用户：请生成客户 A 的后续尽调报告。
输出：……
```

### 6.2 解析要求

支持：

* YAML frontmatter；
* Markdown 正文；
* `name`；
* `displayName`；
* `description`；
* `category`；
* `tags`；
* `keywords`；
* `version`；
* `enabled`；
* `instructions`；
* `examples`。

P0 可以实现轻量解析：

* frontmatter 用简单 parser 或已有库；
* 正文保留 rawContent；
* 不需要完整 Markdown AST；
* 解析失败应返回结构化错误，不要导致整个 Skill Registry 崩溃。

### 6.3 校验要求

Skill 必须满足：

* `name` 非空；
* `displayName` 非空；
* `enabled` 默认为 true；
* `skillId` 可由 `name` 或文件路径 hash 生成；
* 非法文件路径不得加载；
* 不允许读取 Skill 根目录之外文件。

---

## 7. Skill Registry

请实现 `SkillRegistry`。

### 7.1 功能

支持：

* 注册 Skill；
* 注销 Skill；
* 扫描本地 Skill；
* 获取 Skill 列表；
* 搜索 Skill；
* 获取 Skill 元数据；
* 加载 Skill 内容；
* 刷新 Skill 缓存；
* 启用 / 禁用 Skill；
* 获取最近使用 Skill；
* 记录 Skill 使用次数。

### 7.2 API

```ts
export type SkillRegistry = {
  scan(input?: ScanSkillsInput): Promise<SkillMetadata[]>;
  list(input?: ListSkillsInput): Promise<SkillMetadata[]>;
  search(query: SkillSearchQuery): Promise<SkillSearchResult[]>;
  getMetadata(skillId: SkillId): Promise<SkillMetadata | null>;
  load(skillId: SkillId): Promise<LoadedSkill>;
  register(skill: LoadedSkill): Promise<void>;
  unregister(skillId: SkillId): Promise<void>;
  refresh(): Promise<void>;
  recordUsage(skillId: SkillId): Promise<void>;
};
```

### 7.3 ScanSkillsInput

```ts
export type ScanSkillsInput = {
  roots?: string[];
  includeDisabled?: boolean;
  recursive?: boolean;
};
```

### 7.4 ListSkillsInput

```ts
export type ListSkillsInput = {
  enabledOnly?: boolean;
  category?: string;
  sourceType?: SkillSourceType[];
};
```

---

## 8. Skill Loader

请实现 `SkillLoader`。

### 8.1 职责

* 根据 skillId 加载 Skill；
* 读取 Skill 文件；
* 解析 metadata 和正文；
* 做路径安全校验；
* 做缓存；
* 返回 LoadedSkill；
* 解析失败时返回明确错误。

### 8.2 缓存策略

P0 支持内存缓存：

* 按 skillId 缓存；
* 记录 loadedAt；
* 支持 refresh；
* 文件 modifiedAt 变化后可重新加载，当前可预留。

### 8.3 加载安全

禁止：

* 加载根目录之外文件；
* 加载绝对路径绕过；
* 加载隐藏敏感文件；
* 读取 `.env`；
* 读取密钥文件；
* 执行 Skill 中的代码。

---

## 9. Skill Search

请实现 `SkillSearch`。

### 9.1 搜索字段

搜索应匹配：

* name；
* displayName；
* description；
* category；
* tags；
* keywords；
* sourceType；
* 最近使用；
* 使用次数。

### 9.2 排序策略

P0 使用规则评分：

```text
score = displayNameMatch * 0.35
      + nameMatch * 0.25
      + keywordMatch * 0.2
      + tagMatch * 0.1
      + recentUsageBoost * 0.1
```

### 9.3 搜索体验

支持：

* 空关键词返回推荐 Skill；
* `@` 后无关键词返回最近使用 + 高频 Skill；
* `@风险` 返回风险相关 Skill；
* 搜索结果限制数量；
* 禁用 Skill 默认不展示。

---

## 10. @ 快捷输入交互

请实现输入框的 `@` 快捷输入逻辑。

### 10.1 触发规则

在对话输入框中：

* 输入 `@` 时打开 Skill 选择弹层；
* 输入 `@关键词` 时实时筛选 Skill；
* `@` 前是空格、行首或标点时触发；
* 在代码块中不触发；
* 在已存在 mention token 内不重复触发；
* 删除 `@` 后关闭弹层。

### 10.2 关闭规则

以下情况关闭弹层：

* 按 Esc；
* 点击输入框外部；
* 删除触发符；
* 选择 Skill 后；
* 发送消息后；
* 输入内容不再匹配 mention 查询。

### 10.3 键盘操作

支持：

* ArrowUp：上一个 Skill；
* ArrowDown：下一个 Skill；
* Enter：选择当前 Skill；
* Tab：选择当前 Skill，当前可选；
* Esc：关闭弹层。

### 10.4 鼠标操作

支持：

* 鼠标 hover 高亮；
* 鼠标点击选择；
* 鼠标滚动列表；
* 空状态提示。

---

## 11. Mention Token 设计

选择 Skill 后，将其插入输入框为结构化 mention token。

### 11.1 文本表现

可显示为：

```text
@后续尽调报告生成
```

或：

```text
@due-diligence-report
```

### 11.2 内部结构

```ts
export type SkillMentionToken = {
  tokenId: string;
  type: 'skill';
  skillId: SkillId;
  displayName: string;
  rawText: string;
  start: number;
  end: number;
  metadata?: Record<string, unknown>;
};
```

### 11.3 解析输出

发送消息前，需要解析输入框中的 Skill mention：

```ts
export type ParsedSkillMentions = {
  plainText: string;
  mentions: SkillMentionToken[];
  selectedSkills: SelectedSkill[];
};
```

### 11.4 发送消息后的结构

发送到 Agent Runtime 的消息应包含：

```ts
export type ChatMessageWithSkills = {
  content: string;
  selectedSkills: SelectedSkill[];
  metadata?: {
    skillMentionTokens?: SkillMentionToken[];
  };
};
```

---

## 12. Skill Context 注入

请实现或预留 `buildSkillContext`。

### 12.1 输入

```ts
export type BuildSkillContextInput = {
  selectedSkills: SelectedSkill[];
  registry: SkillRegistry;
  maxChars?: number;
};
```

### 12.2 输出

```ts
export type SkillContext = {
  skillIds: SkillId[];
  loadedSkills: LoadedSkill[];
  promptBlock: string;
  warnings: string[];
};
```

### 12.3 Prompt Block 示例

```markdown
# Selected Skills

## 后续尽调报告生成

Source: local_project
Version: 1.0.0

Instructions:
你是一名银行贷后管理与后续尽调专家……
```

### 12.4 注入约束

* 只注入用户选择的 Skill；
* 禁用 Skill 不注入；
* 加载失败的 Skill 记录 warning；
* Skill 内容过长时截断；
* 不注入隐藏文件内容；
* 不注入非法路径内容；
* 保留 Skill 来源和版本信息；
* 支持后续 Context Assembler 合并 Skill Context。

---

## 13. React Hook：useSkillMention

请实现或适配一个 `useSkillMention` Hook。

### 13.1 输入

```ts
export type UseSkillMentionInput = {
  value: string;
  cursorPosition: number;
  registry: SkillRegistry;
  onChange: (value: string) => void;
  onSelectSkill?: (skill: SelectedSkill) => void;
  maxResults?: number;
};
```

### 13.2 输出

```ts
export type UseSkillMentionOutput = {
  isOpen: boolean;
  query: string;
  results: SkillSearchResult[];
  activeIndex: number;
  selectedSkills: SelectedSkill[];
  mentionRange?: { start: number; end: number };
  open: () => void;
  close: () => void;
  moveUp: () => void;
  moveDown: () => void;
  selectActive: () => void;
  selectSkill: (skill: SkillMetadata) => void;
  parseMentions: () => ParsedSkillMentions;
};
```

---

## 14. Skill Mention UI

请实现基础 UI 组件。如果项目已有设计系统，请优先复用。

### 14.1 SkillMentionPopover

功能：

* 展示 Skill 搜索结果；
* 展示 Skill 名称；
* 展示描述；
* 展示 category / tag；
* 展示来源；
* 高亮 active item；
* 支持空状态；
* 支持加载状态。

Props：

```ts
export type SkillMentionPopoverProps = {
  open: boolean;
  query: string;
  results: SkillSearchResult[];
  activeIndex: number;
  loading?: boolean;
  onSelect: (skill: SkillMetadata) => void;
  onMouseEnterItem?: (index: number) => void;
};
```

### 14.2 SkillMentionItem

功能：

* 渲染单个 Skill；
* 显示 displayName；
* 显示 description；
* 显示 tag / category；
* 显示 sourceType；
* 支持 active 状态。

### 14.3 SkillMentionInput

功能：

* 包装现有输入框或提供基础 textarea；
* 监听 `@`；
* 展示 Popover；
* 插入 mention；
* 输出 selectedSkills；
* 发送前 parse mentions。

如果项目已有 ChatInput，请不要重写整个输入框；优先以 Hook 或轻量组件方式接入。

---

## 15. Electron 集成边界

当前模块应支持 Electron 场景。

建议：

* Skill 文件扫描在主进程或 Node 侧执行；
* 渲染进程通过安全 API 请求 Skill 列表；
* 不在渲染进程直接访问任意文件系统路径；
* 如已有 preload / IPC 结构，请复用；
* P0 可先实现纯前端 mock registry 或 Node service registry；
* 接口需预留主进程扫描和渲染进程调用的边界。

预留 API：

```ts
export type SkillClientApi = {
  listSkills(input?: ListSkillsInput): Promise<SkillMetadata[]>;
  searchSkills(query: SkillSearchQuery): Promise<SkillSearchResult[]>;
  loadSkill(skillId: SkillId): Promise<LoadedSkill>;
  recordSkillUsage(skillId: SkillId): Promise<void>;
};
```

---

## 16. 错误处理

请设计统一错误类型。

```ts
export type SkillErrorCode =
  | 'SKILL_NOT_FOUND'
  | 'SKILL_PARSE_FAILED'
  | 'SKILL_LOAD_FAILED'
  | 'SKILL_INVALID_METADATA'
  | 'SKILL_DISABLED'
  | 'SKILL_PATH_NOT_ALLOWED'
  | 'SKILL_SEARCH_FAILED'
  | 'SKILL_CONTEXT_BUILD_FAILED'
  | 'SKILL_MENTION_PARSE_FAILED'
  | 'UNKNOWN_ERROR';
```

要求：

* 所有错误结构化；
* 解析失败不影响其他 Skill；
* 单个 Skill 加载失败不导致整个列表不可用；
* 不暴露本地敏感路径；
* 不读取或返回密钥文件内容。

---

## 17. 测试要求

请补充测试用例。优先使用 Vitest。如果项目已有测试框架，请遵守现有测试框架。

### 17.1 SkillParser 测试

覆盖：

* 解析 Markdown Skill；
* 解析 YAML frontmatter；
* 缺少 displayName；
* enabled 默认值；
* tags / keywords；
* 解析失败；
* rawContent 保留。

### 17.2 SkillRegistry 测试

覆盖：

* 注册 Skill；
* 注销 Skill；
* list；
* search；
* getMetadata；
* load；
* refresh；
* disabled Skill 默认不展示；
* recordUsage。

### 17.3 SkillSearch 测试

覆盖：

* name 匹配；
* displayName 匹配；
* description 匹配；
* tag 匹配；
* keyword 匹配；
* 空关键词返回推荐；
* 最近使用 boost；
* limit 限制。

### 17.4 Mention Utils 测试

覆盖：

* 输入 `@` 触发；
* 输入 `@风险` 触发；
* 行首触发；
* 空格后触发；
* 代码块中不触发；
* 删除 `@` 后关闭；
* mention range 计算；
* parse mentions；
* 插入 mention token。

### 17.5 useSkillMention 测试

覆盖：

* open / close；
* query 更新；
* results 更新；
* moveUp / moveDown；
* selectActive；
* selectSkill；
* selectedSkills 更新；
* parseMentions 输出。

### 17.6 Skill Context 测试

覆盖：

* 构建 Skill Context；
* 加载多个 Skill；
* 禁用 Skill 不注入；
* 加载失败生成 warning；
* maxChars 截断；
* promptBlock 包含来源和版本。

---

## 18. 实现约束

请遵守以下约束：

1. 优先使用 TypeScript；
2. React 组件应保持轻量；
3. 依赖项目组 UI 框架`Astryx`；
4. 不要重写整个 ChatInput；
5. 不要大规模重构无关模块；
6. 不要在渲染进程直接读取任意本地路径；
7. 不要执行 Skill 中的任意代码；
8. 不要加载 Skill 根目录之外文件；
9. 不要读取 `.env`、密钥文件或隐藏敏感文件；
10. Skill 加载失败应产生 warning，不应导致全局崩溃；
11. 所有公开 API 应从 `index.ts` 导出；
12. 如果项目已有 lint / format / test 规范，请遵守；
13. 优先遵守当前项目结构；
14. 如发现已有 `chat-input`、`agent-runtime`、`context-assembler`、`memory`、`tool-registry` 模块，请复用其类型与接口；
15. 完成后运行类型检查和测试，如环境允许。

---

## 19. 验收标准

完成后应满足以下标准：

1. 可以扫描本地 Skill；
2. 可以解析 Markdown Skill 元数据；
3. 可以查询 Skill；
4. 可以按关键词搜索 Skill；
5. 可以加载指定 Skill；
6. 可以缓存 Skill；
7. 可以构建 selected Skill 的 prompt context；
8. 输入框输入 `@` 可以唤起 Skill 选择弹层；
9. 输入 `@关键词` 可以筛选 Skill；
10. 支持键盘上下选择、回车选择、Esc 关闭；
11. 支持鼠标选择；
12. 选择 Skill 后可以插入 mention token；
13. 发送前可以解析 selectedSkills；
14. selectedSkills 可传给 Agent Runtime；
15. 禁用 Skill 不可注入；
16. 非法路径 Skill 不可加载；
17. 不执行 Skill 中的任意代码；
18. 有基础测试覆盖；
19. 模块可与 Context Assembler、Agent Runtime、Streaming Model Adapter 对接。

---

## 20. 开发优先级

请按以下优先级实现。

### P0：必须完成

* 类型定义；
* SkillParser；
* SkillRegistry；
* SkillLoader；
* SkillSearch；
* SkillCache；
* Skill 错误类型；
* SelectedSkill / MentionToken 类型；
* Mention 工具函数；
* useSkillMention；
* SkillMentionPopover；
* SkillMentionItem；
* buildSkillContext；
* 基础测试；
* Skill 启用 / 禁用；
* 本地目录扫描；
* 空状态和加载状态。
* index.ts 导出。

### P1：预留接口

* 远端 Skill；
* Skill 市集；
* Skill 权限；
* Skill 版本管理；
* Skill 热更新；
* Skill 图标；
* Skill 分组管理；
* Skill 收藏；
* Skill 编辑器；
* Skill 与 Tool Registry 自动关联；
* Skill 与 Memory 自动关联；
* 最近使用记录；
* 使用次数排序；
* Electron SkillClientApi；
* maxChars 截断 Skill Context；
* 加载 warning；
* Skill 使用审计。

---

## 21. 请最终输出

执行完成后，请输出：

1. 新增或修改的文件列表；
2. 核心 API 使用示例；
3. Skill 文件示例；
4. Skill 查询示例；
5. Skill 加载示例；
6. `@` 快捷输入使用示例；
7. selectedSkills 解析示例；
8. buildSkillContext 示例；
9. 测试运行结果；
10. 尚未完成或需要后续补充的事项。

请直接推进实现，不要停留在设计文档。请优先遵守当前仓库目录结构，不要大规模重构无关模块；如发现已有 `chat-input`、`agent-runtime`、`context-assembler`、`memory`、`tool-registry` 模块，请复用其类型与接口。
