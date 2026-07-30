# {{report_title}}

## 重点风险客户分析（含金额占比）

全样本 {{sample_count}} 笔中，非正常类客户共 {{non_normal_count}} 笔（占比 {{non_normal_count_rate_display}}），其中不良类 {{nonperforming_count}} 笔、关注类 {{attention_count}} 笔。

笔数口径：{{count_basis_text}}。{{data_quality_note}}

【金额维度】非正常类`{{loan_balance_business_name}}`合计 {{non_normal_loan_balance_display}}（占贷款余额总额 {{non_normal_loan_balance_rate_display}}），其中“不良”类 {{nonperforming_loan_balance_display}}、“关注”类 {{attention_loan_balance_display}}。{{deterioration_summary}}

| 序号 | `{{customer_name_field}}` | `{{branch_field}}` | `{{beginning_risk_field}}` | `{{latest_risk_field}}` | `{{risk_result_field}}` | `{{guarantee_method_field}}` | `{{industry_field}}` | `{{business_product_field}}` | `{{loan_term_field}}` | `{{loan_balance_business_name}}({{amount_unit_label}})` | `{{contract_amount_business_name}}({{amount_unit_label}})` | 占总额% |
|---|---|---|---|---|---|---|---|---|---|---:|---:|---:|
{{risk_customer_rows}}

## 重点风险客户特征分析

{{numbered_feature_conclusions}}
