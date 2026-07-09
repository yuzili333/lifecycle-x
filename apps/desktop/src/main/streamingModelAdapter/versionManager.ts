import { ModelAdapterError } from "./errors";
import type { ContentVersion, CreateVersionInput, UpdateVersionInput, VersionDiffLine } from "./types";
import { createId, nowIso } from "./utils";

export class InMemoryVersionManager {
  private readonly versions = new Map<string, ContentVersion>();

  createVersion(input: CreateVersionInput) {
    const timestamp = nowIso();
    const version: ContentVersion = {
      ...input,
      versionId: input.versionId ?? createId("ver"),
      status: input.status ?? "draft",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.versions.set(version.versionId, version);
    if (version.status === "selected") {
      this.setSelectedVersion(version.versionId);
    }
    return version;
  }

  updateVersion(input: UpdateVersionInput) {
    const current = this.getVersion(input.versionId);
    const next: ContentVersion = {
      ...current,
      content: input.content ?? current.content,
      title: input.title ?? current.title,
      status: input.status ?? current.status,
      metadata: input.metadata ? { ...current.metadata, ...input.metadata } : current.metadata,
      updatedAt: nowIso(),
    };
    this.versions.set(next.versionId, next);
    if (next.status === "selected") {
      this.setSelectedVersion(next.versionId);
    }
    return next;
  }

  listVersions(conversationId: string) {
    return Array.from(this.versions.values())
      .filter((version) => version.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getVersion(versionId: string) {
    const version = this.versions.get(versionId);
    if (!version) {
      throw new ModelAdapterError("VERSION_NOT_FOUND", `版本不存在：${versionId}`);
    }
    return version;
  }

  setCurrentVersion(versionId: string) {
    return this.updateVersion({ versionId, metadata: { current: true } });
  }

  setSelectedVersion(versionId: string) {
    const selected = this.getVersion(versionId);
    for (const version of this.listVersions(selected.conversationId)) {
      if (version.status === "selected" && version.versionId !== versionId) {
        this.versions.set(version.versionId, { ...version, status: "archived", updatedAt: nowIso() });
      }
    }
    const next = { ...selected, status: "selected" as const, updatedAt: nowIso() };
    this.versions.set(versionId, next);
    return next;
  }

  compareVersions(versionAId: string, versionBId: string) {
    const left = this.getVersion(versionAId);
    const right = this.getVersion(versionBId);
    return diffLines(left.content, right.content);
  }
}

export function diffLines(leftContent: string, rightContent: string): VersionDiffLine[] {
  const left = leftContent.split(/\r?\n/);
  const right = rightContent.split(/\r?\n/);
  const max = Math.max(left.length, right.length);
  const diff: VersionDiffLine[] = [];
  for (let index = 0; index < max; index += 1) {
    const leftLine = left[index];
    const rightLine = right[index];
    if (leftLine === rightLine && leftLine !== undefined) {
      diff.push({ type: "unchanged", line: leftLine, oldLineNumber: index + 1, newLineNumber: index + 1 });
      continue;
    }
    if (leftLine !== undefined) {
      diff.push({ type: "removed", line: leftLine, oldLineNumber: index + 1 });
    }
    if (rightLine !== undefined) {
      diff.push({ type: "added", line: rightLine, newLineNumber: index + 1 });
    }
  }
  return diff;
}
