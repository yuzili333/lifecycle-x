import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHAT_CSV_MAX_FILE_SIZE_BYTES,
  ConversationTempSourceManager,
  quoteSqliteIdentifier,
  resolveSchemaContextMode,
} from "./chatCsvTempSource";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type TestDb = {
  exec: (sql: string) => void;
  close: () => void;
  transaction: (fn: () => void) => () => void;
  prepare: (sql: string) => {
    all: (...params: unknown[]) => Array<Record<string, unknown>>;
    get: (...params: unknown[]) => Record<string, unknown> | undefined;
    run: (...params: unknown[]) => unknown;
  };
};

const dbs: TestDb[] = [];

class TestSqliteDb implements TestDb {
  private readonly db = new DatabaseSync(":memory:");

  exec(sql: string) {
    this.db.exec(sql);
  }

  prepare(sql: string) {
    return this.db.prepare(sql) as ReturnType<TestDb["prepare"]>;
  }

  transaction(fn: () => void) {
    return () => {
      this.db.exec("begin");
      try {
        fn();
        this.db.exec("commit");
      } catch (error) {
        this.db.exec("rollback");
        throw error;
      }
    };
  }

  close() {
    this.db.close();
  }
}

function createManager(ttlMs?: number) {
  const db = new TestSqliteDb();
  dbs.push(db);
  const manager = new ConversationTempSourceManager(db, ttlMs);
  manager.migrate();
  return { db, manager };
}

function csvBuffer(content: string) {
  return new TextEncoder().encode(content);
}

function importInput(content: string, patch: Partial<Parameters<ConversationTempSourceManager["importCsv"]>[0]> = {}) {
  const fileBuffer = csvBuffer(content);
  return {
    conversationId: "conversation-1",
    userId: "user-1",
    fileName: "风险数据.csv",
    fileSizeBytes: fileBuffer.byteLength,
    fileBuffer,
    mimeType: "text/csv",
    ...patch,
  };
}

afterEach(() => {
  for (const db of dbs.splice(0)) {
    db.close();
  }
});

describe("quoteSqliteIdentifier", () => {
  it("quotes Chinese identifiers and escapes internal double quotes", () => {
    expect(quoteSqliteIdentifier("贷款余额（万元）")).toBe("\"贷款余额（万元）\"");
    expect(quoteSqliteIdentifier("客户\"名称")).toBe("\"客户\"\"名称\"");
  });

  it("rejects unsafe identifiers", () => {
    expect(() => quoteSqliteIdentifier("")).toThrow("不能为空");
    expect(() => quoteSqliteIdentifier("abc\u0000def")).toThrow("NUL");
    expect(() => quoteSqliteIdentifier("x".repeat(129))).toThrow("128");
  });
});

