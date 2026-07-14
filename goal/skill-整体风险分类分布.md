# 存续期数据探针智能体｜预置本地 Skill「整体风险分类分布（笔数+金额）」开发

你现在是一个资深 TypeScript / Electron / AI Agent / 银行信贷风险分析 / Skill Runtime 工程师。围绕项目 **“存续期数据探针智能体 / Cycle Data Intelligence Agent”** 开发一个可预置安装在客户端本地运行的 Skill：

> **整体风险分类分布（笔数+金额）分析报告 Skill**

该 Skill 用于支持用户在智能体客户端对话中，通过自然语言提出信贷资产风险分类查询、分析、图表绘制和报告生成需求。Skill 应根据用户选择的数据源、业务字段和分析范围，协调调用 SQL 查询、Python 数据分析、图表绘制和 Markdown 报告生成工具，输出“整体风险分类分布（笔数+金额）”分析报告。

请直接推进实现，不要只输出设计方案。

请优先遵守当前项目结构，不要大规模重构无关模块。如果项目中已经存在 Skill Registry、Skill Loader、Tool Registry、SQL Tool、Python Runner、Visualization、Report Generator、Artifact Manager、Memory、Workflow 或 Chat Input 模块，请复用其类型、接口和事件协议。

---

## 1. 项目背景

项目名称：

> **存续期数据探针智能体 / Cycle Data Intelligence Agent**

项目面向银行贷款后续尽职调查、贷后管理、存续期风险监测、信贷资产查询、统计分析、可视化和报告生成场景。

当前需要开发的是一个客户端预置本地 Skill：

> **整体风险分类分布（笔数+金额）**

Skill 主要分析：

1. 信贷合同总笔数；
2. 贷款余额合计；
3. 合同金额合计；
4. 五级风险分类的笔数分布；
5. 五级风险分类的金额分布；
6. 十二级风险分类明细；
7. 正常类、关注类和不良类的结构；
8. 不良率、关注率和不良加关注率；
9. 正常类内部边界风险；
10. 正常类向关注、不良迁徙的潜在风险；
11. 相关图表；
12. 完整 Markdown 分析报告。

上传模板中的示例数字只能用于理解报告结构和展示格式，不能作为客户端运行时默认分析结果，也不能写死到 Skill 中。

---

## 2. 开发目标

请完成以下目标：

1. 创建一个本地预置 Skill 包；
2. Skill 仅在智能体 Electron 客户端环境中运行；
3. Skill 随客户端安装包预置安装；
4. Skill 可被本地 Skill Registry 扫描和加载；
5. Skill 可通过对话框中的 `@` 快捷输入选择；
6. Skill 能识别用户指定的数据范围和分析条件；
7. Skill 能协调 SQL 查询工具获取准确数据；
8. Skill 能协调 Python 工具完成统计校验和派生指标计算；
9. Skill 能协调图表工具生成风险分类图表；
10. Skill 能协调报告工具生成完整 Markdown 报告；
11. Skill 支持在同一会话中多次调整查询范围、分析口径、图表形式和报告内容；
12. Skill 结果必须基于真实工具执行结果，不得基于样例数据或模型推测；
13. Skill 输出必须保留 SQL、Python、图表和报告 Artifact 的数据血缘；
14. Skill 加载失败不能影响客户端其他 Skill 和对话能力；
15. Skill 不依赖远端 Skill 市场或远端插件服务。

---

## 3. Skill 定位

Skill 名称建议：

```text
overall-risk-classification-distribution
```

中文展示名称：

```text
整体风险分类分布（笔数+金额）
```

建议描述：

```text
查询并分析信贷资产五级及十二级风险分类的笔数和贷款余额分布，计算关注率、不良率、风险边界指标，生成图表和完整 Markdown 风险分析报告。
```

建议分类：

```text
credit-risk-analysis
```

建议标签：

```text
信贷资产
风险分类
五级分类
十二级分类
贷款余额
不良率
关注率
风险分布
贷后管理
存续期
```

---

## 4. 推荐 Skill 包目录

请根据当前仓库结构选择实际路径。如果项目尚无预置 Skill 目录，可参考：

```text
resources/
  skills/
    built-in/
      overall-risk-classification-distribution/
        SKILL.md
        manifest.json
        report-template.md
        tool-policy.json
        examples/
          example-user-requests.md
          example-report.md
        schemas/
          skill-input.schema.json
          report-data.schema.json
```

或者：

```text
src/
  ai/
    skills/
      built-in/
        overall-risk-classification-distribution/
          SKILL.md
          manifest.ts
          report-template.ts
          schemas.ts
          index.ts
          __tests__/
            skill.test.ts
            report-template.test.ts
            tool-flow.test.ts
```

应优先遵守项目现有 Skill 目录和加载规范。

不要为该 Skill 重构整个 Skill Runtime。

---

## 5. Skill Manifest

请创建结构清晰的 Skill manifest。

示例：

