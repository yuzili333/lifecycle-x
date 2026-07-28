import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";

export type ToolApprovalCardProps = {
  toolName: string;
  onAccept: () => void;
  onReject: () => void;
};

export function toolApprovalTitle(toolName: string) {
  return `${toolName.trim().toUpperCase() || "TOOL"} 工具调用权限申请`;
}

export function ToolApprovalCard({ toolName, onAccept, onReject }: ToolApprovalCardProps) {
  const title = toolApprovalTitle(toolName);

  return (
    <ClickableCard
      label={`${title}，请选择接受或拒绝`}
      variant="default"
      padding={3}
      width="100%"
    >
      <VStack gap={3} hAlign="stretch" width="100%">
        <Text type="label" weight="semibold">
          {title}
        </Text>
        <HStack gap={2}>
          <Button label="接受" variant="primary" size="sm" onClick={onAccept} />
          <Button label="拒绝" variant="ghost" size="sm" onClick={onReject} />
        </HStack>
      </VStack>
    </ClickableCard>
  );
}
