# 存续期数据探针智能体｜Agent 工作流异常处理与用户引导能力优化

你现在是一个资深 TypeScript / React / Electron / AI Agent / Workflow Runtime / Tool Calling / 数据安全工程师。围绕项目 **“存续期数据探针智能体 / Cycle Data Intelligence Agent”** 优化现有的 **“Agent 工作流异常处理与用户引导”** 能力。

项目主要支持：

1. 数据源和字段理解；
2. SQL 数据查询；
3. Python 数据分析；
4. 图表绘制；
5. Markdown 报告生成；
6. 多轮对话中的查询条件调整；
7. 工具审批；
8. 工具执行结果和数据集状态管理；
9. 会话级工作流恢复。

当前存在以下问题：

* 用户需求描述不完整时，Agent 未引导用户补充必要信息；
* 未识别出工具或字段参数后，工作流直接停止；
* 查询完成后未提示用户可以继续分析、绘图或生成报告；
* 工具参数缺失或错误时，没有提供参数修复机会；
* 工具调用失败后，仅展示错误，没有可执行的恢复路径；
* 工作流出现断点后，Agent 与用户都停在原地；
* 部分错误场景可能使用模拟数据、默认值或模型推测进行兜底，影响数据准确性；
* 工作流状态缺少“等待用户补充”“等待参数修复”“可恢复失败”等明确状态。

本次任务需要建立一套：

> **可引导、可补充、可修复、可恢复、不可伪造数据的 Agent 工作流异常处理机制。**

请直接检查当前仓库并推进实现，不要只输出设计方案。

请优先遵守当前项目结构，复用现有 Agent Runtime、Workflow、Tool Registry、SQL Tool、Python Runner、Chart Tool、Report Tool、Memory、ChatComposer 和消息卡片组件，不要大规模重构无关模块。

---

## 1. 核心目标

请完成以下目标：

1. 用户需求不完整时，不直接结束工作流；
2. 自动识别当前工作流缺少的信息；
3. 生成具体、可操作的补充引导；
4. 支持用户在后续一轮补充缺失参数后继续原工作流；
5. 工具参数错误时提供修复机会；
6. 工具执行失败时提供明确的异常原因和恢复操作；
7. 工作流断点可以恢复；
8. 查询完成后主动提示后续可执行动作；
9. Python 分析完成后提示可绘图或生成报告；
10. 图表完成后提示可修改图表或用于报告；
11. 报告完成后提示可基于当前版本继续调整；
12. 不得使用模拟数据、虚构字段、猜测结果或伪造工具执行结果兜底；
13. 只有用户明确放弃、取消或结束时，才终止当前工作流；
14. 不可恢复错误也需要给出明确解决路径；
15. 所有异常和恢复动作可追踪、可审计；
16. 用户补充信息后，不要求重新描述全部需求；
17. 保留之前已经成功完成的工具结果和数据集；
18. 单个步骤失败不得清空整个工作流状态；
19. 不允许失败调用覆盖最近一次成功结果；
20. UI 中提供清晰的引导提示和快捷操作。

---

## 2. 核心原则

### 2.1 引导优先

当用户描述不足、参数缺失、字段不明确或数据源未选择时，应优先：

```text
识别缺失内容
→ 生成具体补充问题
→ 工作流进入等待用户补充状态
→ 用户补充后继续执行
```

不得直接：

```text
无法执行
→ 结束
```

### 2.2 数据准确性优先

发生异常时禁止以下兜底：

* 使用模拟数据；
* 使用示例数据代替真实结果；
* 模型自行假设字段；
* 模型编造缺失参数；
* 基于少量 preview rows 推断全量结果；
* 使用历史结果冒充当前查询结果；
* 工具失败后由模型自行计算结果；
* 数据缺失时生成带具体数值的报告。

正确方式：

```text
缺少真实数据或参数
→ 明确说明缺少什么
→ 引导用户补充
→ 或提供重新查询、重新选择数据源、重新选择字段等操作
```

### 2.3 可恢复优先

除非用户明确说：

```text
取消
停止
放弃本轮任务
不用继续了
```

否则工作流不应进入永久终止状态。

### 2.4 保留成功结果

例如：

```text
SQL 查询成功
→ Python 分析失败
```

此时应：

