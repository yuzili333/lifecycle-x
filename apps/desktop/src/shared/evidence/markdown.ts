import type { EvidenceCard } from "./types";

export type ReportEvidenceMarkdownSegment =
  | { type: "markdown"; key: string; markdown: string }
  | { type: "evidence"; key: string; evidenceCardId?: string; sectionNumber?: string; errorCode?: "EVIDENCE_NODE_INVALID" };

const EVIDENCE_NODE = /<evidence-card\b([\s\S]*?)\/?>/gi;
const SAFE_EVIDENCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,239}$/;

export function evidenceCardMarkdownNode(evidenceCardId: string, heading = "## 溯据卡") {
  if (!SAFE_EVIDENCE_ID.test(evidenceCardId) || evidenceCardId.includes("..")) {
    throw new Error("EvidenceCard ID 不合法。");
  }
  return `${heading}\n\n<evidence-card evidenceCardId="${evidenceCardId}"/>`;
}

export function appendEvidenceCardToReport(markdown: string, evidenceCardId: string) {
  const withoutExisting = markdown.replace(EVIDENCE_NODE, "").replace(/\n{3,}/g, "\n\n").trim();
  const evidenceHeading = withoutExisting.match(/^#{1,6}\s+.*溯据卡.*$/m);
  if (evidenceHeading?.index !== undefined) {
    const insertAt = evidenceHeading.index + evidenceHeading[0].length;
    return normalizeReportEvidenceHeading(
      `${withoutExisting.slice(0, insertAt)}\n\n<evidence-card evidenceCardId="${evidenceCardId}"/>${withoutExisting.slice(insertAt)}`.replace(/\n{3,}/g, "\n\n").trim(),
    );
  }
  const limitationHeading = findHeadingOffset(withoutExisting, /数据限制|使用边界|局限/);
  const node = evidenceCardMarkdownNode(evidenceCardId);
  if (limitationHeading < 0) {
    return normalizeReportEvidenceHeading(`${withoutExisting}\n\n${node}`);
  }
  return normalizeReportEvidenceHeading(
    `${withoutExisting.slice(0, limitationHeading).trimEnd()}\n\n${node}\n\n${withoutExisting.slice(limitationHeading)}`.trim(),
  );
}

export function parseReportEvidenceNodes(markdown: string, reportVersion = 1): ReportEvidenceMarkdownSegment[] {
  const normalizedMarkdown = normalizeReportEvidenceHeading(markdown);
  const segments: ReportEvidenceMarkdownSegment[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of normalizedMarkdown.matchAll(EVIDENCE_NODE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ type: "markdown", key: `report-evidence-markdown:${reportVersion}:${index}`, markdown: normalizedMarkdown.slice(cursor, start) });
      index += 1;
    }
    const id = attributeValue(match[1] ?? "", "evidenceCardId");
    const valid = Boolean(id && SAFE_EVIDENCE_ID.test(id) && !id.includes(".."));
    const sectionNumber = evidenceSectionNumber(normalizedMarkdown.slice(0, start));
    segments.push(valid
      ? { type: "evidence", key: `report-evidence:${id}:v${reportVersion}`, evidenceCardId: id, sectionNumber }
      : { type: "evidence", key: `report-evidence-invalid:${index}:v${reportVersion}`, sectionNumber, errorCode: "EVIDENCE_NODE_INVALID" });
    cursor = start + match[0].length;
  }
  if (cursor < normalizedMarkdown.length || segments.length === 0) {
    segments.push({ type: "markdown", key: `report-evidence-markdown:${reportVersion}:${index}`, markdown: normalizedMarkdown.slice(cursor) });
  }
  return segments;
}

export function normalizeReportEvidenceHeading(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  return lines.map((line, index) => {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!heading || !/溯据卡/.test(heading[2])) return line;
    if (headingSectionNumber(heading[2])) return line;
    const level = heading[1].length;
    const preceding = lines.slice(0, index + 1)
      .map((candidate) => candidate.match(new RegExp(`^#{${level}}\\s+(.+?)\\s*$`)))
      .filter((candidate): candidate is RegExpMatchArray => Boolean(candidate));
    const ordinal = preceding.length;
    const usesChineseNumbering = preceding.slice(0, -1).some((candidate) => /^[一二三四五六七八九十百]+、/.test(candidate[1]));
    const prefix = usesChineseNumbering ? `${toChineseOrdinal(ordinal)}、` : `${ordinal}. `;
    return `${heading[1]} ${prefix}溯据卡`;
  }).join("\n");
}

