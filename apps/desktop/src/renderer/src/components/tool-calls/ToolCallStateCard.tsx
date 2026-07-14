import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { BarChart3, Braces, Database, FileText, type LucideIcon } from "lucide-react";
import type { ToolCallRecord, ToolKind } from "../../../../main/toolOrchestration";

export type ToolCallStateCardProps = {
  record: ToolCallRecord;
  isSelected?: boolean;
  canOpenReport?: boolean;
  onSelect?: (record: ToolCallRecord) => void;
  onOpenReport?: (record: ToolCallRecord) => void;
  onOpenResult?: (record: ToolCallRecord) => void;
  onApprove?: (record: ToolCallRecord, approved: boolean) => void;
};

const toolKindLabels: Record<ToolKind, string> = {
  sql_query: "SQL 查询",
  python_analysis: "Python 分析",
  chart_rendering: "绘制图表",
  report_generation: "生成报告",
};

const toolKindIcons: Record<ToolKind, LucideIcon> = {
  sql_query: Database,
  python_analysis: Braces,
  chart_rendering: BarChart3,
  report_generation: FileText,
};

const toolStatusLabels: Record<ToolCallRecord["status"], string> = {
  planned: "已计划",
  waiting_input: "等待输入",
  waiting_approval: "待审批",
  approved: "已批准",
  executing: "执行中",
  completed: "已完成",
  failed: "失败",
  rejected: "已拒绝",
  cancelled: "已取消",
  blocked: "已阻塞",
};

export function toolKindLabel(toolKind: ToolKind) {
  return toolKindLabels[toolKind];
}

export function toolStatusLabel(status: ToolCallRecord["status"]) {
  return toolStatusLabels[status];
}

export function toolRecordSummary(record: ToolCallRecord) {
  const outputCount = record.outputArtifactIds?.length ?? record.result?.artifactIds?.length ?? 0;
  const parentCount = record.parentToolCallIds?.length ?? 0;
  const sourceCount = record.sourceArtifactIds?.length ?? 0;
  const fragments = [`v${record.version}`, toolStatusLabel(record.status)];
  if (outputCount > 0) {
    fragments.push(`${outputCount} Artifact`);
  }
  if (parentCount > 0 || sourceCount > 0) {
    fragments.push(`血缘 ${parentCount + sourceCount}`);
  }
  return fragments.join(" · ");
}

export function ToolCallStateCard({
  record,
  isSelected = false,
  canOpenReport = false,
  onSelect,
  onOpenReport,
  onOpenResult,
  onApprove,
}: ToolCallStateCardProps) {
  const IconComponent = toolKindIcons[record.toolKind];
  return (
    <article
      className={`assistant-tool-state-card status-${record.status} ${isSelected ? "selected" : ""}`}
      aria-label={`${toolKindLabel(record.toolKind)} ${toolStatusLabel(record.status)}`}
    >
      <div className="assistant-tool-state-card-main">
        <Icon icon={IconComponent} size="xsm" color="inherit" />
        <div>
          <strong>{toolKindLabel(record.toolKind)}</strong>
          <span>{toolRecordSummary(record)}</span>
        </div>
      </div>
      <div className="assistant-tool-state-card-actions">
        {isSelected ? <span className="assistant-tool-state-selected">默认输入</span> : null}
        {record.status === "waiting_approval" ? (
          <>
            <Button
              label="批准"
              variant="primary"
              size="sm"
              onClick={() => onApprove?.(record, true)}
            />
            <Button
              label="拒绝"
              variant="ghost"
              size="sm"
              onClick={() => onApprove?.(record, false)}
            />
          </>
        ) : null}
        {record.status === "completed" && (record.outputArtifactIds?.length || record.result?.primaryArtifactId) ? (
          <Button
            label="查看结果"
            variant="secondary"
            size="sm"
            onClick={() => onOpenResult?.(record)}
          />
        ) : null}
        {record.status === "completed" && !isSelected ? (
          <Button
            label="作为输入"
            variant="secondary"
            size="sm"
            onClick={() => onSelect?.(record)}
          />
        ) : null}
        {canOpenReport ? (
          <Button
            label="打开报告"
            variant="secondary"
            size="sm"
            onClick={() => onOpenReport?.(record)}
          />
        ) : null}
      </div>
    </article>
  );
}
