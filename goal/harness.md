# 存续期数据探针智能体升级为轻量 Harness Engineering 工程

你现在是一个资深 TypeScript / Electron / React / Node.js / 软件架构 / AI 辅助研发工程师。将当前项目：

> **存续期数据探针智能体 / Cycle Data Intelligence Agent**

从以即时生成为主的传统 `vibe coding` 项目，升级为适合个人开发者长期维护的轻量级：

> **Harness Engineering 工程**

目标工作方式是：

> **Humans Steer, Agents Execute**
> 人类负责目标、约束、边界和设计判断；智能体负责检索、实现、验证、记录和重复性执行。

本轮不是重写业务系统，也不是替换现有技术栈，而是在当前仓库中建立一套可持续约束 AI 开发行为的工程 Harness。

请直接检查仓库并推进实现，不要只输出理念说明或改造建议。

优先遵守当前项目结构，复用已有脚本、文档、测试、Lint、TypeScript、CI 和目录约定，不要大规模重构无关业务模块。

---

## 1. 本轮改造范围

本轮纳入以下 Harness Engineering 能力：

1. **仓库即记录系统**

   * Repo as System of Record

2. **地图而非手册**

   * Map, Not Manual

3. **部分机械化执行**

   * Partial Mechanical Enforcement

4. **降级版吞吐量与合并理念**

   * Throughput Changes Merge Philosophy，个人开发者版本

5. **降级版熵管理**

   * Entropy & Garbage Collection，人工纪律版本

本轮明确不纳入：

6. **智能体可读性**

   * Agent Readability 不作为技术选型或架构改造目标

---

## 2. 核心目标

请完成以下目标：

1. 让仓库成为项目事实、任务、决策和验证结果的唯一可靠来源；
2. 让智能体进入仓库后可以快速找到正确模块、约束和执行入口；
3. 避免依赖聊天历史、个人记忆或过长的项目说明；
4. 为 AI 任务建立简短、结构化、可追踪的任务记录；
5. 为重要架构决策建立轻量 ADR；
6. 为项目增加必要但不过度的机械校验；
7. 明确测试通过不等于设计正确；
8. 在机械校验之外增加人工设计审查步骤；
9. 保持个人开发者单线程、质量优先的工作方式；
10. 支持小步、可逆、连续迭代；
11. 在持续生成代码的同时建立持续重构机制；
12. 不引入后台垃圾回收智能体；
13. 不建立复杂的多智能体任务调度平台；
14. 不因为“方便 AI 理解”而重写稳定代码或更换技术栈；
15. 不大规模重构当前业务模块。

---

## 3. 改造原则

### 3.1 人类掌舵，智能体执行

人类负责：

* 定义目标；
* 确认需求边界；
* 决定架构取舍；
* 判断设计是否合理；
* 决定是否接受技术债；
* 决定是否合并或发布。

智能体负责：

* 阅读仓库地图；
* 定位相关模块；
* 创建或更新任务记录；
* 生成实现计划；
* 修改代码；
* 执行机械校验；
* 更新必要文档；
* 汇总设计风险；
* 输出验证结果。

智能体不得将“测试全部通过”描述为“设计已经正确”。

---

### 3.2 仓库即记录系统

以下信息必须进入仓库，而不是只存在于对话中：

* 当前系统结构；
* 模块边界；
* 关键约束；
* 重要架构决策；
* 正在执行的较大任务；
* 任务验收条件；
* 设计审查结论；
* 已知技术债；
* 后续重构事项；
* 标准验证命令。

不要记录：

* 冗长思维过程；
* 聊天内容全文；
* 重复的代码说明；
* 容易快速过期的逐行实现细节；
* 可以直接从代码中读出的内容；
* 敏感数据或数据库凭据。

---

### 3.3 地图而非手册

项目文档应帮助智能体找到正确位置，而不是试图解释仓库中的每一行代码。

根目录文档应该回答：

1. 项目是什么；
2. 核心模块在哪里；
3. 修改某类能力应该去哪里；
4. 哪些边界不能违反；
5. 如何执行验证；
6. 更详细信息在哪里。