describe("ConversationTempSourceManager", () => {
  it("imports UTF-8 BOM CSV with Chinese headers and queries quoted fields", () => {
    const { db, manager } = createManager();
    const attachment = manager.importCsv(importInput("\uFEFF合同编号,客户名称,五级分类,贷款余额（万元）\nHT001,客户A,正常,1200.50\nHT002,客户B,关注,30"));

    expect(attachment.status).toBe("ready");
    expect(attachment.rowCount).toBe(2);
    expect(attachment.columnCount).toBe(4);
    expect(attachment.columns?.map((column) => column.sqliteColumnName)).toEqual(["合同编号", "客户名称", "五级分类", "贷款余额（万元）"]);

    const rows = db.prepare(
      `select ${quoteSqliteIdentifier("五级分类")} as risk_class, sum(${quoteSqliteIdentifier("贷款余额（万元）")}) as balance
       from ${quoteSqliteIdentifier(attachment.sqliteTableName!)}
       group by ${quoteSqliteIdentifier("五级分类")}
       order by balance desc`,
    ).all();

    expect(rows).toEqual([
      { risk_class: "正常", balance: 1200.5 },
      { risk_class: "关注", balance: 30 },
    ]);
  });

  it("renames duplicate and empty headers while preserving source names", () => {
    const { manager } = createManager();
    const attachment = manager.importCsv(importInput("金额,金额,,\n10,20,30,40"));

    expect(attachment.columns?.map((column) => column.sqliteColumnName)).toEqual(["金额", "金额_2", "未命名字段_3", "未命名字段_4"]);
    expect(attachment.columns?.[1]?.sourceHeader).toBe("金额");
    expect(attachment.columns?.[1]?.warnings?.join("\n")).toContain("重复表头");
    expect(attachment.columns?.[2]?.warnings?.join("\n")).toContain("空表头");
  });

  it("supports quoted commas and embedded newlines", () => {
    const { db, manager } = createManager();
    const attachment = manager.importCsv(importInput("合同编号,备注\nHT001,\"第一行\n第二行,含逗号\"\nHT002,普通备注"));
    const rows = db.prepare(
      `select ${quoteSqliteIdentifier("备注")} as note from ${quoteSqliteIdentifier(attachment.sqliteTableName!)} order by __row_index`,
    ).all();

    expect(rows).toEqual([
      { note: "第一行\n第二行,含逗号" },
      { note: "普通备注" },
    ]);
  });

  it("allows header-only CSV and returns a warning", () => {
    const { db, manager } = createManager();
    const attachment = manager.importCsv(importInput("合同编号,贷款余额（万元）\n"));

    expect(attachment.status).toBe("ready");
    expect(attachment.rowCount).toBe(0);
    expect(attachment.warnings).toContain("CSV 仅包含表头，暂无数据行。");
    expect(db.prepare(`select count(*) as count from ${quoteSqliteIdentifier(attachment.sqliteTableName!)}`).get()).toEqual({ count: 0 });
  });

  it("rejects non-CSV files, empty files and files over 10 MB", () => {
    const { manager } = createManager();

    expect(() => manager.importCsv(importInput("a,b\n1,2", { fileName: "data.txt", mimeType: "" }))).toThrow("仅支持上传 CSV 文件");
    expect(() => manager.importCsv(importInput("", { fileSizeBytes: 0, fileBuffer: new Uint8Array() }))).toThrow("不能为空");
    expect(() =>
      manager.importCsv(importInput("a,b\n1,2", { fileSizeBytes: CHAT_CSV_MAX_FILE_SIZE_BYTES + 1 })),
    ).toThrow("10 MB");
    expect(() => manager.importCsv(importInput("\n\n"))).toThrow("不能为空");
  });

  it("rejects unauthorized, expired and unknown chat_csv table references", () => {
    const { manager } = createManager();
    const attachment = manager.importCsv(importInput("合同编号,金额\nHT001,10"));
    const sql = `select count(*) from ${quoteSqliteIdentifier(attachment.sqliteTableName!)}`;

    expect(() => manager.assertSqlCanAccessTempTables({ sql, conversationId: "conversation-1", userId: "user-1" })).not.toThrow();
    expect(() => manager.assertSqlCanAccessTempTables({ sql, conversationId: "conversation-2", userId: "user-1" })).toThrow("未授权");
    expect(() => manager.assertSqlCanAccessTempTables({ sql: 'select * from "chat_csv_missing_1"', conversationId: "conversation-1", userId: "user-1" })).toThrow("未授权");
  });

  it("allows SQL access to authorized chat CSV fields after table authorization", () => {
    const { manager } = createManager();
    const attachment = manager.importCsv(importInput("合同编号,贷款余额（万元）,客户名称\nHT001,1200.50,客户A"));
    const balanceColumn = attachment.columns?.find((column) => column.sourceHeader === "贷款余额（万元）")!;

    expect(() =>
      manager.assertSqlCanAccessTempTables({
        sql: `select ${quoteSqliteIdentifier(balanceColumn.sqliteColumnName)} from ${quoteSqliteIdentifier(attachment.sqliteTableName!)}`,
        conversationId: "conversation-1",
        userId: "user-1",
      }),
    ).not.toThrow();
    expect(() =>
      manager.assertSqlCanAccessTempTables({
        sql: `select count(*) from ${quoteSqliteIdentifier(attachment.sqliteTableName!)}`,
        conversationId: "conversation-1",
        userId: "user-1",
      }),
    ).not.toThrow();
    expect(() =>
      manager.assertSqlCanAccessTempTables({
        sql: `select * from ${quoteSqliteIdentifier(attachment.sqliteTableName!)}`,
        conversationId: "conversation-1",
        userId: "user-1",
      }),
    ).not.toThrow();
    expect(() =>
      manager.assertSqlCanAccessTempTables({
        sql: `select ${quoteSqliteIdentifier("客户名称")} from ${quoteSqliteIdentifier(attachment.sqliteTableName!)}`,
        conversationId: "conversation-1",
        userId: "user-1",
      }),
    ).not.toThrow();
  });

  it("cleans up expired sources and drops their SQLite tables", () => {
    const { db, manager } = createManager();
    const attachment = manager.importCsv(importInput("合同编号,金额\nHT001,10", { ttlMs: -1 }));

    const result = manager.cleanupExpired();

    expect(result.removedSources).toBe(1);
    expect(result.removedTables).toBe(1);
    expect(db.prepare("select status from conversation_temp_data_sources where id = ?").get(attachment.tempDataSourceId)).toEqual({ status: "expired" });
    expect(() => db.prepare(`select count(*) from ${quoteSqliteIdentifier(attachment.sqliteTableName!)}`).get()).toThrow();
  });

  it("cleans all conversation temp source metadata when a conversation is deleted", () => {
    const { db, manager } = createManager();
    const attachment = manager.importCsv(importInput("合同编号,金额\nHT001,10"));
    db.prepare("update conversation_temp_data_sources set status = 'expired' where id = ?").run(attachment.tempDataSourceId);

    manager.cleanupConversation("conversation-1", "user-1");

    expect(db.prepare("select status from conversation_temp_data_sources where id = ?").get(attachment.tempDataSourceId)).toEqual({ status: "deleted" });
    expect(() => db.prepare(`select count(*) from ${quoteSqliteIdentifier(attachment.sqliteTableName!)}`).get()).toThrow();
  });

  it("builds schema context for all table fields and can fall back to the first 100 fields", () => {
    const { manager } = createManager();
    const attachment = manager.importCsv(importInput("合同编号,贷款余额（万元）,客户名称\nHT001,1200.50,客户A\nHT002,30,客户B"));
    const markdown = manager.buildSchemaContextMarkdown({
      conversationId: "conversation-1",
      userId: "user-1",
      tempDataSourceIds: [attachment.tempDataSourceId!],
    });
    const limitedAttachment = manager.importCsv(importInput(`${Array.from({ length: 102 }, (_, index) => `字段${index + 1}`).join(",")}\n${Array.from({ length: 102 }, (_, index) => index + 1).join(",")}`));
    const limitedMarkdown = manager.buildSchemaContextMarkdown({
      conversationId: "conversation-1",
      userId: "user-1",
      tempDataSourceIds: [limitedAttachment.tempDataSourceId!],
      maxFieldsPerSource: 100,
    });

    expect(markdown).toContain("## 本轮 CSV 全表字段清单");
    expect(markdown).toContain(`- SQLite 临时表：${attachment.sqliteTableName}`);
    expect(markdown).toContain("- 表字段总数：3");
    expect(markdown).toContain("- 本轮注入字段数：3");
    expect(markdown).toContain("| 贷款余额（万元） | 贷款余额（万元） | \"贷款余额（万元）\" | decimal | NUMERIC | 1200.50, 30 |");
    expect(markdown).toContain("客户名称");
    expect(markdown).not.toContain("/Users/");
    expect(markdown).not.toContain("HT001,1200.50");
    expect(limitedMarkdown).toContain("仅注入前 100 个字段");
    expect(limitedMarkdown).toContain("- 表字段总数：102");
    expect(limitedMarkdown).toContain("- 本轮注入字段数：100");
    expect(limitedMarkdown).toContain("字段100");
    expect(limitedMarkdown).not.toContain("字段101");
  });

  it("uses selected_fields schema context when chat field refs are selected", () => {
    const { manager } = createManager();
    const header = Array.from({ length: 500 }, (_, index) => `字段${index + 1}`).join(",");
    const row = Array.from({ length: 500 }, (_, index) => index + 1).join(",");
    const attachment = manager.importCsv(importInput(`${header}\n${row}`));
    const markdown = manager.buildSchemaContextMarkdown({
      conversationId: "conversation-1",
      userId: "user-1",
      tempDataSourceIds: [attachment.tempDataSourceId!],
      selectedFieldRefs: [
        {
          tokenId: "token-field-2",
          type: "csv_field",
          tempDataSourceId: attachment.tempDataSourceId!,
          tempTableId: attachment.tempTableId!,
          fieldId: "field-2",
          sourceHeader: "字段2",
          physicalName: "字段2",
          displayName: "字段2",
          logicalType: "integer",
          sqliteType: "INTEGER",
          rawText: "#字段2",
          start: 0,
          end: 4,
          createdAt: "2026-07-20T00:00:00.000Z",
          status: "valid",
        },
        {
          tokenId: "token-field-499",
          type: "csv_field",
          tempDataSourceId: attachment.tempDataSourceId!,
          tempTableId: attachment.tempTableId!,
          fieldId: "field-499",
          sourceHeader: "字段499",
          physicalName: "字段499",
          displayName: "字段499",
          logicalType: "integer",
          sqliteType: "INTEGER",
          rawText: "#字段499",
          start: 5,
          end: 11,
          createdAt: "2026-07-20T00:00:00.000Z",
          status: "valid",
        },
      ],
    });

    expect(resolveSchemaContextMode({ selectedFieldRefs: [] })).toBe("schema_summary");
    expect(resolveSchemaContextMode({ selectedFieldRefs: [{ status: "valid" } as never] })).toBe("selected_fields");
    expect(resolveSchemaContextMode({ selectedFieldRefs: [{ status: "valid" } as never], requiresFullSchema: true })).toBe("full_schema");
    expect(markdown).toContain("Schema Context Mode：selected_fields");
    expect(markdown).toContain("- 表字段总数：500");
    expect(markdown).toContain("- 本轮注入字段数：2");
    expect(markdown).toContain("| field-2 | #字段2 | 字段2 | 字段2 | \"字段2\" | integer | INTEGER |");
    expect(markdown).toContain("| field-499 | #字段499 | 字段499 | 字段499 | \"字段499\" | integer | INTEGER |");
    expect(markdown).not.toContain("字段498");
    expect(markdown).not.toContain("字段500");
    expect(markdown).not.toContain("脱敏样例");
  });
});
