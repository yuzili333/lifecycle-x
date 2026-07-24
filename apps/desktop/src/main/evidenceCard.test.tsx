import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  appendEvidenceCardToReport,
  parseReportEvidenceNodes,
  type EvidenceCard,
} from "../shared/evidence";
import { EvidenceCardBuilder, ReportEvidenceArtifactResolver } from "./evidence";
import type { ArtifactManager, ArtifactRecord, ToolCallRecord, ToolResultRegistry } from "./toolOrchestration";
import { evidenceCardMarkdown, evidenceStateMarkdown, ReportEvidenceCardContent } from "../renderer/src/components/tool-calls/ReportEvidenceCard";
import { ReportMarkdownViewer } from "../renderer/src/components/tool-calls/ReportMarkdownViewer";

const now = "2026-07-23T00:00:00.000Z";

describe("report evidence card", () => {
  it("builds real SQL, Python, chart and report evidence without leaking scripts, credentials or local paths", async () => {
    const records = completeRecords();
    const artifacts = new MemoryArtifacts([
      artifact("analysis-1", "analysis", "# 分析\n| 分类 | 占比 |\n|---|---:|\n| 关注 | 20% |"),
      artifact("chart-1", "visualization_spec", { type: "bar" }),
      artifact("report-1", "report_markdown", "# 报告"),
    ]);
    const card = await new EvidenceCardBuilder(new MemoryRegistry(records), artifacts).build({
      evidenceCardId: "evidence-card-1",
      reportArtifactId: "report-1",
      reportVersion: 4,
      conversationId: "conversation-1",
      sourceToolCallIds: ["report-call"],
      sourceArtifactIds: ["analysis-1", "chart-1"],
      reportRequest: { analysisGoal: "分析关注类占比并生成图表。" },
    });
    const serialized = JSON.stringify(card);

    expect(card.status).toBe("complete");
    expect(card.generatedBy).toBe("system");
    expect(card.reportVersion).toBe(4);
    expect(card.dataSources).toMatchObject([{
      displayName: "信贷风险.csv",
      type: "conversation_csv",
      scope: "conversation",
      rowCount: 31,
      fieldCount: 2,
    }]);
    expect(card.analysisScope.selectedFields.map((field) => field.displayName)).toEqual(["行业名称", "风险分类"]);
    expect(card.filters).toMatchObject([
      { fieldDisplayName: "行业名称", operator: "like", displayValue: "F51%" },
      { fieldDisplayName: "风险分类", operator: "in", displayValue: "关注、次级" },
    ]);
    expect(card.formulas.some((formula) => formula.aggregation === "ratio" && formula.verificationStatus === "verified")).toBe(true);
    expect(card.sqlExecutions[0]).toMatchObject({
      status: "completed",
      purpose: "筛选行业及风险分类明细",
      resultSummary: { rowCount: 31, fieldCount: 2 },
      approval: { required: true, status: "approved" },
    });
    expect(card.pythonExecutions[0].purpose).toBe("计算各风险分类占比");
    expect(card.pythonExecutions[0].scriptHash).toHaveLength(64);
    expect(card.pythonExecutions[0].inputFields).toEqual(["行业名称", "风险分类"]);
    expect(card.lineage.nodes.some((node) => node.nodeType === "report_artifact")).toBe(true);
    expect(card.lineage.edges.length).toBeGreaterThan(3);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("/Users/example");
    expect(serialized).not.toContain("json.loads");
    expect(serialized).not.toContain("13800138000");
  });

  it("marks missing SQL and data source evidence invalid instead of treating it as verified", async () => {
    const report = toolRecord({
      toolCallId: "report-call",
      toolKind: "report_generation",
      outputArtifactIds: ["report-1"],
      resultArtifactIds: ["report-1"],
      version: 1,
    });
    const card = await new EvidenceCardBuilder(
      new MemoryRegistry([report]),
      new MemoryArtifacts([artifact("report-1", "report_markdown", "# 报告")]),
    ).build({
      reportArtifactId: "report-1",
      reportVersion: 1,
      conversationId: "conversation-1",
      sourceToolCallIds: ["report-call"],
      sourceArtifactIds: [],
    });

    expect(card.status).toBe("invalid");
    expect(card.validation.valid).toBe(false);
    expect(card.validation.checks.find((check) => check.code === "SQL_EXECUTION_PRESENT")?.status).toBe("failed");
    expect(card.validation.missingEvidence.length).toBeGreaterThan(0);
  });

  it("keeps multiple execution records, breaks lineage cycles safely, and marks missing artifacts partial", async () => {
    const records = completeRecords();
    const secondSql = toolRecord({
      toolCallId: "sql-call-2",
      toolKind: "sql_query",
      request: {
        userRequest: "补充查询。",
        script: "SELECT risk_class FROM risk_table",
        dataSourceId: "database-1",
        dataSourceLabel: "贷后业务数据库",
      },
      parentToolCallIds: ["report-call"],
      outputArtifactIds: ["workflow-dataset:2"],
      resultArtifactIds: ["workflow-dataset:2"],
      resultMetadata: { rowCount: 8, fieldCount: 1 },
    });
    const report = records.find((record) => record.toolCallId === "report-call") as ToolCallRecord;
    report.parentToolCallIds = [...(report.parentToolCallIds ?? []), secondSql.toolCallId];
    report.sourceArtifactIds = [...(report.sourceArtifactIds ?? []), "workflow-dataset:2"];
    records.push(secondSql);
    const card = await new EvidenceCardBuilder(
      new MemoryRegistry(records),
      new MemoryArtifacts([
        artifact("analysis-1", "analysis", "# 分析"),
        artifact("report-1", "report_markdown", "# 报告"),
      ]),
    ).build({
      reportArtifactId: "report-1",
      reportVersion: 4,
      conversationId: "conversation-1",
      sourceToolCallIds: ["report-call"],
      sourceArtifactIds: report.sourceArtifactIds ?? [],
    });

    expect(card.sqlExecutions).toHaveLength(2);
    expect(card.dataSources.map((source) => source.type)).toContain("database");
    expect(card.status).toBe("partial");
    expect(card.validation.checks.find((check) => check.code === "ARTIFACTS_AVAILABLE")?.status).toBe("warning");
    expect(new Set(card.lineage.nodes.map((node) => node.nodeId)).size).toBe(card.lineage.nodes.length);
  });

  it("distinguishes persistent CSV from conversation CSV using persisted source metadata", async () => {
    const sql = toolRecord({
      toolCallId: "sql-persistent-csv",
      toolKind: "sql_query",
      request: {
        userRequest: "查询持久 CSV。",
        script: "SELECT risk_class FROM imported_risk_table",
        dataSourceId: "csv-import-1",
        dataSourceLabel: "imported-risk.csv",
      },
      outputArtifactIds: ["workflow-dataset:persistent"],
      resultArtifactIds: ["workflow-dataset:persistent"],
      resultMetadata: { rowCount: 12, fieldCount: 1 },
    });
    const report = toolRecord({
      toolCallId: "report-persistent-csv",
      toolKind: "report_generation",
      parentToolCallIds: [sql.toolCallId],
      sourceArtifactIds: ["workflow-dataset:persistent"],
      outputArtifactIds: ["report-persistent"],
      resultArtifactIds: ["report-persistent"],
    });
    const card = await new EvidenceCardBuilder(
      new MemoryRegistry([sql, report]),
      new MemoryArtifacts([artifact("report-persistent", "report_markdown", "# 报告")]),
    ).build({
      reportArtifactId: "report-persistent",
      reportVersion: 1,
      conversationId: "conversation-1",
      sourceToolCallIds: [report.toolCallId],
      sourceArtifactIds: ["workflow-dataset:persistent"],
    });

    expect(card.dataSources).toMatchObject([{ type: "standard_csv", scope: "persistent", sourceFileName: "imported-risk.csv" }]);
    expect(card.sqlExecutions[0].purpose).toBe("执行只读数据查询");
    expect(card.sqlExecutions[0].purpose).not.toBe(sql.request.userRequest);
  });

  it("binds one evidence card to the declared report version and rejects mismatches", async () => {
    const card = sampleCard();
    const reportMarkdown = appendEvidenceCardToReport("# 报告\n\n## 数据限制\n无。", card.evidenceCardId);
    const report = toolRecord({
      toolCallId: "report-call",
      toolKind: "report_generation",
      outputArtifactIds: ["report-1", card.evidenceCardId],
      resultArtifactIds: ["report-1", card.evidenceCardId],
      version: 3,
    });
    const resolver = new ReportEvidenceArtifactResolver(
      new MemoryArtifacts([
        {
          ...artifact("report-1", "report_markdown", reportMarkdown),
          metadata: { evidenceCardId: card.evidenceCardId, evidenceStatus: card.status, reportVersion: 3 },
        },
        artifact(card.evidenceCardId, "evidence_card", card),
      ]),
      new MemoryRegistry([report]),
    );

    await expect(resolver.resolve({
      conversationId: "conversation-1",
      reportArtifactId: "report-1",
      reportVersion: 3,
      evidenceCardId: card.evidenceCardId,
    })).resolves.toMatchObject({ status: "complete", reportVersion: 3 });
    await expect(resolver.resolve({
      conversationId: "conversation-1",
      reportArtifactId: "report-1",
      reportVersion: 2,
      evidenceCardId: card.evidenceCardId,
    })).rejects.toThrow("不允许");
    await expect(resolver.resolve({
      conversationId: "conversation-1",
      reportArtifactId: "report-1",
      reportVersion: 3,
      evidenceCardId: "evidence-card-other",
    })).rejects.toThrow("未绑定");
  });

  it("keeps evidence JSON out of Markdown and places the node before data limitations", () => {
    const markdown = appendEvidenceCardToReport("# 报告\n\n## 数据限制与使用边界\n仅供分析。", "evidence-card-1");
    const segments = parseReportEvidenceNodes(markdown, 2);
    const evidenceSegment = segments.find((segment) => segment.type === "evidence");

    expect(markdown.indexOf("溯据卡")).toBeLessThan(markdown.indexOf("数据限制"));
    expect(markdown).toContain("## 1. 溯据卡");
    expect(markdown).toContain('<evidence-card evidenceCardId="evidence-card-1"/>');
    expect(markdown).not.toContain('"sqlExecutions"');
    expect(segments.map((segment) => segment.type)).toEqual(["markdown", "evidence", "markdown"]);
    expect(evidenceSegment).toMatchObject({ sectionNumber: "1" });
  });

  it("numbers the evidence chapter and its child headings consistently", () => {
    const markdown = appendEvidenceCardToReport([
      "# 报告",
      "",
      "## 一、执行摘要",
      "",
      "## 二、分析结论",
      "",
      "## 溯据卡",
    ].join("\n"), "evidence-card-1");
    const evidenceSegment = parseReportEvidenceNodes(markdown, 1).find((segment) => segment.type === "evidence");
    if (!evidenceSegment || evidenceSegment.type !== "evidence") throw new Error("missing evidence segment");
    const evidenceMarkdown = evidenceCardMarkdown(sampleCard(), evidenceSegment?.sectionNumber);

    expect(markdown).toContain("## 三、溯据卡");
    expect(evidenceSegment).toMatchObject({ sectionNumber: "3" });
    expect(evidenceMarkdown).toContain("### 3.1 数据来源");
    expect(evidenceMarkdown).toContain("### 3.7 结论边界与完整性");
  });

  it("renders structured evidence and degrades without breaking the report body", () => {
    const card = sampleCard();
    const readyMarkdown = evidenceCardMarkdown(card, "7");
    const unavailableMarkdown = evidenceStateMarkdown({ status: "invalid" });
    const readyHtml = renderToString(<ReportEvidenceCardContent state={{ status: "ready", card }} sectionNumber="7" />);
    const unavailableHtml = renderToString(
      <ReportMarkdownViewer markdown={"# 报告正文\n\n<evidence-card bad=\"id\"/>\n\n正文继续。"} reportArtifactId="report-1" />,
    );

    expect(readyMarkdown).toContain("> 溯据卡用于证明分析过程，不构成授信审批、风险分类调整或风险处置决定。");
    expect(readyMarkdown).not.toContain("受控分析证据");
    expect(readyMarkdown).not.toContain("证据状态");
    expect(readyMarkdown).toContain("### 7.1 数据来源");
    expect(readyMarkdown).toContain("| 数据源 | 类型 | 数据表 | 数据规模 | 访问方式 |");
    expect(readyMarkdown).toContain("### 7.4 统计公式");
    expect(readyMarkdown).toContain("### 7.6 Artifact 与数据血缘");
    expect(readyMarkdown).not.toContain("范围说明");
    expect(readyMarkdown).not.toContain("样本范围");
    expect(readyMarkdown).not.toContain("**数据血缘**");
    expect(readyMarkdown).toContain("| 存在数据来源证据 | 通过 |  |");
    expect(unavailableMarkdown).toContain("> **证据不可用**");
    expect(readyHtml).toContain('data-evidence-state="complete"');
    expect(readyHtml).not.toContain("受控分析证据");
    expect(readyHtml).toContain("数据事实");
    expect(readyHtml).toContain("统计解释");
    expect(readyHtml).toContain("风险判断");
    expect(readyHtml).not.toContain("tool-call-");
    expect(unavailableHtml).toContain("报告正文");
    expect(unavailableHtml).toContain("正文继续");
    expect(unavailableHtml).toContain("证据不可用");
    expect(unavailableHtml).not.toContain("<evidence-card");
  });

  it("renders execution purposes without exposing SQL text or Python runtime boundaries", () => {
    const card = sampleCard();
    card.sqlExecutions = [{
      toolCallId: "sql-call",
      status: "completed",
      purpose: "查询风险分类。",
      dataSourceId: "csv-1",
      tableNames: ["信贷风险.csv"],
      sqlHash: "a".repeat(64),
      displaySql: "SELECT risk_class, COUNT(*) FROM risk_table GROUP BY risk_class",
      inputArtifactIds: [],
      outputArtifactIds: ["dataset-1"],
      durationMs: 120,
      resultSummary: { rowCount: 5, fieldCount: 2 },
      approval: { required: true, status: "approved" },
    }];
    card.pythonExecutions = [{
      toolCallId: "python-call",
      status: "completed",
      purpose: "计算风险分类占比。",
      scriptHash: "b".repeat(64),
      inputArtifactIds: ["dataset-1"],
      outputArtifactIds: ["analysis-1"],
      inputFields: ["风险分类"],
      outputMetrics: ["分类占比"],
      durationMs: 180,
      resultSummary: "分析完成。",
      approval: { required: false, status: "not_required" },
      sandboxPolicy: "受控本地运行时。",
    }];
    const markdown = evidenceCardMarkdown(card, "7");
    const html = renderToString(<ReportEvidenceCardContent state={{ status: "ready", card }} />);

    expect(markdown).toContain("#### 7.5.1 SQL 查询 1");
    expect(markdown).toContain("#### 7.5.2 Python 分析 1");
    expect(markdown).toContain("| 执行状态 | 已完成 |");
    expect(markdown).toContain("| 查询目的 | 查询风险分类。 |");
    expect(markdown).toContain("| 分析目的 | 计算风险分类占比。 |");
    expect(markdown).not.toContain("脱敏 SQL");
    expect(markdown).not.toContain("```sql");
    expect(markdown).not.toContain("SELECT risk_class");
    expect(markdown).not.toContain("运行边界");
    expect(html).toContain("查询风险分类");
    expect(html).not.toContain("SELECT risk_class");
    expect(html).not.toContain("运行边界");
  });

  it("orders Artifact rows by execution time and omits the lineage subsection", () => {
    const card = sampleCard();
    card.upstreamArtifacts = [
      evidenceArtifact("report-1", "markdown_report", "分析报告", "2026-07-23T00:00:04.000Z"),
      evidenceArtifact("chart-1", "visualization", "绘制可视化图表", "2026-07-23T00:00:03.000Z"),
      evidenceArtifact("analysis-1", "python_analysis", "Python分析结果", "2026-07-23T00:00:02.000Z"),
      evidenceArtifact("dataset-1", "sql_dataset", "SQL查询数据集", "2026-07-23T00:00:01.000Z"),
    ];
    const markdown = evidenceCardMarkdown(card, "7");

    expect(markdown.indexOf("SQL查询数据集")).toBeLessThan(markdown.indexOf("Python分析结果"));
    expect(markdown.indexOf("Python分析结果")).toBeLessThan(markdown.indexOf("绘制可视化图表"));
    expect(markdown.indexOf("绘制可视化图表")).toBeLessThan(markdown.indexOf("分析报告"));
    expect(markdown).not.toContain("**数据血缘**");
  });

  it.each(["complete", "partial", "invalid"] as const)("renders the %s evidence state explicitly", (status) => {
    const card = { ...sampleCard(), status };
    const html = renderToString(<ReportEvidenceCardContent state={{ status: "ready", card }} />);
    expect(html).toContain(`data-evidence-state="${status}"`);
    expect(html).not.toContain("证据状态");
  });
});