```json
{
  "skillId": "overall-risk-classification-distribution",
  "name": "overall-risk-classification-distribution",
  "displayName": "整体风险分类分布（笔数+金额）",
  "description": "分析信贷资产五级和十二级风险分类的笔数、贷款余额及风险边界情况，并生成图表和Markdown报告。",
  "version": "1.0.0",
  "category": "credit-risk-analysis",
  "tags": [
    "信贷资产",
    "风险分类",
    "五级分类",
    "十二级分类",
    "不良率",
    "关注率",
    "存续期"
  ],
  "keywords": [
    "风险分类分布",
    "资产质量",
    "不良贷款",
    "关注贷款",
    "贷款余额",
    "合同笔数"
  ],
  "sourceType": "local_builtin",
  "runtime": "cycle-probe-client",
  "clientOnly": true,
  "enabled": true,
  "requiredTools": [
    "request_sql_query_execution",
    "request_python_analysis_execution",
    "request_chart_rendering",
    "request_markdown_report_generation"
  ],
  "entryFile": "SKILL.md"
}
```

要求：

* `sourceType` 必须是本地预置类型；
* `clientOnly` 必须为 true；
* 不配置远端下载地址；
* 不包含数据库账号、密码或数据源连接信息；
* Skill 加载后只提供指令、模板、工具规则和字段语义；
* Skill 本身不得直接执行 SQL、Python 或 JavaScript。

---

## 6. SKILL.md 内容设计

请创建完整 `SKILL.md`。

建议包含 YAML frontmatter：

```markdown
---
name: overall-risk-classification-distribution
displayName: 整体风险分类分布（笔数+金额）
description: 查询并分析信贷资产五级和十二级风险分类的笔数和贷款余额分布，生成图表和Markdown报告。
version: 1.0.0
category: credit-risk-analysis
tags:
  - 信贷资产
  - 风险分类
  - 五级分类
  - 十二级分类
  - 不良率
  - 关注率
keywords:
  - 风险分类分布
  - 资产质量
  - 风险边界
  - 贷款余额
  - 合同笔数
enabled: true
clientOnly: true
requiredTools:
  - request_sql_query_execution
  - request_python_analysis_execution
  - request_chart_rendering
  - request_markdown_report_generation
---
```

正文至少包含：

1. Skill 目标；
2. 适用场景；
3. 不适用场景；
4. 必需字段；
5. 字段映射规则；
6. 风险分类口径；
7. 工具调用规则；
8. SQL 查询规则；
9. Python 分析规则；
10. 图表生成规则；
11. 报告模板；
12. 数据质量检查；
13. 禁止事项；
14. 输出要求。

---

## 7. Skill 触发场景

Skill 应匹配以下用户表达：

```text
分析整体风险分类分布。
统计五级分类的笔数和金额。
生成风险分类分布报告。
查看正常、关注和不良资产占比。
分析十二级分类明细。
生成资产质量分析报告。
分析关注类和不良类贷款。
查看正常3向关注类迁徙的潜在风险。
```

通过 `@` 选择时应支持：

```text
@整体风险分类分布
@风险分类
@资产质量分析
```

---

## 8. 输入数据要求

Skill 不应假设数据库字段名称固定。

需要通过 Schema Context、字段业务注释或用户选择建立字段映射。

### 8.1 必需业务字段

至少需要识别：

```ts
export type RiskClassificationFieldMapping = {
  contractId: string;
  fiveLevelClassification: string;
  twelveLevelClassification?: string;
  loanBalance: string;
  contractAmount?: string;
};
```

### 8.2 可选筛选字段

```ts
export type RiskClassificationOptionalFields = {
  customerId?: string;
  customerName?: string;
  institutionCode?: string;
  institutionName?: string;
  productCode?: string;
  productName?: string;
  loanDate?: string;
  maturityDate?: string;
  reportDate?: string;
  currency?: string;
  businessStatus?: string;
};
```

### 8.3 必需字段含义

* `contractId`：合同、借据或业务笔数的唯一标识；
* `fiveLevelClassification`：正常、关注、次级、可疑、损失；
* `twelveLevelClassification`：正常1、正常2、正常3、关注1等细分类别；
* `loanBalance`：当前贷款余额；
* `contractAmount`：合同金额，可选。

### 8.4 字段缺失处理

* 缺少合同唯一标识时不能准确计算笔数，应提示用户补充字段；
* 缺少五级分类字段时阻止执行；
* 缺少贷款余额字段时只能生成笔数分析，必须明确报告限制；
* 缺少十二级分类字段时跳过十二级明细，不得伪造；
* 缺少合同金额时不输出合同金额合计；
* 字段业务含义不明确时，应先请求用户确认字段映射。

---

## 9. 风险分类口径

### 9.1 五级分类

标准顺序：

```text
正常
关注
次级
可疑
损失
```

### 9.2 不良类定义

```text
不良类 = 次级 + 可疑 + 损失
```

### 9.3 关注加不良

```text
关注加不良 = 关注 + 次级 + 可疑 + 损失
```

### 9.4 十二级分类

默认支持以下编码和展示名称，但应允许项目配置覆盖：

```text
0101 正常1
0102 正常2
0103 正常3
0201 关注1
0202 关注2
0203 关注3
0300 次级
0400 可疑
0500 损失
```

不得假设所有数据源使用完全相同的编码。需要支持：