* 保留 SQL 查询结果；
* 保留 SQLite 临时数据集；
* 允许修改分析规则后重新执行 Python；
* 不重新查询数据库，除非分析输入需要改变。

### 2.5 引导必须具体

禁止提示：

```text
请补充信息。
参数错误。
无法继续。
```

推荐提示：

```text
当前缺少用于统计“笔数”的唯一标识字段。请选择合同编号、借据编号或其他可唯一标识一笔业务的字段。
```

---

## 3. 典型场景

### 3.1 用户需求描述不完整

用户输入：

```text
分析风险分布。
```

系统已知用户需要分析“分布”，但缺少：

* 数据源；
* 目标字段；
* 指标口径；
* 是否按笔数、金额或两者分析。

工作流不得停止，应生成引导：

```text
可以继续分析，但还需要确认以下信息：

1. 使用哪个数据源？
2. “风险分布”对应哪个分类字段？
3. 需要按笔数、金额，还是同时按两个维度统计？

当前可选字段包括：五级分类、十二级分类、贷款余额、合同金额。
```

### 3.2 未识别到可用字段

用户输入：

```text
统计不良贷款分布。
```

当前数据源中没有明确标记为“五级分类”的字段，但存在：

```text
risk_level
risk_type
asset_status
```

系统应：

* 展示候选字段；
* 展示字段类型和少量脱敏样例；
* 让用户选择；
* 不得自行选择其中一个字段。

### 3.3 SQL 工具参数缺失

SQL 工具缺少：

```text
dataSourceId
tableName
classificationField
```

系统应进入：

```text
waiting_for_parameters
```

并提示用户补充或选择。

### 3.4 SQL 执行完成后缺少后续引导

查询完成后应提示：

```text
已查询到 1,250 条记录，并保存为当前会话数据集。

接下来可以：
- 继续缩小数据范围；
- 执行统计分析；
- 绘制图表；
- 生成分析报告。
```

### 3.5 Python 工具执行失败

例如缺少分析字段：

```text
Python 脚本引用了“贷款余额”字段，但当前输入数据集中不存在该字段。
```

系统应提供：

* 重新选择字段；
* 修改分析规则；
* 返回上一步重新查询；
* 使用现有可用字段继续分析。

不得直接结束工作流。

### 3.6 图表工具失败

例如字段类型不适合：

```text
当前选择的“客户名称”字段为文本，无法作为数值轴。
```

系统应提示：

* 选择数值指标；
* 改为计数图表；
* 改用表格展示；
* 返回修改图表需求。

### 3.7 报告生成缺少结果

用户要求生成报告，但没有 SQL 或 Python 结果。

系统应提示：

```text
当前没有可用于生成数据分析报告的真实分析结果。

可以先：
1. 选择数据源并查询；
2. 使用上一轮已成功的数据集；
3. 上传 CSV 后执行分析。
```

不得生成带虚构结论的报告。

---

## 4. 推荐目录结构

请先检查当前仓库结构并复用已有模块。

如无对应结构，可参考：

```text
src/
  ai/
    workflow/
      workflow-runtime.ts
      workflow-state-machine.ts
      workflow-recovery-manager.ts
      workflow-checkpoint-store.ts
      workflow-errors.ts

    guidance/
      index.ts
      types.ts
      guidance-engine.ts
      missing-input-detector.ts
      parameter-repair-engine.ts
      next-action-recommender.ts
      guidance-message-builder.ts
      guidance-policy.ts
      guidance-errors.ts

    tool-orchestration/
      tool-plan-validator.ts
      tool-input-resolver.ts
      tool-error-recovery.ts
      tool-result-registry.ts

    __tests__/
      guidance-engine.test.ts
      missing-input-detector.test.ts
      parameter-repair-engine.test.ts
      workflow-recovery-manager.test.ts
      next-action-recommender.test.ts

  renderer/
    components/
      agent-guidance/
        AgentGuidanceCard.tsx
        MissingParameterCard.tsx
        WorkflowRecoveryCard.tsx
        NextActionCard.tsx
        GuidanceActionButton.tsx
        index.ts
```

如果已有：

* Workflow Runtime；
* Tool Execution Engine；
* ConversationToolState；
* Approval Workflow；
* ChatComposer；
* Tool Call Card；
* Error Boundary；
* Memory；