function completeRecords() {
  const fields = [
    { fieldId: "field-industry", displayName: "行业名称", physicalName: "industry_name", logicalType: "category", tempDataSourceId: "csv-1", tempTableId: "table-1" },
    { fieldId: "field-risk", displayName: "风险分类", physicalName: "risk_class", logicalType: "category", tempDataSourceId: "csv-1", tempTableId: "table-1" },
  ];
  const sql = toolRecord({
    toolCallId: "sql-call",
    toolKind: "sql_query",
    request: {
      userRequest: "查询行业风险分类。",
      purpose: "筛选行业及风险分类明细",
      script: "SELECT industry_name, risk_class FROM \"/Users/example/private.csv\" WHERE industry_name LIKE 'F51%' AND risk_class IN ('关注', '次级') AND password='super-secret'",
      approvalMode: "request_approval",
      temporaryDataSourceLabels: ["信贷风险.csv"],
      selectedFieldRefs: fields,
    },
    outputArtifactIds: ["workflow-dataset:1"],
    resultArtifactIds: ["workflow-dataset:1"],
    resultMetadata: { rowCount: 31, fieldCount: 2, selectedFieldNames: ["行业名称", "风险分类"] },
    metadata: { toolDurationMs: 220 },
  });
  const python = toolRecord({
    toolCallId: "python-call",
    toolKind: "python_analysis",
    request: {
      userRequest: "分析关注类占比。",
      purpose: "计算各风险分类占比",
      script: "rows=json.loads('/Users/example/raw.json')\nphone='13800138000'\nratio=pct(count, total)\ncounts=Counter(rows)",
      approvalMode: "request_approval",
      selectedFieldRefs: fields,
    },
    parentToolCallIds: ["sql-call"],
    sourceArtifactIds: ["workflow-dataset:1"],
    outputArtifactIds: ["analysis-1"],
    resultArtifactIds: ["analysis-1"],
    resultMetadata: { selectedFieldNames: ["行业名称", "风险分类"], resultPreview: "| 风险分类 | 占比 |\n|---|---:|\n| 关注 | 20% |" },
    metadata: { toolDurationMs: 350 },
  });
  const chart = toolRecord({
    toolCallId: "chart-call",
    toolKind: "chart_rendering",
    parentToolCallIds: ["python-call"],
    sourceArtifactIds: ["analysis-1"],
    outputArtifactIds: ["chart-1"],
    resultArtifactIds: ["chart-1"],
  });
  const report = toolRecord({
    toolCallId: "report-call",
    toolKind: "report_generation",
    parentToolCallIds: ["chart-call", "python-call", "sql-call"],
    sourceArtifactIds: ["analysis-1", "chart-1", "workflow-dataset:1"],
    outputArtifactIds: ["report-1"],
    resultArtifactIds: ["report-1"],
    version: 4,
  });
  return [sql, python, chart, report];
}

