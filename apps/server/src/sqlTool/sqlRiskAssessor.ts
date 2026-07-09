import type { RequestSqlQueryExecutionInput, SqlPermissionCheckResult, SqlRiskAssessment, SqlSafetyCheckResult, SqlToolModuleConfig, SqlUserPermissionContext } from "./types.js";

export class SqlRiskAssessor {
  assess({
    request,
    safetyCheck,
    permissionCheck,
    userContext,
    config,
    dataSourceProtectionLevel,
  }: {
    request: RequestSqlQueryExecutionInput;
    safetyCheck: SqlSafetyCheckResult;
    permissionCheck: SqlPermissionCheckResult;
    userContext: SqlUserPermissionContext;
    config: Pick<SqlToolModuleConfig, "defaultMaxRows" | "hardMaxRows" | "defaultTimeoutMs" | "hardTimeoutMs">;
    dataSourceProtectionLevel?: "normal" | "sensitive" | "critical";
  }): SqlRiskAssessment {
    let score = 0;
    const reasons: string[] = [];
    if (!safetyCheck.passed || !permissionCheck.passed) {
      score += 100;
      reasons.push("安全或权限校验未通过。");
    }
    if (safetyCheck.hasJoin) {
      score += 18;
      reasons.push("包含 JOIN 查询。");
    }
    if (safetyCheck.hasAggregation) {
      score += 12;
      reasons.push("包含聚合统计。");
    }
    if (!safetyCheck.hasLimit) {
      score += 14;
      reasons.push("未显式指定 LIMIT。");
    }
    if (safetyCheck.hasPotentialFullScan) {
      score += 25;
      reasons.push("存在潜在全表扫描。");
    }
    if (permissionCheck.sensitiveColumns.length > 0) {
      score += 25;
      reasons.push(`涉及敏感字段：${permissionCheck.sensitiveColumns.join(", ")}。`);
    }
    if (request.expectedResultUse === "python_analysis" || request.resultConsumer === "python_tool") {
      score += 15;
      reasons.push("结果将传递给 Python 分析工具。");
    }
    if (request.expectedResultUse === "chart_generation" || request.resultConsumer === "chart_tool") {
      score += 10;
      reasons.push("结果将用于图表生成。");
    }
    if ((request.maxRows ?? config.defaultMaxRows) > config.defaultMaxRows) {
      score += 10;
      reasons.push("请求行数超过默认上限。");
    }
    if (dataSourceProtectionLevel === "sensitive") {
      score += 12;
      reasons.push("数据源保护等级为 sensitive。");
    }
    if (dataSourceProtectionLevel === "critical") {
      score += 25;
      reasons.push("数据源保护等级为 critical。");
    }

    const riskLevel = !safetyCheck.passed || !permissionCheck.passed ? "blocked" : score >= 60 ? "high" : score >= 25 ? "medium" : "low";
    return {
      riskLevel,
      score,
      reasons: reasons.length > 0 ? reasons : ["低风险只读查询。"],
      requiresApproval: riskLevel !== "blocked" && !(riskLevel === "low" && userContext.allowAutoApproval),
      requiresHigherPrivilege: riskLevel === "high" && !userContext.roles.includes("admin"),
      recommendedMaxRows: Math.min(request.maxRows ?? config.defaultMaxRows, config.hardMaxRows),
      recommendedTimeoutMs: Math.min(request.timeoutMs ?? config.defaultTimeoutMs, config.hardTimeoutMs),
      recommendedResultMode:
        riskLevel === "blocked"
          ? "blocked"
          : request.expectedResultUse === "python_analysis"
            ? "python_payload"
            : safetyCheck.hasAggregation
              ? "aggregated_result"
              : riskLevel === "high"
                ? "summary_only"
                : "limited_rows",
    };
  }
}
