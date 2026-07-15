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

type DictionaryTestField = { source: string; zh: string; en: string; businessId: string; logical: string; sqlite: string; nullable?: boolean; unique?: boolean; primary?: boolean; constraints?: string; comment?: string };

function dictionaryCsv(fields: DictionaryTestField[]) {
  return [
    "field_order,field_name_zh,field_name_en,business_field_id,source_field_name,logical_type,source_type,sqlite_type,mysql_type,nullable,unique,primary_key,constraints_json,source_example,field_comment,aliases,sensitivity",
    ...fields.map((field, index) =>
      [
        index + 1,
        field.zh,
        field.en,
        field.businessId,
        field.source,
        field.logical,
        field.logical === "decimal" ? "number" : "string",
        field.sqlite,
        field.sqlite === "NUMERIC" ? "DECIMAL(18.2)" : "VARCHAR(128)",
        String(field.nullable ?? true),
        String(field.unique ?? false),
        String(field.primary ?? false),
        `"${(field.constraints ?? "{}").replaceAll('"', '""')}"`,
        "",
        field.comment ?? field.zh,
        "",
        field.businessId.includes("balance") || field.businessId.includes("amount") ? "sensitive" : "internal",
      ].join(","),
    ),
  ].join("\n");
}

function importCsvWithDictionary(store: DataManagementStore, fileId: string, userId = "usr_admin", fields: DictionaryTestField[] = [
  { source: "customer_id", zh: "合同编号", en: "contract_id", businessId: "credit.contract_id", logical: "identifier", sqlite: "TEXT", nullable: false, unique: true, primary: true },
  { source: "remark", zh: "产品名称", en: "product_name", businessId: "credit.product_name", logical: "string", sqlite: "TEXT" },
]) {
  const dictionary = store.uploadCsv("table_dictionary.csv", dictionaryCsv(fields));
  const result = store.importCsv(fileId, userId, dictionary.file.id);
  if (!result || !result.success) {
    throw new Error(result?.success === false ? result.error.message : "CSV import failed.");
  }
  return result;
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

    const imported = importCsvWithDictionary(store, upload.file.id);
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
    const imported = importCsvWithDictionary(store, upload.file.id);

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
      const imported = importCsvWithDictionary(store, upload.file.id, "usr_admin", [
        { source: "contract_no", zh: "合同编号", en: "contract_id", businessId: "credit.contract_id", logical: "identifier", sqlite: "TEXT", nullable: false, unique: true, primary: true },
        { source: "loan_balance_10k", zh: "贷款余额", en: "loan_balance", businessId: "credit.loan_balance", logical: "decimal", sqlite: "NUMERIC", nullable: false },
        { source: "contract_amount_10k", zh: "合同金额", en: "contract_amount", businessId: "credit.contract_amount", logical: "decimal", sqlite: "NUMERIC" },
        { source: "latest_risk_result", zh: "五级分类", en: "five_level_classification", businessId: "credit.five_level_classification", logical: "category", sqlite: "TEXT", nullable: false },
      ]);
      const table = imported ? store.tableDetail(imported.job.dataSourceId, imported.job.importedTableId) : null;

      expect(table?.columns.find((column) => column.name === "contract_id")?.businessFieldId).toBe("credit.contract_id");
      expect(table?.columns.find((column) => column.name === "loan_balance")?.type).toBe("decimal(18,4)");
      expect(table?.columns.find((column) => column.name === "contract_amount")?.displayNameZh).toBe("合同金额");
      expect(table?.columns.find((column) => column.name === "five_level_classification")?.type).toBe("text");

      const sample = imported ? store.sampleData(imported.job.dataSourceId, imported.job.importedTableId, "usr_admin", "trace-csv-types") : null;
      expect(sample?.rows[0]?.contract_id).toBe("000123");
      expect(table?.sampleRows[0]?.loan_balance).toBe(1234.5);
      expect(table?.sampleRows[0]?.contract_amount).toBe(2800.75);
      expect(sample?.rows[0]?.five_level_classification).toBe("0201--关注1");

      const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
      const sqliteTable = sqlite.prepare("SELECT sqlite_table_name FROM csv_dataset_tables WHERE data_source_id = ?").get(imported?.job.dataSourceId);
      const sqliteTypes = sqlite.prepare(`PRAGMA table_info("${sqliteTable.sqlite_table_name}")`).all() as Array<{ name: string; type: string }>;
      sqlite.close();
      expect(sqliteTypes.find((column) => column.name === "loan_balance")?.type).toBe("REAL");
      expect(sqliteTypes.find((column) => column.name === "contract_amount")?.type).toBe("REAL");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves overall risk skill fields from uploaded loan contract dictionary ids", () => {
    const store = new DataManagementStore();
    const upload = store.uploadCsv(
      "loan_contracts_standardized.csv",
      [
        "contract_serial,latest_risk,latest_five_level_risk,latest_risk_result,loan_balance_10k,contract_amount_10k",
        "C001,正常,正常,0101--正常1,1250.5,1600",
        "C002,不良,关注,0203--关注3,300,500",
      ].join("\n"),
    );
    const imported = importCsvWithDictionary(store, upload.file.id, "usr_admin", [
      { source: "contract_serial", zh: "合同流水号", en: "contract_serial", businessId: "bf.loan_contract.contract_serial", logical: "identifier", sqlite: "TEXT", nullable: false, unique: true, primary: true },
      { source: "latest_risk", zh: "最新风险分类", en: "latest_risk", businessId: "bf.loan_contract.latest_risk", logical: "enum", sqlite: "TEXT", nullable: false },
      { source: "latest_five_level_risk", zh: "最新风险五级分类", en: "latest_five_level_risk", businessId: "bf.loan_contract.latest_five_level_risk", logical: "enum", sqlite: "TEXT", nullable: false },
      { source: "latest_risk_result", zh: "最新风险分类结果", en: "latest_risk_result", businessId: "bf.loan_contract.latest_risk_result", logical: "enum", sqlite: "TEXT" },
      { source: "loan_balance_10k", zh: "贷款余额(万元)", en: "loan_balance_10k", businessId: "bf.loan_contract.loan_balance_10k", logical: "amount", sqlite: "NUMERIC", nullable: false },
      { source: "contract_amount_10k", zh: "合同金额(万元)", en: "contract_amount_10k", businessId: "bf.loan_contract.contract_amount_10k", logical: "amount", sqlite: "NUMERIC" },
    ]);
    const resolved = store.resolveSkillFields({
      skillId: "overall-risk-classification-distribution",
      dataSourceId: imported.job.dataSourceId,
    });

    expect(resolved.ready).toBe(true);
    expect(resolved.missingRequiredFields).toEqual([]);
    expect(resolved.ambiguousFields).toEqual([]);
    expect(Object.fromEntries(resolved.resolvedFields.map((field) => [field.businessFieldId, field.physicalName]))).toMatchObject({
      "bf.loan_contract.contract_serial": "contract_serial",
      "bf.loan_contract.latest_risk": "latest_risk",
      "bf.loan_contract.latest_risk_result": "latest_risk_result",
      "bf.loan_contract.loan_balance_10k": "loan_balance_10k",
      "bf.loan_contract.contract_amount_10k": "contract_amount_10k",
    });
  });

  it("keeps previous CSV table names as SQL aliases after rename", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lifecycle-x-csv-alias-"));
    const storePath = join(tempDir, "data-management-store.json");
    const sqlitePath = join(tempDir, "csv-data.sqlite");

    try {
      const store = new DataManagementStore(storePath, sqlitePath);
      const upload = store.uploadCsv("loan_contracts_1000.csv", "customer_id,remark\nC01,ok\n");
      const imported = importCsvWithDictionary(store, upload.file.id);
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
      const imported = importCsvWithDictionary(store, upload.file.id);
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
      const imported = importCsvWithDictionary(store, upload.file.id);
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

  it("rejects CSV imports without a table dictionary", () => {
    const store = new DataManagementStore();
    const upload = store.uploadCsv("manual.csv", "customer_id,remark\nC01,ok\n");
    const imported = store.importCsv(upload.file.id, "usr_admin");

    expect(imported?.success).toBe(false);
    expect(imported?.success === false ? imported.error.code : "").toBe("DICTIONARY_FILE_NOT_FOUND");
  });

  it("persists semantic CSV columns in SQLite metadata", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lifecycle-x-wide-csv-"));
    const storePath = join(tempDir, "data-management-store.json");
    const sqlitePath = join(tempDir, "csv-data.sqlite");

    try {
      const store = new DataManagementStore(storePath, sqlitePath);
      const upload = store.uploadCsv("semantic.csv", "contract_no,loan_balance_10k,contract_amount_10k,latest_risk_result\nC01,100.25,300,正常\n");
      const imported = importCsvWithDictionary(store, upload.file.id, "usr_admin", [
        { source: "contract_no", zh: "合同编号", en: "contract_id", businessId: "credit.contract_id", logical: "identifier", sqlite: "TEXT", nullable: false, unique: true, primary: true },
        { source: "loan_balance_10k", zh: "贷款余额", en: "loan_balance", businessId: "credit.loan_balance", logical: "decimal", sqlite: "NUMERIC", nullable: false },
        { source: "contract_amount_10k", zh: "合同金额", en: "contract_amount", businessId: "credit.contract_amount", logical: "decimal", sqlite: "NUMERIC" },
        { source: "latest_risk_result", zh: "五级分类", en: "five_level_classification", businessId: "credit.five_level_classification", logical: "category", sqlite: "TEXT", nullable: false },
      ]);
      expect(imported?.job.status).toBe("completed");

      const sample = imported ? store.sampleData(imported.job.dataSourceId, imported.job.importedTableId, "usr_admin", "trace-sqlite-wide-csv") : null;
      expect(sample?.columns.map((column) => column.name)).toEqual(["contract_id", "loan_balance", "contract_amount", "five_level_classification"]);
      expect(sample?.columns.find((column) => column.name === "loan_balance")?.displayNameZh).toBe("贷款余额");
      const table = imported ? store.tableDetail(imported.job.dataSourceId, imported.job.importedTableId) : null;
      expect(table?.sampleRows[0]?.loan_balance).toBe(100.25);

      const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
      const metadataCount = sqlite
        .prepare("SELECT COUNT(*) AS count FROM csv_dataset_columns WHERE data_source_id = ?")
        .get(imported?.job.dataSourceId);
      const semantic = sqlite
        .prepare("SELECT source_header, physical_name, business_field_id, display_name_zh FROM csv_dataset_columns WHERE data_source_id = ? AND name = ?")
        .get(imported?.job.dataSourceId, "loan_balance") as { source_header: string; physical_name: string; business_field_id: string; display_name_zh: string };
      sqlite.close();
      expect(metadataCount.count).toBe(4);
      expect(semantic).toEqual({
        source_header: "loan_balance_10k",
        physical_name: "loan_balance",
        business_field_id: "credit.loan_balance",
        display_name_zh: "贷款余额",
      });
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
      const imported = importCsvWithDictionary(store, upload.file.id);
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
