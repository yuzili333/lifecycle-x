# {{reportTitle}}

## 一、分析范围

- 数据来源：{{dataSourceName}}
- 统计日期：{{reportDate}}
- 筛选条件：{{filters}}
- 合同笔数：{{totalContracts}}
- 贷款余额(万元)：{{totalLoanBalanceFormatted}}
- 合同金额(万元)：{{totalContractAmountFormatted}}

## 二、整体风险分类分布（笔数+金额）

全样本共 **{{totalContracts}}** 笔信贷合同，贷款余额(万元)合计 **{{totalLoanBalanceFormatted}}**{{contractAmountSummary}}。风险分类分布如下：

### 2.1 五级分类分布

| 五级分类 | 笔数 | 笔数占比 | 金额(万元) | 金额占比 | 备注 |
|---|---:|---:|---:|---:|---|
{{fiveLevelRows}}
| 合计 | {{totalContracts}} | 100.00% | {{totalLoanBalanceFormatted}} | 100.00% | |

### 2.2 十二级分类明细（最新风险分类结果 latest_risk_result，含金额）

{{twelveLevelSection}}

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

### 5.1 【笔数维度】

{{countDimensionAnalysis}}

### 5.2 【金额维度】

{{balanceDimensionAnalysis}}

### 5.3 【正常类维度】

正常类维度口径：按“十二级分类/最新风险分类结果 latest_risk_result”中含“正常1”“正常2”“正常3”的数据汇总总计笔数，并分别说明正常1、正常2、正常3的结构。

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
- 金额指标默认使用贷款余额(万元)；
- 风险边界默认定义为正常3和全部关注类；
- 比率差异可能来自四舍五入；
- 本报告仅基于已授权数据源和工具执行结果，不替代人工风险判断。

## 九、数据血缘

- SQL 工具调用：{{sqlToolCallId}}
- Python 工具调用：{{pythonToolCallId}}
- 图表工具调用：{{chartToolCallIds}}
- 源数据集 Artifact：{{sourceDatasetArtifactId}}
- 分析结果 Artifact：{{analysisArtifactId}}
- 图表 Artifact：{{chartArtifactIds}}
- 报告生成时间：{{generatedAt}}
