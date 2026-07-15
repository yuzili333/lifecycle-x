export function reportMarkdownStartIndex(content: string, title?: string) {
  const escapedTitle = title?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const titlePattern = escapedTitle ? new RegExp(`^\\s{0,3}#{1,6}\\s+${escapedTitle}\\s*$`, "im") : null;
  const titleMatch = titlePattern?.exec(content);
  if (typeof titleMatch?.index === "number") {
    return titleMatch.index;
  }
  const reportHeading = /^\s{0,3}#{1,6}\s+.*报告.*$/im.exec(content);
  if (typeof reportHeading?.index === "number") {
    return reportHeading.index;
  }
  const firstHeading = /^\s{0,3}#{1,6}\s+\S.*$/m.exec(content);
  return typeof firstHeading?.index === "number" ? firstHeading.index : 0;
}

export function isReportMarkdownContentBlock(content: string, title?: string) {
  const escapedTitle = title?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escapedTitle && new RegExp(`^\\s{0,3}#{1,6}\\s+${escapedTitle}\\s*$`, "im").test(content)) {
    return true;
  }
  if (!title && /^\s{0,3}#{1,6}\s+.*报告.*$/im.test(content)) {
    return true;
  }
  return false;
}

export function reportMarkdownContentIndex(contents: string[], title?: string) {
  const matchedIndex = contents.findIndex((content) => isReportMarkdownContentBlock(content, title));
  if (matchedIndex >= 0) {
    return matchedIndex;
  }
  return contents.findIndex((content) => content.trim().length > 0);
}

export function splitReportMarkdownContent(content: string, title?: string) {
  const reportStart = reportMarkdownStartIndex(content, title);
  return {
    preface: content.slice(0, reportStart).trim(),
    reportMarkdown: content.slice(reportStart).trim(),
  };
}
