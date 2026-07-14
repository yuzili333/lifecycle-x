---
name: overall-risk-classification-distribution
description: 查询并分析信贷资产五级和十二级风险分类的笔数、贷款余额、关注率、不良率和风险边界情况，协调 SQL、Python、图表和 Markdown 报告工具生成“整体风险分类分布（笔数+金额）”分析报告。Use when the user selects @整体风险分类分布, @风险分类, @资产质量分析, or asks for credit asset risk classification distribution, asset quality, non-performing loan ratio, attention loan ratio, twelve-level classification details, charts, or a Markdown risk report in the Cycle Probe Electron client.
---

# 整体风险分类分布（笔数+金额）

## Skill 目标

执行“整体风险分类分布（笔数+金额）”分析：基于用户选择的数据源和字段映射，查询真实信贷资产数据，计算五级和十二级风险分类的笔数、贷款余额、关注率、不良率、关注加不良率、正常3和关注类边界风险，并生成图表与完整 Markdown 报告。

不得使用报告模板中的示例数字作为运行时结果。所有指标必须来自 `request_sql_query_execution` 和 `request_python_analysis_execution` 的真实工具执行结果。

## 适用场景

- 用户选择 `@整体风险分类分布`、`@风险分类` 或 `@资产质量分析`。
- 用户要求“分析整体风险分类分布”“统计五级分类笔数和金额”“生成风险分类分布报告”“查看正常、关注和不良资产占比”“分析十二级分类明细”“分析关注类和不良类贷款”“查看正常3向关注类迁徙的潜在风险”。
- 用户在同一会话中调整查询范围、分析口径、图表形式或报告内容。

## 不适用场景

- 用户要求自动调整风险分类、自动预警下发、授信处置决策或监管报送结论。
- 用户未选择数据源，且当前会话没有可用数据源上下文。
- 用户要求直接连接数据库、读取账号密码、访问网络、读取任意本地文件或执行任意脚本。
- 用户只提供报告模板截图或样例数字，未提供真实数据源或已授权 Artifact。

## 必需字段

完整分析至少需要识别：

- `contractId`：合同、借据或业务笔数唯一标识，用于去重计数。
- `fiveLevelClassification`：五级分类，标准值为正常、关注、次级、可疑、损失。
- `loanBalance`：当前贷款余额。

可选字段：

- `twelveLevelClassification`：十二级分类，如正常1、正常2、正常3、关注1等。
- `contractAmount`：合同金额。
- `reportDate`、`institutionCode`、`institutionName`、`productCode`、`productName`、`currency`、`businessStatus` 等筛选字段。

字段缺失处理：

- 缺少合同唯一标识时，阻止准确笔数分析并请求用户确认字段。
- 缺少五级分类字段时，阻止执行完整分析。
- 缺少贷款余额字段时，只能生成笔数分析，并在报告限制中明确说明。
- 缺少十二级分类字段时，跳过十二级明细，不得伪造。
- 缺少合同金额时，不输出合同金额合计。
- 字段业务含义不明确时，先请求用户确认字段映射。

## 字段映射规则

优先通过 Schema Context、字段业务注释、字段枚举值和用户选择建立映射，不假设字段名固定。

常见映射参考：

| 业务字段 | 常见字段名 |
|---|---|
| contractId | 合同流水号、合同编号、借据号、业务编号 |
| fiveLevelClassification | 最新风险五级分类、最新风险分类、五级分类、风险分类 |
| twelveLevelClassification | 最新风险分类结果、十二级分类、风险分类名称、风险分类明细 |
| loanBalance | 贷款余额(万元)、贷款余额、当前余额、余额 |
| contractAmount | 合同金额(万元)、合同金额、授信金额 |
| reportDate | p_date、分区日期、统计日期、报告日期 |

未识别分类必须单独列为“未识别”，不得自动归入正常类。

## 风险分类口径

五级分类标准顺序：正常、关注、次级、可疑、损失。

不良类 = 次级 + 可疑 + 损失。

关注加不良 = 关注 + 次级 + 可疑 + 损失。

默认十二级分类：

