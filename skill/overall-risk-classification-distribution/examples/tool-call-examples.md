# Tool Call Examples

## SQL Query

```json
{
  "tool": "request_sql_query_execution",
  "input": {
    "dataSourceId": "ds_credit_asset",
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
      "institutionCodes": ["510000"]
    },
    "outputMode": "detail_dataset",
    "requireApproval": true
  }
}
```

## Python Analysis

```json
{
  "tool": "request_python_analysis_execution",
  "input": {
    "purpose": "对 SQL 数据集进行风险分类统计、占比计算、边界风险识别和数据质量校验",
    "inputArtifactIds": ["sql-dataset-v1"],
    "analysisContract": "OverallRiskClassificationReportData",
    "requireApproval": true,
    "outputs": [
      "risk-classification-analysis.json",
      "data-quality-summary.json"
    ]
  }
}
```

## Chart Rendering

```json
{
  "tool": "request_chart_rendering",
  "input": {
    "purpose": "生成五级分类笔数分布横向柱状图",
    "sourceArtifactIds": ["python-analysis-v1"],
    "visualizationSpec": {
      "specVersion": "1.0",
      "visualizationId": "risk-five-level-count-v1",
      "type": "horizontal_bar",
      "title": "五级分类笔数分布",
      "businessSemantic": "product_risk_structure",
      "data": {
        "mode": "artifact",
        "artifactId": "python-analysis-v1",
        "dataPath": "$.fiveLevelDistribution"
      },
      "dimensions": [
        {
          "field": "classification",
          "label": "五级分类",
          "dataType": "category",
          "role": "category"
        }
      ],
      "measures": [
        {
          "field": "contractCount",
          "label": "笔数",
          "dataType": "count",
          "role": "value"
        },
        {
          "field": "contractCountRatio",
          "label": "笔数占比",
          "dataType": "percentage",
          "role": "rate"
        }
      ],
      "encoding": {
        "category": "classification",
        "value": "contractCount"
      },
      "provenance": {
        "sourceType": "python",
        "sourceRequestId": "python-call-v1",
        "sourceDatasetId": "python-analysis-v1",
        "generatedAt": "2026-07-14T00:00:00.000Z"
      },
      "metadata": {
        "businessType": "overall_risk_classification_distribution"
      }
    }
  }
}
```

## Markdown Report Generation

```json
{
  "tool": "request_markdown_report_generation",
  "input": {
    "purpose": "基于风险分类分析 Artifact 和图表 Artifact 生成 Markdown 报告",
    "sourceArtifactIds": [
      "sql-dataset-v1",
      "python-analysis-v1",
      "chart-five-level-count-v1"
    ],
    "title": "整体风险分类分布（笔数+金额）分析报告",
    "templateFile": "report-template.md",
    "outputArtifactType": "report_markdown"
  }
}
```
