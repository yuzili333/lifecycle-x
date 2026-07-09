import type { PythonPermissionCheckResult, PythonPermissionIssue, PythonPermissionProvider, PythonScriptSafetyCheckResult, PythonUserPermissionContext, RequestPythonAnalysisExecutionInput } from "./types.js";

const ADVANCED_LIBRARIES = new Set(["scipy", "sklearn"]);

export class DefaultPythonPermissionValidator implements Required<Pick<PythonPermissionProvider, "check">> {
  check({
    request,
    safetyCheck,
    userContext,
  }: {
    request: RequestPythonAnalysisExecutionInput;
    safetyCheck: PythonScriptSafetyCheckResult;
    userContext: PythonUserPermissionContext;
  }): PythonPermissionCheckResult {
    const reasons: PythonPermissionIssue[] = [];
    if (!userContext.allowPythonExecution) {
      reasons.push(issue("PYTHON_EXECUTION_DENIED", "用户无权执行 Python 分析。", "critical"));
    }

    const allowedDatasets: string[] = [];
    const deniedDatasets: string[] = [];
    for (const dataset of request.inputDatasets) {
      const denied = userContext.deniedDatasetIds?.includes(dataset.datasetId) || !userContext.allowedDatasetIds.includes(dataset.datasetId);
      if (denied) {
        deniedDatasets.push(dataset.datasetId);
        reasons.push(issue("DATASET_ACCESS_DENIED", `用户无权访问输入数据集：${dataset.datasetId}`, "error"));
      } else {
        allowedDatasets.push(dataset.datasetId);
      }
      if ((dataset.sensitivity === "sensitive" || dataset.sensitivity === "restricted") && !userContext.allowSensitiveDataAnalysis) {
        reasons.push(issue("SENSITIVE_DATA_DENIED", `敏感数据集需要更高权限：${dataset.datasetId}`, "error"));
      }
    }

    const outputTypes = request.expectedOutputs.map((output) => output.outputType);
    if (outputTypes.some((type) => type === "chart_image" || type === "chart_spec") && !userContext.allowChartGeneration) {
      reasons.push(issue("CHART_GENERATION_DENIED", "用户无权生成图表。", "error"));
    }
    if (outputTypes.some((type) => type === "file" || type === "chart_image") && !userContext.allowFileArtifacts) {
      reasons.push(issue("FILE_ARTIFACT_DENIED", "用户无权生成文件 artifact。", "error"));
    }
    for (const library of request.requiredLibraries ?? safetyCheck.detectedImports) {
      const root = library.split(".")[0];
      if (ADVANCED_LIBRARIES.has(root) && !userContext.allowAdvancedLibraries) {
        reasons.push(issue("ADVANCED_LIBRARY_DENIED", `高级分析库未授权：${library}`, "error"));
      }
    }

    return {
      passed: reasons.every((item) => item.severity !== "error" && item.severity !== "critical"),
      reasons,
      allowedDatasets,
      deniedDatasets,
      requiresMasking: request.inputDatasets.some((dataset) => dataset.sensitivity === "sensitive" || dataset.sensitivity === "restricted"),
      requiresApproval: userContext.approvalPolicy?.requireApprovalByDefault ?? true,
    };
  }
}

function issue(code: PythonPermissionIssue["code"], message: string, severity: PythonPermissionIssue["severity"]): PythonPermissionIssue {
  return { code, message, severity };
}