* 编码映射配置；
* 中文名称映射；
* 数据源业务字典；
* 用户确认映射；
* 未识别分类单独列为“未识别”，不得自动归入正常类。

### 9.5 边界风险定义

默认关注：

```text
风险边界合同 = 正常3 + 全部关注类
```

应输出：

* 风险边界笔数；
* 风险边界笔数占比；
* 风险边界贷款余额；
* 风险边界金额占比；
* 向下迁徙风险提示。

如果数据源中的十二级分类规则不同，应基于字段字典或用户确认调整。

---

## 10. 核心计算指标

Python 分析和报告生成必须使用以下指标口径。

### 10.1 总体指标

```text
合同总笔数 = contractId 去重计数
贷款余额合计 = loanBalance 求和
合同金额合计 = contractAmount 求和
```

### 10.2 分类笔数

```text
分类笔数 = 按风险分类对 contractId 去重计数
```

### 10.3 笔数占比

```text
分类笔数占比 = 分类笔数 / 总笔数 × 100%
```

### 10.4 分类金额

```text
分类金额 = 按风险分类汇总 loanBalance
```

### 10.5 金额占比

```text
分类金额占比 = 分类贷款余额 / 贷款余额合计 × 100%
```

### 10.6 不良率

```text
不良笔数率 =
（次级笔数 + 可疑笔数 + 损失笔数）/ 总笔数

不良金额率 =
（次级余额 + 可疑余额 + 损失余额）/ 贷款余额合计
```

### 10.7 关注加不良率

```text
关注加不良笔数率 =
（关注笔数 + 不良笔数）/ 总笔数

关注加不良金额率 =
（关注余额 + 不良余额）/ 贷款余额合计
```

### 10.8 风险边界率

```text
风险边界笔数率 =
（正常3笔数 + 关注类笔数）/ 总笔数

风险边界金额率 =
（正常3余额 + 关注类余额）/ 贷款余额合计
```

所有占比计算需要处理：

* 分母为零；
* 空值；
* 重复合同；
* 同一合同多条明细；
* 多币种；
* 余额负值或异常值；
* 分类为空；
* 金额单位换算。

---

## 11. 工具调用总体流程

四个工具保持独立注册，不得封装为一个不可拆分的复合工具。

使用工具：

```text
request_sql_query_execution
request_python_analysis_execution
request_chart_rendering
request_markdown_report_generation
```

默认完整流程：

```text
用户选择 Skill 或提出风险分类分析需求
→ Skill 检查数据源和字段映射
→ 调用 SQL 查询工具
→ 用户审批 SQL
→ SQL 执行并生成数据集 Artifact
→ 调用 Python 分析工具
→ 用户审批 Python
→ Python 执行并生成统计结果 Artifact
→ 调用图表绘制工具
→ 生成 VisualizationSpec 和图表 Artifact
→ 调用 Markdown 报告生成工具
→ 生成报告标题卡片和 Markdown Artifact
```

该流程是完整报告场景的推荐链路，但不是全局强制顺序。

用户只要求查询时，可以仅调用 SQL 工具。

用户只要求更新图表时，可以基于最近 Python 或 SQL Artifact 调用图表工具。

用户只要求修改报告时，可以基于最近报告版本和已有 Artifact 调用报告工具。

---

## 12. SQL 查询工具调用规则

工具名：

```text
request_sql_query_execution
```

### 12.1 SQL 查询目标

SQL 应尽量提取用于风险分类分析的基础明细或已聚合数据，包括：

* 合同唯一标识；
* 五级分类；
* 十二级分类；
* 贷款余额；
* 合同金额；
* 用户指定筛选维度。

### 12.2 SQL 工具输入建议

```ts
export type RiskClassificationSqlRequest = {
  dataSourceId: string;
  purpose: string;
  fieldMapping: RiskClassificationFieldMapping;
  filters?: {
    reportDate?: string;
    startDate?: string;
    endDate?: string;
    institutionCodes?: string[];
    productCodes?: string[];
    businessStatuses?: string[];
    additionalConditions?: string[];
  };
  outputMode:
    | 'detail_dataset'
    | 'pre_aggregated_dataset';
  requireApproval: true;
};
```

### 12.3 SQL 安全要求

* 只允许查询类 SQL；
* 必须经过现有 SQL Safety Gateway；
* 必须经过用户权限校验；
* 必须经过审批；
* 不执行 INSERT、UPDATE、DELETE、DROP 等语句；
* 不直接把完整查询结果传给模型；
* SQL 结果应保存为 Artifact 或 SQLite 临时表；
* Skill 只持有结果引用和数据摘要。

### 12.4 SQL 查询结果要求

至少包含：

```ts
export type RiskClassificationQueryResultRef = {
  sqlToolCallId: string;
  sqlExecutionId: string;
  datasetArtifactId: string;
  rowCount: number;
  columnCount: number;
  schema: Record<string, string>;
  previewRows?: Record<string, unknown>[];
};
```

---

## 13. Python 数据分析工具调用规则

工具名：

```text
request_python_analysis_execution
```

### 13.1 Python 输入

