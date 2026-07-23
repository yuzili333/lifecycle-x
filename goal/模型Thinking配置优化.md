# 优化存续期数据分析智能体的双模型 Thinking 配置与流式输出架构

## 一、项目背景

当前项目为“存续期数据分析智能体”，采用双模型协作架构：

* **推理模型**

  * Provider：SiliconFlow
  * Model：`Pro/moonshotai/Kimi-K2.6`
  * 当前支持：

    * `Enable Thinking`
    * `Thinking Budget`
    * 流式输出
    * `reasoning_content`
    * `content`

* **执行模型**

  * Provider：SiliconFlow
  * Model：Qwen 系列模型
  * 主要负责：

    * 用户意图识别；
    * Schema 解析；
    * SQL 生成；
    * Python 分析代码生成；
    * 图表配置生成；
    * Markdown 报告生成。

当前主要问题：

1. Kimi 开启 Thinking 后，会先输出 `reasoning_content`，再输出最终 `content`。
2. 当前前端主要关注最终正文，导致用户在 Kimi 推理期间长时间看不到可见内容。
3. Kimi Thinking 可能在整个智能体流程中被过度使用。
4. SQL、Python、图表、报告等确定性执行阶段仍可能重复使用推理模型。
5. 缺少统一的任务复杂度分级、模型路由、Thinking Budget 动态配置和流式事件协议。
6. 缺少 Thinking 延迟、首个可见内容延迟、报告首字延迟和模型成本监控。
7. 原始模型流式事件和业务层状态高度耦合，不利于后续更换模型或供应商。

---

# 二、总体目标

请对当前代码仓库进行完整分析，并实施一套面向生产环境的双模型 Thinking 配置优化方案。

最终实现以下目标：

1. 简单任务默认跳过 Kimi。
2. Kimi 只承担复杂业务决策、任务规划、异常归因和结果复核。
3. Qwen 负责路由、SQL、Python、图表和 Markdown 报告生成。
4. Qwen 执行阶段默认关闭 Thinking。
5. 根据任务复杂度动态决定：

   * 是否调用 Kimi；
   * 是否开启 Thinking；
   * Thinking Budget 档位；
   * 最大输出 Token；
   * 是否允许自动升级。
6. 用户提交任务后立即收到可见反馈，不等待 Kimi 完成推理。
7. 将模型原始流转换为统一的 Agent 业务事件流。
8. 不向用户直接暴露 Kimi 原始思维链。
9. 对模型调用、流式阶段、工具执行、Token 成本和失败降级建立可观测能力。
10. 保持现有 SQL、Python、图表和报告功能兼容，不破坏已有业务流程。

---

# 三、执行原则

## 3.1 先理解仓库，再实施改造

开始编码前必须完成以下工作：

1. 扫描仓库目录结构。
2. 定位：

   * 模型 Provider 封装；
   * SiliconFlow API 客户端；
   * Kimi 调用入口；
   * Qwen 调用入口；
   * Chat Completion 流式解析逻辑；
   * Agent 编排流程；
   * SQL 工具；
   * Python 工具；
   * 图表 Artifact 逻辑；
   * Markdown 报告生成逻辑；
   * 前端消息状态管理；
   * SSE、WebSocket 或其他流式传输层；
   * 配置文件与环境变量；
   * 日志、监控和测试目录。
3. 梳理当前一次完整数据分析请求的调用链。
4. 识别现有设计中可复用的抽象，优先增量改造，不进行无必要的大规模重写。
5. 不假设固定目录名称，必须以实际仓库结构为准。
6. 将关键架构发现记录到项目文档中。

## 3.2 保持职责边界

必须明确以下职责边界：

```text
Kimi：做决策
Qwen：生成执行指令和报告
工具层：机械执行
规则引擎：校验与约束
前端：展示业务状态和结果
```

禁止让 Kimi 默认承担：

* 所有普通问答；
* 单表查询；
* SQL 长文本生成；
* Python 代码生成；
* 图表配置生成；
* 长篇 Markdown 报告生成；
* 确定性格式转换。

禁止让 Qwen在以下场景自行猜测：

