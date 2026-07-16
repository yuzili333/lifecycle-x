export type ChatComposerDraftState<Skill extends string = string, FieldRef = unknown> = {
  value: string;
  selectedSkill: Skill | null;
  selectedDataSourceId: string | null;
  disabledTempDataSourceIds: string[];
  selectedFieldRefs: FieldRef[];
  updatedAt: string;
};

export function createEmptyChatComposerDraft<Skill extends string = string, FieldRef = unknown>(
  updatedAt = new Date().toISOString(),
): ChatComposerDraftState<Skill, FieldRef> {
  return {
    value: "",
    selectedSkill: null,
    selectedDataSourceId: null,
    disabledTempDataSourceIds: [],
    selectedFieldRefs: [],
    updatedAt,
  };
}

export function removeChatComposerDraft<Draft>(
  draftsByConversation: Record<string, Draft>,
  conversationId: string,
) {
  if (!(conversationId in draftsByConversation)) {
    return draftsByConversation;
  }
  const next = { ...draftsByConversation };
  delete next[conversationId];
  return next;
}