Python 只能读取 SQL 查询产生的受控数据集 Artifact 或本地临时数据集。

不得：

* 直接连接数据库；
* 读取数据库账号和密码；
* 访问网络；
* 读取任意本地文件；
* 绕过 SQL 工具权限。

### 13.2 Python 分析任务

应完成：

1. 字段类型检查；
2. 合同唯一标识去重；
3. 风险分类值标准化；
4. 五级分类笔数统计；
5. 五级分类余额统计；
6. 五级分类占比计算；
7. 十二级分类明细统计；
8. 不良笔数率；
9. 不良金额率；
10. 关注加不良笔数率；
11. 关注加不良金额率；
12. 正常3与关注类边界风险统计；
13. 数据质量异常检查；
14. 报告所需结构化结果输出。

### 13.3 Python 输出 Schema

```ts
export type RiskClassificationAnalysisResult = {
  scope: {
    reportDate?: string;
    filters: Record<string, unknown>;
    totalContracts: number;
    totalLoanBalance: number;
    totalContractAmount?: number;
    amountUnit: string;
  };

  fiveLevelDistribution: Array<{
    classification: '正常' | '关注' | '次级' | '可疑' | '损失' | '未识别';
    contractCount: number;
    contractCountRatio: number;
    loanBalance: number;
    loanBalanceRatio: number;
    remark?: string;
  }>;

  twelveLevelDistribution?: Array<{
    classificationCode?: string;
    classificationName: string;
    contractCount: number;
    contractCountRatio: number;
    loanBalance: number;
    loanBalanceRatio: number;
  }>;

  riskIndicators: {
    normalCount: number;
    attentionCount: number;
    nonPerformingCount: number;
    attentionPlusNonPerformingCount: number;

    normalBalance: number;
    attentionBalance: number;
    nonPerformingBalance: number;
    attentionPlusNonPerformingBalance: number;

    nonPerformingCountRatio: number;
    nonPerformingBalanceRatio: number;
    attentionPlusNonPerformingCountRatio: number;
    attentionPlusNonPerformingBalanceRatio: number;

    boundaryRiskCount?: number;
    boundaryRiskCountRatio?: number;
    boundaryRiskBalance?: number;
    boundaryRiskBalanceRatio?: number;
  };

  dataQuality: {
    duplicateContractCount: number;
    missingClassificationCount: number;
    missingBalanceCount: number;
    unknownClassificationCount: number;
    warnings: string[];
  };
};
```

### 13.4 精度要求

* 金额计算保留原始精度；
* 展示时再做单位换算；
* 比率内部使用数值类型；
* Markdown 中统一格式化为百分比；
* 合计行应与各分类之和校验；
* 五级分类总笔数占比应接近 100%；
* 五级分类总金额占比应接近 100%；
* 存在误差时说明四舍五入原因。

---

## 14. 图表工具调用规则

工具名：

```text
request_chart_rendering
```

图表必须使用统一业务语义 `VisualizationSpec`，不得让模型输出完整 ECharts option。

### 14.1 推荐图表

至少生成以下图表：

#### 图表一：五级分类笔数分布

推荐：

```text
横向柱状图
```

指标：

* 分类名称；
* 合同笔数；
* 笔数占比。

#### 图表二：五级分类金额分布

推荐：

```text
横向柱状图或柱线组合图
```

指标：

* 分类名称；
* 贷款余额；
* 金额占比。

#### 图表三：十二级分类结构

推荐：

```text
堆叠柱状图、横向柱状图或风险等级结构图
```

#### 图表四：核心风险指标 KPI

推荐 KPI 卡片：

* 总合同笔数；
* 贷款余额；
* 关注类占比；
* 不良率；
* 关注加不良率；
* 风险边界占比。

### 14.2 数据来源

图表数据只能引用：

* Python 分析结果 Artifact；
* 受控 SQL 聚合结果 Artifact。

不得：

* 使用报告模板中的示例数字；
* 根据 preview rows 推断全量数据；
* 由模型自行补齐缺失分类。

### 14.3 VisualizationSpec 业务语义

建议：

```text
businessSemantic = product_risk_structure
```

或新增：

```text
businessSemantic = overall_risk_classification_distribution
```

如果当前协议不支持新增语义，请使用 `general_analysis` 并通过 metadata 表达业务类型，避免大规模修改现有协议。

---

## 15. Markdown 报告生成工具规则

工具名：

```text
request_markdown_report_generation
```

### 15.1 报告输出

报告必须生成：

* 报告标题；
* 分析范围；
* 总体资产概况；
* 五级分类表；
* 十二级分类明细表；
* 核心风险指标；
* 分析结论；
* 风险边界提示；
* 图表引用；
* 数据质量说明；
* 方法和口径说明；
* 数据来源说明；
* 限制说明。

### 15.2 报告标题建议

默认：

```text
整体风险分类分布（笔数+金额）分析报告
```

支持用户修改标题。

### 15.3 报告模板

请创建 `report-template.md`，结构参考：

