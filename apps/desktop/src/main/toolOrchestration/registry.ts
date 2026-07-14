import { randomUUID } from "node:crypto";
import type { ArtifactManager, ArtifactRecord, ConversationToolState, ToolCallRecord, ToolKind, ToolResultRegistry } from "./types";
import { latestArtifactKey, latestPointerKey, nowIso, selectedPointerKey, toolError } from "./utils";

export class InMemoryToolResultRegistry implements ToolResultRegistry {
  private readonly records = new Map<string, ToolCallRecord>();
  private readonly states = new Map<string, ConversationToolState>();

  async register(record: ToolCallRecord): Promise<void> {
    this.records.set(record.toolCallId, { ...record });
    const state = await this.getConversationState(record.conversationId);
    state.toolCalls = [...state.toolCalls.filter((item) => item.toolCallId !== record.toolCallId), record];
    state.updatedAt = nowIso();
    this.states.set(record.conversationId, state);
  }

  async update(toolCallId: string, patch: Partial<ToolCallRecord>): Promise<ToolCallRecord> {
    const current = await this.get(toolCallId);
    if (!current) {
      throw toolError("TOOL_RESULT_NOT_FOUND", `工具调用不存在：${toolCallId}`, { toolCallId });
    }
    const next = { ...current, ...patch, toolCallId, updatedAt: nowIso() };
    this.records.set(toolCallId, next);
    const state = await this.getConversationState(next.conversationId);
    state.toolCalls = state.toolCalls.map((item) => (item.toolCallId === toolCallId ? next : item));
    state.updatedAt = next.updatedAt;
    this.states.set(next.conversationId, state);
    if (patch.status === "completed" && next.result) {
      await this.markLatestSuccessful(next.conversationId, toolCallId);
      return (await this.get(toolCallId)) ?? next;
    }
    return next;
  }

  async get(toolCallId: string): Promise<ToolCallRecord | null> {
    return this.records.get(toolCallId) ?? null;
  }

  async listByConversation(conversationId: string): Promise<ToolCallRecord[]> {
    return (await this.getConversationState(conversationId)).toolCalls.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async getLatestSuccessful(conversationId: string, toolKind: ToolKind): Promise<ToolCallRecord | null> {
    const state = await this.getConversationState(conversationId);
    const toolCallId = state[latestPointerKey(toolKind)];
    return toolCallId ? this.get(toolCallId) : null;
  }

  async markLatestSuccessful(conversationId: string, toolCallId: string): Promise<void> {
    const record = await this.get(toolCallId);
    if (!record) {
      throw toolError("TOOL_RESULT_NOT_FOUND", `工具调用不存在：${toolCallId}`, { conversationId, toolCallId });
    }
    if (record.status !== "completed") {
      return;
    }
    const state = await this.getConversationState(conversationId);
    const pointerKey = latestPointerKey(record.toolKind);
    const artifactKey = latestArtifactKey(record.toolKind);
    const previousToolCallId = state[pointerKey];
    state[pointerKey] = toolCallId;
    state[artifactKey] = record.outputArtifactIds ?? record.result?.artifactIds ?? [];
    state.toolCalls = state.toolCalls.map((item) => {
      if (item.toolKind !== record.toolKind) {
        return item;
      }
      return { ...item, isLatestSuccessful: item.toolCallId === toolCallId };
    });
    if (previousToolCallId && previousToolCallId !== toolCallId) {
      const previous = this.records.get(previousToolCallId);
      if (previous) {
        this.records.set(previousToolCallId, { ...previous, isLatestSuccessful: false });
      }
    }
    this.records.set(toolCallId, { ...record, isLatestSuccessful: true });
    state.updatedAt = nowIso();
    this.states.set(conversationId, state);
  }

  async selectResult(conversationId: string, toolKind: ToolKind, toolCallId: string): Promise<void> {
    const record = await this.get(toolCallId);
    if (!record || record.conversationId !== conversationId || record.toolKind !== toolKind || record.status !== "completed") {
      throw toolError("TOOL_RESULT_NOT_FOUND", `无法选择工具结果：${toolCallId}`, { conversationId, toolCallId });
    }
    const state = await this.getConversationState(conversationId);
    state[selectedPointerKey(toolKind)] = toolCallId;
    state.updatedAt = nowIso();
    this.states.set(conversationId, state);
  }

  async getConversationState(conversationId: string): Promise<ConversationToolState> {
    const existing = this.states.get(conversationId);
    if (existing) {
      return { ...existing, toolCalls: [...existing.toolCalls] };
    }
    const created: ConversationToolState = {
      conversationId,
      toolCalls: [],
      updatedAt: nowIso(),
    };
    this.states.set(conversationId, created);
    return { ...created, toolCalls: [] };
  }
}

export class InMemoryArtifactManager {
  private readonly artifacts = new Map<string, import("./types").ArtifactRecord>();

