import { describe, expect, it } from "vitest";
import { buildFallbackTempCsvSqlForAnalysisRequest, buildGenericSqlResultAnalysisPythonScript, buildOverallRiskDistributionMarkdown, detectToolFromAssistantOutput, formatStoppedGenerationMessage, generalStreamSegmentId, generalTextStreamSegmentId, generatedReportArtifactId, generatedReportToolCallId, inferReportTitle, isPreToolTextGuidanceRequiredInputs, isPythonReportCardContent, isReportGenerationContent, normalizeAnalysisReportMarkdown, normalizeAnalysisReportTitle, reportStreamSegmentId, selectedFieldReferencesMarkdown, shouldAnalyzePriorSqlResult, shouldAutoStartPythonReport, shouldEagerStartToolFromAssistantStream, shouldForceGenericSqlResultAnalysisScript, shouldGenerateReportFromAnalysisResult, shouldKeepProviderToolActivityMessage, shouldRegisterAssistantGeneratedArtifacts, shouldRouteSkillThroughModel, shouldStartOverallRiskWorkflowAfterModelText, shouldUseModelForUnclearTaskGoal } from "./assistantRuntime";
import { MissingInputDetector } from "./agentGuidance";
import type { ChatCsvSelectedFieldRef, ConversationTempCsvTable } from "./chatCsvTempSource";

