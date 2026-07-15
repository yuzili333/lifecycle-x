import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { BarChart3, ChevronRight, FileText, GitBranch } from "lucide-react";

export type ReportCardStatus = "creating" | "completed" | "failed";

export type ReportToolCallCardProps = {
  title: string;
  version?: number;
  generatedAt: string;
  chartCount?: number;
  dataSourceCount?: number;
  dataSourceLabels?: string[];
  status?: ReportCardStatus;
  onOpen: () => void;
};

export function ReportToolCallCard({
  title,
  version,
  generatedAt,
  chartCount = 0,
  dataSourceCount = 0,
  dataSourceLabels = [],
  status = "completed",
  onOpen,
}: ReportToolCallCardProps) {
  const subtitle = [version ? `版本 ${version}` : null, generatedAt].filter(Boolean).join(" · ");
  const dataSourceTitle = dataSourceLabels.length > 0 ? `数据来源：${dataSourceLabels.join("、")}` : "暂无数据来源";

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
                {subtitle}
              </Text>
            </VStack>
          </StackItem>
          <Icon icon={ChevronRight} size="sm" color="secondary" />
        </HStack>

        <HStack gap={1} wrap="wrap" className="assistant-report-card-meta">
          {chartCount > 0 && <span><Icon icon={BarChart3} size="xsm" color="inherit" />包含 {chartCount} 张图表</span>}
          {dataSourceCount > 0 && (
            <span title={dataSourceTitle} aria-label={dataSourceTitle}>
              <Icon icon={GitBranch} size="xsm" color="inherit" />{dataSourceCount} 个数据来源
            </span>
          )}
          <span>{status}</span>
        </HStack>

      </VStack>
    </ClickableCard>
  );
}
