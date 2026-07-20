import { describe, expect, it } from "vitest";
import {
  buildCompletedToolCheckpoint,
  createAgentGuidanceModule,
  DEFAULT_DATA_ACCURACY_POLICY,
  isWorkflowCancellationPrompt,
  MissingInputDetector,
  NextActionRecommender,
  ParameterRepairEngine,
  renderGuidanceMarkdown,
  SQLiteWorkflowCheckpointStore,
  ToolErrorRecoveryManager,
} from "./agentGuidance";
import type { ChatCsvSelectedFieldRef, ConversationTempCsvTable } from "./chatCsvTempSource";

function tempSource(): ConversationTempCsvTable {
  return {
    tempTableId: "temp-table-1",
    tempDataSourceId: "temp-source-1",
    conversationId: "conversation-1",
    userId: "user-1",
    fileName: "loan.csv",
    fileSizeBytes: 100,
    sqliteTableName: "chat_csv_1",
    rowCount: 3,
    columnCount: 3,
    status: "ready",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    columns: [
      {
        ordinalPosition: 0,
        sourceHeader: "risk_level",
        sqliteColumnName: "risk_level",
        displayName: "风险等级",
        inferredLogicalType: "category",
        sqliteType: "TEXT",
        sampleValues: ["正常", "关注"],
      },
      {
        ordinalPosition: 1,
        sourceHeader: "loan_balance",
        sqliteColumnName: "loan_balance",
        displayName: "贷款余额",
        inferredLogicalType: "decimal",
        sqliteType: "REAL",
        sampleValues: [100, 50],
      },
      {
        ordinalPosition: 2,
        sourceHeader: "customer_name",
        sqliteColumnName: "customer_name",
        displayName: "客户名称",
        inferredLogicalType: "string",
        sqliteType: "TEXT",
      },
    ],
  };
}

function selectedField(patch: Partial<ChatCsvSelectedFieldRef> = {}): ChatCsvSelectedFieldRef {
  return {
    tokenId: "token-risk",
    type: "csv_field",
    tempDataSourceId: "temp-source-1",
    tempTableId: "temp-table-1",
    fieldId: "risk_level",
    sourceHeader: "risk_level",
    physicalName: "risk_level",
    displayName: "风险等级",
    logicalType: "category",
    sqliteType: "TEXT",
    rawText: "#风险等级",
    start: 0,
    end: 5,
    createdAt: "2026-07-17T00:00:00.000Z",
    status: "valid",
    ...patch,
  };
}