禁止创建巨大、重复、无法维护的“全项目说明书”。

采用：

```text
根导航
→ 模块地图
→ 必要的架构说明
→ 代码和测试
```

而不是：

```text
根目录放置几万字完整手册
```

---

## 4. 开始前的仓库审计

在修改前先检查：

* 根目录已有 Markdown 文件；
* 是否存在 `AGENTS.md`；
* 是否存在 `README.md`；
* 是否存在 `CONTRIBUTING.md`；
* 是否存在 `docs/`；
* 是否存在架构说明；
* 是否存在 ADR；
* 是否存在任务或计划文件；
* `package.json` scripts；
* 当前包管理器；
* TypeScript 配置；
* ESLint、Biome 或其他 Lint 配置；
* Formatter 配置；
* 测试框架；
* Electron 主进程和渲染进程目录；
* Agent、Workflow、Tool、Artifact、CSV、ChatComposer 等主要模块；
* 是否为单包或 monorepo；
* 是否已有 CI；
* 是否已有模块边界检查；
* 是否已有循环依赖检查；
* 是否已有重复或失效文档。

先复用现有机制，再补充缺失能力。

不要因为本提示词给出了参考目录，就机械创建与当前仓库重复的文件。

---

## 5. 目标仓库 Harness 结构

根据当前仓库调整，建议形成以下最小结构：

```text
/
├── AGENTS.md
├── README.md
├── docs/
│   ├── README.md
│   ├── repo-map.md
│   ├── architecture/
│   │   ├── overview.md
│   │   └── boundaries.md
│   ├── decisions/
│   │   ├── README.md
│   │   └── ADR-000-template.md
│   ├── work/
│   │   ├── README.md
│   │   ├── active/
│   │   └── completed/
│   └── quality/
│       ├── design-review.md
│       └── refactor-checkpoint.md
├── scripts/
│   └── verify-harness.*
└── existing project files
```

目录名称可以根据当前项目惯例调整。

关键要求：

* 文件数量保持克制；
* 不重复现有文档；
* 每个文件职责明确；
* 所有入口互相链接；
* 根目录只保留导航和最重要规则。

---

## 6. 根目录 `AGENTS.md`

如果已有 `AGENTS.md`，请精简和优化；如果没有，创建一个。

`AGENTS.md` 应是智能体进入仓库后的首要地图，不是详细手册。

建议内容：

```markdown
# Agent Repository Map

## Project

Cycle Data Intelligence Agent is an Electron-based local data analysis
assistant for lifecycle and post-loan data exploration.

## Start Here

1. Read `docs/repo-map.md`.
2. Locate the affected module.
3. Read only the relevant architecture and boundary documents.
4. For non-trivial work, create or update a task file under
   `docs/work/active/`.
5. Preserve the existing project structure and avoid unrelated refactors.

## Core Modules

- Agent and workflow: `<actual path>`
- Tool orchestration: `<actual path>`
- SQL execution: `<actual path>`
- Python analysis: `<actual path>`
- Visualization: `<actual path>`
- Reports and artifacts: `<actual path>`
- CSV and data sources: `<actual path>`
- Chat UI: `<actual path>`
- Electron main process: `<actual path>`
- Tests: `<actual path>`

## Non-negotiable Boundaries

- Python does not connect directly to business databases.
- SQL execution remains read-only and approval-controlled.
- Full source datasets are not injected into the model.
- Tool and artifact lineage must be preserved.
- Do not fabricate data or tool results.
- Avoid large unrelated refactors.

## Verification

- Fast verification: `<actual command>`
- Full verification: `<actual command>`
- Design review: `docs/quality/design-review.md`

## Documentation Map

- Repository map: `docs/repo-map.md`
- Architecture: `docs/architecture/`
- Decisions: `docs/decisions/`
- Active work: `docs/work/active/`
- Design review: `docs/quality/design-review.md`
- Refactor checkpoint: `docs/quality/refactor-checkpoint.md`
```

