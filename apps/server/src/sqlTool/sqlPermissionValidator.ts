import type { SqlPermissionCheckResult, SqlPermissionIssue, SqlPermissionProvider, SqlUserPermissionContext } from "./types.js";
import type { RequestSqlQueryExecutionInput, SqlSafetyCheckResult } from "./types.js";

export class DefaultSqlPermissionValidator implements SqlPermissionProvider {
  check({
    dataSourceId,
    tables,
    columns,
    safetyCheck,
    request,
    userContext,
  }: {
    dataSourceId: string;
    tables: string[];
    columns: string[];
    safetyCheck: SqlSafetyCheckResult;
    request: RequestSqlQueryExecutionInput;
    userContext: SqlUserPermissionContext;
  }): SqlPermissionCheckResult {
    const reasons: SqlPermissionIssue[] = [];
    const dsPermission = userContext.dataSourcePermissions.find((permission) => permission.dataSourceId === dataSourceId);
    const allowedDataSource = Boolean(dsPermission?.canRead);
    if (!allowedDataSource) {
      reasons.push(issue("DATASOURCE_DENIED", `用户无权访问数据源：${dataSourceId}`));
    }

    const allowedTables: string[] = [];
    const deniedTables: string[] = [];
    for (const table of tables) {
      const tablePermission = userContext.tablePermissions?.find((permission) => permission.dataSourceId === dataSourceId && permission.tableName === table);
      const canRead = tablePermission ? tablePermission.canRead : allowedDataSource;
      if (canRead) {
        allowedTables.push(table);
      } else {
        deniedTables.push(table);
        reasons.push(issue("TABLE_DENIED", `用户无权访问表：${table}`));
      }
      if (tablePermission?.isLarge && !userContext.allowLargeTableQuery) {
        reasons.push(issue("LARGE_TABLE_DENIED", `大表查询未授权：${table}`));
      }
    }

    const wildcard = columns.includes("*");
    const allowedColumns: string[] = [];
    const deniedColumns: string[] = [];
    const sensitiveColumns: string[] = [];
    for (const column of columns) {
      if (column === "*") {
        if (userContext.columnPermissions?.some((permission) => permission.canRead === false || permission.sensitive)) {
          deniedColumns.push("*");
          reasons.push(issue("COLUMN_DENIED", "不允许使用 SELECT *，请显式列出授权字段。"));
        } else {
          allowedColumns.push("*");
        }
        continue;
      }
      const columnPermission = userContext.columnPermissions?.find((permission) => permission.dataSourceId === dataSourceId && permission.columnName === column);
      const canRead = columnPermission ? columnPermission.canRead : !wildcard && allowedDataSource;
      if (canRead) {
        allowedColumns.push(column);
      } else {
        deniedColumns.push(column);
        reasons.push(issue("COLUMN_DENIED", `用户无权访问字段：${column}`));
      }
      if (columnPermission?.sensitive) {
        sensitiveColumns.push(column);
        if (!userContext.allowSensitiveFields) {
          reasons.push(issue("SENSITIVE_FIELD_DENIED", `敏感字段需要脱敏或更高权限：${column}`));
        }
      }
    }

    if (safetyCheck.hasJoin && !userContext.allowJoinQuery) {
      reasons.push(issue("JOIN_DENIED", "用户无权发起 JOIN 查询。"));
    }
    if (safetyCheck.hasAggregation && !userContext.allowAggregationQuery) {
      reasons.push(issue("AGGREGATION_DENIED", "用户无权发起聚合查询。"));
    }
    if ((request.expectedResultUse === "python_analysis" || request.resultConsumer === "python_tool") && !userContext.allowPythonAnalysisPayload) {
      reasons.push(issue("PYTHON_PAYLOAD_DENIED", "用户无权将 SQL 结果传递给 Python 分析工具。"));
    }

    return {
      passed: reasons.every((item) => item.severity !== "error"),
      reasons,
      allowedDataSource,
      allowedTables,
      deniedTables,
      allowedColumns,
      deniedColumns,
      sensitiveColumns,
      requiresMasking: sensitiveColumns.length > 0,
      requiresApproval: userContext.approvalPolicy?.requireApprovalByDefault ?? true,
    };
  }
}

function issue(code: SqlPermissionIssue["code"], message: string): SqlPermissionIssue {
  return { code, message, severity: "error" };
}
