import { validateVisualizationSpec } from "./validator";
import type { ParsedReportVisualizationNode, ReportMarkdownSegment } from "./types";

const VISUALIZATION_FENCE_LANGUAGES = new Set(["visualization", "visualization-json", "viz", "chart-spec"]);

export function stripReportMarkdownImages(markdown: string) {
  return stripMarkdownImageSyntax(
    markdown
      .replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gis, "")
      .replace(/&lt;img\b[\s\S]*?&gt;/gi, ""),
  );
}

export function parseReportMarkdownVisualizations(markdown: string, reportVersion = 1): ReportMarkdownSegment[] {
  const lines = splitLinesPreservingEndings(stripReportMarkdownImages(markdown));
  const segments: ReportMarkdownSegment[] = [];
  const seenArtifactIds = new Set<string>();
  let markdownBuffer = "";
  let markdownSegmentIndex = 0;
  let visualizationFence: { marker: "`" | "~"; markerLength: number; startLine: number; content: string } | null = null;
  let ordinaryFence: { marker: "`" | "~"; markerLength: number } | null = null;

  const flushMarkdown = () => {
    if (!markdownBuffer) {
      return;
    }
    segments.push({
      type: "markdown",
      key: `report-markdown:${reportVersion}:${markdownSegmentIndex}`,
      markdown: markdownBuffer,
    });
    markdownSegmentIndex += 1;
    markdownBuffer = "";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (ordinaryFence) {
      markdownBuffer += line;
      if (isFenceClosing(trimmed, ordinaryFence)) {
        ordinaryFence = null;
      }
      continue;
    }
    if (!visualizationFence) {
      const opening = parseFenceOpening(trimmed);
      if (opening && VISUALIZATION_FENCE_LANGUAGES.has(opening.language) && opening.infoIsLanguageOnly) {
        flushMarkdown();
        visualizationFence = {
          marker: opening.marker,
          markerLength: opening.markerLength,
          startLine: index + 1,
          content: "",
        };
      } else {
        markdownBuffer += line;
        if (opening) {
          ordinaryFence = { marker: opening.marker, markerLength: opening.markerLength };
        }
      }
      continue;
    }

    if (!isFenceClosing(trimmed, visualizationFence)) {
      visualizationFence.content += line;
      continue;
    }

    segments.push(parseVisualizationFence(visualizationFence.content, {
      reportVersion,
      startLine: visualizationFence.startLine,
      endLine: index + 1,
      seenArtifactIds,
    }));
    visualizationFence = null;
  }

  if (visualizationFence) {
    segments.push(invalidVisualizationNode(reportVersion, visualizationFence.startLine, lines.length));
  }
  flushMarkdown();
  return segments;
}

export function reportVisualizationArtifactIds(markdown: string) {
  return Array.from(new Set(
    parseReportMarkdownVisualizations(markdown)
      .filter((segment): segment is ParsedReportVisualizationNode => segment.type === "visualization")
      .map((segment) => segment.artifactId)
      .filter((artifactId): artifactId is string => Boolean(artifactId)),
  ));
}

function parseVisualizationFence(
  content: string,
  context: {
    reportVersion: number;
    startLine: number;
    endLine: number;
    seenArtifactIds: Set<string>;
  },
): ParsedReportVisualizationNode {
  try {
    const parsed = JSON.parse(content) as unknown;
    const validation = validateVisualizationSpec(parsed, {
      allowInlineData: false,
      inlineDataMaxRows: 0,
      inlineDataMaxBytes: 0,
    });
    if (!validation.success || validation.spec.data.mode !== "artifact") {
      return invalidVisualizationNode(context.reportVersion, context.startLine, context.endLine);
    }
    const metadataArtifactId = typeof validation.spec.metadata?.artifactId === "string"
      ? validation.spec.metadata.artifactId.trim()
      : "";
    const artifactId = metadataArtifactId || validation.spec.data.artifactId.trim();
    if (!isSafeArtifactId(artifactId) || context.seenArtifactIds.has(artifactId)) {
      return invalidVisualizationNode(context.reportVersion, context.startLine, context.endLine);
    }
    context.seenArtifactIds.add(artifactId);
    return {
      type: "visualization",
      nodeId: `report-viz:${artifactId}`,
      key: `report-viz:${artifactId}:v${context.reportVersion}`,
      artifactId,
      title: validation.spec.title,
      description: validation.spec.description,
      position: {
        startLine: context.startLine,
        endLine: context.endLine,
      },
    };
  } catch {
    return invalidVisualizationNode(context.reportVersion, context.startLine, context.endLine);
  }
}

function invalidVisualizationNode(reportVersion: number, startLine: number, endLine: number): ParsedReportVisualizationNode {
  return {
    type: "visualization",
    nodeId: `report-viz-invalid:${startLine}`,
    key: `report-viz-invalid:${startLine}:v${reportVersion}`,
    errorCode: "VISUALIZATION_NODE_INVALID",
    position: { startLine, endLine },
  };
}

function isSafeArtifactId(artifactId: string) {
  return artifactId.length > 0
    && artifactId.length <= 240
    && /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/.test(artifactId)
    && !artifactId.includes("..")
    && !artifactId.includes("/")
    && !artifactId.includes("\\");
}

function splitLinesPreservingEndings(value: string) {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function parseFenceOpening(value: string) {
  const match = value.match(/^(`{3,}|~{3,})(?:\s*([^\s]+))?(?:\s+(.*))?\s*$/);
  if (!match) {
    return null;
  }
  const marker = match[1][0] as "`" | "~";
  const language = (match[2] ?? "").toLowerCase();
  return {
    marker,
    markerLength: match[1].length,
    language,
    infoIsLanguageOnly: !match[3],
  };
}

function isFenceClosing(value: string, fence: { marker: "`" | "~"; markerLength: number }) {
  if (!value || value[0] !== fence.marker) {
    return false;
  }
  let markerLength = 0;
  while (value[markerLength] === fence.marker) {
    markerLength += 1;
  }
  return markerLength >= fence.markerLength && value.slice(markerLength).trim().length === 0;
}

function stripMarkdownImageSyntax(value: string) {
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const imageStart = value.indexOf("![", cursor);
    if (imageStart < 0) {
      output += value.slice(cursor);
      break;
    }
    output += value.slice(cursor, imageStart);
    const altEnd = findUnescaped(value, "]", imageStart + 2);
    if (altEnd < 0) {
      output += value.slice(imageStart);
      break;
    }
    const targetStart = altEnd + 1;
    if (value[targetStart] === "(") {
      const targetEnd = findBalancedParenthesisEnd(value, targetStart);
      if (targetEnd >= 0) {
        cursor = targetEnd + 1;
        continue;
      }
    } else if (value[targetStart] === "[") {
      const referenceEnd = findUnescaped(value, "]", targetStart + 1);
      if (referenceEnd >= 0) {
        cursor = referenceEnd + 1;
        continue;
      }
    }
    output += value.slice(imageStart, altEnd + 1);
    cursor = targetStart;
  }
  return output;
}

function findUnescaped(value: string, character: string, start: number) {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === character && value[index - 1] !== "\\") {
      return index;
    }
  }
  return -1;
}

function findBalancedParenthesisEnd(value: string, start: number) {
  let depth = 0;
  let quote: "'" | "\"" | null = null;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && index + 1 < value.length) {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}