请增量扩展，不要创建重复状态系统。

---

## 5. 工作流状态扩展

请扩展现有工作流状态。

```ts
export type AgentWorkflowStatus =
  | 'draft'
  | 'planning'
  | 'ready'
  | 'executing'
  | 'waiting_for_user_input'
  | 'waiting_for_parameters'
  | 'waiting_for_field_selection'
  | 'waiting_for_data_source'
  | 'waiting_for_approval'
  | 'recoverable_error'
  | 'retrying'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';
```

### 5.1 状态含义

#### waiting_for_user_input

缺少业务需求描述，例如：

* 分析目标；
* 时间范围；
* 指标口径；
* 输出形式。

#### waiting_for_parameters

已识别工具，但工具参数缺失或不合法。

#### waiting_for_field_selection

需要用户从候选字段中选择。

#### waiting_for_data_source

当前没有可访问数据源。

#### recoverable_error

工具或步骤失败，但可以通过：

* 修改参数；
* 更换字段；
* 重新审批；
* 重新执行；
* 返回上一步；

继续工作流。

#### paused

工作流暂时停止，但状态、数据集和结果仍保留。

#### failed

仅用于确认无法恢复的系统级错误。

进入 `failed` 前必须确认：

* 无可用恢复动作；
* 错误不是用户输入可修复；
* 错误不是工具参数可修复；
* 错误不是数据源、字段或审批问题；
* 已记录详细异常。

---

## 6. 异常分类

请定义统一异常类型。

```ts
export type AgentWorkflowIssueCategory =
  | 'intent_incomplete'
  | 'data_source_missing'
  | 'field_missing'
  | 'field_ambiguous'
  | 'parameter_missing'
  | 'parameter_invalid'
  | 'approval_required'
  | 'approval_rejected'
  | 'tool_execution_failed'
  | 'tool_execution_timeout'
  | 'dataset_empty'
  | 'dataset_expired'
  | 'permission_denied'
  | 'workflow_interrupted'
  | 'artifact_missing'
  | 'report_input_missing'
  | 'system_error';
```

### 6.1 可恢复性

```ts
export type IssueRecoverability =
  | 'user_input_required'
  | 'parameter_repair'
  | 'retryable'
  | 'return_to_previous_step'
  | 'select_alternative'
  | 'not_recoverable';
```

### 6.2 统一异常结构

```ts
export type AgentWorkflowIssue = {
  issueId: string;
  workflowId: string;
  conversationId: string;
  stepId?: string;
  toolCallId?: string;

  category: AgentWorkflowIssueCategory;
  recoverability: IssueRecoverability;

  code: string;
  title: string;
  message: string;

  missingInputs?: MissingWorkflowInput[];
  invalidParameters?: InvalidToolParameter[];
  candidateFields?: CandidateField[];
  availableActions: WorkflowRecoveryAction[];

  preserveCurrentState: boolean;
  userActionRequired: boolean;

  createdAt: string;
  metadata?: Record<string, unknown>;
};
```

---

## 7. 缺失信息检测

请实现 `MissingInputDetector`。

### 7.1 检测维度

至少检测：

* 数据源；
* 表；
* 字段；
* 时间范围；
* 分组维度；
* 数值指标；
* 聚合方式；
* 查询条件；
* 分析规则；
* 图表类型；
* 报告结构；
* 工具审批；
* 输出用途。

### 7.2 类型

```ts
export type MissingWorkflowInput = {
  key: string;
  label: string;

  type:
    | 'data_source'
    | 'table'
    | 'field'
    | 'date_range'
    | 'metric'
    | 'dimension'
    | 'filter'
    | 'aggregation'
    | 'analysis_rule'
    | 'chart_type'
    | 'report_requirement'
    | 'approval';

  required: boolean;
  description: string;

  candidates?: MissingInputCandidate[];
};
```

```ts
export type MissingInputCandidate = {
  value: string;
  label: string;
  description?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};
```

### 7.3 检测结果

```ts
export type MissingInputDetectionResult = {
  complete: boolean;
  missingInputs: MissingWorkflowInput[];
  warnings: string[];
  nextStatus?: AgentWorkflowStatus;
};
```

---

## 8. 工具参数校验与修复

请实现 `ParameterRepairEngine`。

### 8.1 参数错误类型

