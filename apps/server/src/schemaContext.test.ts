import { describe, expect, it } from "vitest";
import { DataManagementStore } from "./dataManagementStore.js";
import { ToolContextBuilder, detectToolRequiredTasks } from "./schemaContext/index.js";

type DictionaryTestField = { source: string; zh: string; en: string; businessId: string; logical: string; sqlite: string; nullable?: boolean; unique?: boolean; primary?: boolean; constraints?: string };

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
        field.zh,
        "",
        "internal",
      ].join(","),
    ),
  ].join("\n");
}

function importCsvWithDictionary(store: DataManagementStore, fileId: string, fields: Parameters<typeof dictionaryCsv>[0]) {
  const dictionary = store.uploadCsv("table_dictionary.csv", dictionaryCsv(fields));
  const result = store.importCsv(fileId, "usr_admin", dictionary.file.id);
  if (!result || !result.success) {
    throw new Error(result?.success === false ? result.error.message : "CSV import failed.");
  }
  return result;
}

function createStoreWithSources() {
  const store = new DataManagementStore();
  const sqlSource = store.createDataSource(
    {
      name: "贷后核心业务库",
      type: "mysql",
      environment: "production",
      host: "readonly.core-bank.internal",
      port: 3306,
      database: "post_loan",
      username: "probe_readonly",
      password: "secret",
      readonly: true,
    },
    "usr_admin",
  );
  const csvUpload = store.uploadCsv("repayment_patch.csv", "customer_id,loan_amount,due_date,remark\nC01,1200,2026-07-01,ok\nC02,,2026-07-02,follow\n");
  const csvImport = importCsvWithDictionary(store, csvUpload.file.id, [
    { source: "customer_id", zh: "合同编号", en: "contract_id", businessId: "credit.contract_id", logical: "identifier", sqlite: "TEXT", nullable: false, unique: true, primary: true },
    { source: "loan_amount", zh: "合同金额", en: "contract_amount", businessId: "credit.contract_amount", logical: "decimal", sqlite: "NUMERIC" },
    { source: "due_date", zh: "报告日期", en: "report_date", businessId: "credit.report_date", logical: "date", sqlite: "TEXT" },
    { source: "remark", zh: "产品名称", en: "product_name", businessId: "credit.product_name", logical: "string", sqlite: "TEXT" },
  ]);
  if (!sqlSource || !csvImport) {
    throw new Error("Failed to create schema context test sources.");
  }
  return { store, sqlSource, csvImport };
}

