import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Markdown, type MarkdownComponents } from "@astryxdesign/core/Markdown";

export type ReportMarkdownViewerProps = {
  markdown: string;
  className?: string;
  components?: MarkdownComponents;
};

export function ReportMarkdownViewer({ markdown, className, components }: ReportMarkdownViewerProps) {
  const fallbackComponents: MarkdownComponents = {
    code: ({ code, language }: { code: string; language?: string }) => (
      <CodeBlock
        code={code}
        language={language ?? "text"}
        hasCopyButton
        hasLanguageLabel
        isWrapped
        width="100%"
        size="sm"
      />
    ),
  };
  return (
    <div className={className}>
      <Markdown
        density="compact"
        headingLevelStart={1}
        contentWidth="100%"
        autolink="gfm"
        components={components ?? fallbackComponents}
        className="assistant-artifact-markdown-content"
      >
        {markdown}
      </Markdown>
    </div>
  );
}
