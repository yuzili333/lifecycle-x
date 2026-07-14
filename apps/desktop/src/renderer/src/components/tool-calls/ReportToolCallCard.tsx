import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { BarChart3, ChevronRight, FileText, GitBranch } from "lucide-react";

export type ReportToolCallCardProps = {
  title: string;
  version?: number;
  generatedAt: string;
  summary?: string;
  chartCount?: number;
  dataSourceCount?: number;
  status?: string;
  onOpen: () => void;
};

export function ReportToolCallCard({
  title,
  version,
  generatedAt,
  summary,
  chartCount = 0,
  dataSourceCount = 0,
  status = "completed",
  onOpen,
}: ReportToolCallCardProps) {
  return (
    <ClickableCard
      label={`打开报告：${title}`}
      onClick={onOpen}
      variant="muted"
      padding={3}
      maxWidth={420}
      className="assistant-report-card"
    >
      <VStack gap={2} hAlign="stretch" width="100%">
        <HStack gap={3} vAlign="start" width="100%">
          <span className="assistant-report-card-icon">
            <Icon icon={FileText} size="sm" color="inherit" />
          </span>
          <StackItem size="fill">
            <VStack gap={1}>
              <Text type="label" weight="semibold">
                {title}
              </Text>
              <Text type="supporting" color="secondary">
                已生成 Markdown 报告{version ? ` · 版本 ${version}` : ""} · {generatedAt}
              </Text>
            </VStack>
          </StackItem>
          <Icon icon={ChevronRight} size="sm" color="secondary" />
        </HStack>

        {summary && (
          <Text type="supporting" color="secondary" className="assistant-report-card-summary">
            {summary}
          </Text>
        )}

        <HStack gap={1} wrap="wrap" className="assistant-report-card-meta">
          <span><Icon icon={BarChart3} size="xsm" color="inherit" />包含 {chartCount} 张图表</span>
          <span><Icon icon={GitBranch} size="xsm" color="inherit" />{dataSourceCount} 个数据来源</span>
          <span>{status}</span>
        </HStack>

      </VStack>
    </ClickableCard>
  );
}
