export type EvidenceStatus = "complete" | "partial" | "invalid";

export type EvidenceDataSource = {
  dataSourceId: string;
  displayName: string;
  type: "database" | "standard_csv" | "conversation_csv" | "derived_dataset";
  databaseType?: string;
  sourceFileName?: string;
  tableIds: string[];
  tableNames: string[];
  scope: "persistent" | "project" | "conversation" | "derived";
  dataSnapshotAt?: string;
  reportDate?: string;
  rowCount?: number;
  fieldCount?: number;
  accessMode: "read_only" | "artifact_only";
  sourceToolCallIds: string[];
};

export type EvidenceAnalysisScope = {
  description: string;
  tables: Array<{ tableId: string; displayName: string; physicalName?: string }>;
  selectedFields: Array<{
    fieldId?: string;
    displayName: string;
    physicalName?: string;
    logicalType?: string;
    role: "dimension" | "measure" | "identifier" | "filter" | "time" | "other";
  }>;
  timeRange?: { start?: string; end?: string; fieldName?: string };
  populationDefinition?: string;
  inputRowCount?: number;
  outputRowCount?: number;
  excludedRecords?: Array<{ reason: string; count?: number }>;
};

export type EvidenceFilter = {
  filterId: string;
  fieldDisplayName: string;
  fieldPhysicalName?: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "between" | "like" | "is_null" | "is_not_null" | "custom";
  displayValue: string;
  normalizedValue?: unknown;
  source: "user" | "skill" | "workflow" | "system";
  appliedInToolCallId: string;
};

export type EvidenceFormula = {
  formulaId: string;
  metricName: string;
  metricDisplayName: string;
  expression: string;
  expressionFormat: "plain_text" | "latex" | "sql_expression" | "python_expression";
  numerator?: string;
  denominator?: string;
  aggregation: "count" | "distinct_count" | "sum" | "avg" | "median" | "min" | "max" | "ratio" | "custom";
  source: "skill" | "tool_plan" | "sql" | "python" | "report_template";
  implementedByToolCallIds: string[];
  resultArtifactIds: string[];
  verificationStatus: "verified" | "partially_verified" | "unverified";
  notes?: string;
};

export type EvidenceExecutionStatus = "completed" | "failed" | "cancelled" | "rejected";

export type EvidenceSqlExecution = {
  toolCallId: string;
  executionId?: string;
  status: EvidenceExecutionStatus;
  purpose: string;
  dataSourceId: string;
  tableNames: string[];
  sqlHash: string;
  normalizedSql?: string;
  displaySql?: string;
  parameterSummary?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  resultSummary?: { rowCount?: number; fieldCount?: number; affectedScope?: string };
  approval?: { required: boolean; status: "approved" | "rejected" | "not_required" };
};

export type EvidencePythonExecution = {
  toolCallId: string;
  executionId?: string;
  status: EvidenceExecutionStatus;
  purpose: string;
  scriptHash: string;
  analysisType?: string;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  inputFields: string[];
  outputMetrics: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  resultSummary?: string;
  approval?: { required: boolean; status: "approved" | "rejected" | "not_required" };
  sandboxPolicy?: string;
};

export type EvidenceArtifactRef = {
  artifactId: string;
  type: "sql_dataset" | "python_analysis" | "visualization" | "markdown_report" | "table" | "file" | "other";
  title?: string;
  version?: number;
  status: "ready" | "expired" | "failed" | "deleted";
  createdByToolCallId?: string;
  sourceArtifactIds: string[];
  downstreamArtifactIds: string[];
  createdAt?: string;
};

export type EvidenceLineageNode = {
  nodeId: string;
  nodeType: "data_source" | "table" | "sql_execution" | "sql_artifact" | "python_execution" | "python_artifact" | "chart_artifact" | "report_artifact";
  label: string;
  status?: string;
  referenceId: string;
};

export type EvidenceLineageEdge = {
  edgeId: string;
  from: string;
  to: string;
  relation: "queries" | "produces" | "consumes" | "analyzes" | "visualizes" | "includes" | "derived_from";
};

export type EvidenceLineageGraph = {
  nodes: EvidenceLineageNode[];
  edges: EvidenceLineageEdge[];
  rootDataSourceIds: string[];
  reportArtifactId: string;
  complete: boolean;
};

export type EvidenceLimitation = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};

export type EvidenceValidationSummary = {
  valid: boolean;
  completenessScore?: number;
  checks: Array<{
    code: string;
    label: string;
    status: "passed" | "warning" | "failed";
    message?: string;
  }>;
  missingEvidence: string[];
};

export type EvidenceCard = {
  evidenceCardId: string;
  reportArtifactId: string;
  reportVersion: number;
  title: "溯据卡";
  statement: string;
  status: EvidenceStatus;
  dataSources: EvidenceDataSource[];
  analysisScope: EvidenceAnalysisScope;
  filters: EvidenceFilter[];
  formulas: EvidenceFormula[];
  sqlExecutions: EvidenceSqlExecution[];
  pythonExecutions: EvidencePythonExecution[];
  upstreamArtifacts: EvidenceArtifactRef[];
  downstreamArtifacts: EvidenceArtifactRef[];
  lineage: EvidenceLineageGraph;
  limitations: EvidenceLimitation[];
  validation: EvidenceValidationSummary;
  generatedAt: string;
  generatedBy: "system";
};

export type EvidenceCardErrorCode =
  | "EVIDENCE_CARD_NOT_FOUND"
  | "REPORT_ARTIFACT_NOT_FOUND"
  | "DATA_SOURCE_EVIDENCE_MISSING"
  | "TOOL_EXECUTION_RECORD_MISSING"
  | "FORMULA_EVIDENCE_MISSING"
  | "ARTIFACT_LINEAGE_INCOMPLETE"
  | "ARTIFACT_EXPIRED"
  | "EVIDENCE_PERMISSION_DENIED"
  | "EVIDENCE_VALIDATION_FAILED"
  | "UNKNOWN_ERROR";

export type ResolvedReportEvidenceCard = {
  evidenceCardId: string;
  reportArtifactId: string;
  reportVersion: number;
  status: EvidenceStatus;
  evidenceCard: EvidenceCard;
};

export const EVIDENCE_ACCURACY_POLICY = {
  allowFabricatedEvidence: false,
  allowSyntheticExecutionRecord: false,
  allowMissingArtifactGuessing: false,
  allowFailedToolAsSuccessfulEvidence: false,
  requireSqlOrPythonForNumericEvidence: true,
  requireLineageForVisualizationEvidence: true,
} as const;
