import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataManagementStore } from "./dataManagementStore.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => any };

function createStoreWithMysqlSource() {
  const store = new DataManagementStore();
  const source = store.createDataSource(
    {
      name: "测试业务库",
      type: "mysql",
      environment: "production",
      host: "readonly.core-bank.internal",
      port: 3306,
      database: "post_loan",
      username: "probe_readonly",
      password: "test-secret",
      readonly: true,
    },
    "usr_admin",
  );
  if (!source) {
    throw new Error("Failed to create test data source.");
  }

  return { store, source };
}

describe("DataManagementStore", () => {
  it("starts without default connection data", () => {
    const store = new DataManagementStore();

    expect(store.listDataSources()).toEqual([]);
  });

  it("creates data sources without exposing credential secrets", () => {
    const { store, source } = createStoreWithMysqlSource();

    expect(source.type).toBe("mysql");
    expect(source.credentialStatus).toBe("configured");
    expect(JSON.stringify(store.listDataSources())).not.toContain("test-secret");
  });

  it("serves metadata, safe sample rows and large table plans", () => {
    const { store, source } = createStoreWithMysqlSource();

    const tables = store.listTables(source.id);
    const largeTable = tables.find((table) => table.isLarge && table.isSensitive);
    expect(largeTable).toBeDefined();
    if (!largeTable) {
      return;
    }

    const plan = store.largeTablePlan(source.id, largeTable.id, "usr_admin", "trace-plan");
    expect(plan?.requiresConfirmation).toBe(true);
    expect(plan?.strategy).toBe("keyset-pagination");

    const sample = store.sampleData(source.id, largeTable.id, "usr_admin", "trace-sample");
    expect(sample?.rows).toHaveLength(3);
    expect(sample?.policy.maskedFields).toContain("customer_name");
    expect(sample?.policy.skippedLargeFields).toContain("profile_json");
    expect(sample?.rows[0]).not.toHaveProperty("profile_json");
  });

  it("imports CSV content as an isolated data source", () => {
    const store = new DataManagementStore();
    const upload = store.uploadCsv("manual.csv", "customer_id,remark\nC01,ok\n");
    const preview = store.previewCsv(upload.file.id);
    expect(preview?.preview.headers).toEqual(["customer_id", "remark"]);

    const imported = store.importCsv(upload.file.id, "usr_admin");
    expect(imported?.job.status).toBe("completed");
    expect(store.listDataSources().some((source) => source.type === "csv")).toBe(true);

    const removed = imported ? store.deleteCsvDataSource(imported.job.dataSourceId) : null;
    expect(removed?.success).toBe(true);
    expect(store.listDataSources().some((source) => source.type === "csv")).toBe(false);
  });

  it("imports all CSV rows and supports renaming imported tables", () => {
    const store = new DataManagementStore();
    const rows = Array.from({ length: 1000 }, (_, index) => `C${index + 1},remark-${index + 1}`);
    const upload = store.uploadCsv("bulk.csv", `customer_id,remark\n${rows.join("\n")}\n`);
    const imported = store.importCsv(upload.file.id, "usr_admin");

    expect(imported?.job.importedRows).toBe(1000);
    const table = imported ? store.tableDetail(imported.job.dataSourceId, imported.job.importedTableId) : null;
    expect(table?.sampleRows).toHaveLength(1000);

    const sample = imported ? store.sampleData(imported.job.dataSourceId, imported.job.importedTableId, "usr_admin", "trace-csv") : null;
    expect(sample?.rows).toHaveLength(1000);

    const renamed = imported ? store.renameCsvDataSource(imported.job.dataSourceId, "贷后补充数据") : null;
    expect(renamed?.dataSource?.name).toBe("贷后补充数据");
    expect(renamed?.table?.name).toBe("贷后补充数据");
  });

  it("infers numeric CSV fields and keeps quoted comma values aligned", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lifecycle-x-csv-types-"));
    const storePath = join(tempDir, "data-management-store.json");
    const sqlitePath = join(tempDir, "csv-data.sqlite");

    try {
      const store = new DataManagementStore(storePath, sqlitePath);
      const upload = store.uploadCsv(
        "loan_contracts_500_v2.csv",
        [
          "contract_no,loan_balance_10k,contract_amount_10k,latest_risk_result",
          '000123,"1,234.50",2800.75,0201--关注1',
          "000124,10.25,3000,0300--次级",
        ].join("\n"),
      );
      const imported = store.importCsv(upload.file.id, "usr_admin");
      const table = imported ? store.tableDetail(imported.job.dataSourceId, imported.job.importedTableId) : null;

      expect(table?.columns.find((column) => column.name === "contract_no")?.type).toBe("text");
      expect(table?.columns.find((column) => column.name === "loan_balance_10k")?.type).toBe("decimal(18,4)");
      expect(table?.columns.find((column) => column.name === "contract_amount_10k")?.type).toBe("decimal(18,4)");
      expect(table?.columns.find((column) => column.name === "latest_risk_result")?.type).toBe("text");

      const sample = imported ? store.sampleData(imported.job.dataSourceId, imported.job.importedTableId, "usr_admin", "trace-csv-types") : null;
      expect(sample?.rows[0]?.contract_no).toBe("000123");
      expect(sample?.rows[0]?.loan_balance_10k).toBe(1234.5);
      expect(sample?.rows[0]?.contract_amount_10k).toBe(2800.75);
      expect(sample?.rows[0]?.latest_risk_result).toBe("0201--关注1");

      const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
      const sqliteTable = sqlite.prepare("SELECT sqlite_table_name FROM csv_dataset_tables WHERE data_source_id = ?").get(imported?.job.dataSourceId);
      const sqliteTypes = sqlite.prepare(`PRAGMA table_info("${sqliteTable.sqlite_table_name}")`).all() as Array<{ name: string; type: string }>;
      sqlite.close();
      expect(sqliteTypes.find((column) => column.name === "loan_balance_10k")?.type).toBe("REAL");
      expect(sqliteTypes.find((column) => column.name === "contract_amount_10k")?.type).toBe("REAL");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps previous CSV table names as SQL aliases after rename", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lifecycle-x-csv-alias-"));
    const storePath = join(tempDir, "data-management-store.json");
    const sqlitePath = join(tempDir, "csv-data.sqlite");

    try {
      const store = new DataManagementStore(storePath, sqlitePath);
      const upload = store.uploadCsv("loan_contracts_1000.csv", "customer_id,remark\nC01,ok\n");
      const imported = store.importCsv(upload.file.id, "usr_admin");
      expect(imported?.job.importedRows).toBe(1);

      const renamed = imported ? store.renameCsvDataSource(imported.job.dataSourceId, "切片测试数据") : null;
      expect(renamed?.dataSource?.name).toBe("切片测试数据");

      const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
      const meta = sqlite
        .prepare("SELECT display_name, aliases_json FROM csv_dataset_tables WHERE data_source_id = ?")
        .get(imported?.job.dataSourceId) as { display_name: string; aliases_json: string };
      sqlite.close();

      expect(meta.display_name).toBe("切片测试数据");
      expect(JSON.parse(meta.aliases_json)).toContain("loan_contracts_1000");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("backfills CSV aliases from original file name for already-renamed local data", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lifecycle-x-csv-alias-migration-"));
    const storePath = join(tempDir, "data-management-store.json");
    const sqlitePath = join(tempDir, "csv-data.sqlite");

    try {
      const store = new DataManagementStore(storePath, sqlitePath);
      const upload = store.uploadCsv("loan_contracts_1000.csv", "customer_id,remark\nC01,ok\n");
      const imported = store.importCsv(upload.file.id, "usr_admin");
      const renamed = imported ? store.renameCsvDataSource(imported.job.dataSourceId, "切片数据文件") : null;
      expect(renamed?.dataSource?.name).toBe("切片数据文件");

      const sqlite = new DatabaseSync(sqlitePath);
      sqlite
        .prepare("UPDATE csv_dataset_tables SET aliases_json = '[]' WHERE data_source_id = ?")
        .run(imported?.job.dataSourceId);
      sqlite.close();

      const restored = new DataManagementStore(storePath, sqlitePath);
      const restoredSource = restored.listDataSources().find((source) => source.type === "csv");
      expect(restoredSource?.name).toBe("切片数据文件");

      const readonlySqlite = new DatabaseSync(sqlitePath, { readOnly: true });
      const meta = readonlySqlite
        .prepare("SELECT aliases_json FROM csv_dataset_tables WHERE data_source_id = ?")
        .get(imported?.job.dataSourceId) as { aliases_json: string };
      readonlySqlite.close();

      expect(JSON.parse(meta.aliases_json)).toContain("loan_contracts_1000");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("restores imported CSV data from the local persistence snapshot", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lifecycle-x-data-store-"));
    const storePath = join(tempDir, "data-management-store.json");
    const sqlitePath = join(tempDir, "csv-data.sqlite");

    try {
      const store = new DataManagementStore(storePath, sqlitePath);
      const rows = Array.from({ length: 1000 }, (_, index) => `C${index + 1},remark-${index + 1}`);
      const upload = store.uploadCsv("bulk.csv", `customer_id,remark\n${rows.join("\n")}\n`);
      const imported = store.importCsv(upload.file.id, "usr_admin");
      expect(imported?.job.importedRows).toBe(1000);

      const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
      const sqliteTable = sqlite.prepare("SELECT sqlite_table_name FROM csv_dataset_tables WHERE data_source_id = ?").get(imported?.job.dataSourceId);
      expect(sqliteTable?.sqlite_table_name).toMatch(/^csv_ds_csv_/);
      const sqliteRows = sqlite.prepare(`SELECT COUNT(*) AS count FROM "${sqliteTable.sqlite_table_name}"`).get();
      expect(sqliteRows.count).toBe(1000);
      sqlite.close();

      const restored = new DataManagementStore(storePath, sqlitePath);
      const restoredSource = restored.listDataSources().find((source) => source.type === "csv");
      expect(restoredSource?.name).toBe("bulk");
      expect(restoredSource?.credentialStatus).toBe("configured");

      const restoredTables = restoredSource ? restored.listTables(restoredSource.id) : [];
      expect(restoredTables[0]?.sampleRows).toHaveLength(20);
      expect(restored.sampleData(restoredSource?.id ?? "", restoredTables[0]?.id ?? "", "usr_admin", "trace-csv")?.rows).toHaveLength(1000);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("marks CSV imports with 100 or more fields as large tables", () => {
    const store = new DataManagementStore();
    const headers = Array.from({ length: 100 }, (_, index) => `field_${index + 1}`);
    const upload = store.uploadCsv("wide.csv", `${headers.join(",")}\n${headers.map(() => "value").join(",")}\n`);
    const imported = store.importCsv(upload.file.id, "usr_admin");

    expect(imported?.job.status).toBe("completed");
    const table = imported ? store.tableDetail(imported.job.dataSourceId, imported.job.importedTableId) : null;
    expect(table?.columns).toHaveLength(100);
    expect(table?.isLarge).toBe(true);

    const sample = imported ? store.sampleData(imported.job.dataSourceId, imported.job.importedTableId, "usr_admin", "trace-wide-csv") : null;
    expect(sample?.columns).toHaveLength(100);
    expect(sample?.policy.maxFields).toBe(100);
    expect(sample?.rows[0]).toHaveProperty("field_100");
  });

  it("persists all CSV columns in SQLite without field-limit cropping", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lifecycle-x-wide-csv-"));
    const storePath = join(tempDir, "data-management-store.json");
    const sqlitePath = join(tempDir, "csv-data.sqlite");

    try {
      const store = new DataManagementStore(storePath, sqlitePath);
      const headers = Array.from({ length: 64 }, (_, index) => `field_${index + 1}`);
      const upload = store.uploadCsv("wide.csv", `${headers.join(",")}\n${headers.map((header) => `${header}_value`).join(",")}\n`);
      const imported = store.importCsv(upload.file.id, "usr_admin");
      expect(imported?.job.status).toBe("completed");

      const sample = imported ? store.sampleData(imported.job.dataSourceId, imported.job.importedTableId, "usr_admin", "trace-sqlite-wide-csv") : null;
      expect(sample?.columns.map((column) => column.name)).toEqual(headers);
      expect(sample?.rows[0]?.field_64).toBe("field_64_value");

      const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
      const metadataCount = sqlite
        .prepare("SELECT COUNT(*) AS count FROM csv_dataset_columns WHERE data_source_id = ?")
        .get(imported?.job.dataSourceId);
      sqlite.close();
      expect(metadataCount.count).toBe(64);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("removes SQLite CSV rows when deleting an imported data source", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lifecycle-x-data-store-"));
    const storePath = join(tempDir, "data-management-store.json");
    const sqlitePath = join(tempDir, "csv-data.sqlite");

    try {
      const store = new DataManagementStore(storePath, sqlitePath);
      const upload = store.uploadCsv("cleanup.csv", "customer_id,remark\nC01,ok\nC02,done\n");
      const imported = store.importCsv(upload.file.id, "usr_admin");
      expect(imported?.job.status).toBe("completed");

      const removed = imported ? store.deleteCsvDataSource(imported.job.dataSourceId) : null;
      expect(removed?.success).toBe(true);

      const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
      const metadataCount = sqlite.prepare("SELECT COUNT(*) AS count FROM csv_dataset_tables").get();
      const columnCount = sqlite.prepare("SELECT COUNT(*) AS count FROM csv_dataset_columns").get();
      expect(metadataCount.count).toBe(0);
      expect(columnCount.count).toBe(0);
      sqlite.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