export function reportEvidenceCardIds(markdown: string) {
  return Array.from(new Set(parseReportEvidenceNodes(markdown)
    .filter((segment): segment is Extract<ReportEvidenceMarkdownSegment, { type: "evidence" }> => segment.type === "evidence")
    .map((segment) => segment.evidenceCardId)
    .filter((value): value is string => Boolean(value))));
}

export function evidenceCardMarkdown(card: EvidenceCard, sectionNumber?: string) {
  const heading = (index: number, title: string) => `### ${sectionNumber ? `${sectionNumber}.${index}` : index} ${title}`;
  const executionSectionNumber = sectionNumber ? `${sectionNumber}.5` : "5";
  const sections: string[] = [
    "> 溯据卡用于证明分析过程，不构成授信审批、风险分类调整或风险处置决定。",
    markdownDataSources(card, heading(1, "数据来源")),
    markdownAnalysisScope(card, heading(2, "分析范围")),
    markdownFilters(card, heading(3, "筛选条件")),
    markdownFormulas(card, heading(4, "统计公式")),
    markdownExecutions(card, heading(5, "工具执行记录"), executionSectionNumber),
    markdownArtifactsAndLineage(card, heading(6, "Artifact 与数据血缘")),
    markdownValidation(card, heading(7, "结论边界与完整性")),
  ];
  return sections.filter(Boolean).join("\n\n");
}

function markdownDataSources(card: EvidenceCard, heading: string) {
  if (!card.dataSources.length) {
    return markdownMissingSection(heading, "未找到可验证的数据来源记录。");
  }
  return [
    heading,
    "",
    "| 数据源 | 类型 | 数据表 | 数据规模 | 访问方式 |",
    "|---|---|---|---:|---|",
    ...card.dataSources.map((source) => [
      source.displayName,
      dataSourceTypeLabel(source.type),
      source.tableNames.join("、") || "未登记",
      [
        source.rowCount !== undefined ? `${source.rowCount} 行` : "",
        source.fieldCount !== undefined ? `${source.fieldCount} 个字段` : "",
      ].filter(Boolean).join(" / ") || "未登记",
      source.accessMode === "read_only" ? "只读访问" : "仅 Artifact",
    ].map(markdownCell).join(" | ")).map((row) => `| ${row} |`),
  ].join("\n");
}

function markdownAnalysisScope(card: EvidenceCard, heading: string) {
  return [
    heading,
    "",
    "| 项目 | 内容 |",
    "|---|---|",
    markdownTableRow("分析表", card.analysisScope.tables.map((table) => table.displayName).join("、") || "未登记"),
    markdownTableRow(
      "使用字段",
      card.analysisScope.selectedFields.map((field) => `${field.displayName}（${fieldRoleLabel(field.role)}）`).join("、") || "未登记",
    ),
    ...(card.analysisScope.timeRange
      ? [markdownTableRow("时间范围", `${card.analysisScope.timeRange.start ?? "未限定"} 至 ${card.analysisScope.timeRange.end ?? "未限定"}`)]
      : []),
  ].join("\n");
}

function markdownFilters(card: EvidenceCard, heading: string) {
  if (!card.filters.length) {
    return markdownMissingSection(heading, "本次证据链未登记可展示的筛选条件。");
  }
  return [
    heading,
    "",
    "| 字段 | 运算符 | 条件值 | 来源 |",
    "|---|---|---|---|",
    ...card.filters.map((filter) => `| ${[
      filter.fieldDisplayName,
      operatorLabel(filter.operator),
      filter.displayValue,
      filterSourceLabel(filter.source),
    ].map(markdownCell).join(" | ")} |`),
  ].join("\n");
}

function markdownFormulas(card: EvidenceCard, heading: string) {
  if (!card.formulas.length) {
    return markdownMissingSection(heading, "未找到可追溯到 SQL 或 Python 的统计公式。");
  }
  return [
    heading,
    "",
    "| 指标 | 计算表达式 | 聚合方式 | 验证状态 |",
    "|---|---|---|---|",
    ...card.formulas.map((formula) => `| ${[
      formula.metricDisplayName,
      formula.expression,
      aggregationLabel(formula.aggregation),
      verificationLabel(formula.verificationStatus),
    ].map(markdownCell).join(" | ")} |`),
  ].join("\n");
}