* 业务指标口径存在明显歧义；
* 多个数据源定义冲突；
* 多种分析路径会产生显著不同结论；
* 查询结果之间存在矛盾；
* 高风险业务结论缺少验证依据。

---

# 四、目标架构

请将当前流程改造为以下目标链路：

```text
用户提交请求
  ↓
立即发送 task.accepted
  ↓
Qwen 快速完成意图识别和任务复杂度路由
  ↓
流式展示用户可见的任务理解摘要
  ↓
判断是否需要 Kimi
  ├─ L0/L1：跳过 Kimi，直接进入执行
  └─ L2/L3/L4：调用 Kimi 生成结构化分析计划
  ↓
Qwen 根据计划生成 SQL / Python / Chart 指令
  ↓
工具层机械化执行
  ↓
规则引擎进行数据与权限校验
  ↓
异常时按需调用 Kimi 诊断
  ↓
Qwen 关闭 Thinking，流式生成 Markdown 报告
  ↓
发送 completed
```

---

# 五、任务复杂度分级

请建立统一的任务复杂度模型，至少支持以下等级。

## L0：确定性操作

场景包括：

* 查看数据源；
* 查看表结构；
* 查看字段含义；
* 数据预览；
* 导出已有结果；
* 调整已有报告格式；
* 对现有结果做简单说明。

配置要求：

```yaml
use_kimi: false
qwen_thinking: false
```

## L1：单步骤数据查询

场景包括：

* 单表筛选；
* 单表聚合；
* 排序；
* Top N；
* 明确口径下的风险分类统计；
* 按机构、地区、日期或产品汇总；
* 简单同比、环比查询。

配置要求：

```yaml
use_kimi: false
qwen_thinking: false
```

## L2：常规多步骤分析

场景包括：

* SQL 查询后使用 Python 计算；
* 查询结果生成图表和报告；
* 两至三个表之间的明确关联；
* 占比、集中度、迁徙率和趋势分析；
* 已明确口径的数据相关性分析。

配置要求：

```yaml
use_kimi: true
kimi_profile: standard
kimi_thinking_budget: 512
qwen_thinking: false
```

## L3：复杂业务分析

场景包括：

* 多表、多阶段分析；
* 业务指标存在歧义；
* 需要选择分析方法；
* 风险异常归因；
* 多轮 SQL、Python、图表工具编排；
* 分析结果需要交叉验证；
* 查询结果与业务预期明显不一致。

配置要求：

```yaml
use_kimi: true
kimi_profile: analytical
kimi_thinking_budget: 1024
max_auto_upgrade_budget: 2048
qwen_thinking: false
```

## L4：深度分析

场景包括：

* 跨周期、跨机构、多维度根因研究；
* 多个竞争性假设验证；
* 存续期风险专题研究；
* 高风险业务决策支持；
* 用户主动选择“深度分析”。

配置要求：

```yaml
use_kimi: true
kimi_profile: deep
kimi_thinking_budget: 4096
qwen_thinking: false
```

默认不得自动使用高于 `4096` 的 Thinking Budget，除非配置中心明确开放并且经过评测。

---

# 六、模型运行配置

## 6.1 Kimi 配置档位

建立集中式、类型安全的 Kimi 配置。

参考目标结构：

```ts
export const KIMI_THINKING_PROFILES = {
  fast: {
    enableThinking: false,
    stream: true,
    maxTokens: 2048,
  },

  standard: {
    enableThinking: true,
    thinkingBudget: 512,
    stream: true,
    maxTokens: 4096,
  },

  analytical: {
    enableThinking: true,
    thinkingBudget: 1024,
    stream: true,
    maxTokens: 8192,
  },

  complex: {
    enableThinking: true,
    thinkingBudget: 2048,
    stream: true,
    maxTokens: 12000,
  },

  deep: {
    enableThinking: true,
    thinkingBudget: 4096,
    stream: true,
    maxTokens: 16000,
  },
} as const;
```

要求：

1. 实际发送到 SiliconFlow API 时，映射到正确的字段格式。
2. 禁止业务代码散落硬编码 `thinking_budget`。
3. 配置必须可以通过环境变量或配置文件覆盖。
4. 配置必须有合法范围校验。
5. 非 Thinking 请求不得发送无意义的 `thinking_budget`。
6. 必须记录实际使用的模型档位和预算。