describe("agent guidance", () => {
  it("detects missing data source for incomplete distribution analysis", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "分析风险分布。",
    });

    expect(result.complete).toBe(false);
    expect(result.nextStatus).toBe("waiting_for_data_source");
    expect(result.missingInputs.some((item) => item.type === "data_source")).toBe(true);
  });

  it("detects report input missing and prevents fabricated report conclusions", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "生成分析报告",
      dataSourceLabel: "loan.csv",
      toolState: { conversationId: "conversation-1", toolCalls: [], updatedAt: "2026-07-17T00:00:00.000Z" },
    });

    expect(result.complete).toBe(false);
    expect(result.missingInputs.map((item) => item.key)).toContain("report_input");
    expect(DEFAULT_DATA_ACCURACY_POLICY.allowSyntheticDataFallback).toBe(false);
    expect(DEFAULT_DATA_ACCURACY_POLICY.requireToolResultForNumericConclusion).toBe(true);
  });

  it("does not require prior report input for one-shot query analysis report requests", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "1、查询 #风险等级 的全部数据。2、按类别统计总计合同数，统计分析每个类别合同总计数与样本总数量占比。分析每个类别的 #贷款余额 总计与全量样本的 #贷款余额 总计占比。3、统计分析输出报告。",
      tempSources: [tempSource()],
      selectedFieldRefs: [
        selectedField({ rawText: "#风险等级", start: 4, end: 9 }),
        selectedField({
          tokenId: "token-balance",
          fieldId: "loan_balance",
          sourceHeader: "loan_balance",
          physicalName: "loan_balance",
          displayName: "贷款余额",
          logicalType: "decimal",
          sqliteType: "REAL",
          rawText: "#贷款余额",
          start: 65,
          end: 70,
        }),
      ],
      toolState: { conversationId: "conversation-1", toolCalls: [], updatedAt: "2026-07-17T00:00:00.000Z" },
    });

    expect(result.complete).toBe(true);
    expect(result.missingInputs.map((item) => item.key)).not.toContain("report_input");
  });

  it("guides unclear task goals without template text or action buttons", () => {
    const module = createAgentGuidanceModule({});
    const detection = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "这个呢",
      tempSources: [tempSource()],
      selectedFieldRefs: [selectedField()],
    });

    const { guidance } = module.buildClarification({
      conversationId: "conversation-1",
      prompt: "这个呢",
      detection,
      context: {
        tempSources: [tempSource()],
        selectedFieldRefs: [selectedField()],
        toolState: {
          conversationId: "conversation-1",
          latestSuccessfulSqlToolCallId: "sql-1",
          latestSuccessfulSqlArtifactIds: ["sql-artifact-1"],
          toolCalls: [],
          updatedAt: "2026-07-17T00:00:00.000Z",
        },
      },
    });
    const markdown = renderGuidanceMarkdown(guidance);

    expect(guidance.title).toBe("想执行哪类数据任务？");
    expect(guidance.actions).toEqual([]);
    expect(guidance.message).toContain("基于上一轮查询结果继续统计");
    expect(guidance.message).toContain("查询或统计 loan.csv 中的字段");
    expect(guidance.message).toContain("风险等级");
    expect(markdown).not.toContain("可以继续处理，但当前还缺少必要信息");
    expect(markdown).not.toContain("直接补充说明");
    expect(markdown).not.toContain("取消本轮任务");
  });

  it("offers sorted candidate fields instead of guessing ambiguous field mappings", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "统计不良贷款分布。",
      tempSources: [tempSource()],
    });
    const fieldInput = result.missingInputs.find((item) => item.type === "field");

    expect(fieldInput?.candidates?.[0]?.label).toBe("风险等级");
    expect(fieldInput?.description).toContain("不会自动猜测");
  });

  it("asks for query target on vague data lookup instead of returning a generic chat answer", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "查一下数据",
      tempSources: [tempSource()],
    });

    expect(result.complete).toBe(false);
    expect(result.nextStatus).toBe("waiting_for_field_selection");
    expect(result.missingInputs.map((item) => item.key)).toContain("query_target");
  });

  it("detects missing date range only for temporal requests without repeating selected fields", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "按月分析风险趋势",
      tempSources: [tempSource()],
      selectedFieldRefs: [selectedField()],
    });

    expect(result.complete).toBe(false);
    expect(result.missingInputs.map((item) => item.key)).toContain("date_range");
    expect(result.missingInputs.map((item) => item.key)).not.toContain("classification_or_dimension_field");
  });

  it("detects missing metric field for amount analysis and offers numeric candidates", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "按风险等级统计贷款余额汇总",
      tempSources: [tempSource()],
      selectedFieldRefs: [selectedField()],
    });
    const metric = result.missingInputs.find((item) => item.key === "amount_metric_field");

    expect(metric?.type).toBe("metric");
    expect(metric?.candidates?.[0]?.label).toBe("贷款余额");
  });

  it("accepts explicit prompt field references for grouped amount distribution requests", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "查询 #风险等级 全部分类数据，分析每一类数据的总计合同笔数和笔数占比，分析每一类数据的 #贷款余额（余额） 以及与全部样本贷款余额总计的占比。",
      tempSources: [tempSource()],
    });

    expect(result.complete).toBe(true);
    expect(result.missingInputs.map((item) => item.key)).not.toContain("classification_or_dimension_field");
    expect(result.missingInputs.map((item) => item.key)).not.toContain("amount_metric_field");
  });

  it("recommends similar real fields for misspelled prompt field references", () => {
    const module = createAgentGuidanceModule({});
    const detection = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "查询 #风险等及 的分类汇总。",
      tempSources: [tempSource()],
    });
    const fieldReferenceInput = detection.missingInputs.find((item) => item.key === "field_reference:#风险等及");

    expect(detection.complete).toBe(false);
    expect(fieldReferenceInput?.candidates?.[0]?.label).toBe("风险等级");

    const { guidance } = module.buildClarification({
      conversationId: "conversation-1",
      prompt: "查询 #风险等及 的分类汇总。",
      detection,
      context: { tempSources: [tempSource()] },
    });

    expect(guidance.message).toContain("字段 #风险等及");
    expect(guidance.message).toContain("风险等级");
    expect(renderGuidanceMarkdown(guidance)).not.toContain("可以继续处理，但当前还缺少必要信息");
  });

  it("detects missing chart type for generic visualization requests", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "把当前结果绘制成图表",
      toolState: {
        conversationId: "conversation-1",
        latestSuccessfulPythonToolCallId: "python-1",
        latestSuccessfulPythonArtifactIds: ["analysis-1"],
        toolCalls: [],
        updatedAt: "2026-07-17T00:00:00.000Z",
      },
    });

    expect(result.complete).toBe(false);
    expect(result.missingInputs.map((item) => item.key)).toContain("chart_type");
    expect(result.missingInputs.map((item) => item.key)).not.toContain("chart_input");
  });

  it("does not ask for source fields when charting from existing Python analysis result", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "请根据数据分析结果绘制各分行的合同总数占比的饼图。",
      tempSources: [tempSource()],
      toolState: {
        conversationId: "conversation-1",
        latestSuccessfulPythonToolCallId: "python-1",
        latestSuccessfulPythonArtifactIds: ["analysis-1"],
        toolCalls: [],
        updatedAt: "2026-07-18T00:00:00.000Z",
      },
    });

    expect(result.complete).toBe(true);
    expect(result.missingInputs.map((item) => item.key)).not.toContain("classification_or_dimension_field");
    expect(result.missingInputs.map((item) => item.key)).not.toContain("chart_input");
  });

  it("uses existing Python analysis artifacts for chart requests before asking for source fields", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "绘制各分行的合同总数占比饼图。",
      tempSources: [tempSource()],
      toolState: {
        conversationId: "conversation-1",
        latestSuccessfulPythonToolCallId: "python-1",
        latestSuccessfulPythonArtifactIds: ["analysis-1"],
        toolCalls: [],
        updatedAt: "2026-07-18T00:00:00.000Z",
      },
    });

    expect(result.complete).toBe(true);
    expect(result.missingInputs.map((item) => item.key)).not.toContain("classification_or_dimension_field");
    expect(result.missingInputs.map((item) => item.key)).not.toContain("amount_metric_field");
  });

  it("uses existing analysis and chart artifacts for report requests", () => {
    const result = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "生成报告",
      toolState: {
        conversationId: "conversation-1",
        latestSuccessfulPythonToolCallId: "python-1",
        latestSuccessfulPythonArtifactIds: ["analysis-1"],
        latestSuccessfulChartToolCallId: "chart-1",
        latestSuccessfulChartArtifactIds: ["chart-1"],
        toolCalls: [],
        updatedAt: "2026-07-18T00:00:00.000Z",
      },
    });

    expect(result.complete).toBe(true);
    expect(result.missingInputs.map((item) => item.key)).not.toContain("report_input");
  });

  it("builds repair guidance for missing tool parameters", () => {
    const repair = new ParameterRepairEngine().validateToolRequest({
      toolKind: "report_generation",
      request: {},
      toolState: { conversationId: "conversation-1", toolCalls: [], updatedAt: "2026-07-17T00:00:00.000Z" },
    });
    const guidance = createAgentGuidanceModule({}).buildParameterRepair({
      conversationId: "conversation-1",
      toolKind: "report_generation",
      invalidParameters: repair.invalidParameters,
    });

    expect(repair.valid).toBe(false);
    expect(guidance.guidance.resumeToken).toBeTruthy();
    expect(renderGuidanceMarkdown(guidance.guidance)).toContain("工具参数需要修复");
  });

  it("validates SQL tool parameters before execution", () => {
    const engine = new ParameterRepairEngine();
    const missingSql = engine.validateToolRequest({
      toolKind: "sql_query",
      request: { sql: " " },
    });
    const scriptAlias = engine.validateToolRequest({
      toolKind: "sql_query",
      request: { script: "select 1", purpose: "查询", userRequest: "查询数据" },
    });

    expect(missingSql.valid).toBe(false);
    expect(missingSql.invalidParameters.map((item) => item.parameterName)).toContain("sql");
    expect(scriptAlias.valid).toBe(true);
  });

  it("requires real upstream data for Python analysis unless an artifact is provided", () => {
    const engine = new ParameterRepairEngine();
    const missingInput = engine.validateToolRequest({
      toolKind: "python_analysis",
      request: { script: "print('ok')" },
      toolState: { conversationId: "conversation-1", toolCalls: [], updatedAt: "2026-07-17T00:00:00.000Z" },
    });
    const latestSqlInput = engine.validateToolRequest({
      toolKind: "python_analysis",
      request: {},
      toolState: {
        conversationId: "conversation-1",
        latestSuccessfulSqlToolCallId: "sql-1",
        latestSuccessfulSqlArtifactIds: ["artifact-sql-1"],
        toolCalls: [],
        updatedAt: "2026-07-17T00:00:00.000Z",
      },
    });
    const explicitInput = engine.validateToolRequest({
      toolKind: "python_analysis",
      request: { inputArtifactIds: ["artifact-sql-1"] },
      toolState: { conversationId: "conversation-1", toolCalls: [], updatedAt: "2026-07-17T00:00:00.000Z" },
    });

    expect(missingInput.valid).toBe(false);
    expect(missingInput.invalidParameters.map((item) => item.parameterName)).toContain("inputArtifactIds");
    expect(latestSqlInput.valid).toBe(true);
    expect(explicitInput.valid).toBe(true);
  });

  it("validates chart inputs, visualization spec fields, and trusted inline rows", () => {
    const engine = new ParameterRepairEngine();
    const missingSpec = engine.validateToolRequest({
      toolKind: "chart_rendering",
      request: { visualizationSpec: { title: "", type: "bar" } },
      toolState: { conversationId: "conversation-1", toolCalls: [], updatedAt: "2026-07-17T00:00:00.000Z" },
    });
    const trustedInline = engine.validateToolRequest({
      toolKind: "chart_rendering",
      request: {
        visualizationSpec: {
          title: "分行分布",
          type: "bar",
          data: { mode: "inline", trusted: true, rowCount: 1, rows: [{ branch: "上海", count: 3 }] },
          encoding: { x: "branch", y: ["count"] },
        },
      },
      toolState: { conversationId: "conversation-1", toolCalls: [], updatedAt: "2026-07-17T00:00:00.000Z" },
    });

    expect(missingSpec.valid).toBe(false);
    expect(missingSpec.invalidParameters.map((item) => item.parameterName)).toEqual(expect.arrayContaining(["inputArtifactIds", "visualizationSpec.title", "visualizationSpec.encoding"]));
    expect(trustedInline.valid).toBe(true);
  });

  it("validates report inputs without allowing fabricated markdown", () => {
    const engine = new ParameterRepairEngine();
    const missingInput = engine.validateToolRequest({
      toolKind: "report_generation",
      request: {},
      toolState: { conversationId: "conversation-1", toolCalls: [], updatedAt: "2026-07-17T00:00:00.000Z" },
    });
    const explicitArtifact = engine.validateToolRequest({
      toolKind: "report_generation",
      request: { inputArtifactIds: ["analysis-artifact-1"], title: "分析报告" },
      toolState: { conversationId: "conversation-1", toolCalls: [], updatedAt: "2026-07-17T00:00:00.000Z" },
    });
    const emptyMarkdown = engine.validateToolRequest({
      toolKind: "report_generation",
      request: { markdown: "", inputArtifactIds: ["analysis-artifact-1"] },
      toolState: { conversationId: "conversation-1", toolCalls: [], updatedAt: "2026-07-17T00:00:00.000Z" },
    });

    expect(missingInput.valid).toBe(false);
    expect(missingInput.invalidParameters.map((item) => item.parameterName)).toContain("inputArtifactIds");
    expect(explicitArtifact.valid).toBe(true);
    expect(emptyMarkdown.valid).toBe(false);
    expect(emptyMarkdown.invalidParameters.map((item) => item.parameterName)).toContain("markdown");
  });

  it("does not return redundant success summaries after completed tools", () => {
    const normal = new NextActionRecommender().recommend({
      conversationId: "conversation-1",
      toolKind: "sql_query",
      rowCount: 1250,
      columnCount: 6,
    });
    const empty = new NextActionRecommender().recommend({
      conversationId: "conversation-1",
      toolKind: "sql_query",
      rowCount: 0,
    });
    const python = new NextActionRecommender().recommend({
      conversationId: "conversation-1",
      toolKind: "python_analysis",
    });

    expect(normal).toBeNull();
    expect(empty).toBeNull();
    expect(python).toBeNull();
  });

  it("returns recoverable actions for tool errors", () => {
    const recovery = new ToolErrorRecoveryManager().handleToolError({
      conversationId: "conversation-1",
      toolKind: "python_analysis",
      message: "字段“贷款余额”不存在。",
      toolCallId: "tool-1",
    });

    expect(recovery.issue.category).toBe("tool_execution_failed");
    expect(recovery.issue.preserveCurrentState).toBe(true);
    expect(recovery.guidance.actions.map((item) => item.type)).toEqual(expect.arrayContaining(["select_fields", "return_to_query"]));
  });

  it("classifies common tool errors with concrete recovery categories", () => {
    const manager = new ToolErrorRecoveryManager();
    const timeout = manager.handleToolError({
      conversationId: "conversation-1",
      toolKind: "sql_query",
      message: "SQL 查询超时，请缩小范围。",
    });
    const permission = manager.handleToolError({
      conversationId: "conversation-1",
      toolKind: "sql_query",
      message: "权限不足：permission denied for table loan_contracts。",
    });
    const empty = manager.handleToolError({
      conversationId: "conversation-1",
      toolKind: "sql_query",
      message: "查询未返回数据，0 rows。",
    });
    const artifact = manager.handleToolError({
      conversationId: "conversation-1",
      toolKind: "chart_rendering",
      message: "Artifact 不存在或已失效。",
    });

    expect(timeout.issue.category).toBe("tool_execution_timeout");
    expect(timeout.issue.code).toBe("TOOL_EXECUTION_TIMEOUT");
    expect(timeout.issue.recoverability).toBe("retryable");
    expect(permission.issue.category).toBe("permission_denied");
    expect(permission.issue.code).toBe("PERMISSION_DENIED");
    expect(permission.guidance.actions.map((item) => item.type)).toContain("select_data_source");
    expect(empty.issue.category).toBe("dataset_empty");
    expect(empty.issue.code).toBe("DATASET_EMPTY");
    expect(empty.guidance.actions[0].type).toBe("return_to_query");
    expect(artifact.issue.category).toBe("artifact_missing");
    expect(artifact.issue.code).toBe("ARTIFACT_NOT_FOUND");
  });

  it("returns paused recovery guidance for rejected tool approval", () => {
    const recovery = new ToolErrorRecoveryManager().handleApprovalRejected({
      conversationId: "conversation-1",
      toolKind: "sql_query",
      toolCallId: "tool-approval-1",
    });

    expect(recovery.issue.category).toBe("approval_rejected");
    expect(recovery.issue.code).toBe("TOOL_APPROVAL_REJECTED");
    expect(recovery.issue.preserveCurrentState).toBe(true);
    expect(recovery.guidance.title).toContain("工作流已暂停");
    expect(recovery.guidance.actions.map((item) => item.type)).toEqual(expect.arrayContaining(["edit_parameters", "return_to_query", "cancel_workflow"]));
  });

  it("persists and restores active workflow checkpoints", () => {
    const rows = new Map<string, Record<string, unknown>>();
    const db = {
      exec: () => undefined,
      prepare: (sql: string) => ({
        run: (checkpointId: string, workflowId: string, conversationId: string, status: string, checkpointJson: string, createdAt: string, updatedAt: string) => {
          rows.set(checkpointId, { checkpointId, workflowId, conversationId, status, checkpoint_json: checkpointJson, createdAt, updatedAt });
        },
        get: (conversationId: string) =>
          Array.from(rows.values())
            .filter((row) => row.conversationId === conversationId && String(sql).includes("agent_workflow_checkpoints"))
            .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0],
      }),
    };
    const checkpointStore = new SQLiteWorkflowCheckpointStore(db);
    const module = createAgentGuidanceModule({ checkpointStore });
    const guidance = module.buildClarification({
      conversationId: "conversation-1",
      prompt: "分析分布",
      detection: {
        complete: false,
        nextStatus: "waiting_for_data_source",
        warnings: [],
        missingInputs: [
          {
            key: "data_source",
            label: "数据源",
            type: "data_source",
            required: true,
            description: "请选择数据源。",
          },
        ],
      },
    });

    module.createCheckpoint(guidance.checkpoint);
    const restored = module.restoreFromCheckpoint("conversation-1");

    expect(restored?.pendingGuidance?.resumeToken).toBe(guidance.guidance.resumeToken);
    expect(restored?.status).toBe("waiting_for_data_source");
  });

  it("builds completed tool checkpoints that preserve successful tool lineage", () => {
    const checkpoint = buildCompletedToolCheckpoint({
      conversationId: "conversation-1",
      workflowId: "workflow-1",
      currentStepId: "python_analysis",
      latestSuccessfulToolCallIds: {
        sql_query: "sql-1",
        python_analysis: "python-1",
        chart_rendering: undefined,
        report_generation: undefined,
      },
      artifactIds: ["workflow-dataset:dataset-1", "analysis-1"],
      activeDatasetIds: ["dataset-1"],
    });

    expect(checkpoint.status).toBe("completed");
    expect(checkpoint.completedStepIds).toEqual(["python_analysis"]);
    expect(checkpoint.pendingStepIds).toEqual([]);
    expect(checkpoint.latestSuccessfulToolCallIds.sql_query).toBe("sql-1");
    expect(checkpoint.latestSuccessfulToolCallIds.python_analysis).toBe("python-1");
    expect(checkpoint.artifactIds).toEqual(["workflow-dataset:dataset-1", "analysis-1"]);
    expect(checkpoint.activeDatasetIds).toEqual(["dataset-1"]);
  });

  it("only cancels workflow on explicit cancellation prompts and preserves successful lineage", () => {
    const module = createAgentGuidanceModule({});
    const checkpoint = {
      ...buildCompletedToolCheckpoint({
        conversationId: "conversation-1",
        workflowId: "workflow-1",
        currentStepId: "python_analysis",
        latestSuccessfulToolCallIds: {
          sql_query: "sql-1",
          python_analysis: "python-1",
          chart_rendering: undefined,
          report_generation: undefined,
        },
        artifactIds: ["workflow-dataset:dataset-1", "analysis-1"],
        activeDatasetIds: ["dataset-1"],
      }),
      status: "recoverable_error" as const,
      pendingGuidance: {
        guidanceId: "guidance-1",
        workflowId: "workflow-1",
        conversationId: "conversation-1",
        type: "error_recovery" as const,
        title: "Python 分析未完成",
        message: "字段缺失。",
        actions: [],
        blocking: true,
        resumeToken: "resume-1",
        createdAt: "2026-07-17T00:00:00.000Z",
      },
    };

    const cancelled = module.cancelWorkflow({ checkpoint, reason: "取消" });

    expect(isWorkflowCancellationPrompt("取消")).toBe(true);
    expect(isWorkflowCancellationPrompt("停止")).toBe(true);
    expect(isWorkflowCancellationPrompt("暂时不生成报告")).toBe(false);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.pendingGuidance).toBeUndefined();
    expect(cancelled.activeIssue).toBeUndefined();
    expect(cancelled.latestSuccessfulToolCallIds.sql_query).toBe("sql-1");
    expect(cancelled.artifactIds).toEqual(["workflow-dataset:dataset-1", "analysis-1"]);
    expect(cancelled.activeDatasetIds).toEqual(["dataset-1"]);
  });

  it("resumes a checkpoint when the user supplies a candidate field in natural language", () => {
    const module = createAgentGuidanceModule({});
    const detection = new MissingInputDetector().detect({
      conversationId: "conversation-1",
      prompt: "统计风险分布。",
      tempSources: [tempSource()],
    });
    const guidance = module.buildClarification({
      conversationId: "conversation-1",
      prompt: "统计风险分布。",
      detection,
    });

    const resume = module.resumeWithInput({
      checkpoint: guidance.checkpoint,
      prompt: "使用风险等级字段",
      tempSources: [tempSource()],
    });

    expect(resume.canResume).toBe(true);
    expect(resume.resolvedInputKeys).toContain("classification_or_dimension_field");
    expect(resume.mergedPrompt).toContain("原始需求：统计风险分布。");
    expect(resume.mergedPrompt).toContain("用户补充：使用风险等级字段");
  });

  it("keeps unresolved guidance active when the supplement is insufficient", () => {
    const module = createAgentGuidanceModule({});
    const guidance = module.buildClarification({
      conversationId: "conversation-1",
      prompt: "分析风险分布。",
      detection: {
        complete: false,
        nextStatus: "waiting_for_data_source",
        warnings: [],
        missingInputs: [
          {
            key: "data_source",
            label: "数据源",
            type: "data_source",
            required: true,
            description: "请选择数据源。",
          },
        ],
      },
    });

    const resume = module.resumeWithInput({
      checkpoint: guidance.checkpoint,
      prompt: "继续",
    });

    expect(resume.canResume).toBe(false);
    expect(resume.unresolvedInputs.map((item) => item.key)).toEqual(["data_source"]);
  });
});
