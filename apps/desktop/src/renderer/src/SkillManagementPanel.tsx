import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { PackagePlus, Trash2 } from "lucide-react";
import type { SkillSummary } from "../../shared/skills";

type SkillManagementPanelProps = {
  skills: SkillSummary[];
  isLoading: boolean;
  pendingSkillId: string | null;
  isInstalling: boolean;
  onInstall: () => void;
  onSetEnabled: (skill: SkillSummary, enabled: boolean) => void;
  onRemove: (skill: SkillSummary) => void;
};

export function SkillManagementPanel({
  skills,
  isLoading,
  pendingSkillId,
  isInstalling,
  onInstall,
  onSetEnabled,
  onRemove,
}: SkillManagementPanelProps) {
  const [removeCandidate, setRemoveCandidate] = useState<SkillSummary | null>(null);
  const systemSkills = skills.filter((skill) => skill.origin === "system");
  const personalSkills = skills.filter((skill) => skill.origin === "personal");

  const renderList = (items: SkillSummary[], origin: "system" | "personal") => (
    <List density="balanced" hasDividers>
      {items.map((skill) => (
        <ListItem
          key={`${skill.origin}:${skill.skillId}`}
          label={(
            <HStack gap={2} vAlign="center">
              <Text type="body">{skill.displayName}</Text>
              <Text type="supporting" color="secondary">v{skill.version || "--"}</Text>
            </HStack>
          )}
          description={skill.availability === "invalid" ? skill.error : skill.description}
          endContent={origin === "system"
            ? <Text type="supporting" color="secondary">{skill.availability === "ready" ? "系统" : "无效"}</Text>
            : (
              <HStack gap={2} vAlign="center">
                {skill.canToggle && (
                  <Switch
                    label={`${skill.enabled ? "停用" : "启用"} ${skill.displayName}`}
                    isLabelHidden
                    value={skill.enabled}
                    isDisabled={pendingSkillId === skill.skillId || skill.availability !== "ready"}
                    onChange={(enabled) => onSetEnabled(skill, enabled)}
                  />
                )}
                {skill.canDelete && (
                  <Button
                    label={`删除 ${skill.displayName}`}
                    variant="ghost"
                    icon={<Trash2 size={18} />}
                    isIconOnly
                    isDisabled={pendingSkillId === skill.skillId}
                    onClick={() => setRemoveCandidate(skill)}
                  />
                )}
              </HStack>
            )}
        />
      ))}
    </List>
  );

  return (
    <VStack gap={4} hAlign="stretch">
      <HStack hAlign="between" vAlign="center">
        <Text type="display-3" as="h3">技能</Text>
        <Button
          label="安装 Skill"
          variant="primary"
          icon={<PackagePlus size={18} />}
          isLoading={isInstalling}
          onClick={onInstall}
        />
      </HStack>

      {isLoading ? (
        <Section variant="muted" padding={4}>
          <Text type="body" color="secondary">正在加载 Skill...</Text>
        </Section>
      ) : (
        <VStack gap={4} hAlign="stretch">
          <VStack gap={2} hAlign="stretch">
            <Text type="label" as="h3">系统 Skill</Text>
            {systemSkills.length > 0
              ? renderList(systemSkills, "system")
              : <Text type="body" color="secondary">当前没有可用的系统 Skill。</Text>}
          </VStack>
          <VStack gap={2} hAlign="stretch">
            <Text type="label" as="h3">个人 Skill</Text>
            {personalSkills.length > 0
              ? renderList(personalSkills, "personal")
              : <Text type="body" color="secondary">尚未安装个人 Skill。</Text>}
          </VStack>
        </VStack>
      )}

      <Dialog
        isOpen={Boolean(removeCandidate)}
        onOpenChange={(open) => {
          if (!open) setRemoveCandidate(null);
        }}
        width={420}
        purpose="info"
        padding={5}
      >
        <VStack gap={4} hAlign="stretch">
          <Text type="display-3" as="h3">删除个人 Skill</Text>
          <Text type="body">
            确认删除“{removeCandidate?.displayName}”？已开始的 Agent 任务仍使用原有快照，新请求将无法再选择该 Skill。
          </Text>
          <HStack gap={2} hAlign="end">
            <Button label="取消" variant="secondary" onClick={() => setRemoveCandidate(null)} />
            <Button
              label="删除"
              variant="destructive"
              onClick={() => {
                if (removeCandidate) onRemove(removeCandidate);
                setRemoveCandidate(null);
              }}
            />
          </HStack>
        </VStack>
      </Dialog>
    </VStack>
  );
}