## 6.2 Qwen 配置档位

Qwen 默认关闭 Thinking，并按任务角色拆分配置。

参考结构：

```ts
export const QWEN_EXECUTION_PROFILES = {
  router: {
    enableThinking: false,
    stream: true,
    temperature: 0,
    maxTokens: 800,
  },

  sql: {
    enableThinking: false,
    stream: false,
    temperature: 0,
    maxTokens: 4096,
  },

  python: {
    enableThinking: false,
    stream: false,
    temperature: 0.1,
    maxTokens: 8192,
  },

  report: {
    enableThinking: false,
    stream: true,
    temperature: 0.2,
    maxTokens: 12000,
  },
} as const;
```

要求：

1. SQL 与 Python 输出优先使用结构化格式。
2. SQL 和 Python 阶段不要求向用户逐 Token 展示模型文本。
3. 即使模型调用不流式展示，也必须通过 Agent 业务事件显示执行进度。
4. 最终 Markdown 报告必须支持流式输出。
5. Qwen 模型名称不得硬编码到业务逻辑，必须由配置中心管理。

---

# 七、模型路由器

请新增或重构统一的模型路由器。

## 7.1 路由输入

路由器至少接收：

```ts
interface TaskRoutingInput {
  userMessage: string;
  conversationContext?: unknown;
  selectedDataSources?: string[];
  selectedSkills?: string[];
  hasUploadedCsv?: boolean;
  schemaSummary?: unknown;
  requestedOutput?: "text" | "table" | "chart" | "report";
  userRequestedDeepAnalysis?: boolean;
}
```

## 7.2 路由输出

Qwen 路由阶段必须返回经过 Schema 校验的结构化结果：

```ts
interface TaskRoute {
  taskType:
    | "metadata"
    | "single_query"
    | "multi_step_analysis"
    | "root_cause_analysis"
    | "deep_research"
    | "report_generation";

  complexity: "L0" | "L1" | "L2" | "L3" | "L4";

  requiresKimi: boolean;
  requiresSql: boolean;
  requiresPython: boolean;
  requiresChart: boolean;
  requiresReport: boolean;

  ambiguities: Array<{
    field: string;
    description: string;
    blocking: boolean;
  }>;

  userVisibleSummary: string;

  confidence: number;
}
```

要求：

1. 使用 JSON Schema、Zod 或项目现有结构化校验方案。
2. 路由结果不合法时执行有限次数修复。
3. 路由失败时采用保守默认策略。
4. 不允许因路由失败直接启用最高 Thinking Budget。
5. 路由器必须可单元测试。
6. 对用户可见的摘要不得包含内部 Prompt、Schema 全文或敏感字段。

---

# 八、Kimi 结构化规划协议

Kimi 不应直接生成长篇自然语言报告。

请设计并实现结构化分析计划协议：

```ts
interface AnalysisPlan {
  goal: string;

  businessDefinitions: Array<{
    metric: string;
    definition: string;
    source?: string;
  }>;

  requiredData: Array<{
    source?: string;
    table: string;
    fields: string[];
    purpose: string;
  }>;

  steps: Array<{
    id: string;
    type:
      | "schema"
      | "sql"
      | "python"
      | "chart"
      | "validation"
      | "report";
    purpose: string;
    dependsOn?: string[];
  }>;

  validationRules: Array<{
    id: string;
    description: string;
    severity: "info" | "warning" | "error";
  }>;

  reportOutline: string[];

  assumptions: string[];

  unresolvedAmbiguities: string[];
}
```

要求：

1. Kimi 的最终 `content` 必须解析为 `AnalysisPlan`。
2. `reasoning_content` 不得直接拼入最终计划。
3. 计划解析失败时进行一次结构化修复。
4. 第二次仍失败时降级到 Qwen 的保守计划。
5. 所有计划步骤必须具有稳定 `stepId`。
6. 计划必须可以映射到现有工作流或状态机。
7. 计划内容必须记录到审计日志。

---

# 九、Thinking 动态升级机制

建立受控的 Thinking Budget 升级策略。

