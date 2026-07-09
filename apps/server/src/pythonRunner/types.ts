export type PythonInputDatasetRef = {
  datasetId: string;
  sourceType: "sql_execution_result" | "csv_temp_table" | "uploaded_file" | "derived_dataset" | "inline_preview";
  description?: string;
  schema?: Record<string, string>;
  rowCount?: number;
  columnCount?: number;
  accessMode?: "read_only";
  sourceSqlRequestId?: string;
  sourceSqlExecutionId?: string;
  sensitivity?: "public" | "internal" | "sensitive" | "restricted";
};

export type PythonExpectedOutput = {
  outputName: string;
  outputType: "table" | "summary" | "chart_image" | "chart_spec" | "json" | "text" | "file";
  description?: string;
};

export type PythonResultUse =
  | "chart_generation"
  | "statistical_analysis"
  | "risk_report"
  | "data_quality_report"
  | "trend_analysis"
  | "correlation_analysis"
  | "anomaly_detection"
  | "report_visualization"
  | "debug";

export type PythonResultConsumer = "llm" | "chart_tool" | "agent_runtime" | "user_preview" | "report_generator";

export type RequestPythonAnalysisExecutionInput = {
  script: string;
  purpose: string;
  inputDatasets: PythonInputDatasetRef[];
  expectedOutputs: PythonExpectedOutput[];
  resultUse: PythonResultUse;
  resultConsumer?: PythonResultConsumer;
  requiredLibraries?: string[];
  timeoutMs?: number;
  memoryLimitMb?: number;
  requireApproval?: boolean;
  approvalReason?: string;
  metadata?: Record<string, unknown>;
};

export type PythonExecutionRequestStatus = "draft" | "blocked" | "pending_approval" | "approved" | "rejected" | "executing" | "completed" | "failed" | "timeout" | "cancelled" | "expired";

export type PythonScriptSafetyIssueCode =
  | "FORBIDDEN_IMPORT"
  | "FORBIDDEN_FUNCTION"
  | "NETWORK_ACCESS"
  | "SHELL_EXECUTION"
  | "UNAUTHORIZED_FILE_ACCESS"
  | "DYNAMIC_EXECUTION"
  | "ENV_ACCESS"
  | "PACKAGE_INSTALL"
  | "DATABASE_DIRECT_CONNECTION"
  | "UNBOUNDED_LOOP_RISK"
  | "MEMORY_RISK"
  | "UNSUPPORTED_SCRIPT"
  | "PARSE_FAILED";

export type PythonScriptSafetyIssue = {
  code: PythonScriptSafetyIssueCode;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  location?: string;
};

export type PythonScriptSafetyCheckResult = {
  passed: boolean;
  level: "safe" | "warning" | "blocked";
  issues: PythonScriptSafetyIssue[];
  detectedImports: string[];
  detectedOutputs: string[];
  usesFileSystem: boolean;
  usesNetwork: boolean;
  usesShell: boolean;
  usesDynamicExecution: boolean;
  usesDatabaseConnection: boolean;
};

export type PythonApprovalPolicy = {
  requireApprovalByDefault?: boolean;
  approvalExpiresInMs?: number;
};

export type PythonUserPermissionContext = {
  userId: string;
  roles: string[];
  allowPythonExecution: boolean;
  allowChartGeneration?: boolean;
  allowFileArtifacts?: boolean;
  allowSensitiveDataAnalysis?: boolean;
  allowAdvancedLibraries?: boolean;
  allowAutoApproval?: boolean;
  allowedDatasetIds: string[];
  deniedDatasetIds?: string[];
  approvalPolicy?: PythonApprovalPolicy;
};

export type PythonPermissionIssue = {
  code:
    | "PYTHON_EXECUTION_DENIED"
    | "DATASET_ACCESS_DENIED"
    | "SENSITIVE_DATA_DENIED"
    | "CHART_GENERATION_DENIED"
    | "FILE_ARTIFACT_DENIED"
    | "ADVANCED_LIBRARY_DENIED"
    | "AUTO_APPROVAL_DENIED";
  severity: "info" | "warning" | "error" | "critical";
  message: string;
};

