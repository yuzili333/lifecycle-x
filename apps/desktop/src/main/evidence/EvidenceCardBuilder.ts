import { createHash, randomUUID } from "node:crypto";
import {
  type EvidenceAnalysisScope,
  type EvidenceArtifactRef,
  type EvidenceCard,
  type EvidenceDataSource,
  type EvidenceFilter,
  type EvidenceFormula,
  type EvidenceLineageEdge,
  type EvidenceLineageNode,
  type EvidencePythonExecution,
  type EvidenceSqlExecution,
} from "../../shared/evidence";
import type { ArtifactManager, ArtifactRecord, ToolCallRecord, ToolResultRegistry } from "../toolOrchestration";

export type EvidenceCardBuildInput = {
  evidenceCardId?: string;
  reportArtifactId: string;
  reportVersion: number;
  conversationId: string;
  sourceToolCallIds: string[];
  sourceArtifactIds: string[];
  reportRequest?: { analysisGoal?: string; requestedScope?: string };
};

export class EvidenceCardBuilder {
  constructor(
    private readonly toolResultRegistry: ToolResultRegistry,
    private readonly artifactManager: ArtifactManager,
  ) {}

  async build(input: EvidenceCardBuildInput): Promise<EvidenceCard> {
    const allRecords = await this.toolResultRegistry.listByConversation(input.conversationId);
    const records = collectEvidenceRecords(allRecords, input);
    const artifactIds = unique([
      input.reportArtifactId,
      ...input.sourceArtifactIds,
      ...records.flatMap(recordArtifactIds),
      ...records.flatMap((record) => record.sourceArtifactIds ?? []),
    ]).filter((artifactId) => artifactId !== input.evidenceCardId);
    const artifacts = new Map((await Promise.all(artifactIds.map((id) => this.artifactManager.getArtifact(id))))
      .filter((artifact): artifact is ArtifactRecord => Boolean(artifact))
      .map((artifact) => [artifact.artifactId, artifact]));
    const dataSources = buildDataSources(records);
    const analysisScope = buildAnalysisScope(records, dataSources, input.reportRequest);
    const filters = records.flatMap((record) => record.toolKind === "sql_query" ? extractSqlFilters(record) : []);
    const formulas = buildFormulas(records);
    const sqlExecutions = records.filter((record) => record.toolKind === "sql_query").map((record) => buildSqlExecution(record, dataSources));
    const pythonExecutions = records.filter((record) => record.toolKind === "python_analysis").map(buildPythonExecution);
    const artifactRefs = buildArtifactRefs(artifactIds, artifacts, records);
    const upstreamArtifacts = artifactRefs.filter((artifact) => artifact.artifactId !== input.reportArtifactId);
    const reportArtifact = artifactRefs.find((artifact) => artifact.artifactId === input.reportArtifactId)
      ?? missingReportArtifact(input.reportArtifactId, input.reportVersion);
    const lineage = buildLineage(input, records, dataSources, [...upstreamArtifacts, reportArtifact]);
    const validation = validateEvidence({
      dataSources,
      sqlExecutions,
      pythonExecutions,
      formulas,
      artifactRefs: [...upstreamArtifacts, reportArtifact],
      lineageComplete: lineage.complete,
      hasChart: records.some((record) => record.toolKind === "chart_rendering" && record.status === "completed"),
    });
    const status = validation.checks.some((check) => check.status === "failed")
      ? "invalid"
      : validation.checks.some((check) => check.status === "warning")
        ? "partial"
        : "complete";
    return {
      evidenceCardId: input.evidenceCardId ?? `evidence-card:${randomUUID()}`,
      reportArtifactId: input.reportArtifactId,
      reportVersion: input.reportVersion,
      title: "溯据卡",
      statement: "溯据卡用于证明分析过程，不构成授信审批、风险分类调整或风险处置决定。",
      status,
      dataSources,
      analysisScope,
      filters,
      formulas,
      sqlExecutions,
      pythonExecutions,
      upstreamArtifacts,
      downstreamArtifacts: [reportArtifact],
      lineage,
      limitations: validation.missingEvidence.map((message, index) => ({
        code: `EVIDENCE_LIMITATION_${index + 1}`,
        message,
        severity: status === "invalid" ? "error" : "warning",
      })),
      validation,
      generatedAt: new Date().toISOString(),
      generatedBy: "system",
    };
  }
}

