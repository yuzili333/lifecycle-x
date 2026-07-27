# {{report_title}}

## 整体风险分类分布（笔数+金额）

全样本共 {{sample_count}} 笔信贷合同。笔数口径：{{count_basis_text}}。`{{loan_balance_business_name}}`合计 {{loan_balance_display}}{{contract_amount_clause}}

| `{{five_level_field_name}}` | 笔数 | 笔数占比 | `{{loan_balance_field_name}}` | 金额占比 | 备注 |
|---|---:|---:|---:|---:|---|
| 正常 | {{normal_count}} | {{normal_count_rate}} | {{normal_balance}} | {{normal_balance_rate}} | |
| 关注 | {{attention_count}} | {{attention_count_rate}} | {{attention_balance}} | {{attention_balance_rate}} | {{attention_remark}} |
| 次级 | {{substandard_count}} | {{substandard_count_rate}} | {{substandard_balance}} | {{substandard_balance_rate}} | {{nonperforming_remark}} |
| 可疑 | {{doubtful_count}} | {{doubtful_count_rate}} | {{doubtful_balance}} | {{doubtful_balance_rate}} | |
| 损失 | {{loss_count}} | {{loss_count_rate}} | {{loss_balance}} | {{loss_balance_rate}} | |
| 合计 | {{total_count}} | 100.00% | {{total_balance}} | 100.00% | |

`{{risk_result_field_name}}`明细（含金额）：

| `{{risk_result_field_name}}` | 笔数 | 笔数占比 | `{{loan_balance_field_name}}` | 金额占比 |
|---|---:|---:|---:|---:|
{{risk_result_rows}}
| 合计 | {{total_count}} | 100.00% | {{total_balance}} | 100.00% |

## 可视化图表

{{controlled_visualization_nodes}}

## 分析结论

【笔数维度】

{{count_dimension_conclusion}}

【金额维度】

{{amount_dimension_conclusion}}

{{normal_detail_conclusion}}