| 编码 | 名称 |
|---|---|
| 0101 | 正常1 |
| 0102 | 正常2 |
| 0103 | 正常3 |
| 0201 | 关注1 |
| 0202 | 关注2 |
| 0203 | 关注3 |
| 0300 | 次级 |
| 0400 | 可疑 |
| 0500 | 损失 |

支持编码映射配置、中文名称映射、数据源业务字典和用户确认映射。默认风险边界合同 = 正常3 + 全部关注类。

## 工具调用规则

完整报告推荐链路：

1. 解析数据源和字段映射。
2. 调用 `request_sql_query_execution` 获取受控明细或聚合数据集 Artifact。
3. SQL 经用户审批后执行。
4. 调用 `request_python_analysis_execution` 完成统计、校验和派生指标计算。
5. Python 经用户审批后执行。
6. 调用 `request_chart_rendering` 生成 KPI、五级分类和十二级分类图表 Artifact。
7. 调用 `request_markdown_report_generation` 生成 Markdown 报告 Artifact 和标题卡片。

用户只要求查询时，可以仅调用 SQL。用户只要求更新图表时，可以基于最近 Python 或 SQL Artifact 调用图表工具。用户只要求修改报告时，可以基于最近报告版本和已有 Artifact 调用报告工具。

四个工具保持独立注册，不得封装为不可拆分的复合工具。

## SQL 查询规则

调用工具：`request_sql_query_execution`。

只生成查询类 SQL，必须经过 SQL Safety Gateway、权限校验、风险评估和用户审批。SQL 结果保存为 Artifact 或 SQLite 临时表，Skill 只持有结果引用和摘要，不直接把完整源表数据输入模型。

SQL 应提取：

- 合同唯一标识；
- 五级分类；
- 十二级分类；
- 贷款余额；
- 合同金额；
- 用户指定筛选维度。

示例请求：

```json
{
  "dataSourceId": "{{dataSourceId}}",
  "purpose": "查询整体风险分类分布分析所需基础明细数据",
  "fieldMapping": {
    "contractId": "合同流水号",
    "fiveLevelClassification": "最新风险五级分类",
    "twelveLevelClassification": "最新风险分类结果",
    "loanBalance": "贷款余额(万元)",
    "contractAmount": "合同金额(万元)"
  },
  "filters": {
    "reportDate": "2026-06-30",
    "businessStatuses": ["已生效"]
  },
  "outputMode": "detail_dataset",
  "requireApproval": true
}
```

## Python 分析规则

调用工具：`request_python_analysis_execution`。

Python 只能读取 SQL 查询产生的受控数据集 Artifact 或本地临时数据集，不得直接连接数据库、读取凭据、访问网络、读取任意本地文件或绕过 SQL 工具权限。

Python 必须完成：

- 字段类型检查；
- 合同唯一标识去重；
- 风险分类值标准化；
- 五级分类笔数和余额统计；
- 十二级分类明细统计；
- 不良率、关注加不良率；
- 正常3与关注类边界风险统计；
- 数据质量异常检查；
- 结构化分析结果 Artifact 输出。

计算口径：

- 合同总笔数 = `contractId` 去重计数。
- 贷款余额合计 = `loanBalance` 求和。
- 合同金额合计 = `contractAmount` 求和。
- 分类笔数 = 按风险分类对 `contractId` 去重计数。
- 分类金额 = 按风险分类汇总 `loanBalance`。
- 占比 = 分类值 / 总计值，分母为零时返回 0 并记录警告。
- 金额内部保留原始精度，展示时再做单位换算。

## 图表生成规则

调用工具：`request_chart_rendering`。

图表必须使用受控 `VisualizationSpec`，不得输出完整 ECharts option、JavaScript、HTML、SVG 或 formatter 函数。当前协议不支持 `overall_risk_classification_distribution` 语义时，使用 `product_risk_structure` 或 `general_analysis`，并在 metadata 标注业务类型。

至少推荐生成：

- KPI 卡片：总合同笔数、贷款余额、关注类占比、不良率、关注加不良率、风险边界占比。
- 五级分类笔数分布：横向柱状图。
- 五级分类金额分布：横向柱状图或柱线组合图。
- 十二级分类结构：横向柱状图、堆叠柱状图或风险等级结构图。