function markdownExecutions(card: EvidenceCard, heading: string, sectionNumber: string) {
  const lines = [heading];
  let executionIndex = 1;
  if (!card.sqlExecutions.length && !card.pythonExecutions.length) {
    return [...lines, "", "> 缺失证据：未找到 SQL/Python 执行记录。"].join("\n");
  }
  card.sqlExecutions.forEach((execution, index) => {
    lines.push(
      "",
      `#### ${sectionNumber}.${executionIndex++} SQL 查询 ${index + 1}`,
      "",
      "| 项目 | 内容 |",
      "|---|---|",
      markdownTableRow("执行状态", executionStatusLabel(execution.status)),
      markdownTableRow("查询目的", execution.purpose),
      markdownTableRow("数据表", execution.tableNames.join("、") || "未登记"),
      markdownTableRow("返回结果", `${execution.resultSummary?.rowCount ?? "未知"} 行 / ${execution.resultSummary?.fieldCount ?? "未知"} 个字段`),
      markdownTableRow("执行耗时", formatDuration(execution.durationMs)),
      markdownTableRow("审批状态", approvalLabel(execution.approval)),
      markdownTableRow("SQL Hash", execution.sqlHash.slice(0, 16)),
    );
  });
  card.pythonExecutions.forEach((execution, index) => {
    lines.push(
      "",
      `#### ${sectionNumber}.${executionIndex++} Python 分析 ${index + 1}`,
      "",
      "| 项目 | 内容 |",
      "|---|---|",
      markdownTableRow("执行状态", executionStatusLabel(execution.status)),
      markdownTableRow("分析目的", execution.purpose),
      markdownTableRow("输入字段", execution.inputFields.join("、") || "未登记"),
      markdownTableRow("输出指标", execution.outputMetrics.join("、") || "未登记"),
      markdownTableRow("执行耗时", formatDuration(execution.durationMs)),
      markdownTableRow("审批状态", approvalLabel(execution.approval)),
      markdownTableRow("脚本 Hash", execution.scriptHash.slice(0, 16)),
    );
  });
  return lines.join("\n");
}

function markdownArtifactsAndLineage(card: EvidenceCard, heading: string) {
  const artifactRows = [
    ...card.upstreamArtifacts.map((artifact) => ({ artifact, relation: "上游" })),
    ...card.downstreamArtifacts.map((artifact) => ({ artifact, relation: "当前/下游" })),
  ].sort((left, right) => {
    const leftCreatedAt = artifactCreatedAt(left.artifact.createdAt);
    const rightCreatedAt = artifactCreatedAt(right.artifact.createdAt);
    if (leftCreatedAt !== undefined && rightCreatedAt !== undefined && leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }
    return artifactOrder(left.artifact.type) - artifactOrder(right.artifact.type);
  });
  return [
    heading,
    "",
    "| Artifact | 关系 | 类型 | 版本 | 状态 |",
    "|---|---|---|---:|---|",
    ...(artifactRows.length
      ? artifactRows.map(({ artifact, relation }) => `| ${[
          artifact.title ?? artifactTypeLabel(artifact.type),
          relation,
          artifactTypeLabel(artifact.type),
          artifact.version !== undefined ? `v${artifact.version}` : "未登记",
          executionStatusLabel(artifact.status),
        ].map(markdownCell).join(" | ")} |`)
      : ["| 未登记 | - | - | - | 缺失 |"]),
  ].join("\n");
}

function markdownValidation(card: EvidenceCard, heading: string) {
  return [
    heading,
    "",
    "| 层级 | 使用边界 |",
    "|---|---|",
    markdownTableRow("数据事实", "仅来自已登记 SQL、Python 与 Artifact 的实际执行结果。"),
    markdownTableRow("统计解释", "报告可对实际结果进行统计解释，但不得改变原始工具结果。"),
    markdownTableRow("风险判断", "仅作为分析提示，不替代授信审批、风险分类调整或风险处置决定。"),
    "",
    "**完整性校验**",
    "",
    "| 校验项 | 状态 | 说明 |",
    "|---|---|---|",
    ...card.validation.checks.map((check) => `| ${[
      check.label,
      validationStatusLabel(check.status),
      check.message ?? "",
    ].map(markdownCell).join(" | ")} |`),
    ...(card.limitations.length
      ? ["", "**数据限制**", "", ...card.limitations.map((limitation) => `- ${markdownInline(limitation.message)}`)]
      : []),
  ].join("\n");
}

function markdownMissingSection(heading: string, message: string) {
  return [heading, "", `> 缺失证据：${escapeBlockquote(message)}`].join("\n");
}

function markdownTableRow(label: string, value: string) {
  return `| ${markdownCell(label)} | ${markdownCell(value)} |`;
}

