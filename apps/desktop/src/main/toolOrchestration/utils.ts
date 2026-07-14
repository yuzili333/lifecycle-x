import { createHash, randomUUID } from "node:crypto";
import type { ToolCallError, ToolCallErrorCode, ToolKind } from "./types";

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export function traceId(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

export function toolError(code: ToolCallErrorCode, message: string, patch: Partial<ToolCallError> = {}): ToolCallError {
  return {
    code,
    message,
    traceId: patch.traceId ?? traceId(`${code}:${message}:${Date.now()}`),
    ...patch,
  };
}

export function latestPointerKey(toolKind: ToolKind) {
  if (toolKind === "sql_query") {
    return "latestSuccessfulSqlToolCallId" as const;
  }
  if (toolKind === "python_analysis") {
    return "latestSuccessfulPythonToolCallId" as const;
  }
  if (toolKind === "chart_rendering") {
    return "latestSuccessfulChartToolCallId" as const;
  }
  return "latestSuccessfulReportToolCallId" as const;
}

export function latestArtifactKey(toolKind: ToolKind) {
  if (toolKind === "sql_query") {
    return "latestSuccessfulSqlArtifactIds" as const;
  }
  if (toolKind === "python_analysis") {
    return "latestSuccessfulPythonArtifactIds" as const;
  }
  if (toolKind === "chart_rendering") {
    return "latestSuccessfulChartArtifactIds" as const;
  }
  return "latestSuccessfulReportArtifactIds" as const;
}

export function selectedPointerKey(toolKind: ToolKind) {
  if (toolKind === "sql_query") {
    return "selectedSqlToolCallId" as const;
  }
  if (toolKind === "python_analysis") {
    return "selectedPythonToolCallId" as const;
  }
  if (toolKind === "chart_rendering") {
    return "selectedChartToolCallId" as const;
  }
  return "selectedReportToolCallId" as const;
}

export function dependencyKey(toolKind: ToolKind) {
  return toolKind;
}

export function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}