export type PythonPermissionCheckResult = {
  passed: boolean;
  reasons: PythonPermissionIssue[];
  allowedDatasets: string[];
  deniedDatasets: string[];
  requiresMasking: boolean;
  requiresApproval: boolean;
};

export type PythonRiskLevel = "low" | "medium" | "high" | "blocked";
export type PythonResultMode = "summary_only" | "artifact_only" | "limited_table" | "chart_payload" | "blocked";

export type PythonRiskAssessment = {
  riskLevel: PythonRiskLevel;
  score: number;
  reasons: string[];
  requiresApproval: boolean;
  requiresHigherPrivilege?: boolean;
  recommendedTimeoutMs: number;
  recommendedMemoryLimitMb: number;
  recommendedResultMode: PythonResultMode;
};

export type PythonApprovalState = {
  approvalId: string;
  status: "not_required" | "pending" | "approved" | "rejected" | "expired";
  requestedBy: string;
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
  riskLevel: PythonRiskLevel;
  createdAt: string;
  updatedAt?: string;
  expiresAt?: string;
};

export type PythonArtifact = {
  artifactId: string;
  name: string;
  type: "image" | "csv" | "json" | "html" | "text" | "figure";
  mimeType?: string;
  path?: string;
  sizeBytes?: number;
  description?: string;
  createdAt: string;
};

export type PythonExecutionOutput = {
  name: string;
  type: "table" | "summary" | "chart_image" | "chart_spec" | "json" | "text" | "file";
  value?: unknown;
  artifactId?: string;
  description?: string;
};

export type PythonChartOutput = {
  chartId: string;
  title?: string;
  description?: string;
  artifactId?: string;
  type: "image" | "json_spec" | "html";
  mimeType?: string;
};

export type PythonReportVisualizationPayload = {
  executionId: string;
  purpose: string;
  artifacts: PythonArtifact[];
  charts: PythonChartOutput[];
  summary: string;
  limitations: string[];
  warnings: string[];
};

export type PythonModelResultPayload = {
  executionId: string;
  purpose: string;
  textSummary: string;
  outputDescriptions: Array<{ name: string; type: string; description: string }>;
  artifactSummaries: Array<{ artifactId: string; type: string; description?: string }>;
  limitations: string[];
  warnings: string[];
};

export type PythonExecutionResult = {
  executionId: string;
  requestId: string;
  status: "success" | "failed" | "timeout" | "cancelled";
  stdout: string;
  stderr: string;
  outputs: PythonExecutionOutput[];
  artifacts: PythonArtifact[];
  safeModelPayload?: PythonModelResultPayload;
  reportVisualizationPayload?: PythonReportVisualizationPayload;
  executionTimeMs: number;
  memoryUsedMb?: number;
  warnings: string[];
  createdAt: string;
};

export type RequestPythonAnalysisExecutionOutput = {
  requestId: string;
  status: PythonExecutionRequestStatus;
  purpose: string;
  inputDatasets: PythonInputDatasetRef[];
  expectedOutputs: PythonExpectedOutput[];
  riskAssessment: PythonRiskAssessment;
  permissionCheck: PythonPermissionCheckResult;
  safetyCheck: PythonScriptSafetyCheckResult;
  approval: PythonApprovalState;
  execution?: PythonExecutionResult;
  message: string;
  createdAt: string;
  updatedAt?: string;
};

export type PythonAuditEventType =
  | "request_created"
  | "safety_passed"
  | "safety_failed"
  | "permission_passed"
  | "permission_failed"
  | "risk_assessed"
  | "approval_created"
  | "approval_approved"
  | "approval_rejected"
  | "execution_started"
  | "execution_succeeded"
  | "execution_failed"
  | "execution_timeout"
  | "execution_cancelled"
  | "artifact_generated"
  | "result_to_report"
  | "result_to_model"
  | "script_blocked";

