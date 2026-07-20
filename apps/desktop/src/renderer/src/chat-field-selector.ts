import type { ChatCsvAttachment, ChatCsvColumnMetadata, ChatCsvSelectedFieldRef } from "../../main/chatCsvTempSource";

export type ConversationCsvField = {
  fieldId: string;
  tempDataSourceId: string;
  tempTableId: string;
  fileName: string;
  ordinalPosition: number;
  sourceHeader: string;
  physicalName: string;
  displayName: string;
  logicalType: ChatCsvColumnMetadata["inferredLogicalType"];
  sqliteType: ChatCsvColumnMetadata["sqliteType"];
  fieldComment?: string;
  sampleValues?: unknown[];
  status: "active" | "expired" | "deleted";
};

export type ChatFieldMention = {
  start: number;
  end: number;
  query: string;
};

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function normalizeSearchCompact(value: string) {
  return normalizeSearch(value)
    .normalize("NFKC")
    .replace(/[（(][^（）()]*[）)]/gu, "")
    .replace(/[\s"'“”‘’`.,，。；;:：!?！？、/\\|()[\]{}<>《》【】]+/gu, "");
}

function fieldMatchesQuery(field: ConversationCsvField, query: string) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) {
    return true;
  }

  const values = [
    field.displayName,
    field.sourceHeader,
    field.physicalName,
    field.fieldComment,
    field.logicalType,
    field.sqliteType,
  ];
  if (values.some((value) => normalizeSearch(value ?? "").includes(normalizedQuery))) {
    return true;
  }

  const compactQuery = normalizeSearchCompact(query);
  if (!compactQuery) {
    return false;
  }
  return values.some((value) => {
    const compactValue = normalizeSearchCompact(value ?? "");
    const canUsePrefixFallback = compactValue.length >= 4 && compactQuery.length >= 4;
    return (
      compactValue.length > 0 &&
      (
        compactValue.includes(compactQuery) ||
        (canUsePrefixFallback && (
          compactQuery.includes(compactValue) ||
          compactValue.startsWith(compactQuery) ||
          compactQuery.startsWith(compactValue)
        ))
      )
    );
  });
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

export function findChatFieldMention(value: string, cursorPosition = value.length): ChatFieldMention | null {
  const beforeCursor = value.slice(0, Math.max(0, Math.min(value.length, cursorPosition)));
  const match = beforeCursor.match(/(^|[\s，。；;,.!?！？、（(])#([^\s#]*)$/u);
  if (!match || match.index === undefined) {
    return null;
  }
  const start = match.index + match[1].length;
  const linePrefix = beforeCursor.slice(beforeCursor.lastIndexOf("\n") + 1);
  if (/^#\s/u.test(linePrefix) || /https?:\/\/\S*#\S*$/iu.test(beforeCursor) || isInsideMarkdownCode(value, start)) {
    return null;
  }
  return {
    start,
    end: beforeCursor.length,
    query: match[2],
  };
}

export function chatFieldMentionKey(value: string, mention: ChatFieldMention) {
  return `${mention.start}:${mention.end}:${mention.query}:${value}`;
}

export function fieldsFromChatCsvAttachment(attachment: ChatCsvAttachment | undefined): ConversationCsvField[] {
  if (!attachment?.tempDataSourceId || !attachment.tempTableId || attachment.status !== "ready") {
    return [];
  }
  return (attachment.columns ?? []).map((column) => ({
    fieldId: `${attachment.tempDataSourceId}:${column.sqliteColumnName}`,
    tempDataSourceId: attachment.tempDataSourceId!,
    tempTableId: attachment.tempTableId!,
    fileName: attachment.fileName,
    ordinalPosition: column.ordinalPosition,
    sourceHeader: column.sourceHeader,
    physicalName: column.sqliteColumnName,
    displayName: column.displayName || column.sourceHeader || column.sqliteColumnName || `未命名字段_${column.ordinalPosition}`,
    logicalType: column.inferredLogicalType,
    sqliteType: column.sqliteType,
    fieldComment: column.warnings?.join("；"),
    sampleValues: column.sampleValues,
    status: "active",
  }));
}

export function filterConversationCsvFields(fields: ConversationCsvField[], query: string) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) {
    return fields;
  }
  return fields.filter((field) => fieldMatchesQuery(field, query));
}

export function selectConversationCsvFields(input: {
  fields: ConversationCsvField[];
  query?: string;
  selectedFieldIds?: Set<string>;
  recentFieldIds?: string[];
  limit?: number;
}) {
  const selectedFieldIds = input.selectedFieldIds ?? new Set<string>();
  const recentFieldIds = input.recentFieldIds ?? [];
  return filterConversationCsvFields(input.fields, input.query ?? "")
    .slice()
    .sort((left, right) => {
      const leftSelected = selectedFieldIds.has(left.fieldId) ? 0 : 1;
      const rightSelected = selectedFieldIds.has(right.fieldId) ? 0 : 1;
      if (leftSelected !== rightSelected) {
        return leftSelected - rightSelected;
      }
      const leftRecent = recentFieldIds.indexOf(left.fieldId);
      const rightRecent = recentFieldIds.indexOf(right.fieldId);
      if (leftRecent !== -1 || rightRecent !== -1) {
        return (leftRecent === -1 ? Number.MAX_SAFE_INTEGER : leftRecent) - (rightRecent === -1 ? Number.MAX_SAFE_INTEGER : rightRecent);
      }
      return left.ordinalPosition - right.ordinalPosition;
    })
    .slice(0, input.limit ?? 200);
}

export function createChatFieldToken(field: ConversationCsvField, range: { start: number; end: number }): ChatCsvSelectedFieldRef {
  const rawText = `#${field.displayName}`;
  return {
    tokenId: `field_token_${field.tempDataSourceId}_${field.physicalName}`.replace(/[^a-zA-Z0-9_]/g, "_"),
    type: "csv_field",
    tempDataSourceId: field.tempDataSourceId,
    tempTableId: field.tempTableId,
    fieldId: field.fieldId,
    sourceHeader: field.sourceHeader,
    physicalName: field.physicalName,
    displayName: field.displayName,
    logicalType: field.logicalType,
    sqliteType: field.sqliteType,
    rawText,
    start: range.start,
    end: range.start + rawText.length,
    createdAt: new Date().toISOString(),
    status: "valid",
  };
}

export function findCsvFieldTokenMatchesInText(text: string, fields: ConversationCsvField[]) {
  const candidates = fields
    .flatMap((field) => {
      const labels = Array.from(new Set([field.displayName, field.sourceHeader, field.physicalName].filter(Boolean)));
      return labels.map((label) => ({ field, rawText: `#${label}` }));
    })
    .sort((left, right) => right.rawText.length - left.rawText.length);
  const matches: Array<{ field: ConversationCsvField; rawText: string; start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] !== "#") {
      cursor += 1;
      continue;
    }
    const match = candidates.find((candidate) => text.startsWith(candidate.rawText, cursor));
    if (!match) {
      cursor += 1;
      continue;
    }
    matches.push({
      field: match.field,
      rawText: match.rawText,
      start: cursor,
      end: cursor + match.rawText.length,
    });
    cursor += match.rawText.length;
  }
  return matches;
}

export function insertFieldTokenText(value: string, mention: ChatFieldMention, token: ChatCsvSelectedFieldRef) {
  const before = value.slice(0, mention.start);
  const after = value.slice(mention.end);
  const needsSpace = after.length === 0 || !/^\s/u.test(after);
  return `${before}${token.rawText}${needsSpace ? " " : ""}${after}`;
}

export function upsertFieldToken(tokens: ChatCsvSelectedFieldRef[], token: ChatCsvSelectedFieldRef) {
  if (tokens.some((item) => item.fieldId === token.fieldId && item.tempDataSourceId === token.tempDataSourceId)) {
    return tokens;
  }
  return [...tokens, token];
}

export function removeFieldTokenText(value: string, token: ChatCsvSelectedFieldRef) {
  return value.replace(token.rawText, "").replace(/[ \t]{2,}/g, " ").trimStart();
}