describe("AssistantRuntime workflow intent", () => {
  it("starts Python report flow for one-shot SQL, chart, and report requests", () => {
    expect(
      shouldAutoStartPythonReport(
        "查询各分行“accounting_org_name”下存在最近风险等级“latest_risk_class”为“不良”的全字段数据，再根据查询到的数据统计最近风险结果“latest_risk_result”为“0300--次级”总计数量，按总计数量倒序排序后渲染成柱状图放入到报告中。",
      ),
    ).toBe(true);
  });

  it("does not start Python report flow for plain data lookup requests", () => {
    expect(shouldAutoStartPythonReport("查询最近风险等级为不良的前 20 条明细数据。")).toBe(false);
  });

  it("formats user stopped generation as a plain text message", () => {
    expect(formatStoppedGenerationMessage(1_000, 2_250)).toBe("你在 1s 后停止了");
    expect(formatStoppedGenerationMessage(1_000, 13_400)).toBe("你在 12s 后停止了");
    expect(formatStoppedGenerationMessage(1_000, 62_400)).toBe("你在 1m 1s 后停止了");
  });

  it("continues tool detection when provider activity text contains executable SQL", () => {
    const content = [
      "待执行 SQL：",
      "```sql",
      "select * from \"chat_csv_abc\" where \"最新风险分类\" = '不良'",
      "```",
    ].join("\n");
    const message = {
      id: "assistant-1",
      conversationId: "conversation-1",
      userId: "user-1",
      role: "assistant" as const,
      status: "completed" as const,
      content,
      blocks: [{ id: "block-1", type: "markdown" as const, content }],
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:01.000Z",
      integrityHash: "hash",
    };

    expect(detectToolFromAssistantOutput(content)).toEqual({
      kind: "sql",
      script: "select * from \"chat_csv_abc\" where \"最新风险分类\" = '不良'",
    });
    expect(shouldKeepProviderToolActivityMessage(true, message, content)).toBe(false);
    expect(shouldKeepProviderToolActivityMessage(true, { ...message, content: "正在查询数据。", blocks: [{ id: "block-2", type: "text" as const, content: "正在查询数据。" }] }, "正在查询数据。")).toBe(true);
  });

  it("detects executable SQL from closed fenced blocks before the model stream naturally ends", () => {
    const content = [
      "我将执行如下 SQL：",
      "```sqlite",
      "SELECT *",
      "FROM \"chat_csv_abc\"",
      "WHERE \"最新风险分类\" = '不良'",
      "```",
      "",
      "后续再根据结果统计。",
    ].join("\n");

    expect(shouldEagerStartToolFromAssistantStream(content)).toBe(true);
    expect(detectToolFromAssistantOutput(content)).toEqual({
      kind: "sql",
      script: [
        "SELECT *",
        "FROM \"chat_csv_abc\"",
        "WHERE \"最新风险分类\" = '不良'",
      ].join("\n"),
    });
  });

  it("extracts the first executable SQL block when the model emits multiple SQL previews", () => {
    const content = [
      "明细查询：",
      "```sql",
      "SELECT * FROM \"chat_csv_abc\" WHERE \"最新风险分类\" = '不良'",
      "```",
      "统计查询：",
      "```sql",
      "SELECT \"最新风险分类结果\", COUNT(*) AS \"总计数量\" FROM \"chat_csv_abc\" GROUP BY \"最新风险分类结果\"",
      "```",
    ].join("\n");

    expect(detectToolFromAssistantOutput(content)).toEqual({
      kind: "sql",
      script: "SELECT * FROM \"chat_csv_abc\" WHERE \"最新风险分类\" = '不良'",
    });
  });

  it("renders selected field references as high-priority prompt mappings", () => {
    const markdown = selectedFieldReferencesMarkdown([
      {
        tokenId: "field-token-risk",
        type: "csv_field",
        tempDataSourceId: "temp-ds-1",
        tempTableId: "temp-table-1",
        fieldId: "risk",
        sourceHeader: "最新风险分类",
        physicalName: "latest_risk",
        displayName: "最新风险分类",
        logicalType: "category",
        sqliteType: "TEXT",
        rawText: "#最新风险分类",
        start: 0,
        end: 7,
        createdAt: "2026-07-20T00:00:00.000Z",
        status: "valid",
      },
      {
        tokenId: "field-token-risk-result",
        type: "csv_field",
        tempDataSourceId: "temp-ds-1",
        tempTableId: "temp-table-1",
        fieldId: "risk-result",
        sourceHeader: "最新风险分类结果",
        physicalName: "latest_risk_result",
        displayName: "最新风险分类结果",
        logicalType: "category",
        sqliteType: "TEXT",
        rawText: "#最新风险分类结果",
        start: 10,
        end: 19,
        createdAt: "2026-07-20T00:00:00.000Z",
        status: "valid",
      },
    ]);

    expect(markdown).toContain("本轮字段引用映射（最高优先级）");
    expect(markdown).toContain("#最新风险分类结果");
    expect(markdown).toContain("latest_risk_result");
    expect(markdown).toContain('"latest_risk_result"');
    expect(markdown!.indexOf("#最新风险分类结果")).toBeLessThan(markdown!.indexOf("#最新风险分类 |"));
  });

  it("routes unclear task goals to model text guidance instead of guidance cards", () => {
    const detection = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "这个呢",
    });

    expect(detection.missingInputs.map((item) => item.key)).toEqual(["analysis_goal"]);
    expect(shouldUseModelForUnclearTaskGoal(detection)).toBe(true);
    expect(isPreToolTextGuidanceRequiredInputs(detection.missingInputs)).toBe(true);
  });

  it("routes missing data source pre-tool guidance to model text instead of guidance cards", () => {
    const detection = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "分析查询结果中合同数据为前三名的分行。",
    });

    expect(detection.missingInputs.map((item) => item.key)).toEqual(["data_source"]);
    expect(shouldUseModelForUnclearTaskGoal(detection)).toBe(true);
    expect(isPreToolTextGuidanceRequiredInputs(detection.missingInputs)).toBe(true);
  });

  it("continues with Python analysis for SQL summary and analysis requests", () => {
    expect(shouldAutoStartPythonReport("查询各个分行 #一级分行名称 的 #短中长期贷款标识 中“中期”和“长期”的数据汇总和分析。")).toBe(true);
    expect(shouldAutoStartPythonReport("查询导入的数据样本中共有多少例 #最新风险分类 字段为“关注”的合同数据，以及分布在每个分行 #一级分行名称 各有多少例。")).toBe(true);
  });

  it("recognizes query-result summary requests as prior SQL analysis", () => {
    expect(shouldAnalyzePriorSqlResult("根据查询数据结果汇总分行 #一级分行名称 的最新风险分类为“关注”的合同总数以及全部分行的占比。")).toBe(true);
  });

  it("recognizes latest analysis result report generation requests", () => {
    expect(shouldGenerateReportFromAnalysisResult("请根据分析结果生成报告")).toBe(true);
    expect(shouldGenerateReportFromAnalysisResult("请基于上一轮分析整理成 Markdown 报告")).toBe(true);
  });

  it("routes selected overall risk skill through model orchestration instead of local history fallback", () => {
    expect(shouldRouteSkillThroughModel("overall-risk-classification-distribution")).toBe(true);
    expect(shouldRouteSkillThroughModel(null)).toBe(false);
  });

  it("starts governed overall risk workflow when the model only acknowledges a new selected-data report request", () => {
    expect(
      shouldStartOverallRiskWorkflowAfterModelText(
        {
          skill: "overall-risk-classification-distribution",
          prompt: "据选择的数据源生成一份整体风险分类分布报告",
        },
        "我将基于当前已确认的数据集为您重新生成“整体风险分类分布”报告。首先查询所需的明细字段，交由 Python 统一计算。",
      ),
    ).toBe(true);
  });

  it("keeps selected overall risk report requests on the governed workflow even if model text contains SQL", () => {
    expect(
      shouldStartOverallRiskWorkflowAfterModelText(
        {
          skill: "overall-risk-classification-distribution",
          prompt: "据选择的数据源生成一份整体风险分类分布报告",
        },
        "```sql\nselect loan_balance_10k, contract_amount_10k from selected_source\n```",
      ),
    ).toBe(true);
  });

  it("does not start overall risk workflow for explicit historical report reuse", () => {
    expect(
      shouldStartOverallRiskWorkflowAfterModelText(
        {
          skill: "overall-risk-classification-distribution",
          prompt: "查看上一轮整体风险分类分布报告版本",
        },
        "我将打开已有报告版本。",
      ),
    ).toBe(false);
  });

  it("does not hijack ad-hoc branch and term analysis into the overall risk skill workflow", () => {
    expect(
      shouldStartOverallRiskWorkflowAfterModelText(
        {
          skill: "overall-risk-classification-distribution",
          prompt: "查询各个分行 #一级分行名称 的 #短中长期贷款标识 中“中期”和“长期”的数据汇总和分析。",
        },
        "我将基于当前数据源生成整体风险分类分布报告。",
      ),
    ).toBe(false);
  });

  it("does not start local skill workflow when no skill is selected", () => {
    expect(
      shouldStartOverallRiskWorkflowAfterModelText(
        {
          skill: null,
          prompt: "查询各分行数据并分析占比。",
        },
        "我将基于当前数据源生成整体风险分类分布报告。",
      ),
    ).toBe(false);
  });

  it("builds generic Python analysis without business-field hardcoding or fallback skill templates", () => {
    const script = buildGenericSqlResultAnalysisPythonScript(
      "请根据查询结果分析 #一级分行名称 和 #短中长期贷款标识 的占比。",
      [
        { 一级分行名称: "杭州分行", 短中长期贷款标识: "中期", 数量: 3 },
        { 一级分行名称: "宁波分行", 短中长期贷款标识: "长期", 数量: 2 },
      ],
      {
        dataSourceName: "信贷风险表",
        sampleCount: 2,
        selectedFieldNames: ["一级分行名称", "短中长期贷款标识"],
      },
    );

    expect(script).toContain("match_requested_fields");
    expect(script).toContain("# {analysis_object}分析报告");
    expect(script).toContain("分析对象：{analysis_object}");
    expect(script).toContain("样本数量：{sample_count}");
    expect(script).toContain("筛选字段：");
    expect(script).not.toContain("已按用户描述中的引号取值筛选分析样本");
    expect(script).not.toContain("返回记录数");
    expect(script).not.toContain("已匹配用户指定字段");
    expect(script).not.toContain("说明：");
    expect(script).not.toContain("loan_term_type");
    expect(script).not.toContain("branch_name");
    expect(script).not.toContain("latest_risk_result");
    expect(script).not.toContain("loan_balance_10k");
    expect(script).not.toContain("contract_amount_10k");
    expect(script).not.toContain("整体风险分类分布");
    expect(script).not.toContain("核心风险指标");
    expect(script).not.toContain("数据质量与口径说明");
  });

  it("normalizes analysis report title and summary metadata from data source context", () => {
    const title = normalizeAnalysisReportTitle({
      sourceName: "信贷风险表.csv",
      requestedTitle: "SQL 查询结果分析",
      markdown: "# SQL 查询结果分析\n\n- 分析对象：上一轮 SQL 工具调用返回结果\n- 已按用户描述中的引号取值筛选分析样本：25 条。\n\n## 汇总",
    });
    const markdown = normalizeAnalysisReportMarkdown(
      "# SQL 查询结果分析\n\n- 分析对象：上一轮 SQL 工具调用返回结果\n- 已按用户描述中的引号取值筛选分析样本：25 条。\n\n## 汇总",
      {
        title,
        sourceName: "信贷风险表",
        selectedFieldNames: ["一级分行名称", "最新风险五级分类"],
      },
    );

    expect(title).toBe("信贷风险表分析报告");
    expect(normalizeAnalysisReportTitle({ sourceName: "贷款明细.xlsx" })).toBe("贷款明细分析报告");
    expect(markdown).toContain("# 信贷风险表分析报告");
    expect(markdown).toContain("- 分析对象：信贷风险表");
    expect(markdown).toContain("- 筛选字段：一级分行名称、最新风险五级分类");
    expect(markdown).not.toContain("SQL 查询结果分析");
    expect(markdown).not.toContain("已按用户描述中的引号取值筛选分析样本");
  });

  it("keeps generic SQL result analysis limited to requested field and count intent", () => {
    const script = buildGenericSqlResultAnalysisPythonScript(
      "根据查询数据结果汇总分行 #一级分行名称 的最新风险分类为“关注”的合同总数以及全部分行的占比。",
      [
        { __row_index: 1, 一级分行名称: "上海分行", 最新风险分类: "关注", 业务品种大类: "流贷" },
        { __row_index: 2, 一级分行名称: "北京分行", 最新风险分类: "正常", 业务品种大类: "个贷" },
      ],
    );

    expect(script).toContain("合同总数");
    expect(script).toContain("全部分行占比");
    expect(script).toContain("filter_rows_by_requested_values");
    expect(script).not.toContain("行数 |");
    expect(script).not.toContain("行数占比");
    expect(script).not.toContain("__row_index合计");
    expect(script).not.toContain("__row_index占比");
    expect(script).not.toContain("交叉分布");
    expect(script).not.toContain("数值字段汇总");
    expect(script).not.toContain("字段概览");
    expect(script).not.toContain("inferred_dimensions");
    expect(script).not.toContain("inferred_measures");
  });

  it("forces generic analysis when model Python only reports SQL row count", () => {
    const weakScript = "print(f'返回记录数：{len(rows)}')";

    expect(
      shouldForceGenericSqlResultAnalysisScript(
        "按分类维度查询字段 #最新风险五级分类 的数据，分析每个分类总计多少笔。",
        weakScript,
        [{ tempDataSourceId: "temp-source-1", status: "valid" } as ChatCsvSelectedFieldRef],
      ),
    ).toBe(true);
  });

  it("builds category count tables from aggregated SQL rows even when field matching is imperfect", () => {
    const script = buildGenericSqlResultAnalysisPythonScript(
      "按分类维度查询字段 #最新风险五级分类 的数据，分析每个分类总计多少笔。",
      [
        { "最新风险五级分类": "正常", "笔数": 10 },
        { "最新风险五级分类": "关注", "笔数": 3 },
        { "最新风险五级分类": "次级", "笔数": 1 },
        { "最新风险五级分类": "可疑", "笔数": 1 },
      ],
    );

    expect(script).toContain("compact_name");
    expect(script).toContain("choose_dimensions");
    expect(script).toContain("## 按 {dimension} 汇总");
    expect(script).toContain("weighted_total");
  });

  it("recognizes fuzzy count aliases from SQL aggregated rows", () => {
    const script = buildGenericSqlResultAnalysisPythonScript(
      "按分类维度查询字段 #最新风险五级分类 的数据，分析每个分类总计多少笔。",
      [
        { "最新风险五级分类": "正常", "总计合同数": 10 },
        { "最新风险五级分类": "关注", "总计合同数": 3 },
        { "最新风险五级分类": "次级", "总计合同数": 1 },
        { "最新风险五级分类": "可疑", "总计合同数": 1 },
      ],
    );

    expect(script).toContain("'总计合同数'");
    expect(script).toContain("compact_aliases");
    expect(script).toContain("count_field([key]) == key");
  });

  it("treats Python markdown analysis output as report-card content only for analysis/report requests", () => {
    const markdown = "# SQL 查询结果分析\n\n## 按 分行 分布\n| 分行 | 行数 | 占比 |\n|---|---:|---:|\n| 杭州 | 2 | 100% |";

    expect(isPythonReportCardContent("查询各分行数据汇总和分析。", markdown)).toBe(true);
    expect(isPythonReportCardContent("查询前 20 条明细。", "工具执行完成。")).toBe(false);
  });

  it("builds fallback CSV SQL when the model only acknowledges a field-based report request", () => {
    const source: ConversationTempCsvTable = {
      tempTableId: "temp-table-1",
      tempDataSourceId: "temp-source-1",
      conversationId: "conversation-1",
      userId: "user-1",
      fileName: "loan.csv",
      fileSizeBytes: 100,
      sqliteTableName: "chat_csv_conv_1",
      rowCount: 10,
      columnCount: 3,
      status: "ready",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      columns: [
        {
          ordinalPosition: 0,
          sourceHeader: "一级分行名称",
          sqliteColumnName: "一级分行名称",
          displayName: "一级分行名称",
          inferredLogicalType: "category",
          sqliteType: "TEXT",
        },
        {
          ordinalPosition: 1,
          sourceHeader: "最新风险五级分类",
          sqliteColumnName: "最新风险五级分类",
          displayName: "最新风险五级分类",
          inferredLogicalType: "category",
          sqliteType: "TEXT",
        },
        {
          ordinalPosition: 2,
          sourceHeader: "贷款余额（万元）",
          sqliteColumnName: "贷款余额（万元）",
          displayName: "贷款余额（万元）",
          inferredLogicalType: "decimal",
          sqliteType: "REAL",
        },
      ],
    };
    const prompt = "请统计 #一级分行名称 上海分行的数据中 #最新风险五级分类 不同分类的数据汇总，再输出分析结果报告。";
    const fields: ChatCsvSelectedFieldRef[] = [
      {
        tokenId: "token-branch",
        type: "csv_field",
        tempDataSourceId: "temp-source-1",
        tempTableId: "temp-table-1",
        fieldId: "branch",
        sourceHeader: "一级分行名称",
        physicalName: "一级分行名称",
        displayName: "一级分行名称",
        logicalType: "category",
        sqliteType: "TEXT",
        rawText: "#一级分行名称",
        start: prompt.indexOf("#一级分行名称"),
        end: prompt.indexOf("#一级分行名称") + "#一级分行名称".length,
        createdAt: "2026-07-17T00:00:00.000Z",
        status: "valid",
      },
      {
        tokenId: "token-risk",
        type: "csv_field",
        tempDataSourceId: "temp-source-1",
        tempTableId: "temp-table-1",
        fieldId: "risk",
        sourceHeader: "最新风险五级分类",
        physicalName: "最新风险五级分类",
        displayName: "最新风险五级分类",
        logicalType: "category",
        sqliteType: "TEXT",
        rawText: "#最新风险五级分类",
        start: prompt.indexOf("#最新风险五级分类"),
        end: prompt.indexOf("#最新风险五级分类") + "#最新风险五级分类".length,
        createdAt: "2026-07-17T00:00:00.000Z",
        status: "valid",
      },
    ];

    const sql = buildFallbackTempCsvSqlForAnalysisRequest(prompt, source, fields);

    expect(sql).toContain('from "chat_csv_conv_1"');
    expect(sql).toContain('where "一级分行名称" = \'上海分行\'');
    expect(sql).toContain('group by "最新风险五级分类"');
    expect(sql).toContain('sum("贷款余额（万元）") as "贷款余额（万元）合计"');
    expect(sql).not.toContain("整体风险分类分布");
  });

  it("builds fallback CSV SQL for count-by-branch requests with field-is-value filters", () => {
    const source: ConversationTempCsvTable = {
      tempTableId: "temp-table-1",
      tempDataSourceId: "temp-source-1",
      conversationId: "conversation-1",
      userId: "user-1",
      fileName: "loan.csv",
      fileSizeBytes: 100,
      sqliteTableName: "chat_csv_conv_1",
      rowCount: 10,
      columnCount: 2,
      status: "ready",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      columns: [
        {
          ordinalPosition: 0,
          sourceHeader: "最新风险分类",
          sqliteColumnName: "最新风险分类",
          displayName: "最新风险分类",
          inferredLogicalType: "category",
          sqliteType: "TEXT",
        },
        {
          ordinalPosition: 1,
          sourceHeader: "一级分行名称",
          sqliteColumnName: "一级分行名称",
          displayName: "一级分行名称",
          inferredLogicalType: "category",
          sqliteType: "TEXT",
        },
      ],
    };
    const prompt = "查询导入的数据样本中共有多少例 #最新风险分类 字段为“关注”的合同数据，以及分布在每个分行 #一级分行名称 各有多少例。";
    const fields: ChatCsvSelectedFieldRef[] = [
      {
        tokenId: "token-risk",
        type: "csv_field",
        tempDataSourceId: "temp-source-1",
        tempTableId: "temp-table-1",
        fieldId: "risk",
        sourceHeader: "最新风险分类",
        physicalName: "最新风险分类",
        displayName: "最新风险分类",
        logicalType: "category",
        sqliteType: "TEXT",
        rawText: "#最新风险分类",
        start: prompt.indexOf("#最新风险分类"),
        end: prompt.indexOf("#最新风险分类") + "#最新风险分类".length,
        createdAt: "2026-07-17T00:00:00.000Z",
        status: "valid",
      },
      {
        tokenId: "token-branch",
        type: "csv_field",
        tempDataSourceId: "temp-source-1",
        tempTableId: "temp-table-1",
        fieldId: "branch",
        sourceHeader: "一级分行名称",
        physicalName: "一级分行名称",
        displayName: "一级分行名称",
        logicalType: "category",
        sqliteType: "TEXT",
        rawText: "#一级分行名称",
        start: prompt.indexOf("#一级分行名称"),
        end: prompt.indexOf("#一级分行名称") + "#一级分行名称".length,
        createdAt: "2026-07-17T00:00:00.000Z",
        status: "valid",
      },
    ];

    const sql = buildFallbackTempCsvSqlForAnalysisRequest(prompt, source, fields);

    expect(sql).toContain('where "最新风险分类" = \'关注\'');
    expect(sql).toContain('group by "一级分行名称"');
    expect(sql).toContain('count(*) as "笔数"');
  });

  it("builds fallback CSV SQL for all-class risk summaries with selected amount metrics", () => {
    const source: ConversationTempCsvTable = {
      tempTableId: "temp-table-1",
      tempDataSourceId: "temp-source-1",
      conversationId: "conversation-1",
      userId: "user-1",
      fileName: "loan.csv",
      fileSizeBytes: 100,
      sqliteTableName: "chat_csv_conv_1",
      rowCount: 10,
      columnCount: 3,
      status: "ready",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      columns: [
        {
          ordinalPosition: 0,
          sourceHeader: "最新风险五级分类",
          sqliteColumnName: "最新风险五级分类",
          displayName: "最新风险五级分类",
          inferredLogicalType: "category",
          sqliteType: "TEXT",
        },
        {
          ordinalPosition: 1,
          sourceHeader: "贷款余额(万元)",
          sqliteColumnName: "贷款余额(万元)",
          displayName: "贷款余额(万元)",
          inferredLogicalType: "decimal",
          sqliteType: "NUMERIC",
        },
        {
          ordinalPosition: 2,
          sourceHeader: "合同金额(万元)",
          sqliteColumnName: "合同金额(万元)",
          displayName: "合同金额(万元)",
          inferredLogicalType: "decimal",
          sqliteType: "NUMERIC",
        },
      ],
    };
    const prompt = "查询 #最新风险五级分类  全部分类数据，分析每一类数据的总计合同笔数以及每一类数据合同总计笔数与全部样本数量对比的笔数占比，分析 每一类数据的 #贷款余额(万元)  以及与全部样本 #贷款余额(万元)  总计的占比，每一类数据可在备注信息列展示“关注类”和“不良类”的笔数总计和 #合同金额(万元)  ，如“关注类合计： 2笔 / 5,340万元”。";
    const field = (name: string, tokenId: string): ChatCsvSelectedFieldRef => ({
      tokenId,
      type: "csv_field",
      tempDataSourceId: "temp-source-1",
      tempTableId: "temp-table-1",
      fieldId: name,
      sourceHeader: name,
      physicalName: name,
      displayName: name,
      logicalType: name.includes("金额") || name.includes("余额") ? "decimal" : "category",
      sqliteType: name.includes("金额") || name.includes("余额") ? "NUMERIC" : "TEXT",
      rawText: `#${name}`,
      start: prompt.indexOf(`#${name}`),
      end: prompt.indexOf(`#${name}`) + `#${name}`.length,
      createdAt: "2026-07-17T00:00:00.000Z",
      status: "valid",
    });

    const sql = buildFallbackTempCsvSqlForAnalysisRequest(prompt, source, [
      field("最新风险五级分类", "token-risk"),
      field("贷款余额(万元)", "token-balance"),
      field("合同金额(万元)", "token-amount"),
    ]);

    expect(sql).toContain('from "chat_csv_conv_1"');
    expect(sql).toContain('group by "最新风险五级分类"');
    expect(sql).toContain('count(*) as "笔数"');
    expect(sql).toContain('sum("贷款余额(万元)") as "贷款余额(万元)合计"');
    expect(sql).toContain('sum("合同金额(万元)") as "合同金额(万元)合计"');
    expect(sql).not.toContain('where "最新风险五级分类" = \'全部分类\'');
    expect(sql).not.toContain('group by "贷款余额(万元)"');
    expect(sql).not.toContain('group by "合同金额(万元)"');
  });

  it("builds fallback CSV SQL for numbered all-data analysis report prompts", () => {
    const source: ConversationTempCsvTable = {
      tempTableId: "temp-table-1",
      tempDataSourceId: "temp-source-1",
      conversationId: "conversation-1",
      userId: "user-1",
      fileName: "loan.csv",
      fileSizeBytes: 100,
      sqliteTableName: "chat_csv_conv_1",
      rowCount: 10,
      columnCount: 2,
      status: "ready",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      columns: [
        {
          ordinalPosition: 0,
          sourceHeader: "最新风险五级分类",
          sqliteColumnName: "最新风险五级分类",
          displayName: "最新风险五级分类",
          inferredLogicalType: "category",
          sqliteType: "TEXT",
        },
        {
          ordinalPosition: 1,
          sourceHeader: "贷款余额(万元)",
          sqliteColumnName: "贷款余额(万元)",
          displayName: "贷款余额(万元)",
          inferredLogicalType: "decimal",
          sqliteType: "NUMERIC",
        },
      ],
    };
    const prompt = "1、查询 #最新风险五级分类   的全部数据。2、按类别维护统计总计合同数，统计分析每个类别合同总计数与样本总数量占比。分析每个类别的 #贷款余额(万元)   总计与全量样本的 #贷款余额(万元)   总计占比。3、统计分析输出报告。";
    const fields: ChatCsvSelectedFieldRef[] = [
      {
        tokenId: "token-risk",
        type: "csv_field",
        tempDataSourceId: "temp-source-1",
        tempTableId: "temp-table-1",
        fieldId: "risk",
        sourceHeader: "最新风险五级分类",
        physicalName: "最新风险五级分类",
        displayName: "最新风险五级分类",
        logicalType: "category",
        sqliteType: "TEXT",
        rawText: "#最新风险五级分类",
        start: prompt.indexOf("#最新风险五级分类"),
        end: prompt.indexOf("#最新风险五级分类") + "#最新风险五级分类".length,
        createdAt: "2026-07-17T00:00:00.000Z",
        status: "valid",
      },
      {
        tokenId: "token-balance",
        type: "csv_field",
        tempDataSourceId: "temp-source-1",
        tempTableId: "temp-table-1",
        fieldId: "balance",
        sourceHeader: "贷款余额(万元)",
        physicalName: "贷款余额(万元)",
        displayName: "贷款余额(万元)",
        logicalType: "decimal",
        sqliteType: "NUMERIC",
        rawText: "#贷款余额(万元)",
        start: prompt.indexOf("#贷款余额(万元)"),
        end: prompt.indexOf("#贷款余额(万元)") + "#贷款余额(万元)".length,
        createdAt: "2026-07-17T00:00:00.000Z",
        status: "valid",
      },
    ];

    const sql = buildFallbackTempCsvSqlForAnalysisRequest(prompt, source, fields);

    expect(sql).toContain('from "chat_csv_conv_1"');
    expect(sql).toContain('group by "最新风险五级分类"');
    expect(sql).toContain('count(*) as "笔数"');
    expect(sql).toContain('sum("贷款余额(万元)") as "贷款余额(万元)合计"');
    expect(sql).not.toContain("where");
    expect(sql).not.toContain("的全部数据");
    expect(sql).not.toContain("总计与全量样本");
  });
});

