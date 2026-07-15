# 整体风险分类分布（笔数+金额）分析报告

> 本示例仅展示报告结构和占位写法，不作为运行时分析结果。真实报告必须由 SQL、Python、图表和报告工具的 Artifact 生成。

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

### 2.2 十二级分类明细（最新风险分类结果 latest_risk_result，含金额）

{{twelveLevelSection}}

## 三、核心风险指标

{{riskIndicators}}

## 四、可视化分析

{{visualizationNodes}}

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

{{methodology}}

## 九、数据血缘

{{provenance}}