## 9.1 从 512 升级至 1024

满足任一条件时允许升级：

* 涉及三个及以上数据表；
* 存在一个以上非阻塞业务歧义；
* 用户要求解释原因；
* 需要选择统计分析方法；
* SQL 查询结果与业务预期不一致；
* 需要第二轮验证查询；
* 数据质量校验出现警告。

## 9.2 从 1024 升级至 2048

满足任一条件时允许升级：

* 多个分析结论相互矛盾；
* 需要构建多个根因假设；
* 需要三轮及以上工具调用；
* 缺失值或异常值影响主要结论；
* 涉及风险迁徙、跨周期和多维归因；
* 第一次 Kimi 异常诊断未解决问题。

## 9.3 使用 4096

仅允许：

* 用户主动选择深度分析；
* 路由结果为 L4；
* 系统配置明确允许；
* 当前任务未超过成本和时间限制。

## 9.4 升级约束

1. 不得因解析失败直接升级预算。
2. 不得无限重试。
3. 每个任务必须设置最大 Kimi 调用次数。
4. 每个任务必须设置最大累计 Thinking Budget。
5. 升级原因必须写入日志。
6. 已经得到可靠执行计划后，不得继续提高预算。
7. 报告生成阶段不得因文本质量问题重新调用高预算 Kimi。

---

# 十、统一 Agent 流式事件协议

请在模型流和前端之间增加统一业务事件层。

建议事件类型：

```ts
type AgentStreamEvent =
  | {
      type: "task.accepted";
      taskId: string;
      message: string;
      timestamp: number;
    }
  | {
      type: "task.summary.delta";
      taskId: string;
      content: string;
      timestamp: number;
    }
  | {
      type: "routing.completed";
      taskId: string;
      route: TaskRoute;
      timestamp: number;
    }
  | {
      type: "planning.started";
      taskId: string;
      profile: string;
      timestamp: number;
    }
  | {
      type: "planning.progress";
      taskId: string;
      message: string;
      timestamp: number;
    }
  | {
      type: "plan.completed";
      taskId: string;
      plan: AnalysisPlan;
      timestamp: number;
    }
  | {
      type: "tool.started";
      taskId: string;
      stepId: string;
      tool: string;
      message: string;
      timestamp: number;
    }
  | {
      type: "tool.progress";
      taskId: string;
      stepId: string;
      tool: string;
      message: string;
      timestamp: number;
    }
  | {
      type: "tool.completed";
      taskId: string;
      stepId: string;
      tool: string;
      resultPreview?: unknown;
      timestamp: number;
    }
  | {
      type: "validation.completed";
      taskId: string;
      passed: boolean;
      issues: unknown[];
      timestamp: number;
    }
  | {
      type: "report.delta";
      taskId: string;
      content: string;
      timestamp: number;
    }
  | {
      type: "completed";
      taskId: string;
      timestamp: number;
    }
  | {
      type: "failed";
      taskId: string;
      code: string;
      message: string;
      recoverable: boolean;
      timestamp: number;
    };
```

要求：

1. 页面不得依赖 SiliconFlow 原始事件格式。
2. Provider 层负责解析：

   * `reasoning_content`
   * `content`
   * 完成原因；
   * usage；
   * 错误事件。
3. Agent 层负责转换为业务事件。
4. 前端只消费 Agent 业务事件。
5. 必须兼容取消请求。
6. 必须处理客户端断线。
7. 必须避免重复事件和乱序事件。
8. 必须保留 Task ID、Step ID 和事件时间戳。
9. 事件协议必须有运行时校验和 TypeScript 类型。
10. 若项目已有通用事件协议，应优先扩展而非另建重复协议。

---

# 十一、用户首屏体验

用户提交请求后，不得等待模型返回才显示内容。

必须实现以下体验：

```text
0. 用户点击发送
1. 立即创建本地消息和任务卡片
2. 显示“已接收分析任务”
3. Qwen 流式输出任务理解摘要
4. 复杂任务显示“正在规划分析路径”
5. 工具执行时显示具体进度
6. 首批数据返回后显示结果预览
7. Qwen 流式生成最终 Markdown 报告
```

前端状态建议：