describe("SchemaContextBuilder integration", () => {
  it("builds SQL and CSV schema context with safety policy and tool handles", async () => {
    const { store } = createStoreWithSources();

    const result = await store.schemaContext({
      userQuestion: "统计客户逾期风险趋势并生成图表",
      purpose: "risk_analysis",
    });

    expect(result.success).toBe(true);
    expect(result.context.dataSourceProfiles.some((profile) => profile.sourceType === "sql_database")).toBe(true);
    expect(result.context.dataSourceProfiles.some((profile) => profile.sourceType === "csv_sqlite_temp")).toBe(true);
    expect(result.context.markdown).toContain("不要基于 preview_rows 或 sample_rows 直接推断全量数据结论");
    expect(result.context.availableTools.map((tool) => tool.toolName)).toEqual(
      expect.arrayContaining(["get_data_source_profile", "request_sql_query_execution", "request_python_analysis_execution", "generate_chart"]),
    );
    expect(result.context.raw.toolRequiredTasks).toEqual(expect.arrayContaining(["trend_analysis", "chart_generation", "financial_data_analysis"]));
  });

  it("masks sensitive fields and never injects credential secrets", async () => {
    const { store } = createStoreWithSources();

    const result = await store.schemaContext({ userQuestion: "查看客户名称和证件号样例" });
    const serialized = JSON.stringify(result.context);

    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("91110108MA000001");
    expect(serialized).not.toContain("北京启明制造有限公司");
    expect(serialized).toContain("customer_name");
    expect(serialized).toContain("sensitive");
  });

  it("compresses by token budget while preserving safety policy and tools", async () => {
    const { store } = createStoreWithSources();

    const result = await store.schemaContext({
      tokenBudget: { maxChars: 1200, maxTables: 1, maxColumnsPerTable: 2, maxSampleRowsPerTable: 1 },
    });

    expect(result.context.markdown.length).toBeLessThanOrEqual(1200);
    expect(result.context.markdown).toContain("Usage Policy");
    expect(result.context.markdown).toContain("Available Tools");
    expect(result.context.warnings.some((warning) => warning.code === "CONTEXT_BUDGET_EXCEEDED")).toBe(true);
    expect(result.context.dataSourceProfiles[0]?.tables.length).toBeLessThanOrEqual(1);
    expect(result.context.dataSourceProfiles[0]?.tables[0]?.columns.length).toBeLessThanOrEqual(2);
  });

  it("filters denied data sources and allowed columns", async () => {
    const { store, sqlSource, csvImport } = createStoreWithSources();

    const result = await store.schemaContext({
      userPermissionContext: {
        deniedDataSourceIds: [csvImport.job.dataSourceId],
        allowedColumns: {
          [sqlSource.id]: {
            loan_customers: ["customer_id", "risk_level"],
          },
        },
      },
    });

    expect(result.context.dataSourceIds).not.toContain(csvImport.job.dataSourceId);
    const customerTable = result.context.dataSourceProfiles[0]?.tables.find((table) => table.tableName === "loan_customers");
    expect(customerTable?.columns.map((column) => column.columnName)).toEqual(["customer_id", "risk_level"]);
  });

  it("profiles CSV delimiter and UTF-8 BOM metadata", async () => {
    const store = new DataManagementStore();
    const semicolonUpload = store.uploadCsv("semicolon.csv", "\uFEFFcustomer_id;amount;due_date\nC01;1200;2026-07-01\n");
    const tabUpload = store.uploadCsv("tab.csv", "customer_id\tamount\tstatus\nC02\t900\tok\n");
    const semicolonImport = importCsvWithDictionary(store, semicolonUpload.file.id, [
      { source: "customer_id", zh: "合同编号", en: "contract_id", businessId: "credit.contract_id", logical: "identifier", sqlite: "TEXT", nullable: false, unique: true, primary: true },
      { source: "amount", zh: "合同金额", en: "contract_amount", businessId: "credit.contract_amount", logical: "decimal", sqlite: "NUMERIC" },
      { source: "due_date", zh: "报告日期", en: "report_date", businessId: "credit.report_date", logical: "date", sqlite: "TEXT" },
    ]);
    const tabImport = importCsvWithDictionary(store, tabUpload.file.id, [
      { source: "customer_id", zh: "合同编号", en: "contract_id", businessId: "credit.contract_id", logical: "identifier", sqlite: "TEXT", nullable: false, unique: true, primary: true },
      { source: "amount", zh: "合同金额", en: "contract_amount", businessId: "credit.contract_amount", logical: "decimal", sqlite: "NUMERIC" },
      { source: "status", zh: "产品名称", en: "product_name", businessId: "credit.product_name", logical: "string", sqlite: "TEXT" },
    ]);

    const result = await store.schemaContext({
      userPermissionContext: {
        allowedDataSourceIds: [semicolonImport?.job.dataSourceId ?? "", tabImport?.job.dataSourceId ?? ""],
      },
    });

    const profiles = result.context.dataSourceProfiles.filter((profile) => profile.sourceType === "csv_sqlite_temp");
    expect(profiles.map((profile) => profile.fileInfo?.delimiter)).toEqual(expect.arrayContaining([";", "\t"]));
    expect(profiles.find((profile) => profile.fileInfo?.fileName === "semicolon.csv")?.fileInfo?.encoding).toBe("utf-8-bom");
    expect(profiles.find((profile) => profile.fileInfo?.fileName === "semicolon.csv")?.tables[0]?.columns.map((column) => column.businessFieldId)).toEqual([
      "credit.contract_id",
      "credit.contract_amount",
      "credit.report_date",
    ]);
  });

  it("returns tool handle schemas and detects tool-required tasks", () => {
    const tools = new ToolContextBuilder().buildToolHandles();

    expect(tools.find((tool) => tool.toolName === "request_sql_query_execution")?.requiresUserApproval).toBe(true);
    expect(tools.find((tool) => tool.toolName === "generate_chart")?.inputSchema).toHaveProperty("properties");
    expect(detectToolRequiredTasks("按客户分组统计还款金额 Top 10 并画图")).toEqual(
      expect.arrayContaining(["group_by_statistics", "top_n_sorting", "chart_generation"]),
    );
  });
});