function markdownCell(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function markdownInline(value: string) {
  return value.replace(/\r?\n/g, " ").trim();
}

function escapeBlockquote(value: string) {
  return value.replace(/\r?\n/g, "\n> ");
}

function dataSourceTypeLabel(type: EvidenceCard["dataSources"][number]["type"]) {
  return ({ database: "数据库", standard_csv: "标准 CSV", conversation_csv: "会话 CSV", derived_dataset: "派生数据集" })[type];
}

function fieldRoleLabel(role: EvidenceCard["analysisScope"]["selectedFields"][number]["role"]) {
  return ({ dimension: "维度", measure: "指标", identifier: "标识", filter: "筛选", time: "时间", other: "其他" })[role];
}

function operatorLabel(operator: EvidenceCard["filters"][number]["operator"]) {
  return ({ eq: "等于", neq: "不等于", gt: "大于", gte: "大于等于", lt: "小于", lte: "小于等于", in: "属于", not_in: "不属于", between: "介于", like: "匹配", is_null: "为空", is_not_null: "非空", custom: "自定义" })[operator];
}

function filterSourceLabel(source: EvidenceCard["filters"][number]["source"]) {
  return ({ user: "用户", skill: "Skill", workflow: "工作流", system: "系统" })[source];
}

function verificationLabel(status: EvidenceCard["formulas"][number]["verificationStatus"]) {
  return status === "verified" ? "已验证" : status === "partially_verified" ? "部分验证" : "未验证";
}

function aggregationLabel(aggregation: EvidenceCard["formulas"][number]["aggregation"]) {
  return ({ count: "计数", distinct_count: "去重计数", sum: "求和", avg: "平均值", median: "中位数", min: "最小值", max: "最大值", ratio: "占比", custom: "自定义" })[aggregation];
}

function artifactTypeLabel(type: EvidenceCard["upstreamArtifacts"][number]["type"]) {
  return ({ sql_dataset: "SQL 数据集", python_analysis: "Python 分析", visualization: "可视化", markdown_report: "Markdown 报告", table: "数据表", file: "文件", other: "其他" })[type];
}

function artifactOrder(type: EvidenceCard["upstreamArtifacts"][number]["type"]) {
  return ({ sql_dataset: 0, table: 0, python_analysis: 1, visualization: 2, markdown_report: 3, file: 4, other: 5 })[type];
}

function artifactCreatedAt(createdAt?: string) {
  const timestamp = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function executionStatusLabel(status: string) {
  return ({ completed: "已完成", failed: "失败", cancelled: "已取消", rejected: "已拒绝", ready: "可用", expired: "已失效", deleted: "已删除", blocked: "已阻断" } as Record<string, string>)[status] ?? status;
}

function validationStatusLabel(status: EvidenceCard["validation"]["checks"][number]["status"]) {
  return status === "passed" ? "通过" : status === "warning" ? "警告" : "失败";
}

function approvalLabel(approval?: { required: boolean; status: "approved" | "rejected" | "not_required" }) {
  if (!approval || !approval.required || approval.status === "not_required") return "无需审批";
  return approval.status === "approved" ? "已批准" : "已拒绝";
}

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) return "耗时未知";
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function attributeValue(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`, "i"));
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

function findHeadingOffset(markdown: string, title: RegExp) {
  const match = markdown.match(new RegExp(`^#{1,6}\\s+.*(?:${title.source}).*$`, "m"));
  return match?.index ?? -1;
}

function evidenceSectionNumber(markdownBeforeNode: string) {
  const headings = [...markdownBeforeNode.matchAll(/^#{1,6}\s+(.+?溯据卡.*?)\s*$/gm)];
  const title = headings.at(-1)?.[1];
  return title ? headingSectionNumber(title) : undefined;
}

function headingSectionNumber(title: string) {
  const arabic = title.match(/^(\d+)(?:[.、．]|\s)/);
  if (arabic) return arabic[1];
  const chinese = title.match(/^([一二三四五六七八九十百]+)、?/);
  return chinese ? String(fromChineseOrdinal(chinese[1])) : undefined;
}

function toChineseOrdinal(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 10) return value === 10 ? "十" : digits[value];
  if (value < 20) return `十${digits[value % 10]}`;
  if (value < 100) return `${digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ""}`;
  return String(value);
}

function fromChineseOrdinal(value: string) {
  const digit = new Map([["零", 0], ["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9]]);
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (tens ? digit.get(tens) ?? 0 : 1) * 10 + (ones ? digit.get(ones) ?? 0 : 0);
  }
  return digit.get(value) ?? 0;
}