```ts
type AgentPhase =
  | "accepted"
  | "routing"
  | "planning"
  | "querying"
  | "analyzing"
  | "charting"
  | "validating"
  | "reporting"
  | "completed"
  | "failed"
  | "cancelled";
```

界面文案示例：

```text
已接收分析任务
正在理解分析目标
正在规划分析路径
正在读取数据表
正在执行查询
正在计算分析指标
正在生成图表
正在校验分析结果
正在生成分析报告
分析完成
```

禁止：

* 将完整原始思维链直接展示给用户；
* 在没有任何反馈的情况下等待 Kimi 完成；
* 将 `reasoning_content` 与 Markdown 报告正文混合；
* 用不透明的单一“加载中”覆盖所有阶段。

---

# 十二、Reasoning Content 处理

## 12.1 默认策略

```yaml
show_raw_reasoning: false
persist_raw_reasoning: false
```

## 12.2 使用方式

收到 Kimi `reasoning_content` 时：

1. 更新 `planning.progress`；
2. 更新 Kimi 首事件时间；
3. 记录推理仍在进行；
4. 可显示通用状态：

   * 正在识别业务口径；
   * 正在规划数据查询；
   * 正在校验分析路径。
5. 不直接将原始文本发送给前端。

## 12.3 审计内容

需要保存：

* 路由结果；
* 模型档位；
* Thinking Budget；
* Kimi 结构化计划；
* 实际 SQL；
* SQL 参数；
* Python 脚本；
* 工具调用结果摘要；
* 校验结果；
* Chart Artifact；
* 最终 Markdown 报告；
* Token 使用情况；
* 各阶段耗时；
* 降级和重试原因。

默认不保存：

* Kimi 原始完整思维链；
* 未脱敏中间推理文本；
* 无业务价值的模型自我修正过程。

---

# 十三、上下文压缩与 Schema 注入

优化 Kimi 输入上下文，禁止每次注入全量数据。

实现分层上下文：

```text
第一层：业务域摘要
第二层：数据源与候选表摘要
第三层：选中表字段
第四层：指标口径
第五层：当前任务状态与必要结果摘要
```

推荐上下文结构：

```ts
interface ReasoningContext {
  userGoal: string;
  businessDomain: string;

  selectedSources: Array<{
    id: string;
    type: "database" | "csv" | "temporary_table";
    description?: string;
  }>;

  candidateTables: Array<{
    name: string;
    description?: string;
    relevantFields?: string[];
  }>;

  metricDefinitions: Array<{
    name: string;
    definition: string;
  }>;

  previousStepResults: Array<{
    stepId: string;
    summary: string;
  }>;

  constraints: {
    readOnly: boolean;
    maxRows?: number;
    sensitiveFieldsMasked: boolean;
    allowedSchemas?: string[];
  };
}
```

要求：

1. 只注入相关表和字段。
2. 不注入无关历史 SQL。
3. 不注入完整 Python 原始输出。
4. 大结果必须先摘要。
5. 敏感字段必须脱敏。
6. 必须设置上下文 Token 预算。
7. 超出预算时按优先级裁剪。
8. 裁剪逻辑必须可测试和可观测。

---

# 十四、工具执行与异常处理

## 14.1 SQL 阶段

流程：

```text
Qwen 生成 SQL
  ↓
只读规则校验
  ↓
权限校验
  ↓
语法与表字段校验
  ↓
扫描量和行数限制
  ↓
用户审批（若现有流程要求）
  ↓
执行查询
```

失败策略：

```text
第一次失败
→ Qwen 根据数据库错误修复 SQL

第二次失败
→ Kimi 使用 512 Budget 诊断业务关系或 Schema 选择

第三次失败
→ 停止自动重试并返回明确错误
```

## 14.2 Python 阶段

要求：

* 继续使用现有沙箱和审批机制；
* 输入数据通过文件、临时表或明确对象传递；
* 不将大规模数据直接塞回模型上下文；
* Python 结果先形成结构化摘要；
* 图表所需数据和分析结论分离保存。

## 14.3 图表阶段

要求：