要求：

* 使用仓库真实路径和真实命令；
* 控制长度；
* 不复制 README；
* 不复制完整架构文档；
* 不包含实现细节教程。

---

## 7. `docs/repo-map.md`

创建或优化仓库地图。

它应描述：

* 顶层目录；
* 核心模块；
* 每个模块负责什么；
* 从常见任务到代码位置的导航；
* 模块之间的主要依赖方向；
* 常用验证入口。

推荐结构：

```markdown
# Repository Map

## Runtime Surfaces

| Surface | Responsibility | Path |
|---|---|---|
| Electron main | Local privileged operations | ... |
| Renderer | Chat and visualization UI | ... |
| Agent runtime | Intent and workflow execution | ... |
| Tool layer | SQL, Python, chart and report tools | ... |
| Data layer | SQLite, CSV and metadata | ... |
| Artifact layer | Result storage and lineage | ... |

## Change Map

| Change type | Start here | Related checks |
|---|---|---|
| Agent prompt | ... | ... |
| Workflow | ... | ... |
| CSV import | ... | ... |
| Chart rendering | ... | ... |
| Report rendering | ... | ... |
| ChatComposer | ... | ... |

## Dependency Direction

Describe only important dependency directions and forbidden reverse dependencies.

## Verification Map

List the smallest useful verification command for each major area.
```

禁止：

* 逐文件解释整个仓库；
* 复制目录树的所有文件；
* 保存容易失效的行号；
* 将其写成新手教程。

---

## 8. 架构概览和边界

### 8.1 `docs/architecture/overview.md`

只记录稳定结构：

* 应用运行时边界；
* Agent 与工具关系；
* 数据流；
* Artifact 数据血缘；
* 主进程与渲染进程职责；
* 标准 CSV 与会话临时 CSV 的差异；
* SQL、Python、图表、报告的关系。

可以使用简洁 Mermaid，但不要创建复杂装饰图。

### 8.2 `docs/architecture/boundaries.md`

记录不可轻易违反的边界，例如：

```text
Renderer
→ 通过 IPC 调用主进程能力
→ 不直接连接 SQLite

Agent
→ 生成意图和工具计划
→ 不伪造工具结果

SQL Tool
→ 访问原始数据源
→ 只读、审批、审计

Python Runner
→ 读取受控数据集
→ 不直连业务数据库

Chart Tool
→ 消费 SQL/Python Artifact
→ 不重新查询原始数据库

Report Tool
→ 消费真实 Artifact
→ 不重新计算关键指标
```

只记录稳定边界，不写重复实现说明。

---

## 9. 轻量 ADR

为重要且不明显的架构决定使用 ADR。

创建：

```text
docs/decisions/README.md
docs/decisions/ADR-000-template.md
```

ADR 模板：

```markdown
# ADR-NNN: Decision Title

- Status: Proposed | Accepted | Superseded
- Date: YYYY-MM-DD

## Context

What problem or constraint required a decision?

## Decision

What was decided?

## Consequences

What becomes easier, harder, or constrained?

## Alternatives Considered

List only meaningful alternatives.

## Follow-up

What must be verified or revisited?
```

只为以下类型的决定建立 ADR：

* 模块边界变化；
* 数据模型重要变化；
* 工具输入输出协议变化；
* 安全边界变化；
* 采用或移除关键依赖；
* 难以逆转的架构选择。

不要为普通 Bug 修复或小组件改名创建 ADR。

---

## 10. 任务记录系统

建立轻量任务文件，使仓库记录智能体正在执行什么。

目录：

```text
docs/work/active/
docs/work/completed/
```

对于非平凡任务，创建：

```text
docs/work/active/YYYY-MM-DD-short-task-name.md
```

建议模板：

