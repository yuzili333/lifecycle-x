---
name: overall-risk-classification-distribution
description: 查询并分析信贷资产五级风险分类和“十二级分类/最新风险分类结果 latest_risk_result”的笔数、贷款余额、关注率、不良率和风险边界情况，协调 SQL、Python、图表和 Markdown 报告工具生成“整体风险分类分布（笔数+金额）”分析报告。Use when the user selects @整体风险分类分布, @风险分类, @资产质量分析, or asks for credit asset risk classification distribution, asset quality, non-performing loan ratio, attention loan ratio, twelve-level classification/latest_risk_result details, charts, or a Markdown risk report in the Cycle Probe Electron client.
---

# 整体风险分类分布（笔数+金额）

## Skill 目标

执行“整体风险分类分布（笔数+金额）”分析：基于用户选择的数据源和字段映射，查询真实信贷资产数据，计算五级风险分类和十二级分类（字段必须映射为“最新风险分类结果 latest_risk_result”）的笔数、贷款余额、关注率、不良率、关注加不良率、正常3和关注类边界风险，并生成图表与完整 Markdown 报告。

不得使用报告模板中的示例数字作为运行时结果。所有指标必须来自 `request_sql_query_execution` 和 `request_python_analysis_execution` 的真实工具执行结果。

## 适用场景

- 用户选择 `@整体风险分类分布`、`@风险分类` 或 `@资产质量分析`。
- 用户要求“分析整体风险分类分布”“统计五级分类笔数和金额”“生成风险分类分布报告”“查看正常、关注和不良资产占比”“分析十二级分类明细”“分析关注类和不良类贷款”“查看正常3向关注类迁徙的潜在风险”。
- 用户在同一会话中调整查询范围、分析口径、图表形式或报告内容。

## 业务术语映射

- 信贷资产业务场景中的“十二级分类”“十二级风险分类”“十二级分类明细”“细分风险分类”均指表字典字段 `bf.loan_contract.latest_risk_result`，实际 SQL 字段优先映射为 `latest_risk_result`，中文名称为“最新风险分类结果”。
- `bf.loan_contract.latest_risk` / `latest_risk` 仅表示“最新风险分类”，用于整体风险分类或五级/三类风险结构统计，不得用于替代十二级分类明细。
- 当用户要求“正常3”“关注1/2/3”“十二级明细”“正常类内部结构”时，必须优先使用 `latest_risk_result` 的编码或名称值识别；不得从 `latest_risk` 的“正常/关注/不良”粗分类中臆造细分等级。

## 不适用场景

- 用户要求自动调整风险分类、自动预警下发、授信处置决策或监管报送结论。
- 用户未选择数据源，且当前会话没有可用数据源上下文。
- 用户要求直接连接数据库、读取账号密码、访问网络、读取任意本地文件或执行任意脚本。
- 用户只提供报告模板截图或样例数字，未提供真实数据源或已授权 Artifact。

## 必需字段

字段要求以 `field-requirements.json` 为准。导入 CSV 数据时，上传的表字典是字段语义的权威来源；Skill、Schema Context 和字段解析逻辑必须优先使用表字典中的 `businessFieldId`、`physicalName`、`displayNameZh`，不得假设内置 `credit.*` 字段一定存在。

完整分析至少需要解析：

- `bf.loan_contract.contract_serial`：合同流水号，必需，用于去重计数；兼容 `bf.loan_contract.contract_no` 和 `credit.contract_id`。
- `bf.loan_contract.latest_risk`：最新风险分类，必需，标准值为正常、关注、不良；兼容 `bf.loan_contract.latest_five_level_risk` 和 `credit.five_level_classification`。
- `bf.loan_contract.loan_balance_10k`：贷款余额(万元)，必需，用于金额维度统计；兼容 `credit.loan_balance`。

可选字段：

- `bf.loan_contract.latest_risk_result`：最新风险分类结果，业务术语“十二级分类”的唯一标准映射字段，如 `0101--正常1`、`0203--关注3`；兼容 `credit.twelve_level_classification`。
- `bf.loan_contract.contract_amount_10k`：合同金额(万元)；兼容 `credit.contract_amount`。
- `bf.loan_contract.p_date`、`bf.loan_contract.partition_date`、`bf.loan_contract.branch_name`、`bf.loan_contract.loan_term_type`、`bf.loan_contract.product_name`、`bf.loan_contract.currency` 等筛选字段。

字段缺失处理：

- 缺少合同唯一标识时，阻止准确笔数分析并请求用户确认字段。
- 缺少最新风险分类字段时，阻止执行完整分析。
- 缺少贷款余额字段时，只能生成笔数分析，并在报告限制中明确说明。
- 缺少 `latest_risk_result`/最新风险分类结果字段时，跳过十二级分类明细，不得用 `latest_risk` 推断或伪造。
- 缺少合同金额(万元)时，不输出合同金额(万元)合计。
- 字段业务含义不明确或存在多个候选映射时，先请求用户确认字段映射。

## 字段映射规则