  async createArtifact(input: Omit<import("./types").ArtifactRecord, "artifactId" | "createdAt"> & { artifactId?: string }) {
    const artifact = {
      ...input,
      artifactId: input.artifactId ?? `artifact_${randomUUID()}`,
      createdAt: nowIso(),
    };
    this.artifacts.set(artifact.artifactId, artifact);
    return artifact;
  }

  async getArtifact(artifactId: string) {
    return this.artifacts.get(artifactId) ?? null;
  }

  async listArtifacts(artifactIds: string[]) {
    return artifactIds.map((artifactId) => this.artifacts.get(artifactId)).filter((item): item is import("./types").ArtifactRecord => Boolean(item));
  }

  async deleteArtifact(artifactId: string) {
    return this.artifacts.delete(artifactId);
  }
}

export class SQLiteToolResultRegistry implements ToolResultRegistry {
  constructor(private readonly db: any) {
    this.migrate();
  }

  async register(record: ToolCallRecord): Promise<void> {
    this.upsertRecord(record);
    const state = await this.getConversationState(record.conversationId);
    state.updatedAt = nowIso();
    this.saveState(state);
  }

  async update(toolCallId: string, patch: Partial<ToolCallRecord>): Promise<ToolCallRecord> {
    const current = await this.get(toolCallId);
    if (!current) {
      throw toolError("TOOL_RESULT_NOT_FOUND", `工具调用不存在：${toolCallId}`, { toolCallId });
    }
    const next = { ...current, ...patch, toolCallId, updatedAt: nowIso() };
    this.upsertRecord(next);
    if (patch.status === "completed" && next.result) {
      await this.markLatestSuccessful(next.conversationId, toolCallId);
      return (await this.get(toolCallId)) ?? next;
    }
    const state = await this.getConversationState(next.conversationId);
    state.updatedAt = next.updatedAt;
    this.saveState(state);
    return next;
  }

  async get(toolCallId: string): Promise<ToolCallRecord | null> {
    const row = this.db.prepare("select record_json from tool_orchestration_calls where tool_call_id = ?").get(toolCallId);
    return row?.record_json ? parseJson<ToolCallRecord>(row.record_json) : null;
  }

  async listByConversation(conversationId: string): Promise<ToolCallRecord[]> {
    return this.loadRecords(conversationId);
  }

  async getLatestSuccessful(conversationId: string, toolKind: ToolKind): Promise<ToolCallRecord | null> {
    const state = await this.getConversationState(conversationId);
    const toolCallId = state[latestPointerKey(toolKind)];
    if (toolCallId) {
      return this.get(toolCallId);
    }
    return this.loadRecords(conversationId)
      .filter((record) => record.toolKind === toolKind && record.status === "completed" && record.isLatestSuccessful)
      .at(-1) ?? null;
  }

