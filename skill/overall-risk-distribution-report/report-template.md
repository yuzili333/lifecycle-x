# {{report_title}}

## 整体风险分类分布（笔数+金额）

{{报告模型依据 totals、sourceFields、countBasis 和 fallbackCode 组合样本、口径、贷款余额及可选合同金额摘要，并完成单位格式化}}

### 最新风险五级分类

| 风险分类 | 合同笔数 | 笔数占比 | 贷款余额（保留真实源单位） | 金额占比 |
|---|---:|---:|---:|---:|
{{报告模型按正常、关注、次级、可疑、损失顺序格式化 fiveLevelDistribution}}

### 最新风险分类结果

{{riskResultDistribution 非空时由报告模型生成明细表，否则省略本节}}

## 可视化图表

{{仅展示本轮成功的受控图表节点；没有图表时省略本节}}

## 分析结论

### 【笔数维度】

{{基于 fiveLevelDistribution 与 nonperformingSummary 撰写}}

### 【金额维度】

{{基于同一统计项撰写并将可确认金额格式化为三位小数亿元}}

### 正常类内部细分

{{基于 riskResultDistribution 中实际正常明细撰写；无明细时省略}}