优先通过 Schema Context 中的表字典 `businessFieldId` 建立映射。生成 SQL 前必须调用 BusinessFieldResolver 或读取其解析结果，将 `businessFieldId` 转换为实际 `physicalName`。

必须遵循：

- Skill 字段要求使用 `businessFieldId`，并允许 `compatibleBusinessFieldIds` 作为兼容候选。
- SQL 查询使用解析后的 `physicalName`。
- 页面标题、报告表头、分析结论使用 `displayNameZh`。
- 不得把 `displayNameZh` 直接作为 SQL 字段名，除非 `physicalName` 本身为中文。
- 若多个候选字段命中同一语义，优先选择 `field-requirements.json` 中的主 `businessFieldId`；仍冲突时请求用户确认。

常见映射参考：

| businessFieldId | 中文名称 | 常见源字段名 |
|---|---|---|
| bf.loan_contract.contract_serial | 合同流水号 | contract_serial、合同流水号、合同流水 |
| bf.loan_contract.contract_no | 合同编号 | contract_no、合同编号、合同号 |
| bf.loan_contract.latest_risk | 最新风险分类 | latest_risk、最新风险分类、风险分类 |
| bf.loan_contract.latest_five_level_risk | 最新风险五级分类（兼容） | latest_five_level_risk、最新风险五级分类、五级分类 |
| bf.loan_contract.latest_risk_result | 最新风险分类结果（十二级分类） | latest_risk_result、最新风险分类结果、当前风险分类结果、十二级分类 |
| bf.loan_contract.loan_balance_10k | 贷款余额(万元) | loan_balance_10k、贷款余额(万元)、贷款余额 |
| bf.loan_contract.contract_amount_10k | 合同金额(万元) | contract_amount_10k、合同金额(万元)、合同金额 |
| bf.loan_contract.p_date | 数据日期 | p_date、数据日期、业务日期、统计日期 |
| bf.loan_contract.branch_name | 一级分行名称 | branch_name、一级分行、所属分行 |

未识别分类必须单独列为“未识别”，不得自动归入正常类。

## 风险分类口径

五级分类标准顺序：正常、关注、次级、可疑、损失。

不良类 = 次级 + 可疑 + 损失。

关注加不良 = 关注 + 次级 + 可疑 + 损失。

默认十二级分类（来源字段必须为最新风险分类结果 `latest_risk_result`）：

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
6. 调用 `request_chart_rendering` 生成 KPI、五级分类和十二级分类（基于 `latest_risk_result`）图表 Artifact。
7. 调用 `request_markdown_report_generation` 生成 Markdown 报告 Artifact 和标题卡片。

用户只要求查询时，可以仅调用 SQL。用户只要求更新图表时，可以基于最近 Python 或 SQL Artifact 调用图表工具。用户只要求修改报告时，可以基于最近报告版本和已有 Artifact 调用报告工具。

四个工具保持独立注册，不得封装为不可拆分的复合工具。

## SQL 查询规则

调用工具：`request_sql_query_execution`。

只生成查询类 SQL，必须经过 SQL Safety Gateway、权限校验、风险评估和用户审批。SQL 结果保存为 Artifact 或 SQLite 临时表，Skill 只持有结果引用和摘要，不直接把完整源表数据输入模型。

SQL 应提取：

- 合同唯一标识；
- 五级分类；
- 十二级分类（最新风险分类结果 `latest_risk_result`）；
- 贷款余额(万元)；
- 合同金额(万元)；
- 用户指定筛选维度。

示例请求：

