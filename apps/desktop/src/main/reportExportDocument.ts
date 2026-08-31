import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
  type FileChild,
  type ParagraphChild,
} from "docx";
import { parseMarkdown, type BlockNode, type InlineNode, type TableCellNode } from "@astryxdesign/core/Markdown";
import type { ReportExportVisualizationImage } from "../shared/reportExport";

const BODY_SIZE = 20;
const HEADING_SIZE = 28;
const DOCX_CONTENT_WIDTH_PX = 640;
const DOCX_CONTENT_WIDTH_TWIPS = convertMillimetersToTwip(170);
const REPORT_DOCUMENT_FONT = reportDocumentFont();

export function reportDocumentFont(platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") {
    return {
      ascii: "Segoe UI",
      hAnsi: "Segoe UI",
      eastAsia: "Microsoft YaHei UI",
      cs: "Segoe UI",
    };
  }
  if (platform === "darwin") {
    return {
      ascii: "Helvetica Neue",
      hAnsi: "Helvetica Neue",
      eastAsia: "PingFang SC",
      cs: "Helvetica Neue",
    };
  }
  return {
    ascii: "Arial",
    hAnsi: "Arial",
    eastAsia: "Noto Sans CJK SC",
    cs: "Arial",
  };
}

export type ExportDocumentModel = {
  markdown: string;
  images: Map<string, ReportExportVisualizationImage>;
};