* 继续使用现有 Chart Artifact 机制；
* 图表配置由 Qwen 生成；
* 图表数据必须引用确定的数据结果；
* 图表 Artifact 与 Markdown 报告通过稳定引用关联；
* 禁止 Kimi 直接输出最终前端图表代码。

## 14.4 数据校验失败

流程：

```text
规则引擎发现异常
  ↓
定位异常指标
  ↓
Kimi 生成验证假设
  ↓
Qwen 生成验证 SQL / Python
  ↓
重新执行
  ↓
更新结论可信度
```

---

# 十五、超时、取消与降级

## 15.1 Kimi 无首事件

建立可配置阈值。

若达到阈值仍未收到任何流式事件：

1. 取消本次 Kimi 请求；
2. 标记为 `reasoner_first_event_timeout`；
3. 使用 Qwen 生成保守计划；
4. 限制为只读、小数据量和明确口径分析；
5. 向用户显示已降级执行，但不要暴露内部错误细节。

## 15.2 Kimi 持续推理但无最终计划

若持续收到 `reasoning_content`，但没有得到合法 `AnalysisPlan`：

1. 达到应用层最大规划时间后中断；
2. 不自动提高 Thinking Budget；
3. 使用 Qwen 生成保守计划；
4. 记录 `reasoning_overrun`；
5. 保留已完成的任务摘要和上下文；
6. 继续执行可安全完成的步骤。

## 15.3 Provider 错误

处理：

* `429`
* `500`
* `502`
* `503`
* `504`
* 网络断开
* 流格式异常
* JSON 结构异常

要求：

1. 使用有限次数重试。
2. 使用指数退避和抖动。
3. 重试必须具备幂等性。
4. Kimi 不可用时允许降级为 Qwen 保守分析。
5. 不得自动切换到未经配置和评测的模型。
6. 降级策略必须配置化。
7. 用户取消后不得继续后台执行或继续计费。

---

# 十六、可观测性

请实现以下指标。

## 16.1 延迟指标

```text
task_ack_latency
router_latency
first_visible_content_latency
kimi_first_event_latency
kimi_reasoning_duration
plan_latency
first_tool_start_latency
first_result_preview_latency
report_ttft
total_task_latency
```

## 16.2 Token 与成本指标

```text
kimi_prompt_tokens
kimi_reasoning_tokens
kimi_output_tokens
qwen_prompt_tokens
qwen_output_tokens
thinking_budget_requested
thinking_budget_actual
estimated_cost
```

如果 Provider 不返回实际 reasoning token，应记录为未知，不得伪造。

## 16.3 质量指标

```text
sql_first_pass_success_rate
sql_auto_repair_rate
validation_pass_rate
plan_execution_completion_rate
kimi_invocation_rate
kimi_budget_upgrade_rate
simple_task_false_positive_kimi_rate
fallback_rate
user_cancel_rate
report_regeneration_rate
```

## 16.4 日志要求

每个任务的日志必须包含：

* `taskId`
* `conversationId`
* `route`
* `complexity`
* `model`
* `profile`
* `thinkingBudget`
* `stepId`
* `tool`
* `duration`
* `status`
* `fallbackReason`
* `usage`

不得在普通日志中记录：

* 数据库密码；
* API Key；
* 完整敏感数据；
* 原始思维链；
* 未脱敏客户信息。

---

# 十七、配置中心与 Feature Flag

新增或完善配置中心，至少支持：

```ts
interface ThinkingOptimizationConfig {
  enabled: boolean;

  reasonerModel: string;
  executorModel: string;

  defaultKimiProfile: string;
  maxThinkingBudget: number;
  maxKimiCallsPerTask: number;
  maxCumulativeThinkingBudget: number;

  rawReasoningVisible: boolean;
  rawReasoningPersisted: boolean;

  enableDynamicRouting: boolean;
  enableAutomaticBudgetUpgrade: boolean;
  enableQwenFallback: boolean;

  firstEventTimeoutMs: number;
  planningTimeoutMs: number;

  rolloutPercentage: number;
}
```

要求：

1. 支持开发、测试、生产环境不同配置。
2. 支持快速关闭动态 Thinking。
3. 支持按用户、会话或任务进行灰度。
4. 支持回退到现有流程。
5. 配置读取失败时采用安全默认值。
6. 不将密钥提交到仓库。

