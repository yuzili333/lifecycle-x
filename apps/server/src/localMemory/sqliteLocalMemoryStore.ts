import { InMemoryLocalMemoryStore } from "./inMemoryLocalMemoryStore.js";
import type { LocalMemoryRecord, MemoryCleanupInput, MemorySearchQuery } from "./types.js";

export type SQLiteStatementLike = {
  run: (...params: unknown[]) => unknown;
  get?: (...params: unknown[]) => unknown;
  all?: (...params: unknown[]) => unknown[];
};

export type SQLiteDatabaseLike = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SQLiteStatementLike;
};

export class SQLiteLocalMemoryStore extends InMemoryLocalMemoryStore {
  constructor(private readonly db: SQLiteDatabaseLike) {
    super();
    this.migrate();
  }

  override async create(record: LocalMemoryRecord): Promise<LocalMemoryRecord> {
    const created = await super.create(record);
    this.upsert(created);
    return created;
  }

  override async update(memoryId: string, patch: Partial<LocalMemoryRecord>): Promise<LocalMemoryRecord> {
    await this.hydrate();
    const updated = await super.update(memoryId, patch);
    this.upsert(updated);
    return updated;
  }

  override async get(memoryId: string) {
    await this.hydrate();
    const result = await super.get(memoryId);
    if (result) {
      this.upsert(result);
    }
    return result;
  }

  override async delete(memoryId: string) {
    await super.delete(memoryId);
    this.db.prepare("delete from local_memory where memory_id = ?").run(memoryId);
  }

  override async search(query: MemorySearchQuery) {
    await this.hydrate();
    const result = await super.search(query);
    result.forEach((item) => this.upsert(item.record));
    return result;
  }

  override async listByConversation(conversationId: string) {
    await this.hydrate();
    return super.listByConversation(conversationId);
  }

  override async listByProject(projectId: string) {
    await this.hydrate();
    return super.listByProject(projectId);
  }

  override async cleanup(input?: MemoryCleanupInput) {
    await this.hydrate();
    const result = await super.cleanup(input);
    for (const memoryId of result.deletedMemoryIds) {
      this.db.prepare("delete from local_memory where memory_id = ?").run(memoryId);
    }
    return result;
  }

  private migrate() {
    this.db.exec(`
      create table if not exists local_memory (
        memory_id text primary key,
        conversation_id text,
        project_id text,
        data_source_id text,
        scope text not null,
        type text not null,
        importance integer not null,
        created_at text not null,
        updated_at text not null,
        expires_at text,
        record_json text not null
      );
      create index if not exists idx_local_memory_conversation on local_memory(conversation_id, updated_at desc);
      create index if not exists idx_local_memory_project on local_memory(project_id, updated_at desc);
      create index if not exists idx_local_memory_data_source on local_memory(data_source_id, updated_at desc);
    `);
    void this.hydrate();
  }

  private async hydrate() {
    const rows = this.db.prepare("select record_json from local_memory").all?.() ?? [];
    this.replaceAll(
      rows
        .map((row) => {
          try {
            return JSON.parse((row as { record_json: string }).record_json) as LocalMemoryRecord;
          } catch {
            return null;
          }
        })
        .filter((record): record is LocalMemoryRecord => Boolean(record)),
    );
  }

  private upsert(record: LocalMemoryRecord) {
    this.db
      .prepare(
        `insert into local_memory
          (memory_id, conversation_id, project_id, data_source_id, scope, type, importance, created_at, updated_at, expires_at, record_json)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(memory_id) do update set
          conversation_id = excluded.conversation_id,
          project_id = excluded.project_id,
          data_source_id = excluded.data_source_id,
          scope = excluded.scope,
          type = excluded.type,
          importance = excluded.importance,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          record_json = excluded.record_json`,
      )
      .run(
        record.memoryId,
        record.source.conversationId ?? null,
        (record.metadata?.projectId as string | undefined) ?? null,
        record.source.dataSourceId ?? (record.metadata?.dataSourceId as string | undefined) ?? null,
        record.scope,
        record.type,
        record.importance,
        record.createdAt,
        record.updatedAt,
        record.expiresAt ?? null,
        JSON.stringify(record),
      );
  }
}