```markdown
# {{reportTitle}}

## 一、分析范围

- 数据来源：{{dataSourceName}}
- 统计日期：{{reportDate}}
- 筛选条件：{{filters}}
- 合同笔数：{{totalContracts}}
- 贷款余额：{{totalLoanBalance}}
- 合同金额：{{totalContractAmount}}

## 二、整体风险分类分布

全样本共 **{{totalContracts}}** 笔信贷合同，贷款余额合计 **{{totalLoanBalanceFormatted}}**，合同金额合计 **{{totalContractAmountFormatted}}**。

### 2.1 五级分类分布

| 五级分类 | 笔数 | 笔数占比 | 贷款余额 | 金额占比 | 备注 |
|---|---:|---:|---:|---:|---|
{{fiveLevelRows}}
| 合计 | {{totalContracts}} | 100.00% | {{totalLoanBalanceFormatted}} | 100.00% | |

### 2.2 十二级分类明细

| 十二级分类 | 笔数 | 笔数占比 | 贷款余额 | 金额占比 |
|---|---:|---:|---:|---:|
{{twelveLevelRows}}
| 合计 | {{totalContracts}} | 100.00% | {{totalLoanBalanceFormatted}} | 100.00% |

## 三、核心风险指标

- 正常类：{{normalCount}} 笔，余额 {{normalBalanceFormatted}}
- 关注类：{{attentionCount}} 笔，余额 {{attentionBalanceFormatted}}
- 不良类：{{nonPerformingCount}} 笔，余额 {{nonPerformingBalanceFormatted}}
- 不良笔数率：{{nonPerformingCountRatio}}
- 不良金额率：{{nonPerformingBalanceRatio}}
- 关注加不良笔数率：{{attentionPlusNonPerformingCountRatio}}
- 关注加不良金额率：{{attentionPlusNonPerformingBalanceRatio}}
- 风险边界笔数占比：{{boundaryRiskCountRatio}}
- 风险边界金额占比：{{boundaryRiskBalanceRatio}}

## 四、可视化分析

{{kpiVisualizationNode}}

{{fiveLevelCountVisualizationNode}}

{{fiveLevelBalanceVisualizationNode}}

{{twelveLevelVisualizationNode}}

## 五、分析结论

### 5.1 笔数维度

{{countDimensionAnalysis}}

### 5.2 金额维度

{{balanceDimensionAnalysis}}

### 5.3 正常类内部结构

{{normalInternalStructureAnalysis}}

### 5.4 风险边界与迁徙风险

{{boundaryRiskAnalysis}}

## 六、风险提示与管理建议

{{riskRecommendations}}

## 七、数据质量与分析限制

{{dataQualityWarnings}}

{{analysisLimitations}}

## 八、计算口径

- 不良类包括次级、可疑和损失；
- 关注加不良包括关注、次级、可疑和损失；
- 合同笔数按合同唯一标识去重；
- 金额指标默认使用贷款余额；
- 风险边界默认定义为正常3和全部关注类；
- 比率差异可能来自四舍五入。
```

### 15.4 结论生成约束

报告结论必须：

* 引用真实指标；
* 区分笔数维度和金额维度；
* 说明正常、关注和不良结构；
* 说明正常1、正常2、正常3内部结构；
* 说明正常3和关注类的风险边界；
* 避免仅复述表格；
* 给出审慎、可解释的风险判断；
* 不得把相关性描述为因果关系；
* 不得在数据不足时编造迁徙结论；
* 没有历史时点数据时，只能描述潜在迁徙风险，不能声称已发生迁徙。

---

## 16. 用户多轮调整支持

Skill 应支持同一会话中的多轮调整。

### 16.1 调整查询范围

示例：

```text
只看今年以来的数据。
只分析成都分行。
排除已结清合同。
增加小微企业客户。
按报告日期 2026-06-30 统计。
```

应重新调用 SQL 查询工具并生成新数据集版本。

### 16.2 调整分析口径

示例：

```text
笔数按借据号去重。
金额使用合同金额而不是贷款余额。
把正常3和关注类都定义为风险边界。
不良率只按金额计算。
```

应生成新的 Python 分析版本，不覆盖旧版本。

### 16.3 调整图表

示例：

```text
把五级分类图改成横向柱状图。
同时显示笔数和占比。
增加风险指标 KPI 卡片。
隐藏正常类，只突出关注和不良。
```

应生成新的图表 Artifact。

### 16.4 调整报告

示例：

```text
报告改成管理层汇报风格。
增加执行摘要。
突出关注加不良率。
删除方法部分。
增加风险管理建议。
```

应基于最近分析和图表生成新的 Markdown 报告版本。

---

## 17. Tool Flow 定义

请在 Skill 中提供结构化工具流程描述。

```ts
export type OverallRiskClassificationSkillFlow = {
  skillId: 'overall-risk-classification-distribution';

  steps: Array<
    | {
        step: 'resolve_fields';
        required: true;
      }
    | {
        step: 'sql_query';
        tool: 'request_sql_query_execution';
        required: true;
      }
    | {
        step: 'python_analysis';
        tool: 'request_python_analysis_execution';
        required: true;
      }
    | {
        step: 'chart_rendering';
        tool: 'request_chart_rendering';
        required: false;
      }
    | {
        step: 'report_generation';
        tool: 'request_markdown_report_generation';
        required: true;
      }
  >;
};
```