```markdown
# Task: Short Name

- Status: active
- Owner: human + agent
- Started: YYYY-MM-DD

## Goal

One clear outcome.

## Scope

What will be changed?

## Non-goals

What will not be changed?

## Constraints

Important architectural or product constraints.

## Affected Areas

Relevant modules and paths.

## Invariants

What must remain true?

## Implementation Plan

Short executable steps.

## Acceptance Criteria

Observable completion conditions.

## Verification

Commands and manual checks.

## Design Review

- [ ] The design is understandable without relying on tests.
- [ ] Module boundaries remain clear.
- [ ] The implementation is simpler than plausible alternatives.
- [ ] No accidental coupling was introduced.
- [ ] Error and recovery paths are explicit.
- [ ] Generated code was reviewed for unnecessary abstraction.
- [ ] Technical debt and follow-up work are recorded.

## Outcome

Filled when completed.

## Follow-up

Deferred work or refactoring.
```

任务完成后：

1. 更新 Outcome；
2. 记录验证结果；
3. 将文件移动到 `completed/`；
4. 不保留无意义的逐步执行日志；
5. 不将聊天记录复制进任务文件。

---

## 11. 部分机械化执行

本轮只实施能够提供明确价值的机械校验。

### 11.1 优先复用现有校验

检查是否已有：

* Formatter；
* ESLint 或 Biome；
* TypeScript typecheck；
* 单元测试；
* 组件测试；
* 构建检查；
* Electron 打包检查；
* 循环依赖检查；
* 模块边界规则。

不要重复安装功能相同的工具。

### 11.2 建立统一验证入口

优先在已有 `package.json` scripts 上增量增加：

```json
{
  "scripts": {
    "verify:fast": "...",
    "verify": "...",
    "harness:check": "..."
  }
}
```

实际命令根据仓库已有工具确定。

建议语义：

```text
verify:fast
→ formatter check
→ lint
→ typecheck
→ 受影响范围测试

verify
→ fast checks
→ 完整测试
→ build 或必要集成检查

harness:check
→ 检查 Harness 文件和链接是否有效
→ 检查 active task 基本结构
→ 检查关键文档入口
```

不要为了实现 `harness:check` 引入大型框架。

可使用简单 TypeScript、JavaScript 或当前仓库惯用脚本。

---

## 12. 机械化执行的边界

必须在文档和脚本中明确：

> 测试通过只能证明已编码的断言通过，不能证明需求、架构或设计正确。

机械校验负责发现：

* 语法错误；
* 类型错误；
* 格式问题；
* 已知行为回归；
* 部分边界违规；
* 构建失败；
* 明确编码规则违规。

机械校验不能替代：

* 需求判断；
* 架构设计；
* 数据语义判断；
* 安全边界审查；
* 错误恢复设计；
* 用户体验评估；
* 简洁性判断。

不要用测试数量作为质量指标。

禁止在最终输出中使用：

```text
500 个测试通过，因此设计正确。
```

应该表达：

```text
机械校验通过；设计仍经过了独立人工审查。
```

---

## 13. 人工设计审查

创建：

```text
docs/quality/design-review.md
```

建议内容：

```markdown
# Design Review Checklist

Use this after implementation and mechanical verification.

## Problem Fit

- Does the change solve the stated problem?
- Did the implementation accidentally broaden the scope?
- Are important user paths still missing?

## Architecture

- Is the responsibility located in the correct module?
- Were existing abstractions reused appropriately?
- Did the change introduce reverse dependencies or hidden coupling?
- Is the state model explicit?

## Simplicity

- Is there a smaller design that meets the same goal?
- Did generated code add unnecessary interfaces, factories, layers or types?
- Are names and boundaries clearer after the change?

## Data and Safety

- Are data inputs and outputs traceable?
- Are error and recovery paths deterministic?
- Does any fallback fabricate data or hide failure?
- Are permissions and process boundaries preserved?

## Maintainability

- Is duplicated logic present?
- Are files or functions becoming too large?
- Does the implementation preserve repository conventions?
- Is deferred debt recorded?

## Independent Re-read

After tests pass, stop and re-read the change as if reviewing another
developer's code.
```

每个较大任务完成前，都应执行该审查。

审查者可以是：

> 一天后重新查看代码的同一个开发者。