describe("AssistantRuntime report artifact helpers", () => {
  it("builds stable stream segment ids for general markdown and report artifacts", () => {
    expect(generalStreamSegmentId("message-1")).toBe("message:message-1:markdown");
    expect(generalTextStreamSegmentId("message-1")).toBe("message:message-1:text");
    expect(generalTextStreamSegmentId("message-1")).not.toBe(generalStreamSegmentId("message-1"));
    expect(reportStreamSegmentId("message-1", "report-1", 3)).toBe("report:message-1:report-1:v3");
    expect(generatedReportToolCallId("message-1")).toBe("report_message-1");
    expect(generatedReportArtifactId("message-1")).toBe("assistant-report-markdown:message-1");
  });

  it("detects markdown report content and infers stable report titles", () => {
    const content = "# 不良贷款分析报告\n\n## 分析结论\n杭州分行占比较高。";

    expect(isReportGenerationContent("查询不良贷款并输出分析报告。", content)).toBe(true);
    expect(isReportGenerationContent("只查询明细。", "查询结果如下。")).toBe(false);
    expect(inferReportTitle(content)).toBe("不良贷款分析报告");
  });

  it("does not register transitional markdown as a report when tool execution will follow", () => {
    expect(shouldRegisterAssistantGeneratedArtifacts({
      hasDetectedTool: true,
      willStartFallbackTempCsvSql: false,
      willStartSkillWorkflow: false,
    })).toBe(false);
    expect(shouldRegisterAssistantGeneratedArtifacts({
      hasDetectedTool: false,
      willStartFallbackTempCsvSql: true,
      willStartSkillWorkflow: false,
    })).toBe(false);
    expect(shouldRegisterAssistantGeneratedArtifacts({
      hasDetectedTool: false,
      willStartFallbackTempCsvSql: false,
      willStartSkillWorkflow: false,
    })).toBe(true);
  });

  it("builds overall risk distribution report with count and amount metrics", () => {
    const markdown = buildOverallRiskDistributionMarkdown(
      [
        { contract_id: "c1", 五级分类: "正常3", 十二级分类: "正常3", 贷款余额: 100 },
        { contract_id: "c2", 五级分类: "关注", 十二级分类: "关注1", 贷款余额: 50 },
        { contract_id: "c3", 五级分类: "次级", 十二级分类: "次级", 贷款余额: 25 },
      ],
      { dataSourceLabel: "测试数据源 / CSV", version: 1, generatedAt: "2026-07-15 10:00:00" },
    );

    expect(markdown).toContain("整体风险分类分布报告 v1");
    expect(markdown).toContain("- 数据源：测试数据源");
    expect(markdown).toContain("- 生成时间：2026-07-15 10:00:00");
    expect(markdown).not.toContain("用户选择数据源");
    expect(markdown).toContain("| 风险分类 | 笔数 | 笔数占比 | 贷款余额(万元) | 金额占比 |");
    expect(markdown).toContain("| 关注 | 1 | 33.33% | 50 | 28.57% |");
    expect(markdown).toContain("贷款余额(万元)合计");
    expect(markdown).toContain("不良率：33.33%（笔数），14.29%（金额）");
    expect(markdown).toContain("正常3+关注风险边界：66.67%（笔数），85.71%（金额）");
    expect(markdown).toContain("### 5.1 【笔数维度】");
    expect(markdown).toContain("### 5.2 【金额维度】");
    expect(markdown).toContain("### 5.3 【正常类维度】");
  });

  it("prefers latest_risk over risk classified date columns for risk distribution", () => {
    const markdown = buildOverallRiskDistributionMarkdown(
      [
        { contract_id: "c1", latest_risk_classified_at: "2025-12-12 17:32:40", latest_risk: "正常", loan_balance_10k: 100 },
        { contract_id: "c2", latest_risk_classified_at: "2025-12-13 09:10:11", latest_risk: "不良", loan_balance_10k: 50 },
      ],
      { dataSourceLabel: "测试数据源", version: 1 },
    );

    expect(markdown).toContain("| 正常 | 1 | 50.00% | 100 | 66.67% |");
    expect(markdown).toContain("| 不良 | 1 | 50.00% | 50 | 33.33% |");
    expect(markdown).not.toContain("| 2025-12-12");
  });

  it("recognizes latest_risk_result as the twelve-level classification field", () => {
    const markdown = buildOverallRiskDistributionMarkdown(
      [
        { contract_serial: "c1", latest_risk: "正常", latest_risk_result: "0103--正常3", loan_balance_10k: 100 },
        { contract_serial: "c2", latest_risk: "关注", latest_risk_result: "0201--关注1", loan_balance_10k: 50 },
      ],
      { dataSourceLabel: "测试数据源", version: 1 },
    );

    expect(markdown).toContain("十二级分类字段：latest_risk_result");
    expect(markdown).toContain("| 正常3 | 1 | 50.00% | 100 | 66.67% |");
    expect(markdown).toContain("| 关注1 | 1 | 50.00% | 50 | 33.33% |");
    expect(markdown).toContain("正常类维度口径为十二级分类 latest_risk_result 中含“正常1”“正常2”“正常3”的数据");
    expect(markdown).toContain("正常类总计 1 笔");
    expect(markdown).not.toContain("未识别十二级分类字段");
  });
});
