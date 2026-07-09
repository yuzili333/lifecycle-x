import type { PythonExecutionOutput, PythonExecutionResult, PythonModelResultPayload, PythonReportVisualizationPayload, PythonRunnerAdapterResult, RequestPythonAnalysisExecutionInput } from "./types.js";

export class PythonResultProcessor {
  process(input: {
    executionId: string;
    requestId: string;
    request: RequestPythonAnalysisExecutionInput;
    adapterResult: PythonRunnerAdapterResult;
  }): PythonExecutionResult {
    const outputs = buildOutputs(input.request, input.adapterResult);
    const safeModelPayload = buildModelPayload(input.executionId, input.request, outputs, input.adapterResult);
    const reportVisualizationPayload = buildReportPayload(input.executionId, input.request, input.adapterResult);
    return {
      executionId: input.executionId,
      requestId: input.requestId,
      status: input.adapterResult.status,
      stdout: input.adapterResult.stdout,
      stderr: input.adapterResult.stderr,
      outputs,
      artifacts: input.adapterResult.artifacts,
      safeModelPayload,
      reportVisualizationPayload,
      executionTimeMs: input.adapterResult.executionTimeMs,
      memoryUsedMb: input.adapterResult.memoryUsedMb,
      warnings: input.adapterResult.warnings,
      createdAt: new Date().toISOString(),
    };
  }
}

function buildOutputs(request: RequestPythonAnalysisExecutionInput, result: PythonRunnerAdapterResult): PythonExecutionOutput[] {
  const outputs: PythonExecutionOutput[] = request.expectedOutputs.map((output) => {
    const artifact = result.artifacts.find((item) => output.outputType === "chart_image" ? item.type === "image" : item.name.includes(output.outputName));
    return {
      name: output.outputName,
      type: output.outputType,
      artifactId: artifact?.artifactId,
      description: output.description ?? `Python 输出：${output.outputName}`,
      value: output.outputType === "text" || output.outputType === "summary" ? truncateText(result.stdout, 2_000) : undefined,
    };
  });
  if (outputs.length === 0 && result.stdout) {
    outputs.push({ name: "stdout_summary", type: "text", value: truncateText(result.stdout, 2_000), description: "Python stdout 摘要。" });
  }
  return outputs;
}

function buildModelPayload(executionId: string, request: RequestPythonAnalysisExecutionInput, outputs: PythonExecutionOutput[], result: PythonRunnerAdapterResult): PythonModelResultPayload {
  return {
    executionId,
    purpose: request.purpose,
    textSummary: result.status === "success" ? truncateText(result.stdout || "Python 脚本执行完成。", 1_500) : truncateText(result.stderr || "Python 脚本执行失败。", 1_500),
    outputDescriptions: outputs.map((output) => ({
      name: output.name,
      type: output.type,
      description: output.description ?? "受控 Python 输出。",
    })),
    artifactSummaries: result.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      type: artifact.type,
      description: artifact.description,
    })),
    limitations: [
      "返回给模型的是 stdout 摘要、输出说明和 artifact 引用，不包含完整中间数据。",
      "artifact 仅返回受控引用，不返回宿主机绝对路径。",
    ],
    warnings: result.warnings,
  };
}

function buildReportPayload(executionId: string, request: RequestPythonAnalysisExecutionInput, result: PythonRunnerAdapterResult): PythonReportVisualizationPayload {
  const charts = result.artifacts
    .filter((artifact) => artifact.type === "image" || artifact.type === "json" || artifact.type === "html")
    .map((artifact) => ({
      chartId: `py_chart_${artifact.artifactId}`,
      title: artifact.name,
      description: artifact.description,
      artifactId: artifact.artifactId,
      type: artifact.type === "image" ? "image" as const : artifact.type === "html" ? "html" as const : "json_spec" as const,
      mimeType: artifact.mimeType,
    }));
  return {
    executionId,
    purpose: request.purpose,
    artifacts: result.artifacts,
    charts,
    summary: truncateText(result.stdout || "Python 可视化任务执行完成。", 1_500),
    limitations: [
      "图表产物来自受限沙箱 artifacts/ 目录。",
      "报告可视化 payload 不包含未授权原始数据。",
    ],
    warnings: result.warnings,
  };
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