function toolRecord(input: {
  toolCallId: string;
  toolKind: ToolCallRecord["toolKind"];
  request?: Record<string, unknown>;
  parentToolCallIds?: string[];
  sourceArtifactIds?: string[];
  outputArtifactIds?: string[];
  resultArtifactIds?: string[];
  resultMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  version?: number;
}): ToolCallRecord {
  return {
    toolCallId: input.toolCallId,
    conversationId: "conversation-1",
    userId: "user-1",
    toolKind: input.toolKind,
    toolName: input.toolKind,
    status: "completed",
    request: input.request ?? { userRequest: "生成报告。" },
    result: {
      resultId: `result-${input.toolCallId}`,
      toolKind: input.toolKind,
      artifactIds: input.resultArtifactIds ?? input.outputArtifactIds ?? [],
      primaryArtifactId: (input.resultArtifactIds ?? input.outputArtifactIds ?? [])[0],
      summary: input.toolKind === "sql_query" ? "SQL 查询已完成，输出 31 行、2 列。" : `${input.toolKind} 已完成。`,
      createdAt: now,
      metadata: input.resultMetadata,
    },
    parentToolCallIds: input.parentToolCallIds ?? [],
    sourceArtifactIds: input.sourceArtifactIds ?? [],
    outputArtifactIds: input.outputArtifactIds ?? [],
    version: input.version ?? 1,
    isLatestSuccessful: true,
    createdAt: now,
    updatedAt: now,
    completedAt: "2026-07-23T00:00:01.000Z",
    metadata: input.metadata,
  };
}

