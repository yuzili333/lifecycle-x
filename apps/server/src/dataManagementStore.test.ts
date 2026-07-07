import { describe, expect, it } from "vitest";
import { DataManagementStore } from "./dataManagementStore.js";

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
  });
});