---

# 十八、测试要求

必须新增或完善测试。

## 18.1 单元测试

至少覆盖：

* L0–L4 路由；
* Kimi 配置档位选择；
* Thinking Budget 升级；
* 最大预算约束；
* 最大 Kimi 调用次数；
* SiliconFlow 请求参数映射；
* `reasoning_content` 解析；
* `content` 解析；
* `AnalysisPlan` 校验；
* Agent 事件转换；
* 上下文裁剪；
* Provider 错误归一化；
* 取消请求；
* Qwen 降级。

## 18.2 集成测试

至少覆盖：

1. L1 单表查询跳过 Kimi。
2. L2 分析使用 Kimi 512 Budget。
3. L3 异常归因升级到 1024。
4. 第一次异常诊断失败后升级到 2048。
5. L4 深度分析使用 4096。
6. Kimi 无首事件时降级。
7. Kimi 返回非法 JSON 时修复并降级。
8. SQL 第一次失败后由 Qwen 修复。
9. SQL 第二次失败后调用 Kimi。
10. Qwen 流式生成 Markdown 报告。
11. 用户取消后停止所有下游执行。
12. 前端持续收到业务状态事件。

## 18.3 流式测试

使用模拟 SSE 数据验证：

```text
reasoning_content → reasoning_content → content → content → done
```

确保：

* reasoning 不进入报告正文；
* planning 状态及时更新；
* content 正确形成结构化计划；
* 最终报告使用独立 `report.delta`；
* 不丢 Chunk；
* 不重复 Chunk；
* 断流可恢复或明确失败。

## 18.4 回归测试

确保现有功能继续可用：

* 数据源选择；
* CSV 导入；
* Schema Context；
* SQL 查询；
* Python 分析；
* 图表 Artifact；
* Markdown 渲染；
* 报告卡片；
* 多轮对话；
* Skill 调用；
* 审批机制；
* 权限校验。

---

# 十九、验收标准

只有同时满足以下条件，任务才视为完成。

## 19.1 架构验收

* [ ] Kimi 与 Qwen 职责边界明确。
* [ ] Thinking 不再是全局静态配置。
* [ ] 已实现 L0–L4 任务复杂度分级。
* [ ] 已实现动态模型路由。
* [ ] 已实现 Kimi 配置档位。
* [ ] 已实现 Qwen 执行配置档位。
* [ ] 已实现结构化 `AnalysisPlan`。
* [ ] 已实现统一 Agent 流式事件协议。
* [ ] 前端不再直接依赖 SiliconFlow 原始事件格式。

## 19.2 用户体验验收

* [ ] 用户提交后立即显示任务已接收。
* [ ] 路由和规划阶段有可见状态。
* [ ] 工具执行有明确进度。
* [ ] 首批结果可提前展示。
* [ ] Markdown 报告支持流式输出。
* [ ] 原始 `reasoning_content` 不进入报告正文。
* [ ] 用户可以取消执行。
* [ ] 降级时有清晰但不过度暴露内部细节的提示。

## 19.3 模型配置验收

* [ ] L0/L1 默认跳过 Kimi。
* [ ] L2 默认使用 512 Budget。
* [ ] L3 默认使用 1024，并最多自动升级至 2048。
* [ ] L4 使用 4096。
* [ ] Qwen 默认关闭 Thinking。
* [ ] 报告生成阶段不调用高预算 Kimi。
* [ ] 配置可以通过环境变量或配置中心覆盖。
* [ ] 预算和调用次数有硬性上限。

## 19.4 稳定性验收

* [ ] Provider 超时可降级。
* [ ] 非法结构化输出可修复或降级。
* [ ] 重试次数有限。
* [ ] 请求取消后不继续执行。
* [ ] 所有关键阶段有日志。
* [ ] 所有关键延迟和 Token 指标可观测。
* [ ] 现有核心业务流程无回归。

## 19.5 测试验收

* [ ] 新增单元测试通过。
* [ ] 新增集成测试通过。
* [ ] 流式模拟测试通过。
* [ ] 原有测试通过。
* [ ] TypeScript 类型检查通过。
* [ ] Lint 通过。
* [ ] 构建通过。

