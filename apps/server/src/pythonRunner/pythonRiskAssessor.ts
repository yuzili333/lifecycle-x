import type { PythonPermissionCheckResult, PythonRiskAssessment, PythonScriptSafetyCheckResult, PythonUserPermissionContext, PythonRunnerModuleConfig, RequestPythonAnalysisExecutionInput } from "./types.js";

export class PythonRiskAssessor {
  assess({
    request,
    safetyCheck,
    permissionCheck,
    userContext,
    config,
  }: {
    request: RequestPythonAnalysisExecutionInput;
    safetyCheck: PythonScriptSafetyCheckResult;
    permissionCheck: PythonPermissionCheckResult;
    userContext: PythonUserPermissionContext;
    config: Pick<PythonRunnerModuleConfig, "defaultTimeoutMs" | "hardTimeoutMs" | "defaultMemoryLimitMb" | "hardMemoryLimitMb">;
  }): PythonRiskAssessment {
    let score = 0;
    const reasons: string[] = [];
    if (!safetyCheck.passed || !permissionCheck.passed) {
      score += 100;
      reasons.push("安全或权限校验未通过。");
    }
    if (request.inputDatasets.some((dataset) => dataset.sensitivity === "sensitive" || dataset.sensitivity === "restricted")) {
      score += 25;
      reasons.push("输入数据集包含敏感或受限数据。");
    }
    if (request.inputDatasets.some((dataset) => (dataset.rowCount ?? 0) >= 100_000)) {
      score += 20;
      reasons.push("输入数据量较大。");
    }
    if (request.script.length > 10_000) {
      score += 12;
      reasons.push("脚本较长，审计复杂度较高。");
    }
    if (/\b(for|while)\b/.test(request.script)) {
      score += 8;
      reasons.push("脚本包含循环。");
    }
    if (safetyCheck.usesFileSystem) {
      score += 12;
      reasons.push("脚本涉及文件系统访问。");
    }
    if (request.expectedOutputs.some((output) => output.outputType === "chart_image" || output.outputType === "chart_spec")) {
      score += 12;
      reasons.push("脚本将生成可视化产物。");
    }
    if (request.expectedOutputs.some((output) => output.outputType === "file")) {
      score += 15;
      reasons.push("脚本将生成文件产物。");
    }
    if (request.resultConsumer === "llm") {
      score += 8;
      reasons.push("结果将返回给大模型。");
    }
    if (request.resultConsumer === "report_generator" || request.resultUse === "risk_report") {
      score += 10;
      reasons.push("结果将进入报告生成链路。");
    }
    if ((request.memoryLimitMb ?? config.defaultMemoryLimitMb) > config.defaultMemoryLimitMb) {
      score += 6;
      reasons.push("请求内存超过默认上限。");
    }

    const riskLevel = !safetyCheck.passed || !permissionCheck.passed ? "blocked" : score >= 70 ? "high" : score >= 30 ? "medium" : "low";
    return {
      riskLevel,
      score,
      reasons: reasons.length > 0 ? reasons : ["低风险受控 Python 分析。"],
      requiresApproval: riskLevel !== "blocked" && !(riskLevel === "low" && userContext.allowAutoApproval),
      requiresHigherPrivilege: riskLevel === "high" && !userContext.roles.includes("admin"),
      recommendedTimeoutMs: Math.min(request.timeoutMs ?? config.defaultTimeoutMs, config.hardTimeoutMs),
      recommendedMemoryLimitMb: Math.min(request.memoryLimitMb ?? config.defaultMemoryLimitMb, config.hardMemoryLimitMb),
      recommendedResultMode:
        riskLevel === "blocked"
          ? "blocked"
          : request.expectedOutputs.some((output) => output.outputType === "chart_image" || output.outputType === "chart_spec")
            ? "chart_payload"
            : request.expectedOutputs.some((output) => output.outputType === "file")
              ? "artifact_only"
              : "summary_only",
    };
  }
}