注意：

* `steps` 表示完整报告任务的推荐链路；
* 不得在 Tool Orchestrator 中硬编码为全局顺序；
* 用户只要求部分结果时可执行对应步骤；
* 上游结果不存在时，应通过会话最新成功结果解析或提示缺少输入；
* SQL 和 Python 仍需执行各自审批流程。

---

## 18. Skill 系统提示词

请在 Skill 中提供以下类型的系统指令：

```text
你正在执行“整体风险分类分布（笔数+金额）”分析 Skill。

本 Skill 用于分析信贷资产五级和十二级风险分类的笔数、贷款余额、关注率、不良率和风险边界情况。

你不能根据报告模板中的示例数字生成结论。所有指标必须来自 SQL 查询工具和 Python 分析工具的真实执行结果。

执行要求：

1. 首先确认数据源以及合同唯一标识、五级分类、贷款余额等字段映射。
2. 需要准确查询或统计数据时，调用 request_sql_query_execution。
3. SQL 执行前必须经过用户审批。
4. SQL 查询结果应保存为受控数据集 Artifact，不得直接把完整源表数据输入模型。
5. 统计计算、分类标准化、占比计算、风险指标计算和数据质量校验应调用 request_python_analysis_execution。
6. Python 执行前必须经过用户审批。
7. 需要图表时，调用 request_chart_rendering，并引用 SQL 或 Python Artifact。
8. 不要输出完整 ECharts option 或其他图表库原始配置。
9. 生成完整报告时，调用 request_markdown_report_generation。
10. 报告必须区分笔数维度和金额维度，并说明不良类、关注类和风险边界情况。
11. 如果十二级分类字段不存在，应明确报告限制并跳过十二级分类分析。
12. 不得编造缺失数据，不得根据 preview rows 推断全量结论。
```

---

## 19. 客户端本地预置安装

Skill 仅支持客户端本地环境运行。

### 19.1 安装要求

* Skill 文件随 Electron 客户端安装包发布；
* 安装后位于只读或受控的内置 Skill 目录；
* 客户端启动时由 Skill Registry 扫描；
* Skill 默认启用；
* 用户可在客户端 Skill 列表中查看；
* 支持通过 `@整体风险分类分布` 选择；
* 不需要联网下载；
* 不依赖远端 Skill 市场。

### 19.2 路径要求

使用 Electron 推荐资源路径解析方式，不要硬编码开发机绝对路径。

例如预留：

```ts
export type BuiltinSkillPathResolver = {
  getBuiltinSkillRoot(): string;
};
```

需要兼容：

* 开发环境；
* Electron 打包环境；
* `app.asar`；
* `process.resourcesPath`；
* Windows；
* macOS；
* Linux。

### 19.3 安全要求

* 渲染进程不得直接访问任意本地目录；
* Skill 文件读取通过主进程、受控 Node 服务或现有 SkillClientApi；
* Skill Loader 只能读取允许的内置 Skill 根目录；
* 禁止路径穿越；
* 禁止 Skill 加载任意外部脚本；
* Skill 中的 Markdown 只能作为指令和模板使用；
* Skill 不具有任意代码执行权限。

---

## 20. Skill 加载接口

请复用现有 Skill Registry 接口。如果尚未实现，可适配：

```ts
export type BuiltinSkillInstaller = {
  installBuiltinSkills(): Promise<{
    installed: string[];
    skipped: string[];
    failed: Array<{
      skillId: string;
      error: string;
    }>;
  }>;
};
```

```ts
export type SkillClientApi = {
  listSkills(): Promise<SkillMetadata[]>;
  searchSkills(query: SkillSearchQuery): Promise<SkillSearchResult[]>;
  loadSkill(skillId: string): Promise<LoadedSkill>;
};
```

Skill 加载结果应包含：

```ts
export type LoadedRiskClassificationSkill = {
  metadata: SkillMetadata;
  instructions: string;
  reportTemplate: string;
  requiredTools: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  loadedAt: string;
};
```

---

## 21. Skill 输入 Schema

请创建输入 JSON Schema。

建议：

```ts
export type OverallRiskClassificationSkillInput = {
  dataSourceId?: string;

  fieldMapping?: {
    contractId?: string;
    fiveLevelClassification?: string;
    twelveLevelClassification?: string;
    loanBalance?: string;
    contractAmount?: string;
  };

  filters?: {
    reportDate?: string;
    startDate?: string;
    endDate?: string;
    institutionCodes?: string[];
    productCodes?: string[];
    businessStatuses?: string[];
    additionalDescription?: string;
  };

  analysisOptions?: {
    amountMetric?: 'loan_balance' | 'contract_amount';
    includeTwelveLevel?: boolean;
    includeBoundaryRisk?: boolean;
    boundaryRiskCategories?: string[];
    amountUnit?: 'yuan' | 'ten_thousand_yuan' | 'hundred_million_yuan';
  };

  outputOptions?: {
    includeCharts?: boolean;
    includeKpiCards?: boolean;
    includeExecutiveSummary?: boolean;
    includeRecommendations?: boolean;
    reportTitle?: string;
  };
};
```