无需引入形式化多人 code review 系统。

---

## 14. 降级版合并与迭代理念

个人开发者通常一次只推进一个主要智能体任务，因此本轮不建设：

* 大规模并行分支；
* 多 Agent 自动合并；
* 合并队列；
* 自动 PR 编排；
* 以吞吐量为核心的发布体系。

保留以下原则：

### 14.1 小步可逆

每次改动应：

* 目标清晰；
* 影响范围有限；
* 能独立验证；
* 能独立回退；
* 不捆绑无关重构。

### 14.2 不追求一次完美

允许：

* 先完成最小正确实现；
* 记录明确后续项；
* 下一轮继续改进；
* 在证据充分后抽象。

禁止：

* 因追求完美建立过度架构；
* 未验证需求就建立通用框架；
* 用“以后可能需要”解释大量抽象。

### 14.3 快速迭代必须伴随重构

核心规则：

> AI 能以较高速度生成简单代码，也应以同样的节奏被用于删除重复、拆分职责和重构边界。

不得连续堆叠多轮生成代码而不审视结构。

### 14.4 合并或提交前条件

无论是否使用 PR，较大修改完成前至少需要：

1. 任务验收条件满足；
2. 必要机械校验通过；
3. 设计审查完成；
4. 文档和仓库地图在必要时更新；
5. 已知技术债已记录；
6. 无无关修改混入。

---

## 15. 降级版熵管理

本轮不建设：

* 后台垃圾回收 Agent；
* 自动扫描代码偏差的常驻服务；
* 自动更新质量分数；
* 自动创建重构 PR；
* 自动代码美学评分系统。

改为建立人工重构节奏。

创建：

```text
docs/quality/refactor-checkpoint.md
```

建议内容：

```markdown
# Refactor Checkpoint

Run this checkpoint after a substantial batch of AI-generated code.

## The Ugliness Question

Ask directly:

> Is this code ugly, confusing, duplicated, or harder than necessary?

## Inspect

- Duplicate logic
- Oversized files and functions
- Thin wrappers with no real value
- Unnecessary interfaces or factories
- Leaky module boundaries
- Repeated prompt or schema definitions
- Inconsistent error models
- Dead code and stale feature flags
- Stale documentation
- Tests coupled to implementation details
- Temporary code that became permanent

## Decide

For each issue:

- Refactor now
- Record as follow-up
- Accept deliberately
- Delete

## Verify

After refactoring:

- Run mechanical checks
- Re-run design review
- Update the task outcome
```

---

## 16. 重构触发条件

至少在以下情况执行一次 Refactor Checkpoint：

1. 完成一个较大模块；
2. 连续完成若干个 AI 生成任务；
3. 同一文件多次被智能体修改；
4. 出现相似逻辑第三次；
5. 新增重要抽象；
6. 一个功能需要跨越过多模块才能修改；
7. 修复一个问题导致多个不相关问题；
8. 开发者产生“代码已经不太敢动”的感觉；
9. 发布重要版本前。

不要求自动计时或后台执行。

---

## 17. 不纳入 Agent Readability

本轮明确不做以下事情：

* 不因 AI 更容易理解而更换技术栈；
* 不因 AI 更容易生成而重写成熟模块；
* 不把“Agent 可读性”列为依赖选型评分项；
* 不强制将所有复杂代码改写为简单模板；
* 不为 AI 创建与人类代码分离的特殊语言或 DSL；
* 不建立 Agent 专用镜像代码结构。

保留的使用策略：

1. 在已选择的技术栈中优先使用成熟惯用法；
2. 避免无必要的炫技写法；
3. 新代码保持命名清晰；
4. 重要边界通过类型、测试和文档表达；
5. 不改变稳定代码，只为“让模型更容易看懂”。

---

## 18. 智能体执行协议

请将以下执行协议写入合适的根导航或 Harness 文档。

### 18.1 开始任务

智能体应：