```ts
export type InvalidToolParameter = {
  parameterName: string;
  value?: unknown;

  reason:
    | 'missing'
    | 'invalid_type'
    | 'out_of_range'
    | 'not_found'
    | 'permission_denied'
    | 'incompatible'
    | 'expired';

  message: string;
  candidates?: MissingInputCandidate[];
};
```

### 8.2 修复原则

参数错误时：

1. 保留原工具调用计划；
2. 不执行工具；
3. 标记缺失或错误参数；
4. 生成参数修复引导；
5. 用户补充后重新验证；
6. 验证通过后继续原步骤；
7. 不重新识别整个工作流，除非用户改变任务目标。

### 8.3 示例

原工具参数：

```json
{
  "purpose": "统计风险分布",
  "classificationField": null,
  "amountField": "贷款余额"
}
```

修复引导：

```text
当前缺少“风险分类字段”。

可选字段：
- 五级分类
- 十二级分类
- 风险等级

请选择一个字段作为分组维度。
```

---

## 9. 用户引导模型

请定义统一引导结构。

```ts
export type AgentGuidance = {
  guidanceId: string;
  workflowId: string;
  conversationId: string;

  type:
    | 'clarification'
    | 'parameter_request'
    | 'field_selection'
    | 'data_source_selection'
    | 'error_recovery'
    | 'next_action'
    | 'confirmation';

  title: string;
  message: string;

  requiredInputs?: MissingWorkflowInput[];
  actions: AgentGuidanceAction[];

  blocking: boolean;
  resumeToken?: string;

  createdAt: string;
};
```

### 9.1 引导动作

```ts
export type AgentGuidanceAction = {
  actionId: string;

  type:
    | 'select_candidate'
    | 'provide_text'
    | 'retry'
    | 'edit_parameters'
    | 'select_data_source'
    | 'select_fields'
    | 'return_to_query'
    | 'continue_analysis'
    | 'create_chart'
    | 'generate_report'
    | 'cancel_workflow';

  label: string;
  description?: string;

  payload?: Record<string, unknown>;
  primary?: boolean;
  destructive?: boolean;
};
```

---

## 10. 引导问题生成规则

引导问题必须满足：

1. 说明当前已完成什么；
2. 说明缺少什么；
3. 说明为什么需要；
4. 给出候选项；
5. 给出用户可执行的下一步；
6. 不要求用户重复已提供的信息；
7. 不一次询问过多无关问题。

### 10.1 推荐示例

```text
已经识别到你希望分析风险分类分布，并找到了贷款余额字段。

当前还缺少用于分组的风险分类字段。请选择：
- 五级分类
- 十二级分类
- 风险等级
```

### 10.2 禁止示例

```text
信息不足，请补充。
```

```text
无法分析。
```

```text
参数错误。
```

---

## 11. 查询完成后的下一步引导

请实现 `NextActionRecommender`。

SQL 查询成功后，根据结果状态生成后续建议。

### 11.1 查询结果正常

```text
查询已完成，共获得 1,250 条记录，并保存为当前会话数据集。

接下来可以：
- 继续调整筛选条件；
- 分析风险分类分布；
- 绘制趋势或结构图；
- 生成完整报告。
```

### 11.2 查询结果为空

不得直接结束。

应提示：

```text
当前查询未返回数据。

可以尝试：
- 放宽时间范围；
- 删除部分筛选条件；
- 检查字段取值；
- 返回修改查询条件。
```

### 11.3 查询结果字段不足

```text
查询结果中包含风险分类，但缺少金额字段。

当前可以进行笔数分布分析；若需要金额分析，请补充贷款余额或合同金额字段。
```

---

## 12. Python 分析后的引导

Python 成功后：

```text
分析已完成，已生成风险分布指标。

接下来可以：
- 绘制分类分布图；
- 调整分析规则后重新分析；
- 生成 Markdown 报告。
```

如果分析结果存在限制：

```text
当前结果仅包含笔数维度，因为输入数据没有金额字段。

可以继续生成笔数分布图，或返回查询步骤补充金额字段。
```

---

## 13. 图表完成后的引导

图表完成后：

```text
图表已生成。

可以：
- 调整图表类型；
- 修改标题和指标；
- 增加其他图表；
- 将当前图表加入报告。
```