  async markLatestSuccessful(conversationId: string, toolCallId: string): Promise<void> {
    const record = await this.get(toolCallId);
    if (!record) {
      throw toolError("TOOL_RESULT_NOT_FOUND", `工具调用不存在：${toolCallId}`, { conversationId, toolCallId });
    }
    if (record.status !== "completed") {
      return;
    }
    for (const item of this.loadRecords(conversationId)) {
      if (item.toolKind === record.toolKind) {
        this.upsertRecord({ ...item, isLatestSuccessful: item.toolCallId === toolCallId, updatedAt: item.toolCallId === toolCallId ? nowIso() : item.updatedAt });
      }
    }
    const updatedRecord = (await this.get(toolCallId)) ?? { ...record, isLatestSuccessful: true };
    const state = await this.getConversationState(conversationId);
    state[latestPointerKey(record.toolKind)] = toolCallId;
    state[latestArtifactKey(record.toolKind)] = updatedRecord.outputArtifactIds ?? updatedRecord.result?.artifactIds ?? [];
    state.updatedAt = nowIso();
    this.saveState(state);
  }

  async selectResult(conversationId: string, toolKind: ToolKind, toolCallId: string): Promise<void> {
    const record = await this.get(toolCallId);
    if (!record || record.conversationId !== conversationId || record.toolKind !== toolKind || record.status !== "completed") {
      throw toolError("TOOL_RESULT_NOT_FOUND", `无法选择工具结果：${toolCallId}`, { conversationId, toolCallId });
    }
    const state = await this.getConversationState(conversationId);
    state[selectedPointerKey(toolKind)] = toolCallId;
    state.updatedAt = nowIso();
    this.saveState(state);
  }

  async getConversationState(conversationId: string): Promise<ConversationToolState> {
    const persisted = this.loadState(conversationId);
    const records = this.loadRecords(conversationId);
    const derived: ConversationToolState = {
      conversationId,
      ...persisted,
      toolCalls: records,
      updatedAt: persisted?.updatedAt ?? records.at(-1)?.updatedAt ?? nowIso(),
    };
    for (const toolKind of ["sql_query", "python_analysis", "chart_rendering", "report_generation"] as ToolKind[]) {
      const pointerKey = latestPointerKey(toolKind);
      const artifactKey = latestArtifactKey(toolKind);
      if (!derived[pointerKey]) {
        const latest = records.filter((record) => record.toolKind === toolKind && record.status === "completed" && record.isLatestSuccessful).at(-1);
        if (latest) {
          derived[pointerKey] = latest.toolCallId;
          derived[artifactKey] = latest.outputArtifactIds ?? latest.result?.artifactIds ?? [];
        }
      }
    }
    if (!persisted) {
      this.saveState(derived);
    }
    return { ...derived, toolCalls: [...derived.toolCalls] };
  }

  private migrate() {
    this.db.exec(`
      create table if not exists tool_orchestration_calls (
        tool_call_id text primary key,
        conversation_id text not null,
        user_id text not null,
        tool_kind text not null,
        status text not null,
        record_json text not null,
        created_at text not null,
        updated_at text not null,
        completed_at text
      );
      create table if not exists tool_orchestration_states (
        conversation_id text primary key,
        state_json text not null,
        updated_at text not null
      );
      create index if not exists idx_tool_orchestration_calls_conversation on tool_orchestration_calls(conversation_id, created_at);
      create index if not exists idx_tool_orchestration_calls_kind on tool_orchestration_calls(conversation_id, tool_kind, updated_at);
    `);
  }

  private upsertRecord(record: ToolCallRecord) {
    this.db
      .prepare(
        `insert into tool_orchestration_calls
          (tool_call_id, conversation_id, user_id, tool_kind, status, record_json, created_at, updated_at, completed_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(tool_call_id) do update set
          conversation_id = excluded.conversation_id,
          user_id = excluded.user_id,
          tool_kind = excluded.tool_kind,
          status = excluded.status,
          record_json = excluded.record_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at`,
      )
      .run(
        record.toolCallId,
        record.conversationId,
        record.userId,
        record.toolKind,
        record.status,
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt,
        record.completedAt ?? null,
      );
  }