图表数据只能引用 Python 分析结果 Artifact 或受控 SQL 聚合结果 Artifact，不得使用模板样例数字或 preview rows 推断全量数据。

## 报告生成规则

调用工具：`request_markdown_report_generation`。

使用 `report-template.md` 生成完整 Markdown Artifact。报告必须包含：

- 报告标题；
- 分析范围；
- 总体资产概况；
- 五级分类表；
- 十二级分类明细表；
- 核心风险指标；
- 分析结论；
- 风险边界提示；
- 图表引用；
- 数据质量说明；
- 方法和口径说明；
- 数据来源说明；
- 限制说明。

结论必须引用真实指标，区分笔数维度和金额维度，说明正常、关注、不良结构和正常1/正常2/正常3内部结构。没有历史时点数据时，只能描述潜在迁徙风险，不能声称已发生迁徙。

## 数据质量检查

返回报告前检查：

- 五级分类合计是否等于总合同数和总余额；
- 十二级分类合计是否等于总合同数和总余额；
- 正常、关注、不良合计是否等于总合同数；
- 占比是否约等于 100%，仅允许四舍五入差异；
- 是否存在重复合同、分类缺失、余额缺失、未识别分类、负余额、多币种、单位异常；
- Artifact 血缘是否包含 SQL、Python、图表和报告工具调用 ID。

校验失败时，在报告中展示数据质量警告；严重失败时不要输出粉饰性结论。

## 多轮调整

- 调整查询范围：重新调用 SQL，生成新数据集版本。
- 调整分析口径：基于指定 Artifact 重新调用 Python，生成新分析版本。
- 调整图表：基于最近 Python 或 SQL Artifact 调用图表工具，生成新图表版本。
- 调整报告：基于最近报告、分析和图表 Artifact 调用报告工具，生成新 Markdown 版本。

不要覆盖旧版本；保留版本号和血缘。

## 禁止事项

- 不得写死模板示例数字。
- 不得基于 preview rows 推断全量结论。
- 不得编造缺失字段、缺失分类、缺失金额或迁徙结论。
- 不得保存数据库账号、密码或连接字符串。
- 不得执行 Skill 文件中的任意代码。
- 不得绕过用户审批执行 SQL 或 Python。
- 不得将完整源表数据注入模型上下文。
- 不得在 Skill 中配置远端下载地址或依赖远端 Skill 市场。

## Tool Flow

```json
{
  "skillId": "overall-risk-classification-distribution",
  "steps": [
    { "step": "resolve_fields", "required": true },
    { "step": "sql_query", "tool": "request_sql_query_execution", "required": true },
    { "step": "python_analysis", "tool": "request_python_analysis_execution", "required": true },
    { "step": "chart_rendering", "tool": "request_chart_rendering", "required": false },
    { "step": "report_generation", "tool": "request_markdown_report_generation", "required": true }
  ]
}
```

## 系统指令

你正在执行“整体风险分类分布（笔数+金额）”分析 Skill。

本 Skill 用于分析信贷资产五级和十二级风险分类的笔数、贷款余额、关注率、不良率和风险边界情况。

你不能根据报告模板中的示例数字生成结论。所有指标必须来自 SQL 查询工具和 Python 分析工具的真实执行结果。

执行要求：

1. 首先确认数据源以及合同唯一标识、五级分类、贷款余额等字段映射。
2. 需要准确查询或统计数据时，调用 `request_sql_query_execution`。
3. SQL 执行前必须经过用户审批。
4. SQL 查询结果应保存为受控数据集 Artifact，不得直接把完整源表数据输入模型。
5. 统计计算、分类标准化、占比计算、风险指标计算和数据质量校验应调用 `request_python_analysis_execution`。
6. Python 执行前必须经过用户审批。
7. 需要图表时，调用 `request_chart_rendering`，并引用 SQL 或 Python Artifact。
8. 不要输出完整 ECharts option 或其他图表库原始配置。
9. 生成完整报告时，调用 `request_markdown_report_generation`。
10. 报告必须区分笔数维度和金额维度，并说明不良类、关注类和风险边界情况。
11. 如果十二级分类字段不存在，应明确报告限制并跳过十二级分类分析。
12. 不得编造缺失数据，不得根据 preview rows 推断全量结论。