export type PythonAuditEvent = {
  auditId: string;
  eventType: PythonAuditEventType;
  requestId?: string;
  executionId?: string;
  userId: string;
  scriptHash?: string;
  riskLevel?: PythonRiskLevel;
  status: "success" | "failed" | "blocked";
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type PythonAuditLogger = {
  log(event: Omit<PythonAuditEvent, "auditId" | "createdAt">): void | Promise<void>;
};

export type PythonDatasetMaterialized = {
  fileName: string;
  relativePath: string;
  rowCount?: number;
  columnCount?: number;
};

export type PythonDatasetResolver = {
  resolveDataset(datasetId: string): Promise<{
    datasetId: string;
    name: string;
    sourceType: PythonInputDatasetRef["sourceType"];
    schema?: Record<string, string>;
    rowCount?: number;
    columnCount?: number;
    sensitivity?: PythonInputDatasetRef["sensitivity"];
    materializeForSandbox: (input: { targetDir: string; format: "csv" | "jsonl" }) => Promise<PythonDatasetMaterialized>;
  } | null>;
};

export type PythonPermissionProvider = {
  getPermissionContext?(userId: string): Promise<PythonUserPermissionContext> | PythonUserPermissionContext;
  check?(input: {
    request: RequestPythonAnalysisExecutionInput;
    safetyCheck: PythonScriptSafetyCheckResult;
    userContext: PythonUserPermissionContext;
  }): Promise<PythonPermissionCheckResult> | PythonPermissionCheckResult;
};

export type PythonSandboxRunInput = {
  executionId: string;
  requestId: string;
  script: string;
  input: RequestPythonAnalysisExecutionInput;
  timeoutMs: number;
  memoryLimitMb: number;
  signal?: AbortSignal;
};

export type PythonRunnerAdapterResult = {
  status: "success" | "failed" | "timeout" | "cancelled";
  stdout: string;
  stderr: string;
  outputs: PythonExecutionOutput[];
  artifacts: PythonArtifact[];
  executionTimeMs: number;
  memoryUsedMb?: number;
  warnings: string[];
};

export type PythonRunnerAdapter = {
  execute(input: PythonSandboxRunInput): Promise<PythonRunnerAdapterResult>;
  cancel?(executionId: string): void | Promise<void>;
};

export type PythonRunnerModuleConfig = {
  defaultTimeoutMs: number;
  hardTimeoutMs: number;
  defaultMemoryLimitMb: number;
  hardMemoryLimitMb: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxArtifactCount: number;
  maxArtifactSizeBytes: number;
  requireApprovalByDefault: boolean;
  allowAutoApprovalForLowRisk?: boolean;
  storePlainScriptInAuditLog?: boolean;
  allowedLibraries: string[];
  sandboxRootDir: string;
  pythonExecutable?: string;
  datasetResolver: PythonDatasetResolver;
  permissionProvider?: PythonPermissionProvider;
  runnerAdapter?: PythonRunnerAdapter;
  auditLogger?: PythonAuditLogger;
  cleanupSandboxOnSuccess?: boolean;
  maxConcurrentExecutions?: number;
  maxRequestsPerMinute?: number;
  circuitBreaker?: { failureThreshold: number; cooldownMs: number };
};

export type PythonRunnerErrorCode =
  | "PYTHON_SCRIPT_EMPTY"
  | "PYTHON_SCRIPT_PARSE_FAILED"
  | "PYTHON_FORBIDDEN_IMPORT"
  | "PYTHON_FORBIDDEN_FUNCTION"
  | "PYTHON_NETWORK_ACCESS_DENIED"
  | "PYTHON_SHELL_EXECUTION_DENIED"
  | "PYTHON_FILE_ACCESS_DENIED"
  | "PYTHON_ENV_ACCESS_DENIED"
  | "PYTHON_DATABASE_DIRECT_CONNECTION_DENIED"
  | "PYTHON_DATASET_NOT_FOUND"
  | "PYTHON_DATASET_PERMISSION_DENIED"
  | "PYTHON_APPROVAL_REQUIRED"
  | "PYTHON_APPROVAL_NOT_FOUND"
  | "PYTHON_APPROVAL_REJECTED"
  | "PYTHON_APPROVAL_EXPIRED"
  | "PYTHON_REQUEST_NOT_APPROVED"
  | "PYTHON_SANDBOX_CREATE_FAILED"
  | "PYTHON_EXECUTION_FAILED"
  | "PYTHON_EXECUTION_TIMEOUT"
  | "PYTHON_EXECUTION_CANCELLED"
  | "PYTHON_ARTIFACT_TOO_LARGE"
  | "PYTHON_RESULT_PROCESS_FAILED"
  | "UNKNOWN_ERROR";
