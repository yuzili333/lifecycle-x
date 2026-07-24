import { useMemo } from "react";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Markdown, type MarkdownComponents } from "@astryxdesign/core/Markdown";
import { parseReportMarkdownVisualizations, type ReportMarkdownSegment, type ResolvedReportVisualizationArtifact } from "../../../../shared/visualization";
import { parseReportEvidenceNodes, type ReportEvidenceMarkdownSegment, type ResolvedReportEvidenceCard } from "../../../../shared/evidence";
import { ReportVisualizationNode } from "./ReportVisualizationNode";
import { ReportEvidenceCard } from "./ReportEvidenceCard";

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
  resolveEvidenceArtifact?: (input: {
    userId: string;
    conversationId: string;
    reportArtifactId: string;
    reportVersion: number;
    evidenceCardId: string;
  }) => Promise<ResolvedReportEvidenceCard>;
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
  resolveEvidenceArtifact,
}: ReportMarkdownViewerProps) {
  const segments = useMemo<Array<ReportMarkdownSegment | Extract<ReportEvidenceMarkdownSegment, { type: "evidence" }>>>(() => {
    const parsed: Array<ReportMarkdownSegment | Extract<ReportEvidenceMarkdownSegment, { type: "evidence" }>> = [];
    for (const segment of parseReportEvidenceNodes(markdown, reportVersion)) {
      if (segment.type === "markdown") {
        parsed.push(...parseReportMarkdownVisualizations(segment.markdown, reportVersion).map((nested) => ({
          ...nested,
          key: `${segment.key}:${nested.key}`,
        })));
      } else {
        parsed.push(segment);
      }
    }
    return parsed;
  }, [markdown, reportVersion]);
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
      ) : segment.type === "visualization" ? (
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
      ) : (
        <ReportEvidenceCard
          key={segment.key}
          userId={userId ?? ""}
          conversationId={conversationId ?? ""}
          reportArtifactId={reportArtifactId ?? ""}
          reportVersion={reportVersion}
          evidenceCardId={segment.evidenceCardId}
          sectionNumber={segment.sectionNumber}
          resolveArtifact={resolveEvidenceArtifact}
        />
      ))}
    </div>
  );
}
