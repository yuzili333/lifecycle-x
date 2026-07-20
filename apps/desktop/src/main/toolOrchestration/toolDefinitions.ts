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
    return "request_sql_query_execution 是受控只读 SQL 查询执行请求工具。SQL 必须经过安全校验、权限校验和用户审批，不得直接伪造查询结果。用户使用 #字段 时，必须优先使用本轮字段引用映射中的实际字段名，并用 SQLite 双引号引用。";
  }
  if (toolKind === "python_analysis") {
    return "request_python_analysis_execution 是受控 Python 数据分析工具。默认使用会话最新成功 SQL 结果作为输入，必须经过审批和沙箱执行。Python 分析应读取工具结果中的真实列名，不得根据原始 #字段 文本重新猜测字段。";
  }
  if (toolKind === "chart_rendering") {
    return "request_chart_rendering 是受控数据可视化工具。图表数据必须来自已授权 Artifact，只能描述 VisualizationSpec，不得输出任意 JavaScript 或渲染器配置。";
  }
  return "request_markdown_report_generation 是受控 Markdown 报告生成工具。报告必须引用 Artifact、工具结果摘要和字段引用映射，不得编造数据或自行扩展用户未要求字段，每次修改生成新版本。";
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
