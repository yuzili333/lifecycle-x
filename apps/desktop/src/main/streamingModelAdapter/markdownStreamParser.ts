import type { MarkdownBlockType } from "./types";
import { createId } from "./utils";

export type MarkdownBlock = {
  blockId: string;
  type: MarkdownBlockType;
  content: string;
  raw: string;
  language?: string;
  complete: boolean;
};

export type MarkdownParserEvent =
  | { type: "start"; block: MarkdownBlock }
  | { type: "delta"; block: MarkdownBlock; delta: string }
  | { type: "end"; block: MarkdownBlock };

type ActiveBlock = MarkdownBlock & {
  fence?: "code" | "math";
};

export class StreamingMarkdownParser {
  private pending = "";
  private activeBlock: ActiveBlock | null = null;

  push(chunk: string) {
    const events: MarkdownParserEvent[] = [];
    this.pending += chunk;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    for (const line of lines) {
      events.push(...this.processLine(`${line}\n`));
    }
    return events;
  }

  flush() {
    const events: MarkdownParserEvent[] = [];
    if (this.pending) {
      events.push(...this.processLine(this.pending));
      this.pending = "";
    }
    if (this.activeBlock) {
      this.activeBlock.complete = false;
      events.push({ type: "end", block: { ...this.activeBlock } });
      this.activeBlock = null;
    }
    return events;
  }

  reset() {
    this.pending = "";
    this.activeBlock = null;
  }

  private processLine(line: string) {
    const events: MarkdownParserEvent[] = [];
    const trimmed = line.trim();

    if (this.activeBlock?.fence === "code") {
      this.activeBlock.raw += line;
      if (/^```\s*$/.test(trimmed)) {
        this.activeBlock.complete = true;
        events.push({ type: "end", block: { ...this.activeBlock } });
        this.activeBlock = null;
        return events;
      }
      this.activeBlock.content += line;
      events.push({ type: "delta", block: { ...this.activeBlock }, delta: line });
      return events;
    }

    if (this.activeBlock?.fence === "math") {
      this.activeBlock.raw += line;
      if (/^\$\$\s*$/.test(trimmed)) {
        this.activeBlock.complete = true;
        events.push({ type: "end", block: { ...this.activeBlock } });
        this.activeBlock = null;
        return events;
      }
      this.activeBlock.content += line;
      events.push({ type: "delta", block: { ...this.activeBlock }, delta: line });
      return events;
    }

    if (!trimmed) {
      if (this.activeBlock) {
        this.activeBlock.complete = true;
        events.push({ type: "end", block: { ...this.activeBlock } });
        this.activeBlock = null;
      }
      return events;
    }

    const fence = trimmed.match(/^```([a-z0-9_+#.-]+)?\s*$/i);
    if (fence) {
      if (this.activeBlock) {
        this.activeBlock.complete = true;
        events.push({ type: "end", block: { ...this.activeBlock } });
      }
      const language = fence[1]?.toLowerCase();
      const type: MarkdownBlockType = language === "mermaid" ? "mermaid" : isVisualizationLanguage(language) ? "visualization" : "code_block";
      this.activeBlock = this.createBlock(type, "", line, language, "code");
      events.push({ type: "start", block: { ...this.activeBlock } });
      return events;
    }

    if (/^\$\$\s*$/.test(trimmed)) {
      if (this.activeBlock) {
        this.activeBlock.complete = true;
        events.push({ type: "end", block: { ...this.activeBlock } });
      }
      this.activeBlock = this.createBlock("math_block", "", line, undefined, "math");
      events.push({ type: "start", block: { ...this.activeBlock } });
      return events;
    }

    const type = classifyMarkdownLine(trimmed);
    if (!this.activeBlock || !isCompatibleBlock(this.activeBlock.type, type)) {
      if (this.activeBlock) {
        this.activeBlock.complete = true;
        events.push({ type: "end", block: { ...this.activeBlock } });
      }
      this.activeBlock = this.createBlock(type, line, line);
      events.push({ type: "start", block: { ...this.activeBlock } });
      if (type === "horizontal_rule") {
        this.activeBlock.complete = true;
        events.push({ type: "end", block: { ...this.activeBlock } });
        this.activeBlock = null;
      }
      return events;
    }

    this.activeBlock.content += line;
    this.activeBlock.raw += line;
    events.push({ type: "delta", block: { ...this.activeBlock }, delta: line });
    return events;
  }

  private createBlock(type: MarkdownBlockType, content: string, raw: string, language?: string, fence?: ActiveBlock["fence"]): ActiveBlock {
    return {
      blockId: createId("mdb"),
      type,
      content,
      raw,
      language,
      fence,
      complete: false,
    };
  }
}

function isVisualizationLanguage(language: string | undefined) {
  return Boolean(language && ["visualization", "visualization-json", "viz", "chart-spec"].includes(language));
}

export function classifyMarkdownLine(trimmedLine: string): MarkdownBlockType {
  if (/^#{1,6}\s+/.test(trimmedLine)) {
    return "heading";
  }
  if (/^>\s?/.test(trimmedLine)) {
    return "blockquote";
  }
  if (/^[-*+]\s+/.test(trimmedLine)) {
    return "unordered_list";
  }
  if (/^\d+\.\s+/.test(trimmedLine)) {
    return "ordered_list";
  }
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmedLine)) {
    return "horizontal_rule";
  }
  if (looksLikeTableLine(trimmedLine)) {
    return "table";
  }
  return "paragraph";
}

function looksLikeTableLine(line: string) {
  if (!line.includes("|")) {
    return false;
  }
  const columns = line.split("|").filter((part) => part.trim().length > 0);
  return columns.length >= 2 || /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
}

function isCompatibleBlock(current: MarkdownBlockType, next: MarkdownBlockType) {
  if (current === "table" || next === "table") {
    return current === next;
  }
  if (current === "unordered_list" || current === "ordered_list" || current === "blockquote") {
    return current === next;
  }
  if (current === "paragraph") {
    return next === "paragraph";
  }
  return false;
}