图表失败时：

```text
当前字段组合不适合绘制散点图，因为缺少第二个数值字段。

可以：
- 改为柱状图；
- 选择另一个数值字段；
- 使用计数作为纵轴。
```

---

## 14. 报告完成后的引导

报告生成后：

```text
报告已生成并保存为 Markdown 版本 1。

可以：
- 查看完整报告；
- 调整报告结构；
- 增加图表；
- 修改分析重点；
- 基于当前版本生成新版本。
```

---

## 15. 工具异常恢复

请实现 `ToolErrorRecoveryManager`。

### 15.1 SQL 工具异常

常见异常及操作：

| 异常       | 恢复操作         |
| -------- | ------------ |
| 数据源未选择   | 选择数据源        |
| 字段不存在    | 重新选择字段       |
| SQL 语法错误 | 修复 SQL 后重新审批 |
| 权限不足     | 更换数据源或申请权限   |
| 查询超时     | 缩小范围或重试      |
| 结果为空     | 修改筛选条件       |
| 临时表过期    | 重新上传或重新查询    |

### 15.2 Python 工具异常

| 异常            | 恢复操作         |
| ------------- | ------------ |
| 字段缺失          | 返回查询或重新选择字段  |
| 类型错误          | 修改分析规则       |
| 数据集过大         | 先通过 SQL 缩小范围 |
| 脚本校验失败        | 修复脚本后重新审批    |
| 执行超时          | 简化分析或缩小数据    |
| Artifact 生成失败 | 重试产物生成       |

### 15.3 图表工具异常

| 异常           | 恢复操作                 |
| ------------ | -------------------- |
| 字段类型不兼容      | 更换字段或图表类型            |
| Artifact 不存在 | 重新执行上游工具             |
| 数据为空         | 返回查询步骤               |
| 图表协议错误       | 修复 VisualizationSpec |
| 渲染器不可用       | 降级为表格                |

### 15.4 报告工具异常

| 异常            | 恢复操作       |
| ------------- | ---------- |
| 无分析结果         | 先执行分析      |
| 图表缺失          | 无图表生成或重新绘图 |
| Artifact 过期   | 重新执行上游步骤   |
| 模板错误          | 使用默认模板重试   |
| Markdown 保存失败 | 重试保存，不重新分析 |

---

## 16. 工作流断点和检查点

请实现或扩展 `WorkflowCheckpointStore`。

```ts
export type WorkflowCheckpoint = {
  checkpointId: string;
  workflowId: string;
  conversationId: string;

  currentStepId?: string;
  status: AgentWorkflowStatus;

  completedStepIds: string[];
  pendingStepIds: string[];

  activeDatasetIds: string[];
  latestSuccessfulToolCallIds: Record<string, string | undefined>;
  artifactIds: string[];

  pendingGuidance?: AgentGuidance;
  activeIssue?: AgentWorkflowIssue;

  createdAt: string;
  updatedAt: string;
};
```

### 16.1 检查点创建时机

至少在以下事件创建或更新检查点：

* 工具计划生成；
* SQL 查询成功；
* SQLite 数据集生成；
* Python 分析成功；
* 图表生成成功；
* 报告生成成功；
* 等待用户补充；
* 参数修复；
* 工具执行异常；
* 用户暂停工作流。

### 16.2 恢复原则

用户补充参数后：

```text
读取 checkpoint
→ 合并新输入
→ 重新校验当前步骤
→ 从断点继续
```

不要从头重新执行已成功步骤。

---

## 17. Resume Token

每个等待用户补充的引导应生成 `resumeToken`。

```ts
export type WorkflowResumeToken = {
  token: string;
  workflowId: string;
  conversationId: string;
  stepId: string;
  issueId: string;
  expectedInputKeys: string[];
  expiresAt?: string;
};
```

用户下一轮回复后：

1. 检查当前会话是否存在待恢复工作流；
2. 判断用户输入是否满足缺失信息；
3. 合并参数；
4. 恢复对应步骤；
5. 清除已解决 issue；
6. 不要求用户重新选择整个工作流。

---

## 18. 意图未识别处理

当未识别工具意图时，不要立即返回普通聊天答案并停止。

应分析：

* 是否缺少动作；
* 是否缺少数据对象；
* 是否缺少输出目标；
* 是否属于当前四类工具能力。