export function renderReportHtml(model: ExportDocumentModel) {
  const blocks = parseMarkdown(model.markdown, { autolink: "gfm" });
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 22mm 20mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
    font-size: 10pt;
    line-height: 1.65;
    overflow-wrap: anywhere;
  }
  h1, h2, h3, h4, h5, h6 {
    margin: 1.15em 0 .55em;
    font-size: 14pt;
    line-height: 1.4;
    font-weight: 700;
    break-after: avoid;
  }
  h1 { text-align: center; margin-top: 0; }
  p { margin: .45em 0; white-space: normal; }
  ul, ol { margin: .45em 0; padding-left: 2em; }
  li { margin: .15em 0; }
  blockquote {
    margin: .6em 0;
    padding: .2em 0 .2em 1em;
    border-left: 2pt solid #a8a8a8;
    color: #333;
  }
  code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 9pt; }
  pre {
    margin: .65em 0;
    padding: .7em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: #f5f5f5;
    border: .5pt solid #d4d4d4;
    break-inside: avoid;
  }
  table {
    width: 100%;
    margin: .7em 0;
    border-collapse: collapse;
    table-layout: fixed;
    break-inside: auto;
  }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td {
    padding: 5pt 6pt;
    border: .5pt solid #777;
    vertical-align: top;
    text-align: left;
    overflow-wrap: anywhere;
  }
  th { font-weight: 700; background: #f2f2f2; }
  .report-chart {
    margin: 10pt 0 12pt;
    text-align: center;
    break-inside: avoid;
  }
  .report-chart img { display: inline-block; max-width: 100%; height: auto; }
  .report-chart figcaption { margin-top: 4pt; font-weight: 700; }
  hr { border: 0; border-top: .5pt solid #999; margin: 1em 0; }
</style>
</head>
<body>${blocks.map((block) => htmlBlock(block, model.images)).join("")}</body>
</html>`;
}

export async function renderReportDocx(model: ExportDocumentModel) {
  const blocks = parseMarkdown(model.markdown, { autolink: "gfm" });
  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: REPORT_DOCUMENT_FONT, size: BODY_SIZE, sizeComplexScript: BODY_SIZE },
          paragraph: { spacing: { line: 330, after: 100 } },
        },
        heading1: headingStyle(),
        heading2: headingStyle(),
        heading3: headingStyle(),
        heading4: headingStyle(),
        heading5: headingStyle(),
        heading6: headingStyle(),
        strong: { run: { bold: true, font: REPORT_DOCUMENT_FONT, size: BODY_SIZE } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
          margin: {
            top: convertMillimetersToTwip(22),
            right: convertMillimetersToTwip(20),
            bottom: convertMillimetersToTwip(22),
            left: convertMillimetersToTwip(20),
          },
        },
      },
      children: blocks.flatMap((block) => docxBlock(block, model.images)),
    }],
  });
  return Packer.toBuffer(document);
}

function headingStyle() {
  return {
    run: { font: REPORT_DOCUMENT_FONT, size: HEADING_SIZE, sizeComplexScript: HEADING_SIZE, bold: true },
    paragraph: { spacing: { before: 220, after: 110 }, keepNext: true },
  };
}

function htmlBlock(block: BlockNode, images: Map<string, ReportExportVisualizationImage>): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level}>${htmlInline(block.children, images)}</h${block.level}>`;
    case "paragraph":
      return `<p>${htmlInline(block.children, images)}</p>`;
    case "codeblock":
      return `<pre><code>${escapeHtml(block.content)}</code></pre>`;
    case "blockquote":
      return `<blockquote>${block.children.map((child) => htmlBlock(child, images)).join("")}</blockquote>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const start = block.ordered && block.start && block.start !== 1 ? ` start="${block.start}"` : "";
      return `<${tag}${start}>${block.items.map((item) => `<li>${item.children.map((child) => htmlBlock(child, images)).join("")}</li>`).join("")}</${tag}>`;
    }
    case "table":
      return `<table><thead><tr>${block.headers.map((cell) => `<th>${htmlInline(cell.children, images)}</th>`).join("")}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${htmlInline(cell.children, images)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    case "hr":
      return "<hr>";
    case "image":
      return htmlImage(block.src, block.alt, images);
  }
}

function htmlInline(nodes: InlineNode[], images: Map<string, ReportExportVisualizationImage>): string {
  return nodes.map((node) => {
    switch (node.type) {
      case "text":
        return escapeHtml(node.content);
      case "bold":
        return `<strong>${htmlInline(node.children, images)}</strong>`;
      case "italic":
        return `<em>${htmlInline(node.children, images)}</em>`;
      case "strikethrough":
        return `<s>${htmlInline(node.children, images)}</s>`;
      case "code":
        return `<code>${escapeHtml(node.content)}</code>`;
      case "link": {
        const href = safeExternalHref(node.href);
        const content = htmlInline(node.children, images);
        return href ? `<a href="${escapeAttribute(href)}">${content}</a>` : content;
      }
      case "image":
        return htmlImage(node.src, node.alt, images);
      case "citation":
        return escapeHtml(`[${node.sourceId}]`);
      case "break":
        return "<br>";
    }
  }).join("");
}

function htmlImage(src: string, alt: string, images: Map<string, ReportExportVisualizationImage>) {
  const image = images.get(src);
  if (!image) return "";
  return `<figure class="report-chart"><img src="${escapeAttribute(image.dataUrl)}" width="${image.width}" height="${image.height}" alt="${escapeAttribute(alt)}">${alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : ""}</figure>`;
}

function docxBlock(
  block: BlockNode,
  images: Map<string, ReportExportVisualizationImage>,
  context: { quote?: boolean; listLevel?: number; orderedIndex?: number } = {},
): FileChild[] {
  switch (block.type) {
    case "heading":
      return [new Paragraph({
        children: inlineRuns(block.children),
        heading: (`Heading${block.level}`) as "Heading1",
        alignment: block.level === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
        keepNext: true,
      })];
    case "paragraph":
      return [paragraphFor(block.children, context)];
    case "codeblock":
      return [new Paragraph({
        children: [new TextRun({ text: block.content, font: "Consolas", size: 18 })],
        shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
        border: { top: thinBorder(), bottom: thinBorder(), left: thinBorder(), right: thinBorder() },
        spacing: { before: 100, after: 100 },
      })];
    case "blockquote":
      return block.children.flatMap((child) => docxBlock(child, images, { ...context, quote: true }));
    case "list":
      return block.items.flatMap((item, index) => item.children.flatMap((child, childIndex) => {
        const level = context.listLevel ?? 0;
        const marker = childIndex === 0
          ? block.ordered ? `${(block.start ?? 1) + index}. ` : "• "
          : "";
        if (child.type === "paragraph") {
          return [paragraphFor(child.children, {
            ...context,
            listLevel: level + 1,
          }, marker)];
        }
        return docxBlock(child, images, { ...context, listLevel: level + 1 });
      }));
    case "table":
      return [docxTable(block.headers, block.rows)];
    case "hr":
      return [new Paragraph({ border: { bottom: thinBorder() }, spacing: { before: 100, after: 100 } })];
    case "image": {
      const image = images.get(block.src);
      if (!image) return [];
      const size = scaledImageSize(image);
      return [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            type: "png",
            data: dataUrlBuffer(image.dataUrl),
            transformation: size,
            altText: { title: block.alt || "报告图表", description: block.alt || "报告图表", name: block.alt || "报告图表" },
          }),
        ],
        spacing: { before: 120, after: 120 },
      })];
    }
  }
}

