import { useMemo } from "react";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Markdown, type MarkdownComponents } from "@astryxdesign/core/Markdown";
import { parseReportMarkdownVisualizations, type ResolvedReportVisualizationArtifact } from "../../../../shared/visualization";
import { ReportVisualizationNode } from "./ReportVisualizationNode";

export type ReportMarkdownViewerProps = {
  markdown: string;
  className?: string;
  components?: MarkdownComponents;
  userId?: string;
  conversationId?: string;
  reportArtifactId?: string;
  reportVersion?: number;
  resolveVisualizationArtifact?: (input: {
    userId: string;
    conversationId: string;
    reportArtifactId: string;
    reportVersion: number;
    visualizationArtifactId: string;
  }) => Promise<ResolvedReportVisualizationArtifact>;
};

export function ReportMarkdownViewer({
  markdown,
  className,
  components,
  userId,
  conversationId,
  reportArtifactId,
  reportVersion = 1,
  resolveVisualizationArtifact,
}: ReportMarkdownViewerProps) {
  const segments = useMemo(() => parseReportMarkdownVisualizations(markdown, reportVersion), [markdown, reportVersion]);
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
      {segments.map((segment) => segment.type === "markdown" ? (
        <Markdown
          key={segment.key}
          density="compact"
          headingLevelStart={1}
          contentWidth="100%"
          autolink="gfm"
          components={components ?? fallbackComponents}
          className="assistant-artifact-markdown-content"
        >
          {segment.markdown}
        </Markdown>
      ) : (
        <ReportVisualizationNode
          key={segment.key}
          userId={userId ?? ""}
          conversationId={conversationId ?? ""}
          reportArtifactId={reportArtifactId ?? ""}
          reportVersion={reportVersion}
          artifactId={segment.artifactId}
          title={segment.title}
          description={segment.description}
          resolveArtifact={resolveVisualizationArtifact}
        />
      ))}
    </div>
  );
}