1. 阅读 `AGENTS.md`；
2. 阅读 `docs/repo-map.md`；
3. 只打开相关模块文档；
4. 检查是否存在对应 active task；
5. 对非平凡任务创建或更新任务文件；
6. 明确范围和非目标；
7. 再开始修改代码。

### 18.2 执行任务

智能体应：

* 遵守当前模块边界；
* 优先复用已有实现；
* 保持改动最小；
* 不修改无关模块；
* 不因测试方便改变业务设计；
* 记录重要架构决定；
* 不记录冗长工作日志。

### 18.3 完成任务

智能体应：

1. 执行最小相关验证；
2. 执行必要的完整验证；
3. 完成人工设计审查；
4. 执行重构检查点，适用于较大批次；
5. 更新任务 Outcome；
6. 更新必要地图或 ADR；
7. 汇总未完成事项。

---

## 19. Harness 校验脚本

如当前仓库没有类似机制，实现一个轻量 `harness:check`。

至少检查：

* `AGENTS.md` 存在；
* 仓库地图存在；
* 关键链接指向存在的文件；
* active task 文件符合基本结构；
* ADR 模板存在；
* 设计审查文件存在；
* 重构检查点文件存在；
* `AGENTS.md` 中声明的验证命令在 `package.json` 中存在；
* 文档不引用明显不存在的目录。

不要：

* 构建复杂 Markdown 解析器；
* 建立数据库；
* 引入远端服务；
* 根据自然语言自动评分代码质量；
* 阻止所有小型开发任务。

如果 active task 机制对当前仓库过重，可以只对标记为较大任务的文件执行检查。

---

## 20. 可选 CI 集成

如果当前项目已经有 CI，可以将：

```text
harness:check
verify:fast
```

增量接入。

如果当前没有 CI：

* 不要求本轮建设复杂 CI；
* 确保本地命令可执行；
* 在文档中记录建议执行顺序；
* 可以建立最小 CI，但不得偏离本轮核心目标。

个人项目不以 PR 合并速度为优化目标。

---

## 21. 现有项目内容迁移

请检查现有文档并执行以下处理：

### 保留

* 有效 README；
* 当前架构说明；
* 有价值的功能说明；
* 已使用的开发命令；
* 当前安全边界。

### 合并

* 重复的开发说明；
* 多处重复的模块列表；
* 重复的验证命令；
* 多份相似 Agent 提示。

### 删除或归档

* 已失效计划；
* 与当前代码不符的文档；
* 无实际用途的长篇 AI 生成说明；
* 重复的临时设计稿；
* 已被 ADR 取代的决策说明。

不要未经判断批量删除文件。

在删除前确认：

* 文件未被有效链接；
* 内容已过期或重复；
* 重要信息已迁移。

---

## 22. 与业务代码的边界

本轮 Harness 改造不得主动重写以下业务能力：

* Agent 工作流；
* SQL 工具；
* Python Runner；
* 图表工具；
* 报告工具；
* CSV 导入；
* ChatComposer；
* Skill Runtime；
* Artifact 数据模型。

只有在以下情况下可以小幅修改：

* 增加验证脚本入口；
* 修复文档中发现的明显错误路径；
* 为边界检查提供必要导出；
* 消除阻碍 Harness 落地的极小结构问题。

任何较大的业务重构都记录为后续任务，不在本轮执行。

---

## 23. 测试与验证

### 23.1 Harness 文件测试

验证：

* 根导航存在；
* 地图链接有效；
* ADR 模板有效；
* 任务模板有效；
* 设计审查存在；
* 重构检查点存在。

### 23.2 脚本测试

验证：

* `harness:check` 成功；
* 缺失关键文件时能失败；
* 失效链接能被发现；
* 不输出本地敏感路径；
* Windows、macOS 路径处理合理；
* 使用当前 Node.js 和包管理环境。

### 23.3 项目回归

运行仓库已有：

* Lint；
* Typecheck；
* 必要测试；
* Build。

如果已有失败与本轮无关，应明确记录，不要伪造成功。

### 23.4 人工验证

完成一次实际演练：