---

# 二十、交付物

完成改造后必须提交以下内容：

1. 实际代码修改。
2. 模型配置中心。
3. 任务复杂度路由器。
4. Kimi Thinking Profile。
5. Qwen Execution Profile。
6. Kimi 结构化规划协议。
7. Agent 统一流式事件协议。
8. Provider 流式适配器。
9. 前端状态与进度展示改造。
10. 超时、取消、重试与降级逻辑。
11. 可观测指标与结构化日志。
12. 单元测试、集成测试和流式测试。
13. 架构说明文档。
14. 配置说明文档。
15. 迁移与回滚说明。
16. 测试报告或验证记录。

---

# 二十一、文档要求

请在仓库中补充一份 Markdown 文档，至少包括：

```text
1. 改造背景
2. 当前调用链
3. 目标架构
4. 双模型职责
5. L0-L4 路由规则
6. Thinking Budget 策略
7. Agent 流式事件协议
8. Reasoning Content 处理
9. 超时与降级
10. 配置项
11. 监控指标
12. 测试方法
13. 灰度发布
14. 回滚方案
```

文档中应包含 Mermaid 架构图和时序图，但不要依赖图形才能理解核心设计。

---

# 二十二、实施顺序

按照以下顺序实施，避免一次性重写。

## Phase 1：基线分析

* 扫描仓库；
* 定位现有调用链；
* 记录当前配置和流式机制；
* 找出最小改造边界。

## Phase 2：配置与协议

* 建立模型配置中心；
* 增加 Kimi/Qwen Profile；
* 定义 TaskRoute；
* 定义 AnalysisPlan；
* 定义 AgentStreamEvent。

## Phase 3：Provider 适配

* 正确解析 Kimi `reasoning_content`；
* 正确解析最终 `content`；
* 统一 Usage 和错误；
* 实现取消和超时。

## Phase 4：路由与编排

* 实现 L0–L4 路由；
* 实现 Kimi 按需调用；
* 实现 Thinking Budget 升级；
* 实现 Qwen 保守降级。

## Phase 5：前端体验

* 立即展示任务状态；
* 展示路由、规划和工具进度；
* 流式展示 Markdown 报告；
* 处理取消和错误。

## Phase 6：可观测性

* 增加延迟指标；
* 增加 Token 和成本指标；
* 增加质量指标；
* 补充结构化日志。

## Phase 7：测试和文档

* 完成测试；
* 完成构建检查；
* 更新文档；
* 输出迁移与回滚说明。

---

# 二十三、实现约束

1. 优先使用仓库现有技术栈和依赖。
2. 不引入与现有架构重复的大型框架。
3. 不修改无关业务逻辑。
4. 不删除现有功能，除非确认是废弃代码。
5. 不在代码中硬编码 API Key。
6. 不直接展示或持久化原始思维链。
7. 不绕过 SQL 只读、权限和审批机制。
8. 不让模型直接执行任意系统命令。
9. 不让高预算 Thinking 成为错误恢复的默认手段。
10. 不将模型输出未经校验直接作为工具参数。
11. 所有新增结构化输出必须经过运行时 Schema 校验。
12. 所有行为变化必须有测试或明确验证记录。
13. 发现现有代码与本提示词冲突时，以业务安全、向后兼容和最小改造为优先原则。
14. 对无法从仓库确认的细节，不要虚构实现；采用可配置抽象并在文档中记录假设。

---

# 二十四、最终输出格式

完成实施后，请在 Codex 最终回复中按以下结构汇报：

```markdown
# 实施结果

## 1. 仓库现状与关键发现

## 2. 已完成的架构改造

## 3. Thinking 配置策略

## 4. 双模型调用链变化

## 5. 流式体验改造

## 6. 新增或修改的主要文件

## 7. 测试与验证结果

## 8. 可观测指标

## 9. 兼容性与迁移说明

## 10. 未完成项或已知限制
```

必须明确说明：

* 实际完成了什么；
* 哪些内容没有完成；
* 是否存在构建或测试失败；
* 是否存在无法验证的假设；
* 如何启用、关闭和回滚本次优化。