function artifact(id: string, type: ArtifactRecord["artifactType"], content: unknown): ArtifactRecord {
  return { artifactId: id, artifactType: type, contentType: type === "report_markdown" || type === "analysis" ? "markdown" : "json", content, createdAt: now };
}

function evidenceArtifact(
  artifactId: string,
  type: EvidenceCard["upstreamArtifacts"][number]["type"],
  title: string,
  createdAt: string,
): EvidenceCard["upstreamArtifacts"][number] {
  return {
    artifactId,
    type,
    title,
    status: "ready",
    sourceArtifactIds: [],
    downstreamArtifactIds: [],
    createdAt,
  };
}

class MemoryRegistry implements ToolResultRegistry {
  constructor(private readonly records: ToolCallRecord[]) {}
  async listByConversation(conversationId: string) { return this.records.filter((record) => record.conversationId === conversationId); }
  async get(toolCallId: string) { return this.records.find((record) => record.toolCallId === toolCallId) ?? null; }
  async getLatestSuccessful(conversationId: string, kind: ToolCallRecord["toolKind"]) { return [...this.records].reverse().find((record) => record.conversationId === conversationId && record.toolKind === kind && record.status === "completed") ?? null; }
  async register(record: ToolCallRecord) { this.records.push(record); }
  async update(toolCallId: string, patch: Partial<ToolCallRecord>) {
    const record = await this.get(toolCallId);
    if (!record) throw new Error("missing");
    Object.assign(record, patch);
    return record;
  }
  async markLatestSuccessful() {}
  async selectResult() {}
  async getConversationState(conversationId: string) {
    return { conversationId, toolCalls: await this.listByConversation(conversationId), updatedAt: now };
  }
}

