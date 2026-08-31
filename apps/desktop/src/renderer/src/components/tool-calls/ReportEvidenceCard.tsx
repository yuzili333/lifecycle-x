import { useEffect, useState } from "react";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Markdown, type MarkdownComponents } from "@astryxdesign/core/Markdown";
import { evidenceCardMarkdown, type EvidenceCard, type ResolvedReportEvidenceCard } from "../../../../shared/evidence";

export { evidenceCardMarkdown } from "../../../../shared/evidence";

export type ReportEvidenceCardProps = {
  evidenceCardId?: string;
  reportArtifactId: string;
  reportVersion: number;
  sectionNumber?: string;
  userId: string;
  conversationId: string;
  resolveArtifact?: (input: {
    userId: string;
    conversationId: string;
    reportArtifactId: string;
    reportVersion: number;
    evidenceCardId: string;
  }) => Promise<ResolvedReportEvidenceCard>;
};

type EvidenceState =
  | { status: "loading" }
  | { status: "ready"; card: EvidenceCard }
  | { status: "invalid" }
  | { status: "error"; message: string };

const evidenceMarkdownComponents: MarkdownComponents = {
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

export function ReportEvidenceCard(props: ReportEvidenceCardProps) {
  const { conversationId, evidenceCardId, reportArtifactId, reportVersion, resolveArtifact, sectionNumber, userId } = props;
  const [state, setState] = useState<EvidenceState>(evidenceCardId ? { status: "loading" } : { status: "invalid" });
  useEffect(() => {
    if (!evidenceCardId) {
      setState({ status: "invalid" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    resolveEvidence({ conversationId, evidenceCardId, reportArtifactId, reportVersion, resolveArtifact, userId })
      .then((result) => {
        if (!cancelled) setState({ status: "ready", card: result.evidenceCard });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "溯据卡加载失败。" });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, evidenceCardId, reportArtifactId, reportVersion, resolveArtifact, userId]);
  return <ReportEvidenceCardContent state={state} sectionNumber={sectionNumber} />;
}

export function ReportEvidenceCardContent({ state, sectionNumber }: { state: EvidenceState; sectionNumber?: string }) {
  const evidenceState = state.status === "ready" ? state.card.status : state.status === "loading" ? "loading" : "unavailable";
  return (
    <div className="assistant-report-evidence-card" data-evidence-state={evidenceState}>
      <Markdown
        density="compact"
        headingLevelStart={1}
        contentWidth="100%"
        autolink="gfm"
        components={evidenceMarkdownComponents}
        className="assistant-artifact-markdown-content"
      >
        {evidenceStateMarkdown(state, sectionNumber)}
      </Markdown>
    </div>
  );
}

export function evidenceStateMarkdown(state: EvidenceState, sectionNumber?: string) {
  if (state.status === "loading") {
    return "> 溯据卡加载中...";
  }
  if (state.status === "invalid" || state.status === "error") {
    const message = state.status === "error"
      ? friendlyEvidenceError(state.message)
      : "报告中的溯据卡引用无效，正文仍可正常查看。";
    return [
      "> **证据不可用**",
      ">",
      `> ${escapeBlockquote(message)}`,
    ].join("\n");
  }
  return evidenceCardMarkdown(state.card, sectionNumber);
}

function escapeBlockquote(value: string) {
  return value.replace(/\r?\n/g, "\n> ");
}

function resolveEvidence(props: ReportEvidenceCardProps) {
  const input = {
    userId: props.userId,
    conversationId: props.conversationId,
    reportArtifactId: props.reportArtifactId,
    reportVersion: props.reportVersion,
    evidenceCardId: props.evidenceCardId as string,
  };
  if (props.resolveArtifact) return props.resolveArtifact(input);
  const api = window.lifecycleX?.assistant;
  if (!api) return Promise.reject(new Error("报告证据服务不可用。"));
  return api.resolveReportEvidence(input.userId, input.conversationId, input.reportArtifactId, input.reportVersion, input.evidenceCardId);
}

function friendlyEvidenceError(message: string) {
  if (/permission|权限|不允许/i.test(message)) return "当前用户无权访问该报告版本的溯据卡，报告正文仍可正常查看。";
  if (/not found|不存在|失效/i.test(message)) return "该报告版本的溯据卡不存在或已失效，报告正文仍可正常查看。";
  return "溯据卡暂时无法加载，报告正文仍可正常查看。";
}
