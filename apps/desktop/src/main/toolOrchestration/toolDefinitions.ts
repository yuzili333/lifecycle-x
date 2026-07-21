import type { ToolDefinition } from "../streamingModelAdapter";
import type { ToolExecutionEngine } from "./engine";
import type { ToolKind } from "./types";
import { TOOL_NAMES, TOOL_SCHEMAS } from "./types";

export function createOrchestrationToolDefinitions(input: {
  engine: ToolExecutionEngine;
  conversationId: string;
  userId: string;
  userMessage: string;
}): ToolDefinition[] {
  return (Object.entries(TOOL_NAMES) as Array<[ToolKind, string]>).map(([toolKind, name]) => ({
    name,
    description: toolDescription(toolKind),
    inputSchema: TOOL_SCHEMAS[toolKind],
    riskLevel: riskLevel(toolKind),
    handler: async (request) =>
      input.engine.executeSingleTool({
        conversationId: input.conversationId,
        userId: input.userId,
        userMessage: input.userMessage,
        toolKind,
        request: request as Record<string, unknown>,
      }),
  }));
}

function toolDescription(toolKind: ToolKind) {
  if (toolKind === "sql_query") {
    return "用途：从已授权数据源执行只读查询、筛选、字段选择、分组、聚合和排序。输出 SQL 结果 Artifact、行列统计和数据集 Schema。规则：只读、需要审批、不使用模拟数据、不把完整结果直接注入模型；无筛选条件的兜底查询表示查询活动表完整数据范围，大结果通过 Artifact 物化。";
  }
  if (toolKind === "python_analysis") {
    return "用途：对已有 SQL 查询结果执行统计、分布、趋势、相关性、异常检测或其他分析。必要输入是 SQL 数据集 Artifact 或具有 SQL 数据血缘的分析数据集。规则：不直接连接业务数据库，不使用模拟数据，字段必须来自输入数据集，输出分析 Artifact 供图表和报告使用。";
  }
  if (toolKind === "chart_rendering") {
    return [
      "用途：将 SQL 查询结果或 Python 分析结果转换为可交互数据可视化。",
      "触发规则：用户明确要求绘图、画图、图表、可视化、分布图、趋势图、比率图、占比图、排名图或具体图表类型时，必须调用本工具。",
      "输入：SQL 或 Python Artifact、图表目标、维度、指标和可选图表类型；横向条形图使用 horizontal_bar。",
      "输出：受控 VisualizationSpec、图表 Artifact、标题和摘要。",
      "规则：不输出完整 ECharts option，不用 Markdown 表格代替图表，图表 Artifact 可以被报告工具引用。",
    ].join(" ");
  }
  return "用途：基于真实 SQL、Python 和图表 Artifact 生成 Markdown 报告。输入包括 SQL Artifact、可选 Python Artifact、可选图表 Artifact、报告目标和结构要求。规则：不编造数据；用户同时要求图表和报告时，必须把 visualizationArtifactIds 嵌入报告正文；不重新计算上游指标，不重新生成已有图表，输出 Markdown Artifact 和报告卡片。";
}

function riskLevel(toolKind: ToolKind): ToolDefinition["riskLevel"] {
  if (toolKind === "sql_query" || toolKind === "python_analysis") {
    return "high";
  }
  if (toolKind === "chart_rendering") {
    return "medium";
  }
  return "low";
}