Schema 校验要求：

* `dataSourceId` 如未提供，应从当前会话数据源上下文获取；
* `contractId`、`fiveLevelClassification`、`loanBalance` 是完整分析的必需字段；
* `amountMetric = contract_amount` 时必须存在 `contractAmount`；
* `includeTwelveLevel = true` 时应检查十二级字段；
* amountUnit 必须受控；
* 不接受任意 SQL；
* 不接受数据库连接字符串；
* 不接受本地文件绝对路径；
* 不接受任意工具名称。

---

## 22. 报告数据输出 Schema

请创建报告数据 Schema，保证报告工具输入稳定。

```ts
export type OverallRiskClassificationReportData = {
  reportTitle: string;
  analysisScope: {
    dataSourceName?: string;
    reportDate?: string;
    filters: Record<string, unknown>;
  };

  totals: {
    contractCount: number;
    loanBalance: number;
    contractAmount?: number;
    amountUnit: string;
  };

  fiveLevelDistribution: RiskClassificationAnalysisResult['fiveLevelDistribution'];
  twelveLevelDistribution?: RiskClassificationAnalysisResult['twelveLevelDistribution'];
  riskIndicators: RiskClassificationAnalysisResult['riskIndicators'];
  dataQuality: RiskClassificationAnalysisResult['dataQuality'];

  analysisText: {
    countDimension: string;
    amountDimension: string;
    normalInternalStructure?: string;
    boundaryRisk?: string;
    recommendations: string[];
    limitations: string[];
  };

  artifactRefs: {
    sourceDatasetArtifactId: string;
    analysisArtifactId: string;
    chartArtifactIds: string[];
  };

  provenance: {
    sqlToolCallId: string;
    pythonToolCallId: string;
    chartToolCallIds: string[];
    generatedAt: string;
  };
};
```

---

## 23. 报告标题卡片

报告生成完成后，应复用现有报告卡片能力。

默认展示：

```text
整体风险分类分布（笔数+金额）分析报告
Markdown 报告 · 版本 1
包含五级分类、十二级分类、风险指标和图表
查看完整报告
```

点击卡片后：

* 加载 Markdown Artifact；
* 展示完整报告；
* 渲染表格；
* 渲染 KPI；
* 渲染图表节点；
* 展示数据来源；
* 展示分析限制；
* 不重新执行 SQL、Python 或图表工具。

---

## 24. 错误与降级处理

请定义 Skill 专用错误：

```ts
export type OverallRiskClassificationSkillErrorCode =
  | 'SKILL_NOT_INSTALLED'
  | 'SKILL_LOAD_FAILED'
  | 'DATA_SOURCE_NOT_SELECTED'
  | 'FIELD_MAPPING_INCOMPLETE'
  | 'FIVE_LEVEL_FIELD_MISSING'
  | 'LOAN_BALANCE_FIELD_MISSING'
  | 'TWELVE_LEVEL_FIELD_MISSING'
  | 'CLASSIFICATION_MAPPING_INVALID'
  | 'SQL_QUERY_FAILED'
  | 'PYTHON_ANALYSIS_FAILED'
  | 'CHART_RENDER_FAILED'
  | 'REPORT_GENERATION_FAILED'
  | 'DATA_QUALITY_INVALID'
  | 'UNKNOWN_ERROR';
```

降级规则：

* 无十二级分类字段：生成五级分类报告并明确限制；
* 无合同金额：仅输出贷款余额；
* 图表失败：继续生成表格和文本报告；
* 报告失败：保留 SQL、Python 和图表 Artifact；
* 单个未知分类：归为“未识别”并提示；
* 合计校验失败：报告中展示数据质量警告；
* Skill 加载失败：不影响其他 Skill；
* 用户无数据权限：阻止工具调用并说明权限不足。

---

## 25. 测试要求

优先使用当前项目测试框架；TypeScript 项目可使用 Vitest。

### 25.1 Skill Manifest 测试

覆盖：

* skillId 正确；
* displayName 正确；
* clientOnly 为 true；
* sourceType 为 local_builtin；
* 四个 requiredTools 正确；
* enabled 默认 true；
* version 格式正确。

### 25.2 Skill Parser 测试

覆盖：

* 解析 frontmatter；
* 解析 instructions；
* 解析 requiredTools；
* 加载 report-template；
* 非法 Skill 文件；
* 缺少必需字段；
* Skill 根目录保护。

### 25.3 本地安装测试

覆盖：

* 开发环境扫描；
* 打包资源目录扫描；
* 重复安装跳过；
* Skill 默认启用；
* Skill Registry 可查询；
* `@` 搜索可命中；
* 加载失败不影响其他 Skill。

### 25.4 字段映射测试

覆盖：

* 完整字段映射；
* 缺少合同 ID；
* 缺少五级分类；
* 缺少贷款余额；
* 缺少十二级分类；
* 中文字段名；
* 英文字段名；
* 字段业务注释匹配。

### 25.5 风险计算测试

覆盖：