  private loadRecords(conversationId: string): ToolCallRecord[] {
    return this.db
      .prepare("select record_json from tool_orchestration_calls where conversation_id = ? order by created_at asc")
      .all(conversationId)
      .map((row: { record_json: string }) => parseJson<ToolCallRecord>(row.record_json))
      .filter((record: ToolCallRecord | null): record is ToolCallRecord => Boolean(record));
  }

  private loadState(conversationId: string): Omit<ConversationToolState, "conversationId" | "toolCalls"> | null {
    const row = this.db.prepare("select state_json from tool_orchestration_states where conversation_id = ?").get(conversationId);
    if (!row?.state_json) {
      return null;
    }
    const parsed = parseJson<ConversationToolState>(row.state_json);
    if (!parsed) {
      return null;
    }
    const { toolCalls: _toolCalls, conversationId: _conversationId, ...state } = parsed;
    return state;
  }

  private saveState(state: ConversationToolState) {
    const storedState = { ...state, toolCalls: [] };
    this.db
      .prepare(
        `insert into tool_orchestration_states (conversation_id, state_json, updated_at)
         values (?, ?, ?)
         on conflict(conversation_id) do update set
          state_json = excluded.state_json,
          updated_at = excluded.updated_at`,
      )
      .run(state.conversationId, JSON.stringify(storedState), state.updatedAt);
  }
}

export class SQLiteArtifactManager implements ArtifactManager {
  constructor(private readonly db: any) {
    this.migrate();
  }

  async createArtifact(input: Omit<ArtifactRecord, "artifactId" | "createdAt"> & { artifactId?: string }) {
    const artifact: ArtifactRecord = {
      ...input,
      artifactId: input.artifactId ?? `artifact_${randomUUID()}`,
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `insert into tool_orchestration_artifacts
          (artifact_id, artifact_type, title, content_type, content_json, metadata_json, created_at)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(artifact_id) do update set
          artifact_type = excluded.artifact_type,
          title = excluded.title,
          content_type = excluded.content_type,
          content_json = excluded.content_json,
          metadata_json = excluded.metadata_json`,
      )
      .run(
        artifact.artifactId,
        artifact.artifactType,
        artifact.title ?? null,
        artifact.contentType,
        JSON.stringify(artifact.content ?? null),
        JSON.stringify(artifact.metadata ?? null),
        artifact.createdAt,
      );
    return artifact;
  }

  async getArtifact(artifactId: string) {
    const row = this.db.prepare("select * from tool_orchestration_artifacts where artifact_id = ?").get(artifactId);
    return row ? artifactFromRow(row) : null;
  }

  async listArtifacts(artifactIds: string[]) {
    if (artifactIds.length === 0) {
      return [];
    }
    const artifacts = await Promise.all(artifactIds.map((artifactId) => this.getArtifact(artifactId)));
    return artifacts.filter((artifact): artifact is ArtifactRecord => Boolean(artifact));
  }

  async deleteArtifact(artifactId: string) {
    const result = this.db.prepare("delete from tool_orchestration_artifacts where artifact_id = ?").run(artifactId);
    return Number(result?.changes ?? 0) > 0;
  }

  private migrate() {
    this.db.exec(`
      create table if not exists tool_orchestration_artifacts (
        artifact_id text primary key,
        artifact_type text not null,
        title text,
        content_type text not null,
        content_json text,
        metadata_json text,
        created_at text not null
      );
      create index if not exists idx_tool_orchestration_artifacts_type_created on tool_orchestration_artifacts(artifact_type, created_at);
    `);
  }
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function artifactFromRow(row: Record<string, unknown>): ArtifactRecord {
  return {
    artifactId: String(row.artifact_id),
    artifactType: row.artifact_type as ArtifactRecord["artifactType"],
    title: typeof row.title === "string" ? row.title : undefined,
    contentType: row.content_type as ArtifactRecord["contentType"],
    content: typeof row.content_json === "string" ? parseJson<unknown>(row.content_json) : undefined,
    createdAt: String(row.created_at),
    metadata: typeof row.metadata_json === "string" ? parseJson<Record<string, unknown>>(row.metadata_json) ?? undefined : undefined,
  };
}