例如用户输入：

```text
看看这个数据的分布。
```

可引导：

```text
可以分析数据分布。请确认希望查看：

- 哪个字段的分布？
- 按笔数统计还是按金额汇总？
- 是否需要绘制图表？
```

如果当前已选择字段，则不要重复询问字段。

---

## 19. 不允许的模拟兜底

请在系统策略中明确禁止：

```ts
export type DataAccuracyPolicy = {
  allowSyntheticDataFallback: false;
  allowModelEstimatedResults: false;
  allowPreviewRowsAsFullDataset: false;
  allowMissingFieldGuessing: false;
  allowFailedToolResultFabrication: false;
  requireToolResultForNumericConclusion: true;
};
```

### 19.1 报告生成限制

没有真实数据时，报告工具只能：

* 生成报告结构模板；
* 明确标记“暂无数据”；
* 引导用户查询或上传数据。

不得输出：

* 虚构笔数；
* 虚构金额；
* 虚构占比；
* 虚构趋势；
* 虚构风险结论。

---

## 20. 用户主动终止

仅在用户明确表达以下意图时取消工作流：

```text
取消
停止
放弃
不做了
结束本轮任务
```

取消前：

* 保留历史工具结果；
* 标记 workflow cancelled；
* 清除 pending guidance；
* 不删除仍被会话使用的数据集，除非用户同时要求删除。

用户普通的：

```text
暂时不用生成报告
```

只应跳过报告步骤，不应取消整个工作流。

---

## 21. UI 引导卡片

请实现或复用引导卡片。

### 21.1 AgentGuidanceCard

展示：

* 当前状态；
* 已完成内容；
* 缺失内容；
* 可选项；
* 下一步操作；
* 取消操作。

### 21.2 MissingParameterCard

例如：

```text
缺少分析字段

当前已选择：
- 数据源：风险分类数据.csv
- 指标：贷款余额

请选择分类字段：
[五级分类] [十二级分类] [风险等级]
```

### 21.3 WorkflowRecoveryCard

例如：

```text
Python 分析未完成

原因：字段“贷款余额”不存在。

可选操作：
[重新选择字段]
[返回查询步骤]
[查看可用字段]
[取消本轮分析]
```

### 21.4 NextActionCard

查询成功后：

```text
数据查询完成

1,250 条记录 · 6 个字段

[继续筛选]
[数据分析]
[绘制图表]
[生成报告]
```

---

## 22. ChatComposer 集成

当存在 pending guidance 时：

* ChatComposer 仍可正常输入；
* 可以显示当前期望补充的参数提示；
* 用户选择候选项后填充结构化参数；
* 不强制只能点击按钮；
* 用户自然语言回复也应能解析；
* 发送后尝试恢复工作流。

可定义：

```ts
export type PendingWorkflowInputContext = {
  workflowId: string;
  resumeToken: string;
  expectedInputs: MissingWorkflowInput[];
  suggestedActions: AgentGuidanceAction[];
};
```

---

## 23. 与工具审批集成

审批被拒绝时，不应直接标记整个工作流失败。

应进入：

```text
paused
```

并提示：

```text
SQL 查询未执行，因为审批被拒绝。

可以：
- 修改查询条件后重新提交；
- 更换数据源；
- 取消当前查询步骤。
```

用户重新提交时创建新工具调用版本，不覆盖原审批记录。

---

## 24. 与 Memory 集成

需要写入 Memory 的内容：

* 用户已确认的字段；
* 用户已确认的指标口径；
* 用户已确认的时间范围；
* 用户选择的恢复动作；
* 当前工作流待补充参数；
* 已完成步骤摘要；
* 最近成功数据集引用。

不得写入：

* 完整错误堆栈；
* 完整查询结果；
* 模拟结果；
* 数据库凭据；
* 未脱敏敏感字段。

---

## 25. 对外 API

请实现或扩展以下接口：

```ts
createAgentGuidanceModule(config)

guidance.detectMissingInputs(input)
guidance.buildClarification(input)
guidance.buildParameterRepair(input)
guidance.recommendNextActions(input)
guidance.handleToolError(input)

workflow.pauseForInput(input)
workflow.resumeWithInput(input)
workflow.createCheckpoint(input)
workflow.restoreFromCheckpoint(input)
workflow.cancel(workflowId, reason)
```