function collectEvidenceRecords(allRecords: ToolCallRecord[], input: EvidenceCardBuildInput) {
  const byId = new Map(allRecords.map((record) => [record.toolCallId, record]));
  const artifactOwners = new Map<string, ToolCallRecord>();
  for (const record of allRecords) {
    for (const artifactId of recordArtifactIds(record)) {
      artifactOwners.set(artifactId, record);
    }
  }
  const queue = unique([
    ...input.sourceToolCallIds,
    ...input.sourceArtifactIds.map((artifactId) => artifactOwners.get(artifactId)?.toolCallId),
    artifactOwners.get(input.reportArtifactId)?.toolCallId,
  ].filter((value): value is string => Boolean(value)));
  const selected = new Map<string, ToolCallRecord>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (selected.has(id)) continue;
    const record = byId.get(id);
    if (!record) continue;
    selected.set(id, record);
    for (const parentId of record.parentToolCallIds ?? []) queue.push(parentId);
    for (const artifactId of record.sourceArtifactIds ?? []) {
      const owner = artifactOwners.get(artifactId);
      if (owner) queue.push(owner.toolCallId);
    }
  }
  return [...selected.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function buildDataSources(records: ToolCallRecord[]): EvidenceDataSource[] {
  const sources = new Map<string, EvidenceDataSource>();
  for (const record of records.filter((candidate) => candidate.toolKind === "sql_query")) {
    const request = record.request;
    const refs = selectedFieldRefs(request);
    const labels = stringArray(request.temporaryDataSourceLabels);
    const dataSourceId = stringValue(request.dataSourceId)
      ?? refs[0]?.tempDataSourceId
      ?? `derived-source:${shortHash(labels[0] ?? record.toolCallId)}`;
    const displayName = safeDisplayName(labels[0] ?? stringValue(request.dataSourceLabel) ?? stringValue(request.tableName) ?? "受控数据源");
    const isConversationCsv = labels.length > 0 || refs.some((ref) => Boolean(ref.tempDataSourceId));
    const tableIds = unique(refs.map((ref) => ref.tempTableId).filter(isString));
    const sqlTables = extractSqlTables(sqlScript(record));
    const existing = sources.get(dataSourceId);
    const rowCount = numberFrom(record.result?.metadata?.rowCount) ?? resultRowCount(record);
    const fieldCount = numberFrom(record.result?.metadata?.fieldCount) ?? numberFrom(record.result?.metadata?.columnCount);
    sources.set(dataSourceId, {
      dataSourceId,
      displayName,
      type: isConversationCsv ? "conversation_csv" : displayName.toLowerCase().endsWith(".csv") ? "standard_csv" : "database",
      sourceFileName: displayName.toLowerCase().endsWith(".csv") ? displayName : undefined,
      tableIds: unique([...(existing?.tableIds ?? []), ...tableIds]),
      tableNames: unique([...(existing?.tableNames ?? []), ...(isConversationCsv ? [displayName] : sqlTables.map(safeDisplayName))]),
      scope: isConversationCsv ? "conversation" : "persistent",
      rowCount: rowCount ?? existing?.rowCount,
      fieldCount: fieldCount ?? (refs.length || existing?.fieldCount),
      accessMode: "read_only",
      sourceToolCallIds: unique([...(existing?.sourceToolCallIds ?? []), record.toolCallId]),
    });
  }
  return [...sources.values()];
}

function buildAnalysisScope(
  records: ToolCallRecord[],
  dataSources: EvidenceDataSource[],
  reportRequest?: EvidenceCardBuildInput["reportRequest"],
): EvidenceAnalysisScope {
  const fields = new Map<string, EvidenceAnalysisScope["selectedFields"][number]>();
  for (const record of records) {
    for (const ref of selectedFieldRefs(record.request)) {
      const displayName = safeDisplayName(ref.displayName ?? ref.sourceHeader ?? ref.physicalName ?? "字段");
      fields.set(ref.fieldId ?? displayName, {
        fieldId: ref.fieldId,
        displayName,
        physicalName: safeOptionalName(ref.physicalName),
        logicalType: safeOptionalName(ref.logicalType),
        role: inferFieldRole(displayName, ref.logicalType),
      });
    }
    for (const name of stringArray(record.result?.metadata?.selectedFieldNames)) {
      if (![...fields.values()].some((field) => field.displayName === name)) {
        fields.set(name, { displayName: safeDisplayName(name), role: inferFieldRole(name) });
      }
    }
  }
  const sqlRecords = records.filter((record) => record.toolKind === "sql_query");
  const firstRowCount = sqlRecords.map(resultRowCount).find((value) => value !== undefined);
  const lastAnalysisCount = [...records].reverse().map(resultRowCount).find((value) => value !== undefined);
  const tables = unique(dataSources.flatMap((source) => source.tableNames)).map((displayName) => ({
    tableId: dataSources.find((source) => source.tableNames.includes(displayName))?.tableIds[0] ?? `table:${shortHash(displayName)}`,
    displayName,
  }));
  return {
    description: sanitizeText(reportRequest?.requestedScope ?? reportRequest?.analysisGoal ?? "基于已登记工具执行记录构建的分析范围。"),
    tables,
    selectedFields: [...fields.values()],
    populationDefinition: buildPopulationDefinition(records),
    inputRowCount: firstRowCount,
    outputRowCount: lastAnalysisCount,
  };
}

function extractSqlFilters(record: ToolCallRecord): EvidenceFilter[] {
  const sql = sqlScript(record);
  const where = sql.match(/\bwhere\b([\s\S]*?)(?:\bgroup\s+by\b|\border\s+by\b|\blimit\b|$)/i)?.[1];
  if (!where) return [];
  const fieldNames = new Map(selectedFieldRefs(record.request).flatMap((ref) => {
    const displayName = ref.displayName ?? ref.sourceHeader ?? ref.physicalName;
    return displayName && ref.physicalName ? [[ref.physicalName.toLowerCase(), displayName] as const] : [];
  }));
  const pattern = /(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([a-zA-Z_][\w.]*))\s+(is\s+not\s+null|is\s+null|not\s+in|in|between|like|>=|<=|<>|!=|=|>|<)\s*([\s\S]*?)(?=\s+(?:and|or)\s+(?:"|`|\[|[a-zA-Z_])|$)/gi;
  const filters: EvidenceFilter[] = [];
  for (const match of where.matchAll(pattern)) {
    const physicalField = safeDisplayName(match[1] ?? match[2] ?? match[3] ?? match[4] ?? "字段");
    const field = safeDisplayName(fieldNames.get(physicalField.toLowerCase()) ?? physicalField);
    const operator = normalizeFilterOperator(match[5]);
    const rawValue = sanitizeSqlFilterValue(match[6] ?? "");
    filters.push({
      filterId: `filter:${shortHash(`${record.toolCallId}:${field}:${operator}:${filters.length}`)}`,
      fieldDisplayName: field.split(".").at(-1) ?? field,
      fieldPhysicalName: physicalField,
      operator,
      displayValue: rawValue || (operator === "is_null" ? "空值" : operator === "is_not_null" ? "非空" : "已脱敏条件"),
      source: "user",
      appliedInToolCallId: record.toolCallId,
    });
  }
  return filters;
}

function buildFormulas(records: ToolCallRecord[]): EvidenceFormula[] {
  const formulas: EvidenceFormula[] = [];
  for (const record of records) {
    const script = record.toolKind === "sql_query" ? sqlScript(record) : record.toolKind === "python_analysis" ? stringValue(record.request.script) ?? "" : "";
    if (!script) continue;
    const artifactIds = recordArtifactIds(record);
    if (record.toolKind === "sql_query") {
      const aggregate = /\b(count\s*\(\s*distinct|count|sum|avg|min|max)\s*\(([^)]*)\)/gi;
      for (const match of script.matchAll(aggregate)) {
        const operation = match[1].replace(/\s+/g, "_").toLowerCase();
        const expression = `${match[1].toUpperCase()}(${sanitizeSqlIdentifierExpression(match[2])})`;
        formulas.push(formula(record, expression, operation === "count_distinct" ? "distinct_count" : operation as EvidenceFormula["aggregation"], "sql", artifactIds));
      }
    } else {
      if (/\b(?:pct|ratio|percentage)\s*\(|(?:\/|\bdiv\b)[^\n]{0,80}(?:100|百分比)/i.test(script)) {
        formulas.push(formula(record, "分组值 ÷ 总体值 × 100%", "ratio", "python", artifactIds, "占比"));
      }
      if (/\bCounter\s*\(|groupby\s*\(|value_counts\s*\(|\bcount\s*\(/i.test(script)) {
        formulas.push(formula(record, "按指定维度统计记录数", "count", "python", artifactIds, "分组计数"));
      }
      if (/\bsum\s*\(/i.test(script)) {
        formulas.push(formula(record, "对指定数值字段求和", "sum", "python", artifactIds, "字段合计"));
      }
    }
  }
  return dedupeBy(formulas, (item) => `${item.implementedByToolCallIds[0]}:${item.expression}`);
}

function formula(
  record: ToolCallRecord,
  expression: string,
  aggregation: EvidenceFormula["aggregation"],
  source: "sql" | "python",
  resultArtifactIds: string[],
  label?: string,
): EvidenceFormula {
  const metricDisplayName = label ?? `${aggregationLabel(aggregation)}指标`;
  return {
    formulaId: `formula:${shortHash(`${record.toolCallId}:${expression}`)}`,
    metricName: metricDisplayName,
    metricDisplayName,
    expression,
    expressionFormat: source === "sql" ? "sql_expression" : "python_expression",
    aggregation,
    source,
    implementedByToolCallIds: [record.toolCallId],
    resultArtifactIds,
    verificationStatus: record.status === "completed" ? "verified" : "unverified",
  };
}

function buildSqlExecution(record: ToolCallRecord, dataSources: EvidenceDataSource[]): EvidenceSqlExecution {
  const sql = sqlScript(record);
  const source = dataSources.find((item) => item.sourceToolCallIds.includes(record.toolCallId));
  return {
    toolCallId: record.toolCallId,
    executionId: stringValue(record.result?.metadata?.sqlExecutionId),
    status: evidenceExecutionStatus(record.status),
    purpose: executionPurpose(record, "执行只读数据查询"),
    dataSourceId: source?.dataSourceId ?? "unknown-data-source",
    tableNames: source?.tableNames.length ? source.tableNames : extractSqlTables(sql).map(safeDisplayName),
    sqlHash: sha256(sql),
    normalizedSql: normalizeSql(sql),
    displaySql: redactSql(sql),
    startedAt: record.createdAt,
    completedAt: record.completedAt,
    durationMs: durationMs(record),
    inputArtifactIds: record.sourceArtifactIds ?? [],
    outputArtifactIds: recordArtifactIds(record),
    resultSummary: {
      rowCount: resultRowCount(record),
      fieldCount: numberFrom(record.result?.metadata?.fieldCount) ?? numberFrom(record.result?.metadata?.columnCount),
      affectedScope: source?.displayName,
    },
    approval: approvalEvidence(record),
  };
}

function buildPythonExecution(record: ToolCallRecord): EvidencePythonExecution {
  const script = stringValue(record.request.script) ?? "";
  return {
    toolCallId: record.toolCallId,
    executionId: stringValue(record.result?.metadata?.executionId),
    status: evidenceExecutionStatus(record.status),
    purpose: executionPurpose(record, "执行统计分析"),
    scriptHash: sha256(script),
    analysisType: sanitizeText(stringValue(record.request.analysisType) ?? "受控 Python 分析"),
    inputArtifactIds: record.sourceArtifactIds ?? [],
    outputArtifactIds: recordArtifactIds(record),
    inputFields: unique([
      ...selectedFieldRefs(record.request).map((ref) => ref.displayName ?? ref.sourceHeader ?? ref.physicalName).filter(isString),
      ...stringArray(record.result?.metadata?.selectedFieldNames),
    ]).map(safeDisplayName),
    outputMetrics: inferOutputMetrics(record),
    startedAt: record.createdAt,
    completedAt: record.completedAt,
    durationMs: durationMs(record),
    resultSummary: sanitizeText(record.result?.summary ?? "分析结果已登记。"),
    approval: approvalEvidence(record),
    sandboxPolicy: "受控本地运行时；仅消费已解析 Artifact，不直接连接业务数据库。",
  };
}

function executionPurpose(record: ToolCallRecord, fallback: string) {
  return sanitizeText(
    stringValue(record.request.purpose)
      ?? stringValue(record.request.queryGoal)
      ?? stringValue(record.request.analysisGoal)
      ?? stringValue(record.metadata?.purpose)
      ?? stringValue(record.result?.metadata?.purpose)
      ?? fallback,
  );
}

function buildArtifactRefs(
  artifactIds: string[],
  artifacts: Map<string, ArtifactRecord>,
  records: ToolCallRecord[],
): EvidenceArtifactRef[] {
  const owners = new Map<string, ToolCallRecord>();
  for (const record of records) for (const id of recordArtifactIds(record)) owners.set(id, record);
  return artifactIds.map((artifactId) => {
    const artifact = artifacts.get(artifactId);
    const owner = owners.get(artifactId);
    const downstream = records.filter((record) => (record.sourceArtifactIds ?? []).includes(artifactId)).flatMap(recordArtifactIds);
    const recognizedWorkflowArtifact = artifactId.startsWith("workflow-dataset:") && Boolean(owner);
    return {
      artifactId,
      type: artifactRefType(artifact, owner),
      title: safeOptionalName(artifact?.title) ?? artifactDisplayTitle(owner, artifactId),
      version: owner?.version,
      status: artifact || recognizedWorkflowArtifact ? "ready" : owner?.status === "failed" ? "failed" : "expired",
      createdByToolCallId: owner?.toolCallId,
      sourceArtifactIds: owner?.sourceArtifactIds ?? [],
      downstreamArtifactIds: unique(downstream),
      createdAt: artifact?.createdAt ?? owner?.completedAt,
    };
  });
}

function buildLineage(
  input: EvidenceCardBuildInput,
  records: ToolCallRecord[],
  dataSources: EvidenceDataSource[],
  artifacts: EvidenceArtifactRef[],
) {
  const nodes: EvidenceLineageNode[] = [];
  const edges: EvidenceLineageEdge[] = [];
  const artifactNodes = new Map<string, string>();
  const tableNodes = new Map<string, string[]>();
  for (const source of dataSources) {
    const sourceNodeId = `source:${shortHash(source.dataSourceId)}`;
    nodes.push({ nodeId: sourceNodeId, nodeType: "data_source", label: source.displayName, status: "ready", referenceId: source.dataSourceId });
    const sourceTableNodes = source.tableNames.map((tableName, index) => {
      const referenceId = source.tableIds[index] ?? `${source.dataSourceId}:${tableName}`;
      const nodeId = `table:${shortHash(referenceId)}`;
      nodes.push({ nodeId, nodeType: "table", label: tableName, status: "ready", referenceId });
      addEdge(edges, sourceNodeId, nodeId, "derived_from");
      return nodeId;
    });
    tableNodes.set(source.dataSourceId, sourceTableNodes);
  }
  for (const artifact of artifacts) {
    const nodeId = `artifact:${shortHash(artifact.artifactId)}`;
    artifactNodes.set(artifact.artifactId, nodeId);
    nodes.push({
      nodeId,
      nodeType: artifact.artifactId === input.reportArtifactId ? "report_artifact" : artifactNodeType(artifact),
      label: artifact.title ?? artifactTypeLabel(artifact.type),
      status: artifact.status,
      referenceId: artifact.artifactId,
    });
  }
  for (const record of records) {
    if (!["sql_query", "python_analysis"].includes(record.toolKind)) continue;
    const nodeId = `tool:${shortHash(record.toolCallId)}`;
    nodes.push({
      nodeId,
      nodeType: record.toolKind === "sql_query" ? "sql_execution" : "python_execution",
      label: record.toolKind === "sql_query" ? "SQL 查询" : "Python 分析",
      status: record.status,
      referenceId: record.toolCallId,
    });
    if (record.toolKind === "sql_query") {
      const source = dataSources.find((item) => item.sourceToolCallIds.includes(record.toolCallId));
      if (source) {
        const queryInputs = tableNodes.get(source.dataSourceId) ?? [];
        if (queryInputs.length > 0) {
          for (const tableNodeId of queryInputs) addEdge(edges, tableNodeId, nodeId, "queries");
        } else {
          addEdge(edges, `source:${shortHash(source.dataSourceId)}`, nodeId, "queries");
        }
      }
    }
    for (const sourceId of record.sourceArtifactIds ?? []) {
      if (artifactNodes.has(sourceId)) addEdge(edges, artifactNodes.get(sourceId) as string, nodeId, record.toolKind === "python_analysis" ? "analyzes" : "consumes");
    }
    for (const outputId of recordArtifactIds(record)) {
      if (artifactNodes.has(outputId)) addEdge(edges, nodeId, artifactNodes.get(outputId) as string, "produces");
    }
  }
  for (const record of records.filter((candidate) => candidate.toolKind === "chart_rendering")) {
    const outputIds = recordArtifactIds(record);
    for (const sourceId of record.sourceArtifactIds ?? []) {
      const sourceNode = artifactNodes.get(sourceId);
      if (!sourceNode) continue;
      for (const outputId of outputIds) {
        const outputNode = artifactNodes.get(outputId);
        if (outputNode) addEdge(edges, sourceNode, outputNode, "visualizes");
      }
    }
  }
  const reportNode = artifactNodes.get(input.reportArtifactId);
  if (reportNode) {
    for (const sourceId of input.sourceArtifactIds) {
      const sourceNode = artifactNodes.get(sourceId);
      if (sourceNode) addEdge(edges, sourceNode, reportNode, "includes");
    }
  }
  const complete = Boolean(reportNode)
    && dataSources.length > 0
    && records.some((record) => record.toolKind === "sql_query" && record.status === "completed")
    && artifacts.every((artifact) => artifact.status === "ready");
  const nodeOrder: Record<EvidenceLineageNode["nodeType"], number> = {
    data_source: 0,
    table: 1,
    sql_execution: 2,
    sql_artifact: 3,
    python_execution: 4,
    python_artifact: 5,
    chart_artifact: 6,
    report_artifact: 7,
  };
  return {
    nodes: dedupeBy(nodes, (node) => node.nodeId).sort((left, right) => nodeOrder[left.nodeType] - nodeOrder[right.nodeType]),
    edges: dedupeBy(edges, (edge) => edge.edgeId),
    rootDataSourceIds: dataSources.map((source) => source.dataSourceId),
    reportArtifactId: input.reportArtifactId,
    complete,
  };
}

function validateEvidence(input: {
  dataSources: EvidenceDataSource[];
  sqlExecutions: EvidenceSqlExecution[];
  pythonExecutions: EvidencePythonExecution[];
  formulas: EvidenceFormula[];
  artifactRefs: EvidenceArtifactRef[];
  lineageComplete: boolean;
  hasChart: boolean;
}) {
  const successfulSql = input.sqlExecutions.some((execution) => execution.status === "completed");
  const successfulAnalysis = successfulSql || input.pythonExecutions.some((execution) => execution.status === "completed");
  const missingArtifacts = input.artifactRefs.filter((artifact) => artifact.status !== "ready");
  const checks: EvidenceCard["validation"]["checks"] = [
    check("DATA_SOURCE_PRESENT", "存在数据来源证据", input.dataSources.length > 0, true),
    check("SQL_EXECUTION_PRESENT", "存在成功 SQL 执行", successfulSql, true),
    check("NUMERIC_EVIDENCE_PRESENT", "统计结论具备工具来源", successfulAnalysis, true),
    check("FORMULA_TRACEABLE", "统计公式关联实际执行", input.formulas.length > 0 && input.formulas.every((formula) => formula.verificationStatus === "verified"), false),
    check("ARTIFACTS_AVAILABLE", "引用 Artifact 可用", missingArtifacts.length === 0, false, missingArtifacts.length ? `${missingArtifacts.length} 个 Artifact 不可用。` : undefined),
    check("LINEAGE_COMPLETE", "Artifact 血缘完整", input.lineageComplete, false),
  ];
  const missingEvidence = checks.filter((item) => item.status !== "passed").map((item) => item.message ?? item.label);
  const passed = checks.filter((item) => item.status === "passed").length;
  return {
    valid: !checks.some((item) => item.status === "failed"),
    completenessScore: Math.round((passed / checks.length) * 100),
    checks,
    missingEvidence,
  };
}

function check(code: string, label: string, passed: boolean, required: boolean, message?: string): EvidenceCard["validation"]["checks"][number] {
  return { code, label, status: passed ? "passed" : required ? "failed" : "warning", message: passed ? undefined : message ?? `${label}缺失或无法验证。` };
}

function selectedFieldRefs(request: Record<string, unknown>) {
  return (Array.isArray(request.selectedFieldRefs) ? request.selectedFieldRefs : [])
    .filter(isRecord)
    .map((ref) => ({
      fieldId: stringValue(ref.fieldId),
      displayName: stringValue(ref.displayName),
      physicalName: stringValue(ref.physicalName),
      sourceHeader: stringValue(ref.sourceHeader),
      logicalType: stringValue(ref.logicalType),
      tempDataSourceId: stringValue(ref.tempDataSourceId),
      tempTableId: stringValue(ref.tempTableId),
    }));
}

function sqlScript(record: ToolCallRecord) {
  return stringValue(record.request.script) ?? stringValue(record.request.sql) ?? "";
}

function extractSqlTables(sql: string) {
  return unique([...sql.matchAll(/\b(?:from|join)\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([a-zA-Z_][\w.]*))/gi)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? match[4])
    .filter(isString));
}

function buildPopulationDefinition(records: ToolCallRecord[]) {
  const sql = records.filter((record) => record.toolKind === "sql_query").map(sqlScript).find((value) => /\bwhere\b/i.test(value));
  if (!sql) return "未登记额外筛选条件，范围以工具输出 Artifact 为准。";
  const filterCount = [...sql.matchAll(/\b(?:where|and|or)\b/gi)].length;
  return `按已执行 SQL 中的 ${filterCount} 组受控筛选条件确定样本范围。`;
}

function inferOutputMetrics(record: ToolCallRecord) {
  const preview = stringValue(record.result?.metadata?.resultPreview) ?? "";
  const lines = preview.split(/\r?\n/);
  const headers: string[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!/^\s*\|.*\|\s*$/.test(lines[index]) || !/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1])) continue;
    headers.push(...lines[index].split("|").map((value) => value.trim()).filter(Boolean));
  }
  return unique(headers).slice(0, 20).map(safeDisplayName);
}

function approvalEvidence(record: ToolCallRecord) {
  const mode = stringValue(record.request.approvalMode);
  const required = mode === "request_approval" || record.status === "rejected";
  return {
    required,
    status: record.status === "rejected" ? "rejected" as const : required ? "approved" as const : "not_required" as const,
  };
}

function evidenceExecutionStatus(status: ToolCallRecord["status"]) {
  if (status === "completed" || status === "cancelled" || status === "rejected") return status;
  return "failed" as const;
}

function durationMs(record: ToolCallRecord) {
  const explicit = numberFrom(record.metadata?.toolDurationMs);
  if (explicit !== undefined) return explicit;
  if (!record.completedAt) return undefined;
  const duration = Date.parse(record.completedAt) - Date.parse(record.createdAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function resultRowCount(record: ToolCallRecord) {
  const direct = numberFrom(record.result?.metadata?.rowCount);
  if (direct !== undefined) return direct;
  const summary = record.result?.summary?.match(/(?:输出|获得|共)\s*(\d+)\s*(?:行|条|条记录)/);
  return summary ? Number(summary[1]) : undefined;
}

function normalizeSql(sql: string) {
  return redactSql(sql).replace(/\s+/g, " ").trim();
}

function redactSql(sql: string) {
  return sanitizeText(sql)
    .replace(/'(?:''|[^'])*'/g, "'?'")
    .replace(/\b(password|passwd|pwd|token|api[_-]?key)\s*=\s*[^\s,;)]+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeSqlFilterValue(value: string) {
  const trimmed = value.trim().replace(/[;)]*$/, "").trim();
  if (/^(?:is\s+)?(?:not\s+)?null$/i.test(trimmed)) return "";
  const literals = [...trimmed.matchAll(/'((?:''|[^'])*)'/g)].map((match) => match[1].replace(/''/g, "'"));
  if (literals.length > 0) return literals.map(redactSensitiveValue).join("、");
  return redactSensitiveValue(trimmed.slice(0, 160));
}

function sanitizeSqlIdentifierExpression(value: string) {
  return value.replace(/[^\w\u3400-\u9fff.*", ]/g, "").slice(0, 120) || "*";
}

function redactSensitiveValue(value: string) {
  return sanitizeText(value)
    .replace(/\b1\d{10}\b/g, "1**********")
    .replace(/\b\d{6}(?:19|20)\d{2}\d{4}\d{3}[\dXx]\b/g, "******************");
}

function sanitizeText(value: string) {
  return value
    .replace(/(?:file:\/\/\/|[a-zA-Z]:[\\/]|\/(?:Users|home|private|tmp|var|opt)\/)\S+/g, "[本地路径已隐藏]")
    .replace(/\b(?:password|passwd|pwd|token|api[_-]?key|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/\b(?:postgres(?:ql)?|mysql|sqlite|mongodb):\/\/\S+/gi, "[连接信息已隐藏]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function safeDisplayName(value: string) {
  const sanitized = sanitizeText(value);
  const basename = sanitized.split(/[\\/]/).at(-1) ?? sanitized;
  return basename.slice(0, 120) || "受控数据源";
}

function safeOptionalName(value: unknown) {
  const string = stringValue(value);
  return string ? safeDisplayName(string) : undefined;
}

function inferFieldRole(name: string, logicalType?: string): EvidenceAnalysisScope["selectedFields"][number]["role"] {
  if (/时间|日期|date|time/i.test(name) || /date|time/i.test(logicalType ?? "")) return "time";
  if (/id|编号|代码|合同号|客户号/i.test(name)) return "identifier";
  if (/金额|余额|数量|笔数|比例|占比|amount|balance|count|rate|ratio/i.test(name) || /number|decimal|integer/i.test(logicalType ?? "")) return "measure";
  if (/分类|分行|行业|类型|标识|名称/i.test(name)) return "dimension";
  return "other";
}

function normalizeFilterOperator(value: string): EvidenceFilter["operator"] {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  const map: Record<string, EvidenceFilter["operator"]> = {
    "=": "eq", "!=": "neq", "<>": "neq", ">": "gt", ">=": "gte", "<": "lt", "<=": "lte",
    "in": "in", "not in": "not_in", "between": "between", "like": "like", "is null": "is_null", "is not null": "is_not_null",
  };
  return map[normalized] ?? "custom";
}

function artifactRefType(artifact: ArtifactRecord | undefined, owner: ToolCallRecord | undefined): EvidenceArtifactRef["type"] {
  if (owner?.toolKind === "sql_query") return "sql_dataset";
  if (owner?.toolKind === "python_analysis") return "python_analysis";
  if (owner?.toolKind === "chart_rendering") return "visualization";
  if (owner?.toolKind === "report_generation" || artifact?.artifactType === "report_markdown") return "markdown_report";
  return "other";
}

function artifactNodeType(artifact: EvidenceArtifactRef): EvidenceLineageNode["nodeType"] {
  if (artifact.type === "sql_dataset") return "sql_artifact";
  if (artifact.type === "python_analysis") return "python_artifact";
  if (artifact.type === "visualization") return "chart_artifact";
  return "sql_artifact";
}

function artifactDisplayTitle(owner: ToolCallRecord | undefined, artifactId: string) {
  if (owner?.toolKind === "sql_query") return "SQL 查询结果数据集";
  if (owner?.toolKind === "python_analysis") return "Python 分析结果";
  if (owner?.toolKind === "chart_rendering") return "可视化图表";
  if (owner?.toolKind === "report_generation") return "当前 Markdown 报告";
  return artifactId.startsWith("workflow-dataset:") ? "工作流数据集" : "分析 Artifact";
}

function artifactTypeLabel(type: EvidenceArtifactRef["type"]) {
  return ({ sql_dataset: "SQL 查询结果", python_analysis: "Python 分析结果", visualization: "可视化图表", markdown_report: "Markdown 报告", table: "数据表", file: "文件", other: "分析 Artifact" })[type];
}

function missingReportArtifact(artifactId: string, version: number): EvidenceArtifactRef {
  return { artifactId, type: "markdown_report", title: "当前 Markdown 报告", version, status: "expired", sourceArtifactIds: [], downstreamArtifactIds: [] };
}

function addEdge(edges: EvidenceLineageEdge[], from: string, to: string, relation: EvidenceLineageEdge["relation"]) {
  edges.push({ edgeId: `edge:${shortHash(`${from}:${to}:${relation}`)}`, from, to, relation });
}

function recordArtifactIds(record: ToolCallRecord) {
  return unique([...(record.outputArtifactIds ?? []), ...(record.result?.artifactIds ?? [])]);
}

function aggregationLabel(value: EvidenceFormula["aggregation"]) {
  return ({ count: "计数", distinct_count: "去重计数", sum: "求和", avg: "平均值", median: "中位数", min: "最小值", max: "最大值", ratio: "占比", custom: "自定义" })[value];
}

function sha256(value: string) {
  return createHash("sha256").update(value || "missing").digest("hex");
}

function shortHash(value: string) {
  return sha256(value).slice(0, 16);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function dedupeBy<T>(values: T[], key: (value: T) => string) {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}