* 五级分类笔数；
* 五级分类金额；
* 笔数占比；
* 金额占比；
* 不良类合计；
* 关注加不良合计；
* 正常3加关注边界风险；
* 零分母；
* 重复合同；
* 未识别分类；
* 合计校验；
* 四舍五入误差。

### 25.6 工具流程测试

覆盖：

* 仅 SQL 查询；
* SQL 加 Python；
* SQL 加 Python 加图表；
* 完整报告流程；
* SQL 审批拒绝；
* Python 审批拒绝；
* 图表失败降级；
* 报告重新生成；
* 多轮调整查询范围；
* 多轮调整分析口径；
* 多轮调整图表；
* 多轮调整报告。

### 25.7 报告模板测试

覆盖：

* 五级分类表；
* 十二级分类表；
* 合计行；
* 笔数维度结论；
* 金额维度结论；
* 风险边界结论；
* 图表 Artifact；
* 数据质量警告；
* 无十二级分类时降级；
* Markdown 渲染。

---

## 26. 实现约束

请严格遵守：

1. 优先使用 TypeScript；
2. Skill 内容采用 Markdown、JSON 或项目已有格式；
3. Skill 仅在智能体客户端环境中运行；
4. Skill 随客户端预置安装；
5. 不依赖远端 Skill 市场；
6. 不硬编码报告模板中的示例数字；
7. 不允许模型基于示例数字生成实际结论；
8. 所有指标必须来自真实 SQL/Python 工具结果；
9. SQL 和 Python 必须复用现有审批流程；
10. Python 不允许直接连接业务数据库；
11. 图表必须引用 Artifact 数据；
12. 报告必须生成 Markdown Artifact；
13. 不将完整源表数据注入模型；
14. 不在 Skill 中保存数据库凭据；
15. 不执行 Skill 中的任意代码；
16. 优先遵守当前项目结构；
17. 不要大规模重构无关模块；
18. 所有公开 API 从当前 Skill 模块 `index.ts` 或现有 Skill Registry 导出；
19. 完成后运行类型检查和测试，如环境允许。

---

## 27. 验收标准

完成后应满足：

1. 客户端包含预置 Skill；
2. Skill Registry 可以扫描并加载 Skill；
3. 用户可以通过 `@整体风险分类分布` 选择 Skill；
4. Skill 仅在客户端本地运行；
5. Skill 能识别必要字段；
6. Skill 能调用 SQL 查询工具；
7. Skill 能调用 Python 分析工具；
8. Skill 能调用图表工具；
9. Skill 能调用 Markdown 报告工具；
10. SQL 和 Python 执行前需要审批；
11. 能生成五级分类笔数与金额分布；
12. 能生成十二级分类明细；
13. 能计算不良率、关注加不良率；
14. 能识别正常3和关注类风险边界；
15. 能生成 KPI 和分类分布图表；
16. 能生成完整 Markdown 报告；
17. 报告通过标题卡片展示入口；
18. 工具结果和报告具备数据血缘；
19. 模板示例数字不会进入真实分析结果；
20. 支持多轮调整查询、分析、图表和报告；
21. 有基础测试覆盖；
22. 未大规模重构现有项目。

---

## 28. 开发优先级

### P0：必须完成

* Skill manifest；
* SKILL.md；
* report-template.md；
* 输入 Schema；
* 报告数据 Schema；
* 本地预置目录；
* Skill Registry 加载适配；
* `@` 搜索元数据；
* 字段映射规则；
* 五级分类分析口径；
* 十二级分类分析口径；
* 四个工具调用指令；
* 报告模板；
* 基础测试。

### P1：尽量完成

* 编码映射配置；
* 风险边界配置；
* KPI VisualizationSpec 模板；
* 五级分类图表模板；
* 十二级分类图表模板；
* 多轮调整支持；
* 报告标题卡片集成；
* Artifact 血缘展示；
* 打包环境路径测试；
* 数据质量规则增强。

### P2：预留接口

* 按机构分层分析；
* 按产品分层分析；
* 按客户类型分析；
* 风险分类迁徙分析；
* 多期趋势对比；
* Vintage 分析；
* Skill 版本升级；
* Skill 用户自定义副本；
* Skill 配置面板；
* 远端更新包签名校验。

---

## 29. 最终输出要求

执行完成后，请输出：

1. 新增或修改的文件列表；
2. Skill 包目录结构；
3. manifest 内容；
4. SKILL.md 核心内容；
5. 输入 Schema；
6. 报告数据 Schema；
7. SQL 工具调用示例；
8. Python 分析工具调用示例；
9. 图表工具调用示例；
10. 报告生成工具调用示例；
11. 本地预置安装与加载示例；
12. `@` 快捷选择示例；
13. 完整 Markdown 报告示例；
14. 测试运行结果；
15. 尚未完成或需要后续补充的事项。

请直接推进实现，不要停留在设计文档。请优先遵守当前仓库目录结构，不要大规模重构无关模块；如发现已有 `skills`、`skill-registry`、`chat-input`、`tool-registry`、`sql-tool`、`python-runner`、`visualization`、`report`、`artifact-manager`、`memory` 或 `workflow` 模块，请复用其类型、接口和事件协议。
