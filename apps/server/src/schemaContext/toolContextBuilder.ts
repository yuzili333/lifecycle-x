import type { ToolHandle } from "./types.js";
import { REQUEST_PYTHON_ANALYSIS_EXECUTION_INPUT_SCHEMA } from "../pythonRunner/index.js";
import { REQUEST_SQL_QUERY_EXECUTION_INPUT_SCHEMA } from "../sqlTool/index.js";

export class ToolContextBuilder {
  buildToolHandles(): ToolHandle[] {
    return [
      {
        toolName: "get_data_source_profile",
        description: "获取授权数据源的结构画像、字段摘要、行列数、缺失率、样例数据和安全策略。",
        inputSchema: {
          type: "object",
          properties: {
            dataSourceId: { type: "string" },
            tableName: { type: "string" },
          },
          required: ["dataSourceId"],
        },
        outputDescription: "返回结构化 DataSourceProfile，不包含数据库凭据或完整原始数据。",
        riskLevel: "low",
        requiresUserApproval: false,
        useCases: ["理解数据源结构", "查找可用表字段", "判断是否需要进一步查询"],
        forbiddenUseCases: ["获取完整表数据", "绕过权限读取敏感字段"],
      },
      {
        toolName: "request_sql_query_execution",
        description: "创建受控只读 SQL 查询执行请求；SQL 不会立即执行，必须经过安全校验、权限校验、风险评估和用户审批。",
        inputSchema: REQUEST_SQL_QUERY_EXECUTION_INPUT_SCHEMA,
        outputDescription: "返回 SQL 执行请求、审批状态、风险评估、安全校验、权限校验和执行结果摘要。",
        riskLevel: "high",
        requiresUserApproval: true,
        useCases: ["精确筛选", "聚合统计", "排序 Top N", "多表关联", "缺失值统计"],
        forbiddenUseCases: ["DDL/DML", "导出生产库全量数据", "访问无权限表字段"],
      },
      {
        toolName: "request_python_analysis_execution",
        description: "创建受控 Python 数据分析执行请求；脚本不会立即执行，必须经过安全校验、权限校验、风险评估和用户审批后在受限沙箱中运行。",
        inputSchema: REQUEST_PYTHON_ANALYSIS_EXECUTION_INPUT_SCHEMA,
        outputDescription: "返回 Python 执行请求、审批状态、安全校验、权限校验、风险评估、stdout/stderr 摘要、artifact metadata 和安全 payload。",
        riskLevel: "high",
        requiresUserApproval: true,
        useCases: ["相关性分析", "异常值检测", "趋势分析", "统计建模"],
        forbiddenUseCases: ["访问未授权路径", "网络访问", "执行系统命令", "数据库直连"],
      },
      {
        toolName: "generate_chart",
        description: "基于查询或分析结果生成图表配置，禁止基于 preview rows 猜测全量趋势。",
        inputSchema: {
          type: "object",
          properties: {
            chartType: { type: "string" },
            datasetRef: { type: "string" },
            xField: { type: "string" },
            yField: { type: "string" },
            reason: { type: "string" },
          },
          required: ["chartType", "datasetRef", "reason"],
        },
        outputDescription: "返回前端可渲染的图表配置或 Python 绘图任务引用。",
        riskLevel: "medium",
        requiresUserApproval: false,
        useCases: ["趋势展示", "分布可视化", "风险对比"],
        forbiddenUseCases: ["基于少量样例行生成全量统计图"],
      },
    ];
  }
}
