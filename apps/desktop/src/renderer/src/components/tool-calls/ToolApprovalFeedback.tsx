import { Badge } from "@astryxdesign/core/Badge";
import { ChatComposerDrawer } from "@astryxdesign/core/Chat";
import { List, ListItem } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";

export type ToolApprovalFeedbackProps = {
  toolName: string;
  isSubmitting: boolean;
  onDecision: (approved: boolean) => void;
};

export function toolApprovalTitle(toolName: string) {
  return `${toolName.trim().toUpperCase() || "TOOL"} 工具调用权限申请`;
}

export function ToolApprovalFeedback({
  toolName,
  isSubmitting,
  onDecision,
}: ToolApprovalFeedbackProps) {
  return (
    <ChatComposerDrawer
      className="assistant-tool-approval-drawer"
      aria-label={toolApprovalTitle(toolName)}
    >
      <VStack gap={2} hAlign="stretch" width="100%">
        <Text type="label" weight="semibold">
          {toolApprovalTitle(toolName)}
        </Text>
        <List density="compact">
          <ListItem
            label="接受"
            startContent={<Badge label="A" variant="neutral" />}
            isDisabled={isSubmitting}
            onClick={() => onDecision(true)}
          />
          <ListItem
            label="拒绝"
            startContent={<Badge label="B" variant="neutral" />}
            isDisabled={isSubmitting}
            onClick={() => onDecision(false)}
          />
        </List>
        {isSubmitting ? (
          <Text type="supporting" color="secondary">
            正在提交审批结果
          </Text>
        ) : null}
      </VStack>
    </ChatComposerDrawer>
  );
}