```json
{
  "dataSourceId": "{{dataSourceId}}",
  "purpose": "查询整体风险分类分布分析所需基础明细数据",
  "fieldMapping": {
    "contractId": {
      "businessFieldId": "bf.loan_contract.contract_serial",
      "physicalName": "contract_serial",
      "displayNameZh": "合同流水号"
    },
    "fiveLevelClassification": {
      "businessFieldId": "bf.loan_contract.latest_risk",
      "physicalName": "latest_risk",
      "displayNameZh": "最新风险分类"
    },
    "twelveLevelClassification": {
      "businessFieldId": "bf.loan_contract.latest_risk_result",
      "physicalName": "latest_risk_result",
      "displayNameZh": "最新风险分类结果"
    },
    "loanBalance": {
      "businessFieldId": "bf.loan_contract.loan_balance_10k",
      "physicalName": "loan_balance_10k",
      "displayNameZh": "贷款余额(万元)",
      "amountUnit": "ten_thousand_yuan"
    },
    "contractAmount": {
      "businessFieldId": "bf.loan_contract.contract_amount_10k",
      "physicalName": "contract_amount_10k",
      "displayNameZh": "合同金额(万元)",
      "amountUnit": "ten_thousand_yuan"
    }
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
- 十二级分类明细统计，输入字段必须为 `latest_risk_result`；
- 不良率、关注加不良率；
- 正常3与关注类边界风险统计；
- 正常类维度统计：仅基于十二级分类字段 `latest_risk_result` 中包含“正常1”“正常2”“正常3”的记录，汇总正常类总计笔数，并分别统计正常1、正常2、正常3的笔数、余额和占比；不得用 `latest_risk` 的“正常”粗分类替代；
- 数据质量异常检查；
- 结构化分析结果 Artifact 输出。

计算口径：

- 合同总笔数 = `contractId` 去重计数。
- 贷款余额(万元)合计 = `loanBalance` 求和。
- 合同金额(万元)合计 = `contractAmount` 求和。
- 分类笔数 = 按风险分类对 `contractId` 去重计数。
- 分类金额 = 按风险分类汇总 `loanBalance`。
- 占比 = 分类值 / 总计值，分母为零时返回 0 并记录警告。
- 金额内部保留原始精度，展示时再做单位换算。

## 图表生成规则

调用工具：`request_chart_rendering`。

图表必须使用受控 `VisualizationSpec`，不得输出完整 ECharts option、JavaScript、HTML、SVG 或 formatter 函数。当前协议不支持 `overall_risk_classification_distribution` 语义时，使用 `product_risk_structure` 或 `general_analysis`，并在 metadata 标注业务类型。

至少推荐生成：

- KPI 卡片：总合同笔数、贷款余额(万元)、关注类占比、不良率、关注加不良率、风险边界占比。
- 五级分类笔数分布：横向柱状图。
- 五级分类金额分布：横向柱状图或柱线组合图。
- 十二级分类结构：基于 `latest_risk_result` 的横向柱状图、堆叠柱状图或风险等级结构图。

图表数据只能引用 Python 分析结果 Artifact 或受控 SQL 聚合结果 Artifact，不得使用模板样例数字或 preview rows 推断全量数据。

## 报告生成规则

调用工具：`request_markdown_report_generation`。

使用 `report-template.md` 生成完整 Markdown Artifact。报告必须包含：

- 报告标题；
- 分析范围；
- 总体资产概况；
- 五级分类表；
- 十二级分类明细表，字段来源说明为“最新风险分类结果 latest_risk_result”；
- 核心风险指标；
- 分析结论；
- 风险边界提示；
- 图表引用；
- 数据质量说明；
- 方法和口径说明；
- 数据来源说明；
- 限制说明。

分析结论章节必须至少包含三个明确小节标签：`【笔数维度】`、`【金额维度】`、`【正常类维度】`。结论必须引用真实指标，区分笔数维度和金额维度，说明正常、关注、不良结构和正常1/正常2/正常3内部结构。`【正常类维度】` 是指十二级分类字段 `latest_risk_result` 中含“正常1”“正常2”“正常3”的数据总计笔数及其内部结构，不得用 `latest_risk` 的“正常”粗分类直接替代。没有历史时点数据时，只能描述潜在迁徙风险，不能声称已发生迁徙。

## 数据质量检查

返回报告前检查：

- 五级分类合计是否等于总合同数和总余额；
- 十二级分类（latest_risk_result）合计是否等于总合同数和总余额；
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

本 Skill 用于分析信贷资产五级风险分类和十二级分类（字典字段：最新风险分类结果 latest_risk_result）的笔数、贷款余额、关注率、不良率和风险边界情况。

你不能根据报告模板中的示例数字生成结论。所有指标必须来自 SQL 查询工具和 Python 分析工具的真实执行结果。

执行要求：

1. 首先读取 `field-requirements.json`，用用户所选数据源的表字典字段逐项解析合同唯一标识、五级分类、十二级分类（必须对应最新风险分类结果 `latest_risk_result`）、贷款余额和合同金额。
2. 当前标准字典优先映射为 `contract_serial`、`latest_risk`、`latest_risk_result`、`loan_balance_10k`、`contract_amount_10k`；`latest_five_level_risk` 仅作为兼容风险字段；十二级分类只允许使用 `latest_risk_result` 或其兼容业务字段；SQL 只能使用解析后的 `physicalName`。
3. 需要准确查询或统计数据时，调用 `request_sql_query_execution`。
4. SQL 执行前必须经过用户审批。
5. SQL 查询结果应保存为受控数据集 Artifact，不得直接把完整源表数据输入模型。
6. 统计计算、分类标准化、占比计算、风险指标计算和数据质量校验应调用 `request_python_analysis_execution`。
7. Python 执行前必须经过用户审批。
8. 需要图表时，调用 `request_chart_rendering`，并引用 SQL 或 Python Artifact。
9. 不要输出完整 ECharts option 或其他图表库原始配置。
10. 生成完整报告时，调用 `request_markdown_report_generation`。
11. 报告分析结论必须包含 `【笔数维度】`、`【金额维度】`、`【正常类维度】` 三个小节；其中 `【正常类维度】` 必须说明十二级分类 `latest_risk_result` 中含“正常1”“正常2”“正常3”的数据总计笔数，并说明正常1、正常2、正常3内部结构。
12. 如果最新风险分类结果 `latest_risk_result` 字段不存在，应明确报告限制并跳过十二级分类分析，不得使用 `latest_risk` 代替。
13. 不得编造缺失数据，不得根据 preview rows 推断全量结论。