1. 选择仓库中一个小型真实任务或虚拟演练任务；
2. 根据 `AGENTS.md` 定位模块；
3. 创建 active task；
4. 执行验证；
5. 完成设计审查；
6. 移动到 completed；
7. 检查整个流程是否简洁可用。

不要为了演练修改无关业务代码。

---

## 24. 实现约束

请严格遵守：

1. 优先使用当前项目已有技术栈；
2. 优先使用 TypeScript 或当前脚本语言；
3. 优先遵守当前仓库结构；
4. 不大规模重构无关模块；
5. 不引入多智能体调度系统；
6. 不引入后台垃圾回收 Agent；
7. 不引入自动代码质量评分平台；
8. 不以测试数量衡量设计质量；
9. 不把测试通过描述为设计正确；
10. 不以合并速度作为个人项目核心指标；
11. 保持小步、可逆、可验证；
12. 不因为 Agent 可读性更换技术栈；
13. 不创建冗长重复的手册；
14. 仓库文档应以导航和稳定约束为主；
15. 重要事实不得只保留在对话中；
16. 文档内容必须与真实仓库路径一致；
17. 所有新增命令必须真实可运行；
18. 完成后执行机械校验和人工设计审查。

---

## 25. 验收标准

完成后应满足：

1. 仓库根目录存在简洁 `AGENTS.md`；
2. `AGENTS.md` 能正确导航主要模块；
3. 存在仓库地图；
4. 存在稳定架构概览；
5. 存在明确模块边界；
6. 存在轻量 ADR 模板；
7. 存在 active/completed 任务记录机制；
8. 存在人工设计审查清单；
9. 存在人工重构检查点；
10. 存在统一快速验证入口；
11. 存在统一完整验证入口，若当前项目适合；
12. 存在轻量 Harness 校验；
13. 文档链接有效；
14. 文档使用真实路径和命令；
15. 测试通过与设计审查被明确区分；
16. 不建设后台垃圾回收智能体；
17. 不建设高吞吐量合并系统；
18. 不以 Agent Readability 改造技术栈；
19. 现有业务功能不受影响；
20. 未大规模重构当前项目；
21. Harness 流程经过一次实际演练；
22. 最终输出记录已知限制和后续改进项。

---

## 26. P0 开发范围

本轮必须完成：

* 仓库现状审计；
* 根 `AGENTS.md`；
* 仓库地图；
* 架构概览；
* 模块边界；
* ADR 索引和模板；
* active/completed 任务机制；
* 任务模板；
* 设计审查清单；
* 重构检查点；
* 统一验证命令；
* 轻量 `harness:check`；
* 必要的 package scripts；
* 文档链接检查；
* 一次 Harness 使用演练；
* 当前仓库回归验证。

本轮不完成：

* 多智能体并行调度；
* 自动 PR 创建和合并；
* 合并队列；
* 自动垃圾回收 Agent；
* 自动质量评分；
* Agent 专用技术栈改造；
* 全量业务模块重构；
* 大型文档平台；
* 远端 Harness 服务。

---

## 27. 最终输出要求

执行完成后，请输出：

1. 新增或修改的文件列表；
2. 删除、合并或归档的过期文档；
3. 当前仓库 Harness 改造前的问题；
4. 新的 Harness 目录结构；
5. `AGENTS.md` 核心内容；
6. 仓库地图内容；
7. 架构边界内容；
8. ADR 使用规则；
9. 任务文件使用流程；
10. 机械校验范围；
11. 人工设计审查流程；
12. 人工重构检查点流程；
13. 新增或修改的 package scripts；
14. `harness:check` 实现说明；
15. 实际 Harness 演练结果；
16. 原有项目回归验证结果；
17. 已知限制；
18. 后续建议，但不要直接执行本轮非目标内容。

请直接推进实现，不要停留在理念说明。

开始前先读取当前仓库结构和现有文档，根据真实项目情况决定哪些文件需要新增、精简、合并或复用。最终结果应是一套个人开发者可以持续执行的轻量 Harness，而不是一个新的流程负担。