模块配置：

```ts
export type AgentGuidanceModuleConfig = {
  workflowStore: WorkflowStateStore;
  checkpointStore: WorkflowCheckpointStore;
  toolResultRegistry: ToolResultRegistry;
  fieldResolver?: FieldResolver;
  dataSourceResolver?: DataSourceResolver;
  memoryBridge?: GuidanceMemoryBridge;

  dataAccuracyPolicy: DataAccuracyPolicy;

  maxGuidanceCandidates?: number;
  enableNextActionRecommendations?: boolean;
};
```

---

## 26. 统一错误代码

```ts
export type AgentWorkflowErrorCode =
  | 'INTENT_INCOMPLETE'
  | 'DATA_SOURCE_REQUIRED'
  | 'TABLE_REQUIRED'
  | 'FIELD_REQUIRED'
  | 'FIELD_AMBIGUOUS'
  | 'METRIC_REQUIRED'
  | 'FILTER_INVALID'
  | 'TOOL_PARAMETER_MISSING'
  | 'TOOL_PARAMETER_INVALID'
  | 'TOOL_APPROVAL_REJECTED'
  | 'TOOL_EXECUTION_FAILED'
  | 'TOOL_EXECUTION_TIMEOUT'
  | 'DATASET_EMPTY'
  | 'DATASET_EXPIRED'
  | 'ARTIFACT_NOT_FOUND'
  | 'WORKFLOW_INTERRUPTED'
  | 'WORKFLOW_RESUME_FAILED'
  | 'REPORT_INPUT_MISSING'
  | 'PERMISSION_DENIED'
  | 'UNRECOVERABLE_SYSTEM_ERROR'
  | 'UNKNOWN_ERROR';
```

要求：

* 用户提示与内部错误分离；
* 用户提示可理解；
* 内部日志保留 traceId；
* 不展示敏感堆栈；
* 每个错误尽量包含 recovery actions；
* `UNRECOVERABLE_SYSTEM_ERROR` 才允许直接进入 failed。

---

## 27. 测试要求

优先使用当前项目测试框架。TypeScript 可使用 Vitest，React 使用 Testing Library。

### 27.1 缺失意图测试

覆盖：

* “分析分布”；
* “查一下数据”；
* “生成报告”但无数据；
* 缺少字段；
* 缺少数据源；
* 缺少时间范围；
* 已有部分参数时不重复询问。

### 27.2 参数修复测试

覆盖：

* SQL 参数缺失；
* Python 字段缺失；
* 图表指标错误；
* 报告输入缺失；
* 用户补充后恢复；
* 参数仍错误时继续引导；
* 不重新执行已成功步骤。

### 27.3 查询后引导测试

覆盖：

* 查询成功；
* 查询为空；
* 字段不足；
* 查询结果可分析；
* 下一步动作正确。

### 27.4 工具异常测试

覆盖：

* SQL 执行失败；
* SQL 超时；
* Python 执行失败；
* Python 超时；
* 图表失败；
* 报告失败；
* Artifact 失效；
* 数据集过期。

### 27.5 工作流恢复测试

覆盖：

* checkpoint 创建；
* waiting_for_parameters；
* resume token；
* 用户补充字段；
* 从断点恢复；
* 保留 SQL 结果；
* 不重复执行成功步骤；
* 恢复失败的错误提示。

### 27.6 禁止模拟兜底测试

覆盖：

* 查询失败后不生成虚构结果；
* 无数据时不生成具体金额；
* preview rows 不作为全量统计；
* 缺失字段不自动猜测；
* Python 失败后不由模型自行计算；
* 报告只生成空模板或引导。

### 27.7 用户终止测试

覆盖：

* 明确取消；
* 明确停止；
* “暂时不生成报告”不取消查询和分析状态；
* 取消后保留历史成功结果。

### 27.8 UI 测试

覆盖：

* MissingParameterCard；
* Candidate 选择；
* RecoveryCard；
* NextActionCard；
* ChatComposer 补充输入；
* 错误提示；
* 取消按钮；
* 恢复后卡片状态更新。

---

## 28. 性能与稳定性要求

