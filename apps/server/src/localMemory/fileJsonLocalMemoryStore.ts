import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { InMemoryLocalMemoryStore } from "./inMemoryLocalMemoryStore.js";
import type { LocalMemoryRecord } from "./types.js";

export class FileJsonLocalMemoryStore extends InMemoryLocalMemoryStore {
  private loaded = false;

  constructor(private readonly filePath: string) {
    super();
  }

  override async create(record: LocalMemoryRecord) {
    await this.load();
    const created = await super.create(record);
    await this.persist();
    return created;
  }

  override async update(memoryId: string, patch: Partial<LocalMemoryRecord>) {
    await this.load();
    const updated = await super.update(memoryId, patch);
    await this.persist();
    return updated;
  }

  override async get(memoryId: string) {
    await this.load();
    const result = await super.get(memoryId);
    await this.persist();
    return result;
  }

  override async delete(memoryId: string) {
    await this.load();
    await super.delete(memoryId);
    await this.persist();
  }

  override async search(query: Parameters<InMemoryLocalMemoryStore["search"]>[0]) {
    await this.load();
    const result = await super.search(query);
    await this.persist();
    return result;
  }

  override async listByConversation(conversationId: string) {
    await this.load();
    return super.listByConversation(conversationId);
  }

  override async listByProject(projectId: string) {
    await this.load();
    return super.listByProject(projectId);
  }

  override async cleanup(input?: Parameters<InMemoryLocalMemoryStore["cleanup"]>[0]) {
    await this.load();
    const result = await super.cleanup(input);
    await this.persist();
    return result;
  }

  private async load() {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { records?: LocalMemoryRecord[] };
      this.replaceAll(Array.isArray(parsed.records) ? parsed.records : []);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async persist() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ records: this.snapshot() }, null, 2), "utf8");
  }
}
