export type ChatToolSelectorSectionId = "add" | "skill" | "data_source";

export type ChatToolSkillOption<SkillValue extends string = string> = {
  label: string;
  value: SkillValue;
};

export type ChatToolDataSourceKind = "database" | "csv" | "temporary_csv";

export type ChatToolDataSourceOption = {
  id: string;
  label: string;
  description?: string;
  kind: ChatToolDataSourceKind;
  isSelected?: boolean;
};

export type ChatToolSelectorItem<SkillValue extends string = string> =
  | {
      type: "add_csv";
      id: "add_csv";
      label: string;
      description: string;
    }
  | {
      type: "skill";
      id: string;
      label: string;
      value: SkillValue;
      isSelected?: boolean;
    }
  | {
      type: "data_source";
      id: string;
      label: string;
      description?: string;
      kind: ChatToolDataSourceKind;
      isSelected?: boolean;
    };

export type ChatToolSelectorSection<SkillValue extends string = string> = {
  id: ChatToolSelectorSectionId;
  title: string;
  items: Array<ChatToolSelectorItem<SkillValue>>;
};

export type ChatToolMention = {
  start: number;
  end: number;
  query: string;
};

function normalizeToolSearchText(value: string) {
  return value.trim().toLowerCase();
}

function matchesToolQuery(query: string, ...values: Array<string | undefined>) {
  const normalizedQuery = normalizeToolSearchText(query);
  if (!normalizedQuery) {
    return true;
  }
  return values.some((value) => normalizeToolSearchText(value ?? "").includes(normalizedQuery));
}

function isInsideMarkdownCode(value: string, start: number) {
  const before = value.slice(0, start);
  const fencedCount = before.match(/```/g)?.length ?? 0;
  if (fencedCount % 2 === 1) {
    return true;
  }
  const linePrefix = before.slice(before.lastIndexOf("\n") + 1);
  return (linePrefix.match(/`/g)?.length ?? 0) % 2 === 1;
}

export function findChatToolMention(value: string, cursorPosition = value.length): ChatToolMention | null {
  const beforeCursor = value.slice(0, Math.max(0, Math.min(value.length, cursorPosition)));
  const match = beforeCursor.match(/(^|[\s，。；;,.!?！？、（(])@([^\s@]*)$/u);
  if (!match || match.index === undefined) {
    return null;
  }
  const start = match.index + match[1].length;
  if (isInsideMarkdownCode(value, start)) {
    return null;
  }
  return {
    start,
    end: beforeCursor.length,
    query: match[2],
  };
}

export function chatToolMentionKey(value: string, mention: ChatToolMention) {
  return `${mention.start}:${mention.end}:${mention.query}:${value}`;
}

export function isSuppressedChatToolMention({
  value,
  mention,
  suppressedKey,
  suppressedAnchor,
}: {
  value: string;
  mention: ChatToolMention;
  suppressedKey?: string | null;
  suppressedAnchor?: number | null;
}) {
  if (suppressedAnchor === mention.start && value[mention.start] === "@") {
    return true;
  }
  return chatToolMentionKey(value, mention) === suppressedKey;
}

export function removeChatToolMention(value: string, mention: ChatToolMention | null) {
  if (!mention) {
    return value;
  }
  const before = value.slice(0, mention.start).replace(/[ \t]+$/u, "");
  const after = value.slice(mention.end).replace(/^[ \t]+/u, "");
  if (!before) {
    return after;
  }
  if (!after) {
    return before;
  }
  return `${before} ${after}`;
}

export function buildChatToolSelectorSections<SkillValue extends string>({
  query = "",
  skills,
  dataSources,
  selectedSkill,
  includeAddCsv = true,
}: {
  query?: string;
  skills: Array<ChatToolSkillOption<SkillValue>>;
  dataSources: ChatToolDataSourceOption[];
  selectedSkill?: SkillValue | null;
  includeAddCsv?: boolean;
}): Array<ChatToolSelectorSection<SkillValue>> {
  const sections: Array<ChatToolSelectorSection<SkillValue>> = [];

  if (includeAddCsv && matchesToolQuery(query, "上传 CSV 文件", "添加", "csv")) {
    sections.push({
      id: "add",
      title: "添加",
      items: [
        {
          type: "add_csv",
          id: "add_csv",
          label: "上传 CSV 文件",
          description: "导入当前会话临时数据源",
        },
      ],
    });
  }

  const skillItems = skills
    .filter((skill) => matchesToolQuery(query, skill.label, skill.value))
    .map<ChatToolSelectorItem<SkillValue>>((skill) => ({
      type: "skill",
      id: skill.value,
      label: skill.label,
      value: skill.value,
      isSelected: selectedSkill === skill.value,
    }));
  if (skillItems.length > 0) {
    sections.push({ id: "skill", title: "Skill", items: skillItems });
  }

  const dataSourceItems = dataSources
    .filter((dataSource) => matchesToolQuery(query, dataSource.label, dataSource.description, dataSource.kind))
    .map<ChatToolSelectorItem<SkillValue>>((dataSource) => ({
      type: "data_source",
      id: dataSource.id,
      label: dataSource.label,
      description: dataSource.description,
      kind: dataSource.kind,
      isSelected: dataSource.isSelected,
    }));
  if (dataSourceItems.length > 0) {
    sections.push({ id: "data_source", title: "数据源", items: dataSourceItems });
  }

  return sections;
}