1. 引导生成不得重复触发；
2. 同一个 issue 只创建一个 active guidance；
3. 用户输入后原子更新参数和状态；
4. 不因异常清空会话；
5. 不因异常清空工具结果；
6. 不因异常删除临时数据集；
7. 恢复时避免重复调用成功工具；
8. Guidance Card 使用稳定 key；
9. 异常日志异步写入；
10. 候选字段列表数量受控。

---

## 29. 实现约束

请严格遵守：

1. 优先使用 TypeScript；
2. 优先遵守当前项目结构；
3. 不要大规模重构无关模块；
4. 不要使用模拟数据兜底；
5. 不要由模型编造工具结果；
6. 不要自动猜测关键业务字段；
7. 不要因参数缺失直接停止工作流；
8. 不要因可恢复工具错误将整个工作流标记失败；
9. 用户未明确取消时保持工作流可恢复；
10. 查询完成后必须提供后续动作引导；
11. 每个异常必须尽可能提供操作路径；
12. 已成功结果必须保留；
13. 恢复时不得重复执行成功步骤；
14. 如果已有 Workflow、Tool Registry、Memory、ChatComposer、Tool Cards，请复用；
15. 所有公开 API 从当前模块入口或新增 `index.ts` 导出；
16. 完成后运行类型检查和测试，如环境允许。

---

## 30. 验收标准

完成后应满足：

1. 用户需求描述不完整时收到具体引导；
2. 缺少字段时可以选择候选字段；
3. 缺少数据源时可以选择数据源；
4. 工具参数错误时可以补充和修复；
5. 用户补充后工作流从断点继续；
6. 查询完成后提示分析、绘图和报告动作；
7. Python 完成后提示绘图和报告动作；
8. 图表完成后提示修改或加入报告；
9. 报告完成后提示继续调整；
10. 工具失败后有明确恢复操作；
11. 可恢复异常不会终止整个工作流；
12. 用户未明确放弃时工作流保持可恢复；
13. 不使用模拟数据；
14. 不生成虚构结论；
15. 不使用 preview rows 代替全量统计；
16. 已成功工具结果不会丢失；
17. 失败调用不会覆盖最新成功结果；
18. 支持 checkpoint 和 resume token；
19. 支持 UI 引导卡片；
20. 有完整异常和恢复测试；
21. 未大规模重构当前项目。

---

## 31. 开发优先级

### P0：本次必须完成

* 工作流等待状态；
* AgentWorkflowIssue；
* MissingInputDetector；
* ParameterRepairEngine；
* GuidanceEngine；
* NextActionRecommender；
* ToolErrorRecoveryManager；
* WorkflowCheckpoint；
* Resume Token；
* 查询完成后引导；
* 工具错误恢复路径；
* 禁止模拟兜底策略；
* MissingParameterCard；
* WorkflowRecoveryCard；
* NextActionCard；
* 候选字段排序；
* 自然语言补充参数解析；
* 多缺失参数分步引导；
* 工作流恢复历史；
* 基础测试和回归测试。


### P1：预留接口

* 多 Agent 协同恢复；
* 跨会话工作流恢复；
* 智能诊断建议；
* 异常知识库；
* 异常详情面板；

---

## 32. 最终输出要求

执行完成后，请输出：

1. 新增或修改的文件列表；
2. 当前异常处理问题根因；
3. 工作流状态扩展；
4. 异常分类模型；
5. 缺失输入检测实现；
6. 参数修复实现；
7. 用户引导结构；
8. 查询完成后的下一步引导示例；
9. 工具异常恢复示例；
10. checkpoint 和 resume 示例；
11. 禁止模拟数据兜底的实现；
12. UI 引导卡片实现；
13. ChatComposer 恢复流程；
14. 测试运行结果；
15. 未完成的 P0 事项。

请直接推进实现，不要停留在设计文档。

开始前请先检查当前仓库中的：

* Agent Runtime；
* Workflow Runtime；
* Workflow 状态枚举；
* Tool Execution Engine；
* Tool Input Resolver；
* SQL Tool；
* Python Runner；
* Visualization Tool；
* Report Tool；
* Tool Call Card；
* ChatComposer；
* Memory；
* Conversation Tool State；
* Error Boundary；
* 审批流程。

优先在现有实现基础上增加“等待、引导、修复和恢复”能力，避免重建平行的工作流系统。