function paragraphFor(children: InlineNode[], context: { quote?: boolean; listLevel?: number }, prefix = "") {
  const runs = inlineRuns(children);
  if (prefix) runs.unshift(new TextRun({ text: prefix, font: REPORT_DOCUMENT_FONT, size: BODY_SIZE }));
  return new Paragraph({
    children: runs,
    indent: {
      left: context.quote ? convertMillimetersToTwip(6) : context.listLevel ? convertMillimetersToTwip(context.listLevel * 5) : 0,
    },
    border: context.quote ? { left: { style: BorderStyle.SINGLE, color: "A8A8A8", size: 8, space: 6 } } : undefined,
  });
}

function inlineRuns(nodes: InlineNode[], style: { bold?: boolean; italics?: boolean; strike?: boolean } = {}): ParagraphChild[] {
  return nodes.flatMap((node): ParagraphChild[] => {
    switch (node.type) {
      case "text":
        return [textRun(node.content, style)];
      case "bold":
        return inlineRuns(node.children, { ...style, bold: true });
      case "italic":
        return inlineRuns(node.children, { ...style, italics: true });
      case "strikethrough":
        return inlineRuns(node.children, { ...style, strike: true });
      case "code":
        return [new TextRun({ text: node.content, font: "Consolas", size: 18, shading: { type: ShadingType.CLEAR, fill: "F2F2F2" } })];
      case "link":
        return inlineRuns(node.children, style);
      case "image":
        return [];
      case "citation":
        return [textRun(`[${node.sourceId}]`, style)];
      case "break":
        return [new TextRun({ break: 1 })];
    }
  });
}

function textRun(text: string, style: { bold?: boolean; italics?: boolean; strike?: boolean }) {
  return new TextRun({
    text,
    font: REPORT_DOCUMENT_FONT,
    size: BODY_SIZE,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
  });
}

function docxTable(headers: TableCellNode[], rows: TableCellNode[][]) {
  const columnCount = Math.max(1, headers.length, ...rows.map((cells) => cells.length));
  const columnWidths = calculateDocxColumnWidths(headers, rows, columnCount);
  const row = (cells: TableCellNode[], isHeader = false) => new TableRow({
    tableHeader: isHeader,
    cantSplit: true,
    children: Array.from({ length: columnCount }, (_, index) => cells[index] ?? { children: [] }).map((cell, index) => new TableCell({
      width: { size: columnWidths[index], type: WidthType.DXA },
      shading: isHeader ? { type: ShadingType.CLEAR, fill: "F2F2F2" } : undefined,
      children: [new Paragraph({ children: inlineRuns(cell.children, isHeader ? { bold: true } : {}) })],
    })),
  });
  return new Table({
    width: { size: DOCX_CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: thinBorder(),
      bottom: thinBorder(),
      left: thinBorder(),
      right: thinBorder(),
      insideHorizontal: thinBorder(),
      insideVertical: thinBorder(),
    },
    rows: [row(headers, true), ...rows.map((cells) => row(cells))],
  });
}

export function calculateDocxColumnWidths(
  headers: TableCellNode[],
  rows: TableCellNode[][],
  columnCount = Math.max(1, headers.length, ...rows.map((cells) => cells.length)),
) {
  const weights = Array.from({ length: columnCount }, (_, index) => {
    const cells = [headers[index], ...rows.map((row) => row[index])].filter((cell): cell is TableCellNode => Boolean(cell));
    const contentLength = Math.max(0, ...cells.map((cell) => inlineDisplayLength(cell.children)));
    return clampNumber(contentLength, 6, 48);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let allocated = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) {
      return DOCX_CONTENT_WIDTH_TWIPS - allocated;
    }
    const width = Math.max(1, Math.floor((DOCX_CONTENT_WIDTH_TWIPS * weight) / totalWeight));
    allocated += width;
    return width;
  });
}

function inlineDisplayLength(nodes: InlineNode[]): number {
  return nodes.reduce((length, node) => {
    switch (node.type) {
      case "text":
      case "code":
        return length + displayTextLength(node.content);
      case "bold":
      case "italic":
      case "strikethrough":
      case "link":
        return length + inlineDisplayLength(node.children);
      case "image":
        return length + displayTextLength(node.alt);
      case "citation":
        return length + displayTextLength(node.sourceId) + 2;
      case "break":
        return length + 1;
    }
  }, 0);
}

function displayTextLength(value: string) {
  return Array.from(value).reduce((length, character) => length + (/[\u2e80-\u9fff\uff00-\uffef]/.test(character) ? 2 : 1), 0);
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function thinBorder() {
  return { style: BorderStyle.SINGLE, color: "777777", size: 4 };
}

function scaledImageSize(image: ReportExportVisualizationImage) {
  const scale = Math.min(1, DOCX_CONTENT_WIDTH_PX / image.width);
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}

function dataUrlBuffer(dataUrl: string) {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

function safeExternalHref(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
