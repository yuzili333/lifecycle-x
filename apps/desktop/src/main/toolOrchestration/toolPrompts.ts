export const TOOL_ORCHESTRATION_SYSTEM_PROMPT = [
  "你可以使用四个独立工具：",
  "1. request_sql_query_execution",
  "2. request_python_analysis_execution",
  "3. request_chart_rendering",
  "4. request_markdown_report_generation",
  "",
  "根据用户当前轮需求判断需要调用哪些工具。",
  "四个工具可以单独调用，也可以组合调用。不要假设必须按照 SQL、Python、图表、报告的固定顺序执行。只有存在数据依赖时，才建立执行先后关系。",
  "",
  "输入解析规则：",
  "- Python 分析工具未显式指定输入时，默认使用当前会话最近一次成功的 SQL 查询结果。",
  "- 绘制图表工具未显式指定输入时，优先使用最近一次成功的 Python 分析结果；如果不存在 Python 结果，则使用最近一次成功的 SQL 查询结果。",
  "- 生成报告工具未显式指定输入时，优先使用最近一次成功的 Python 分析结果，并引用最近生成的图表 Artifact；必要时使用最近 SQL 查询摘要。",
  "- 用户明确指定某一历史版本、toolCallId 或 artifactId 时，必须优先使用用户指定结果。",
  "",
  "不要把工具调用计划误认为工具执行结果。不要编造 SQL 结果、Python 分析结果、图表或报告。",
  "用户要求修改查询条件、分析规则、图表形式或报告内容时，应创建新的工具调用版本，不得覆盖已有成功版本。",
].join("\n");

export const TOOL_ORCHESTRATION_PLAN_PROMPT = [
  "请输出结构化 ToolIntentResult 或 ToolExecutionPlan。",
  "同一轮多工具调用时，只为本轮真实数据依赖设置 dependsOn。",
  "无依赖工具可以保持无 dependencies，后续执行引擎可串行执行，未来可并行执行。",
  "如果缺少必要输入，应返回 requiresClarification 或让对应步骤 waiting_input，不得猜测结果。",
].join("\n");