class MemoryArtifacts implements ArtifactManager {
  private readonly records = new Map<string, ArtifactRecord>();
  constructor(records: ArtifactRecord[]) { records.forEach((record) => this.records.set(record.artifactId, record)); }
  async createArtifact(input: Omit<ArtifactRecord, "artifactId" | "createdAt"> & { artifactId?: string }) {
    const record = { ...input, artifactId: input.artifactId ?? "generated", createdAt: now } as ArtifactRecord;
    this.records.set(record.artifactId, record);
    return record;
  }
  async getArtifact(artifactId: string) { return this.records.get(artifactId) ?? null; }
}

function sampleCard(): EvidenceCard {
  return {
    evidenceCardId: "evidence-card-1",
    reportArtifactId: "report-1",
    reportVersion: 3,
    title: "溯据卡",
    statement: "溯据卡用于证明分析过程，不构成授信审批、风险分类调整或风险处置决定。",
    status: "complete",
    dataSources: [{
      dataSourceId: "csv-1",
      displayName: "信贷风险.csv",
      type: "conversation_csv",
      sourceFileName: "信贷风险.csv",
      tableIds: ["table-1"],
      tableNames: ["信贷风险.csv"],
      scope: "conversation",
      rowCount: 31,
      fieldCount: 2,
      accessMode: "read_only",
      sourceToolCallIds: ["sql-call"],
    }],
    analysisScope: {
      description: "行业风险分类分析。",
      tables: [{ tableId: "table-1", displayName: "信贷风险.csv" }],
      selectedFields: [{ displayName: "风险分类", role: "dimension" }],
      inputRowCount: 31,
      outputRowCount: 2,
    },
    filters: [],
    formulas: [{
      formulaId: "formula-1",
      metricName: "占比",
      metricDisplayName: "占比",
      expression: "分类笔数 ÷ 总笔数 × 100%",
      expressionFormat: "python_expression",
      aggregation: "ratio",
      source: "python",
      implementedByToolCallIds: ["python-call"],
      resultArtifactIds: ["analysis-1"],
      verificationStatus: "verified",
    }],
    sqlExecutions: [],
    pythonExecutions: [],
    upstreamArtifacts: [],
    downstreamArtifacts: [],
    lineage: {
      nodes: [{ nodeId: "source", nodeType: "data_source", label: "信贷风险.csv", referenceId: "csv-1" }],
      edges: [],
      rootDataSourceIds: ["csv-1"],
      reportArtifactId: "report-1",
      complete: true,
    },
    limitations: [],
    validation: {
      valid: true,
      completenessScore: 100,
      checks: [{ code: "DATA_SOURCE_PRESENT", label: "存在数据来源证据", status: "passed" }],
      missingEvidence: [],
    },
    generatedAt: now,
    generatedBy: "system",
  };
}
