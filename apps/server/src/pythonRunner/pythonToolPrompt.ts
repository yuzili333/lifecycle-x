import type { PythonResultConsumer, PythonResultUse } from "./types.js";

export const PYTHON_TOOL_NAME = "request_python_analysis_execution";

export const PYTHON_TOOL_DESCRIPTION_EN = [
  "request_python_analysis_execution is a controlled Python data analysis execution request tool.",
  "Use this tool only when the user asks for data analysis, statistical computation, data transformation, visualization preparation, chart generation, anomaly detection, trend analysis, correlation analysis, or report-ready analytical output that requires Python execution.",
  "The model must provide a Python script, explain the purpose of the script, declare the required input datasets, and describe the expected outputs. The script will not be executed immediately. It will first be validated, checked against user permissions, assessed for risk, and submitted for user approval. Only approved scripts can be executed in a restricted sandbox.",
  "All input data must come from approved dataset references, such as SQL execution results, controlled CSV temporary datasets, uploaded file copies, or derived datasets. The script must not directly connect to databases or access raw data sources.",
  "Never use this tool to access the network, read arbitrary local files, write outside the sandbox directory, execute shell commands, install packages, access environment secrets, connect to databases directly, modify source data, or perform any unauthorized operation.",
].join("\n");

export const PYTHON_TOOL_DESCRIPTION_ZH = [
  "request_python_analysis_execution 是一个受控的 Python 数据分析执行请求工具。",
  "仅当用户需求需要执行数据分析、统计计算、数据转换、可视化准备、图表生成、异常检测、趋势分析、相关性分析或报告级分析结果输出时，才使用该工具。",
  "模型需要提供 Python 脚本，说明脚本目的，声明所需输入数据集，并描述预期输出。脚本不会被立即执行，而是先经过脚本安全校验、用户权限校验、风险评估和用户审批。只有审批通过的脚本才能在受限沙箱中执行。",
  "所有输入数据必须来自已审批的数据集引用，例如 SQL 执行结果、受控 CSV 临时数据集、上传文件副本或派生数据集。Python 脚本不得直接连接数据库，不得访问原始业务数据源。",
  "禁止使用该工具访问网络、读取任意本地文件、写入沙箱目录之外的路径、执行 shell 命令、安装依赖包、读取环境密钥、直接连接数据库、修改源数据或执行任何未授权操作。",
].join("\n");

const resultUses: PythonResultUse[] = ["chart_generation", "statistical_analysis", "risk_report", "data_quality_report", "trend_analysis", "correlation_analysis", "anomaly_detection", "report_visualization", "debug"];
const resultConsumers: PythonResultConsumer[] = ["llm", "chart_tool", "agent_runtime", "user_preview", "report_generator"];
const sourceTypes = ["sql_execution_result", "csv_temp_table", "uploaded_file", "derived_dataset", "inline_preview"] as const;
const outputTypes = ["table", "summary", "chart_image", "chart_spec", "json", "text", "file"] as const;
const sensitivities = ["public", "internal", "sensitive", "restricted"] as const;

export const REQUEST_PYTHON_ANALYSIS_EXECUTION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["script", "purpose", "inputDatasets", "expectedOutputs", "resultUse"],
  properties: {
    script: { type: "string", minLength: 1, maxLength: 50_000 },
    purpose: { type: "string", minLength: 1, maxLength: 2_000 },
    inputDatasets: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["datasetId", "sourceType"],
        properties: {
          datasetId: { type: "string", minLength: 1 },
          sourceType: { type: "string", enum: sourceTypes },
          description: { type: "string" },
          schema: { type: "object" },
          rowCount: { type: "integer", minimum: 0 },
          columnCount: { type: "integer", minimum: 0 },
          accessMode: { type: "string", enum: ["read_only"] },
          sourceSqlRequestId: { type: "string" },
          sourceSqlExecutionId: { type: "string" },
          sensitivity: { type: "string", enum: sensitivities },
        },
      },
    },
    expectedOutputs: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["outputName", "outputType"],
        properties: {
          outputName: { type: "string", minLength: 1 },
          outputType: { type: "string", enum: outputTypes },
          description: { type: "string" },
        },
      },
    },
    resultUse: { type: "string", enum: resultUses },
    resultConsumer: { type: "string", enum: resultConsumers },
    requiredLibraries: { type: "array", items: { type: "string" } },
    timeoutMs: { type: "integer", minimum: 100, maximum: 120_000 },
    memoryLimitMb: { type: "integer", minimum: 64, maximum: 4096 },
    requireApproval: { type: "boolean" },
    approvalReason: { type: "string", maxLength: 2_000 },
    metadata: { type: "object" },
  },
} as const;

export function getPythonToolDefinition() {
  return {
    name: PYTHON_TOOL_NAME,
    description: `${PYTHON_TOOL_DESCRIPTION_EN}\n\n${PYTHON_TOOL_DESCRIPTION_ZH}`,
    inputSchema: REQUEST_PYTHON_ANALYSIS_EXECUTION_INPUT_SCHEMA,
    outputDescription: "Creates a governed Python analysis execution request. The script is blocked, pending approval, or executed only after approval inside a restricted sandbox.",
    riskLevel: "high" as const,
    requiresUserApproval: true,
  };
}
