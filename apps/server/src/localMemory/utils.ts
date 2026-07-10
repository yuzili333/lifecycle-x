import { randomUUID } from "node:crypto";
import type { ContextItem, LocalMemoryRecord, MemoryRetentionPolicy } from "./types.js";

export function nowIso() {
  return new Date().toISOString();
}

export function createMemoryId() {
  return `mem_${randomUUID()}`;
}

export function createContextId() {
  return `ctx_${randomUUID()}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function estimateChars(value: string) {
  return value.length;
}

export function truncate(value: string, maxChars: number) {
  if (maxChars <= 0) {
    return "";
  }
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 3))}...` : value;
}

export function tokenize(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\u4e00-\u9fa5]+/gu, " ")
    .trim();
  if (!normalized) {
    return [];
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  const cjk = Array.from(normalized.matchAll(/[\u4e00-\u9fa5]{2,}/g)).flatMap((match) => {
    const text = match[0];
    const parts: string[] = [];
    for (let i = 0; i < text.length - 1; i += 1) {
      parts.push(text.slice(i, i + 2));
    }
    return parts;
  });
  return Array.from(new Set([...words, ...cjk]));
}

export function textSimilarity(query: string | undefined, content: string) {
  if (!query?.trim()) {
    return 0;
  }
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }
  const contentTokens = new Set(tokenize(content));
  const matched = queryTokens.filter((token) => contentTokens.has(token)).length;
  return matched / queryTokens.length;
}

export function isExpired(record: LocalMemoryRecord, at = new Date()) {
  return Boolean(record.expiresAt && Date.parse(record.expiresAt) <= at.getTime());
}

export function defaultRetention(scope: LocalMemoryRecord["scope"], visibility: LocalMemoryRecord["visibility"], patch?: Partial<MemoryRetentionPolicy>) {
  const mode: MemoryRetentionPolicy["mode"] = patch?.mode ?? (visibility === "temporary" ? "ephemeral" : scope === "conversation" ? "session" : scope === "project" ? "project" : "persistent");
  return {
    mode,
    ttlMs: patch?.ttlMs,
    allowCompression: patch?.allowCompression ?? mode !== "ephemeral",
    allowDeletion: patch?.allowDeletion ?? true,
    allowPromptInjection: patch?.allowPromptInjection ?? visibility !== "temporary",
  } satisfies MemoryRetentionPolicy;
}

export function applyTtl(createdAt: string, retention: MemoryRetentionPolicy) {
  if (!retention.ttlMs) {
    return undefined;
  }
  return new Date(Date.parse(createdAt) + retention.ttlMs).toISOString();
}

export function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function itemChars(item: Pick<ContextItem, "content" | "tokenEstimate">) {
  return item.tokenEstimate ?? item.content.length;
}

export function rankByCreatedAtDesc<T extends { createdAt?: string }>(items: T[]) {
  return [...items].sort((left, right) => Date.parse(right.createdAt ?? "0") - Date.parse(left.createdAt ?? "0"));
}

export function recordText(record: LocalMemoryRecord) {
  return [record.title, record.content, record.tags?.join(" "), record.type, record.scope].filter(Boolean).join("\n");
}
