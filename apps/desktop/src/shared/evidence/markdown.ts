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
