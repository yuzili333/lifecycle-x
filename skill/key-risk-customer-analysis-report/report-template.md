# {{report_title}}

## 重点风险客户分析（含金额占比）

{{报告模型依据 sample、riskSummary、sourceFields、countBasis 和 fallbackCode 组合样本、笔数口径和金额摘要并完成格式化}}

| 序号 | 客户名称 | 一级分行 | 年初风险分类 | 最新风险分类 | 最新风险分类结果 | 主要担保方式名称 | 国标行业投向名称 | 业务品种名称 | 短中长期贷款标识 | 贷款余额(万) | 合同金额(万) | 占总额% |
|---:|---|---|---|---|---|---|---|---|---|---:|---:|---:|
{{报告模型按 riskCustomers 顺序格式化全部重点风险合同，缺失辅助字段展示 --}}

## 重点风险客户特征分析

（1）{{依据 loanTermDistribution 撰写业务期限特征}}

（2）{{依据 riskSummary 说明不良合同，并从 riskCustomers 选取 riskGroup=nonperforming 的全部记录生成下表}}

| 客户名称 | 一级分行 | 主要担保方式名称 | 国标行业投向名称 | 贷款余额(万) |
|---|---|---|---|---:|
{{全部不良合同；无不良时省略表格}}

（3）{{依据 riskSummary 和关注合同明细撰写关注特征}}

{{deteriorationCount 非空时生成第（4）项风险迁徙结论}}

（5）{{依据 industryDistribution 和 provinceDistribution 撰写分布特征}}
