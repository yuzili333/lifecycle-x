import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  InMemoryWorkflowAuditLogger,
  InMemoryWorkflowMemoryBridge,
  InMemoryDatasetStateManager,
  InMemoryWorkflowStateStore,
  MarkdownReportWorkflowBridge,
  SQLiteDatasetStateManager,
  SQLiteMaterializer,
  SQLiteWorkflowAuditLogger,
  TempTableRegistry,
  WorkflowContextBuilder,
  WorkflowIntentRouter,
  WorkflowRuntime,
  type PythonWorkflowBridge,
  type SqlWorkflowBridge,
  type WorkflowSession,
} from "./workflowRuntime";

function testDb() {
  const dbPath = join(tmpdir(), `cycle-probe-workflow-test-${randomUUID()}.sqlite3`);
  const db = new FakeSqliteDb();
  const store = new InMemoryWorkflowStateStore();
  const datasets = new InMemoryDatasetStateManager(store);
  const materializer = new SQLiteMaterializer(db, { sqliteDatabasePath: dbPath, batchSize: 2 });
  const runtime = new WorkflowRuntime({
    stateStore: store,
    datasetStateManager: datasets,
    sqliteMaterializer: materializer,
    tempTableRegistry: new TempTableRegistry(),
    sqlToolBridge: mockSqlBridge(),
    pythonBridge: mockPythonBridge(),
  });
  return { db, dbPath, store, datasets, materializer, runtime };
}

class FakeSqliteDb {
  tables = new Map<string, { columns: string[]; rows: Record<string, unknown>[] }>();
  auditRows: Array<Record<string, unknown>> = [];
  private insertCount = 0;

  constructor(private readonly options: { failOnInsertAfter?: number } = {}) {}

  exec(_sql: string) {}

  transaction<T extends unknown[]>(fn: (...args: T) => void) {
    return (...args: T) => fn(...args);
  }

  prepare(sql: string) {
    const db = this;
    return {
      run(...params: unknown[]) {
        if (/insert into workflow_audit_logs/i.test(sql)) {
          db.auditRows.push({
            audit_id: params[0],
            workflow_id: params[1],
            conversation_id: params[2],
            event_type: params[3],
            level: params[4],
            message: params[5],
            payload_json: params[6],
            created_at: params[7],
          });
          return {};
        }
        const dropTable = sql.match(/drop table if exists "([^"]+)"/i)?.[1];
        if (dropTable) {
          db.tables.delete(dropTable);
          return {};
        }
        const createTable = sql.match(/create table "([^"]+)" \((.+)\)/i);
        if (createTable) {
          const columns = createTable[2].split(",").map((part) => part.trim().match(/^"([^"]+)"/)?.[1] ?? part.trim());
          db.tables.set(createTable[1], { columns, rows: [] });
          return {};
        }
        const insertTable = sql.match(/insert into "([^"]+)" \((.+)\) values/i);
        if (insertTable) {
          const table = db.tables.get(insertTable[1]);
          if (!table) {
            throw new Error(`missing table ${insertTable[1]}`);
          }
          if (db.options.failOnInsertAfter !== undefined && db.insertCount >= db.options.failOnInsertAfter) {
            throw new Error("simulated insert failure");
          }
          db.insertCount += 1;
          const columns = insertTable[2].split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
          table.rows.push(Object.fromEntries(columns.map((column, index) => [column, params[index]])));
          return {};
        }
        return {};
      },
      get(...params: unknown[]) {
        if (/select name from sqlite_master where type = 'table' and name = \?/i.test(sql)) {
          const tableName = params[0] as string;
          return db.tables.has(tableName) ? { name: tableName } : undefined;
        }
        const countTable = sql.match(/select count\(\*\) as count from "([^"]+)"/i)?.[1];
        if (countTable) {
          return { count: db.tables.get(countTable)?.rows.length ?? 0 };
        }
        return {};
      },
      all(...params: unknown[]) {
        if (/select \* from workflow_audit_logs where conversation_id = \? order by created_at desc/i.test(sql)) {
          const conversationId = params[0];
          return db.auditRows.filter((row) => row.conversation_id === conversationId).slice().reverse();
        }
        const table = sql.match(/select \* from "([^"]+)" limit/i)?.[1];
        if (table) {
          return db.tables.get(table)?.rows.slice(0, 20) ?? [];
        }
        return [];
      },
    };
  }

  close() {}
}

class RecordingWorkflowStateStore extends InMemoryWorkflowStateStore {
  readonly statuses: string[] = [];

  override async create(session: WorkflowSession) {
    this.statuses.push(session.status);
    return super.create(session);
  }

  override async update(workflowId: string, patch: Partial<WorkflowSession>) {
    if (patch.status) {
      this.statuses.push(patch.status);
    }
    return super.update(workflowId, patch);
  }
}

function mockSqlBridge(): SqlWorkflowBridge {
  return {
    createSqlRequest: async () => ({ sqlRequestId: randomUUID(), status: "pending_approval" }),
    executeApprovedSqlRequest: async () => ({
      sqlExecutionId: randomUUID(),
      columns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
    }),
  };
}

function mockPythonBridge(): PythonWorkflowBridge {
  return {
    createPythonRequest: async () => ({ pythonRequestId: randomUUID(), status: "pending_approval" }),
    executeApprovedPythonRequest: async () => ({ pythonExecutionId: randomUUID(), summary: "ok", artifacts: [] }),
  };
}

async function* rowsStream() {
  yield { id: 1, name: "A" };
  yield { id: 2, name: "B" };
  yield { id: 3, name: "C" };
}

describe("WorkflowIntentRouter", () => {
  it("routes core workflow intents with rules", () => {
    const router = new WorkflowIntentRouter();

    expect(router.detect("请查询客户逾期情况，分析特征并生成报告")).toBe("query_analyze_report");
    expect(router.detect("先帮我提取今年以来到期的客户数据")).toBe("extract_data");
    expect(router.detect("在上一轮结果中筛选逾期超过 30 天的客户")).toBe("refine_previous_dataset");
    expect(router.detect("确认这批数据无误")).toBe("confirm_dataset");
    expect(router.detect("生成报告")).toBe("generate_report");
    expect(router.detect("基于最近一轮查询结果，再筛选授信余额大于500万的客户并生成报告")).toBe("generate_report_with_more_query");
  });
});

describe("SQLiteWorkflowAuditLogger", () => {
  it("persists and reads workflow audit entries", async () => {
    const db = new FakeSqliteDb();
    const audit = new SQLiteWorkflowAuditLogger(db);

    await audit.writeWorkflowAudit({
      workflowId: "wf-audit",
      conversationId: "conv-audit",
      eventType: "dataset_materialized",
      level: "info",
      message: "数据集已物化。",
      payload: { datasetId: "dataset-1", rowCount: 2 },
    });

    const entries = audit.list("conv-audit");
    expect(entries).toHaveLength(1);
    expect(entries[0].workflowId).toBe("wf-audit");
    expect(entries[0].eventType).toBe("dataset_materialized");
    expect(entries[0].payload?.datasetId).toBe("dataset-1");
    db.close();
  });
});

describe("SQLiteMaterializer", () => {
  it("materializes rows and profiles a SQLite temp table", async () => {
    const { db, materializer } = testDb();

    const result = await materializer.materializeSqlResult({
      workflowId: "wf",
      conversationId: "conv",
      sqlRequestId: "sql_req",
      sqlExecutionId: "sql_exec",
      sourceDataSourceId: "source",
      resultColumns: [
        { name: "id", type: "integer" },
        { name: "name", type: "text" },
      ],
      rows: [
        { id: 1, name: "A" },
        { id: 2, name: "B" },
      ],
    });

    expect(result.rowCount).toBe(2);
    expect(result.columnCount).toBe(2);
    const profile = materializer.profileDataset({ ...result, schema: result.schema });
    const count = db.prepare(`select count(*) as count from "${result.sqliteTableName}"`).get() as { count: number };
    expect(count.count).toBe(2);
    expect(profile.previewRows).toHaveLength(2);
    db.close();
  });

  it("materializes rowsStream in batches", async () => {
    const { db, materializer } = testDb();

    const result = await materializer.materializeSqlResult({
      workflowId: "wf",
      conversationId: "conv",
      sqlRequestId: "sql_req",
      sqlExecutionId: "sql_exec",
      sourceDataSourceId: "source",
      resultColumns: [
        { name: "id", type: "integer" },
        { name: "name", type: "text" },
      ],
      rowsStream: rowsStream(),
    });

    expect(result.rowCount).toBe(3);
    expect(materializer.profileDataset({ ...result, schema: result.schema }).previewRows?.[2]?.name).toBe("C");
    db.close();
  });

  it("allocates a unique table name instead of overwriting existing materialized tables", async () => {
    const { db, materializer } = testDb();

    const first = await materializer.materializeSqlResult({
      workflowId: "wf",
      conversationId: "conv",
      sqlRequestId: "sql_req_1",
      sqlExecutionId: "sql_exec_1",
      sourceDataSourceId: "source",
      resultColumns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
      targetTableName: "same_table",
    });
    const second = await materializer.materializeSqlResult({
      workflowId: "wf",
      conversationId: "conv",
      sqlRequestId: "sql_req_2",
      sqlExecutionId: "sql_exec_2",
      sourceDataSourceId: "source",
      resultColumns: [{ name: "id", type: "integer" }],
      rows: [{ id: 2 }],
      targetTableName: "same_table",
    });

    expect(first.sqliteTableName).toBe("same_table");
    expect(second.sqliteTableName).toBe("same_table_1");
    const firstCount = db.prepare(`select count(*) as count from "${first.sqliteTableName}"`).get() as { count: number };
    const secondCount = db.prepare(`select count(*) as count from "${second.sqliteTableName}"`).get() as { count: number };
    expect(firstCount.count).toBe(1);
    expect(secondCount.count).toBe(1);
    expect(db.tables.get(first.sqliteTableName)?.rows[0].id).toBe(1);
    expect(db.tables.get(second.sqliteTableName)?.rows[0].id).toBe(2);
    db.close();
  });

  it("cancels materialization with AbortSignal and rolls back temp tables", async () => {
    const { db, materializer } = testDb();
    const controller = new AbortController();
    async function* abortingRows() {
      yield { id: 1, name: "A" };
      controller.abort();
      yield { id: 2, name: "B" };
    }

    await expect(
      materializer.materializeSqlResult({
        workflowId: "wf",
        conversationId: "conv",
        sqlRequestId: "sql_req",
        sqlExecutionId: "sql_exec",
        sourceDataSourceId: "source",
        resultColumns: [
          { name: "id", type: "integer" },
          { name: "name", type: "text" },
        ],
        rowsStream: abortingRows(),
        targetTableName: "cancelled_table",
        signal: controller.signal,
      }),
    ).rejects.toThrow("materialization cancelled");

    expect(db.tables.has("cancelled_table")).toBe(false);
    db.close();
  });

  it("rolls back materialized table when batch insertion fails", async () => {
    const db = new FakeSqliteDb({ failOnInsertAfter: 1 });
    const materializer = new SQLiteMaterializer(db, { sqliteDatabasePath: join(tmpdir(), `cycle-probe-workflow-test-${randomUUID()}.sqlite3`), batchSize: 2 });

    await expect(
      materializer.materializeSqlResult({
        workflowId: "wf",
        conversationId: "conv",
        sqlRequestId: "sql_req",
        sqlExecutionId: "sql_exec",
        sourceDataSourceId: "source",
        resultColumns: [{ name: "id", type: "integer" }],
        rows: [{ id: 1 }, { id: 2 }],
        targetTableName: "failed_insert_table",
      }),
    ).rejects.toThrow("simulated insert failure");

    expect(db.tables.has("failed_insert_table")).toBe(false);
    db.close();
  });
});

describe("WorkflowRuntime", () => {
  it("starts extraction workflow and waits for SQL approval", async () => {
    const { db, runtime } = testDb();

    const workflow = await runtime.start({
      conversationId: "conv",
      userId: "user",
      userRequest: "先帮我提取今年以来到期的存续期客户数据",
    });

    expect(workflow.status).toBe("waiting_sql_approval");
    expect(workflow.steps.some((item) => item.type === "sql_request" && item.status === "waiting")).toBe(true);
    db.close();
  });

  it("executes approved SQL requests and materializes the result dataset", async () => {
    const { db, runtime } = testDb();
    const workflow = await runtime.start({
      conversationId: "conv-sql-exec",
      userId: "user",
      userRequest: "查询客户数据",
    });
    const sqlRequestId = workflow.steps.find((item) => item.type === "sql_request")?.output?.sqlRequestId as string;

    const result = await runtime.executeApprovedSqlRequest({
      conversationId: workflow.conversationId,
      workflowId: workflow.workflowId,
      userId: workflow.userId,
      sqlRequestId,
      sourceDataSourceId: "source",
    });

    expect(result.workflow.status).toBe("waiting_user_confirmation");
    expect(result.dataset?.rowCount).toBe(1);
    expect(result.workflow.activeDatasetId).toBe(result.dataset?.datasetId);
    expect(result.workflow.steps.some((item) => item.type === "sqlite_materialization" && item.status === "success")).toBe(true);
    db.close();
  });

  it("records executing_sql to materializing_dataset before dataset confirmation", async () => {
    const db = new FakeSqliteDb();
    const store = new RecordingWorkflowStateStore();
    const datasets = new InMemoryDatasetStateManager(store);
    const materializer = new SQLiteMaterializer(db, { sqliteDatabasePath: join(tmpdir(), `cycle-probe-workflow-test-${randomUUID()}.sqlite3`) });
    const runtime = new WorkflowRuntime({
      stateStore: store,
      datasetStateManager: datasets,
      sqliteMaterializer: materializer,
      tempTableRegistry: new TempTableRegistry(),
      sqlToolBridge: mockSqlBridge(),
      pythonBridge: mockPythonBridge(),
    });
    const workflow = await runtime.start({
      conversationId: "conv-status-flow",
      userId: "user",
      userRequest: "查询客户数据",
    });
    const sqlRequestId = workflow.steps.find((item) => item.type === "sql_request")?.output?.sqlRequestId as string;

    await runtime.executeApprovedSqlRequest({
      conversationId: workflow.conversationId,
      workflowId: workflow.workflowId,
      userId: workflow.userId,
      sqlRequestId,
      sourceDataSourceId: "source",
    });

    expect(store.statuses).toEqual(expect.arrayContaining(["planning", "waiting_sql_approval", "executing_sql", "materializing_dataset", "waiting_user_confirmation"]));
    expect(store.statuses.indexOf("materializing_dataset")).toBeLessThan(store.statuses.indexOf("waiting_user_confirmation"));
    db.close();
  });

  it("short-circuits an already cancelled SQL workflow without materializing datasets", async () => {
    const { db, store, datasets, materializer } = testDb();
    let bridgeWasCalled = false;
    const sqlBridge: SqlWorkflowBridge = {
      createSqlRequest: async () => ({ sqlRequestId: "sql-cancel", status: "pending_approval" }),
      executeApprovedSqlRequest: async (_sqlRequestId, options) => {
        bridgeWasCalled = true;
        if (options?.signal?.aborted) {
          throw new Error("query cancelled");
        }
        return {
          sqlExecutionId: "sql-exec-cancel",
          columns: [{ name: "id", type: "integer" }],
          rows: [{ id: 1 }],
        };
      },
    };
    const runtime = new WorkflowRuntime({
      stateStore: store,
      datasetStateManager: datasets,
      sqliteMaterializer: materializer,
      tempTableRegistry: new TempTableRegistry(),
      sqlToolBridge: sqlBridge,
      pythonBridge: mockPythonBridge(),
    });
    const workflow = await runtime.start({
      conversationId: "conv-cancel-signal",
      userId: "user",
      userRequest: "查询客户数据",
    });
    const sqlRequestId = workflow.steps.find((item) => item.type === "sql_request")?.output?.sqlRequestId as string;
    const controller = new AbortController();
    controller.abort();

    const result = await runtime.executeApprovedSqlRequest({
      conversationId: workflow.conversationId,
      workflowId: workflow.workflowId,
      userId: workflow.userId,
      sqlRequestId,
      sourceDataSourceId: "source",
      signal: controller.signal,
    });

    expect(bridgeWasCalled).toBe(false);
    expect(result.workflow.status).toBe("failed");
    expect(result.dataset).toBeNull();
    expect(await datasets.listDatasets(workflow.conversationId)).toHaveLength(0);
    db.close();
  });

  it("passes non-aborted cancellation signal into SQL bridge and materializer", async () => {
    const { db, store, datasets, materializer } = testDb();
    const controller = new AbortController();
    let bridgeReceivedSignal = false;
    const sqlBridge: SqlWorkflowBridge = {
      createSqlRequest: async () => ({ sqlRequestId: "sql-with-signal", status: "pending_approval" }),
      executeApprovedSqlRequest: async (_sqlRequestId, options) => {
        bridgeReceivedSignal = options?.signal === controller.signal;
        return {
          sqlExecutionId: "sql-exec-with-signal",
          columns: [{ name: "id", type: "integer" }],
          rows: [{ id: 1 }],
        };
      },
    };
    const runtime = new WorkflowRuntime({
      stateStore: store,
      datasetStateManager: datasets,
      sqliteMaterializer: materializer,
      tempTableRegistry: new TempTableRegistry(),
      sqlToolBridge: sqlBridge,
      pythonBridge: mockPythonBridge(),
    });
    const workflow = await runtime.start({
      conversationId: "conv-pass-signal",
      userId: "user",
      userRequest: "查询客户数据",
    });
    const sqlRequestId = workflow.steps.find((item) => item.type === "sql_request")?.output?.sqlRequestId as string;

    const result = await runtime.executeApprovedSqlRequest({
      conversationId: workflow.conversationId,
      workflowId: workflow.workflowId,
      userId: workflow.userId,
      sqlRequestId,
      sourceDataSourceId: "source",
      signal: controller.signal,
    });

    expect(bridgeReceivedSignal).toBe(true);
    expect(result.workflow.status).toBe("waiting_user_confirmation");
    expect(result.dataset?.rowCount).toBe(1);
    db.close();
  });

  it("applies WorkflowRuntime maxTempDatabaseSizeBytes and cleans up oversized materialized tables", async () => {
    const dbPath = join(tmpdir(), `cycle-probe-workflow-budget-${randomUUID()}.sqlite3`);
    writeFileSync(dbPath, "oversized");
    const db = new FakeSqliteDb();
    const store = new InMemoryWorkflowStateStore();
    const datasets = new InMemoryDatasetStateManager(store);
    const materializer = new SQLiteMaterializer(db, { sqliteDatabasePath: dbPath });
    const runtime = new WorkflowRuntime({
      stateStore: store,
      datasetStateManager: datasets,
      sqliteMaterializer: materializer,
      tempTableRegistry: new TempTableRegistry(),
      sqlToolBridge: mockSqlBridge(),
      pythonBridge: mockPythonBridge(),
      maxTempDatabaseSizeBytes: 1,
    });
    const workflow = await runtime.start({
      conversationId: "conv-size-budget",
      userId: "user",
      userRequest: "查询客户数据",
    });
    const sqlRequestId = workflow.steps.find((item) => item.type === "sql_request")?.output?.sqlRequestId as string;

    try {
      const result = await runtime.executeApprovedSqlRequest({
        conversationId: workflow.conversationId,
        workflowId: workflow.workflowId,
        userId: workflow.userId,
        sqlRequestId,
        sourceDataSourceId: "source",
      });

      expect(result.workflow.status).toBe("failed");
      expect(result.dataset).toBeNull();
      expect(result.workflow.steps.at(-1)?.type).toBe("sqlite_materialization");
      expect(result.workflow.steps.at(-1)?.error?.code).toBe("SQLITE_MATERIALIZATION_FAILED");
      expect(db.tables.size).toBe(0);
      expect(await datasets.listDatasets(workflow.conversationId)).toHaveLength(0);
    } finally {
      unlinkSync(dbPath);
      db.close();
    }
  });

  it("runs direct query-analysis-report workflow through SQL, Python approval, and report generation", async () => {
    const db = new FakeSqliteDb();
    const store = new RecordingWorkflowStateStore();
    const datasets = new InMemoryDatasetStateManager(store);
    const materializer = new SQLiteMaterializer(db, { sqliteDatabasePath: join(tmpdir(), `cycle-probe-workflow-test-${randomUUID()}.sqlite3`), batchSize: 2 });
    const memory = new InMemoryWorkflowMemoryBridge();
    const audit = new InMemoryWorkflowAuditLogger();
    const runtime = new WorkflowRuntime({
      stateStore: store,
      datasetStateManager: datasets,
      sqliteMaterializer: materializer,
      tempTableRegistry: new TempTableRegistry(),
      sqlToolBridge: mockSqlBridge(),
      pythonBridge: mockPythonBridge(),
      reportBridge: new MarkdownReportWorkflowBridge(),
      memoryBridge: memory,
      auditLogger: audit,
    });
    const workflow = await runtime.start({
      conversationId: "conv-direct-report",
      userId: "user",
      userRequest: "请查询客户逾期情况，分析特征并生成报告",
    });
    const sqlRequestId = workflow.steps.find((item) => item.type === "sql_request")?.output?.sqlRequestId as string;

    const afterSql = await runtime.executeApprovedSqlRequest({
      conversationId: workflow.conversationId,
      workflowId: workflow.workflowId,
      userId: workflow.userId,
      sqlRequestId,
      sourceDataSourceId: "source",
    });
    const pythonRequestId = afterSql.workflow.steps.find((item) => item.type === "python_request")?.output?.pythonRequestId as string;

    expect(afterSql.workflow.status).toBe("waiting_python_approval");
    expect(afterSql.dataset?.status).toBe("confirmed");
    expect(pythonRequestId).toBeTruthy();

    const completed = await runtime.executeApprovedPythonRequest({
      conversationId: workflow.conversationId,
      workflowId: workflow.workflowId,
      userId: workflow.userId,
      pythonRequestId,
    });
    const context = await new WorkflowContextBuilder(store, datasets).build(workflow.conversationId);
    const finalWorkflow = await store.get(workflow.workflowId);

    expect(completed.workflow.status).toBe("completed");
    expect(store.statuses).toEqual(expect.arrayContaining(["executing_python", "generating_report", "completed"]));
    expect(store.statuses.lastIndexOf("executing_python")).toBeLessThan(store.statuses.lastIndexOf("generating_report"));
    expect(store.statuses.lastIndexOf("generating_report")).toBeLessThan(store.statuses.lastIndexOf("completed"));
    expect(completed.workflow.latestPythonExecutionId).toBeTruthy();
    expect(completed.workflow.latestReportVersionId).toBeTruthy();
    expect(completed.workflow.steps.some((item) => item.type === "report_generation" && item.status === "success")).toBe(true);
    expect(finalWorkflow?.events.some((item) => item.type === "workflow_completed")).toBe(true);
    expect(context.latestPythonAnalysis?.pythonExecutionId).toBe(completed.workflow.latestPythonExecutionId);
    expect(context.latestReport?.reportVersionId).toBe(completed.workflow.latestReportVersionId);
    expect(context.latestReport).not.toHaveProperty("markdown");
    expect(memory.list(workflow.conversationId).some((entry) => entry.type === "report_generated")).toBe(true);
    const auditEntries = audit.list(workflow.conversationId);
    expect(auditEntries.map((entry) => entry.eventType)).toEqual(expect.arrayContaining(["sql_approved", "dataset_materialized", "python_executed", "report_generated", "workflow_completed"]));
    const reportAuditPayload = auditEntries.find((entry) => entry.eventType === "report_generated")?.payload;
    expect(reportAuditPayload?.markdown).toBe("[redacted]");
    db.close();
  });

  it("refines from the active dataset by requesting local SQLite SQL and preserving lineage", async () => {
    const { db, store, datasets, materializer } = testDb();
    const sqlRequests: Array<Parameters<SqlWorkflowBridge["createSqlRequest"]>[0]> = [];
    const sqlBridge: SqlWorkflowBridge = {
      createSqlRequest: async (input) => {
        sqlRequests.push(input);
        return { sqlRequestId: `sql-${sqlRequests.length}`, status: "pending_approval" };
      },
      executeApprovedSqlRequest: async () => ({
        sqlExecutionId: randomUUID(),
        columns: [{ name: "id", type: "integer" }],
        rows: [{ id: sqlRequests.length }],
      }),
    };
    const runtime = new WorkflowRuntime({
      stateStore: store,
      datasetStateManager: datasets,
      sqliteMaterializer: materializer,
      tempTableRegistry: new TempTableRegistry(),
      sqlToolBridge: sqlBridge,
      pythonBridge: mockPythonBridge(),
    });
    const workflow = await runtime.start({
      conversationId: "conv-refine",
      userId: "user",
      userRequest: "先帮我提取今年以来到期的客户数据",
    });
    const firstSqlRequestId = workflow.steps.find((item) => item.type === "sql_request")?.output?.sqlRequestId as string;
    const first = await runtime.executeApprovedSqlRequest({
      conversationId: workflow.conversationId,
      workflowId: workflow.workflowId,
      userId: workflow.userId,
      sqlRequestId: firstSqlRequestId,
      sourceDataSourceId: "source",
    });

    const refinedRequest = await runtime.continue({
      conversationId: workflow.conversationId,
      userId: workflow.userId,
      userRequest: "在上一轮结果中筛选逾期超过 30 天的客户",
    });
    const secondSqlRequestId = refinedRequest.steps.at(-1)?.output?.sqlRequestId as string;
    const second = await runtime.executeApprovedSqlRequest({
      conversationId: workflow.conversationId,
      workflowId: workflow.workflowId,
      userId: workflow.userId,
      sqlRequestId: secondSqlRequestId,
      sourceDataSourceId: "source",
    });

    expect(sqlRequests[1].useLocalSqlite).toBe(true);
    expect(sqlRequests[1].sourceDatasetId).toBe(first.dataset?.datasetId);
    expect(sqlRequests[1].sourceSqliteTableName).toBe(first.dataset?.sqliteTableName);
    expect(second.dataset?.parentDatasetIds).toEqual([first.dataset?.datasetId]);
    expect(second.workflow.activeDatasetId).toBe(second.dataset?.datasetId);
    db.close();
  });

  it("starts report-before-refine SQL from latest dataset and then waits for Python approval", async () => {
    const { db, store, datasets, materializer } = testDb();
    const sqlRequests: Array<Parameters<SqlWorkflowBridge["createSqlRequest"]>[0]> = [];
    const sqlBridge: SqlWorkflowBridge = {
      createSqlRequest: async (input) => {
        sqlRequests.push(input);
        return { sqlRequestId: `sql-report-${sqlRequests.length}`, status: "pending_approval" };
      },
      executeApprovedSqlRequest: async () => ({
        sqlExecutionId: randomUUID(),
        columns: [{ name: "risk_score", type: "real" }],
        rows: [{ risk_score: 92.5 }],
      }),
    };
    const runtime = new WorkflowRuntime({
      stateStore: store,
      datasetStateManager: datasets,
      sqliteMaterializer: materializer,
      tempTableRegistry: new TempTableRegistry(),
      sqlToolBridge: sqlBridge,
      pythonBridge: mockPythonBridge(),
    });
    const createdAt = new Date().toISOString();
    await store.create({
      workflowId: "wf-report-refine",
      conversationId: "conv-report-refine",
      userId: "user",
      type: "report_generation",
      status: "generating_report",
      userGoal: "生成报告",
      activeDatasetId: "dataset-base",
      latestSqlDatasetId: "dataset-base",
      steps: [],
      datasets: [],
      events: [],
      createdAt,
      updatedAt: createdAt,
    });
    const materialized = await materializer.materializeSqlResult({
      workflowId: "wf-report-refine",
      conversationId: "conv-report-refine",
      sqlRequestId: "sql_req_base",
      sqlExecutionId: "sql_exec_base",
      sourceDataSourceId: "source",
      resultColumns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
    });
    await datasets.registerDataset({
      datasetId: "dataset-base",
      workflowId: "wf-report-refine",
      conversationId: "conv-report-refine",
      name: "报告基础数据集",
      sourceType: "sql_execution_result",
      sqliteTableName: materialized.sqliteTableName,
      sqliteDatabasePath: materialized.sqliteDatabasePath,
      rowCount: 1,
      columnCount: 1,
      schema: { id: "integer" },
      status: "confirmed",
      canQuery: true,
      canAnalyze: true,
      canUseForReport: true,
      createdAt,
      updatedAt: createdAt,
    });

    const refineRequest = await runtime.generateReport({
      conversationId: "conv-report-refine",
      workflowId: "wf-report-refine",
      userId: "user",
      reportGoal: "生成报告前再筛选高风险客户",
      allowRefineBeforeReport: true,
    });
    const sqlRequestId = refineRequest.steps.at(-1)?.output?.sqlRequestId as string;
    const refined = await runtime.executeApprovedSqlRequest({
      conversationId: "conv-report-refine",
      workflowId: "wf-report-refine",
      userId: "user",
      sqlRequestId,
      sourceDataSourceId: "source",
    });

    expect(sqlRequests[0].useLocalSqlite).toBe(true);
    expect(sqlRequests[0].sourceDatasetId).toBe("dataset-base");
    expect(refined.dataset?.parentDatasetIds).toEqual(["dataset-base"]);
    expect(refined.workflow.status).toBe("waiting_python_approval");
    expect(refined.workflow.steps.some((item) => item.type === "python_request" && item.status === "waiting")).toBe(true);
    db.close();
  });

  it("executes approved Python requests and records artifacts", async () => {
    const { db, runtime, store } = testDb();
    const createdAt = new Date().toISOString();
    await store.create({
      workflowId: "wf-python",
      conversationId: "conv-python",
      userId: "user",
      type: "python_analysis",
      status: "waiting_python_approval",
      userGoal: "分析数据",
      steps: [],
      datasets: [],
      events: [],
      createdAt,
      updatedAt: createdAt,
    });

    const result = await runtime.executeApprovedPythonRequest({
      conversationId: "conv-python",
      workflowId: "wf-python",
      userId: "user",
      pythonRequestId: "py-req-1",
    });

    expect(result.workflow.status).toBe("completed");
    expect(result.workflow.latestPythonExecutionId).toBe(result.result?.pythonExecutionId);
    expect(result.workflow.steps.some((item) => item.type === "python_execution" && item.status === "success")).toBe(true);
    db.close();
  });

  it("requires confirmation before starting Python analysis on an active dataset", async () => {
    const { db, store, datasets, materializer, runtime } = testDb();
    const createdAt = new Date().toISOString();
    await store.create({
      workflowId: "wf-python-confirm",
      conversationId: "conv-python-confirm",
      userId: "user",
      type: "python_analysis",
      status: "waiting_user_confirmation",
      userGoal: "分析数据",
      steps: [],
      datasets: [],
      events: [],
      createdAt,
      updatedAt: createdAt,
    });
    const materialized = await materializer.materializeSqlResult({
      workflowId: "wf-python-confirm",
      conversationId: "conv-python-confirm",
      sqlRequestId: "sql_req",
      sqlExecutionId: "sql_exec",
      sourceDataSourceId: "source",
      resultColumns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
    });
    await datasets.registerDataset({
      datasetId: materialized.datasetId,
      workflowId: "wf-python-confirm",
      conversationId: "conv-python-confirm",
      name: "未确认数据集",
      sourceType: "sql_execution_result",
      sqliteTableName: materialized.sqliteTableName,
      sqliteDatabasePath: materialized.sqliteDatabasePath,
      rowCount: 1,
      columnCount: 1,
      schema: { id: "integer" },
      status: "ready",
      canQuery: true,
      canAnalyze: true,
      canUseForReport: true,
      createdAt,
      updatedAt: createdAt,
    });

    await expect(
      runtime.startPythonAnalysis({
        conversationId: "conv-python-confirm",
        workflowId: "wf-python-confirm",
        userId: "user",
        userRequest: "分析这批数据",
        analysisGoal: "分析这批数据",
      }),
    ).rejects.toMatchObject({ code: "DATASET_NOT_CONFIRMED" });
    const workflow = await store.get("wf-python-confirm");

    expect(workflow?.status).toBe("waiting_user_confirmation");
    expect(workflow?.steps.some((item) => item.type === "user_confirmation" && item.status === "waiting")).toBe(true);
    db.close();
  });

  it("confirms active dataset and exposes safe workflow context without full rows", async () => {
    const { db, store, datasets, materializer } = testDb();
    const createdAt = new Date().toISOString();
    const workflow: WorkflowSession = {
      workflowId: "wf",
      conversationId: "conv",
      userId: "user",
      type: "data_extraction",
      status: "waiting_user_confirmation",
      userGoal: "提取数据",
      steps: [],
      datasets: [],
      events: [],
      createdAt,
      updatedAt: createdAt,
    };
    await store.create(workflow);
    const materialized = await materializer.materializeSqlResult({
      workflowId: "wf",
      conversationId: "conv",
      sqlRequestId: "sql_req",
      sqlExecutionId: "sql_exec",
      sourceDataSourceId: "source",
      resultColumns: [
        { name: "customer_name", type: "text" },
        { name: "latest_risk_result", type: "text" },
      ],
      rows: [{ customer_name: "敏感客户A", latest_risk_result: "0201--关注1" }],
    });
    await datasets.registerDataset({
      datasetId: materialized.datasetId,
      workflowId: "wf",
      conversationId: "conv",
      name: "SQL 结果集",
      sourceType: "sql_execution_result",
      sqliteTableName: materialized.sqliteTableName,
      sqliteDatabasePath: materialized.sqliteDatabasePath,
      rowCount: materialized.rowCount,
      columnCount: materialized.columnCount,
      schema: materialized.schema,
      status: "ready",
      canQuery: true,
      canAnalyze: true,
      canUseForReport: true,
      createdAt,
      updatedAt: createdAt,
    });
    const runtime = new WorkflowRuntime({
      stateStore: store,
      datasetStateManager: datasets,
      sqliteMaterializer: materializer,
      tempTableRegistry: new TempTableRegistry(),
      sqlToolBridge: mockSqlBridge(),
      pythonBridge: mockPythonBridge(),
    });

    const confirmed = await runtime.confirmDataset({ conversationId: "conv", userId: "user", workflowId: "wf" });
    const context = await new WorkflowContextBuilder(store, datasets).buildMarkdown("conv");

    expect(confirmed.confirmedDatasetId).toBe(materialized.datasetId);
    expect(context).toContain(materialized.datasetId);
    expect(context).toContain("latest_risk_result");
    expect(context).not.toContain("敏感客户A");
    db.close();
  });

  it("rejects active dataset and clears workflow dataset pointers", async () => {
    const { db, store, datasets, materializer } = testDb();
    const memory = new InMemoryWorkflowMemoryBridge();
    const createdAt = new Date().toISOString();
    await store.create({
      workflowId: "wf-reject",
      conversationId: "conv-reject",
      userId: "user",
      type: "data_extraction",
      status: "waiting_user_confirmation",
      userGoal: "提取数据",
      activeDatasetId: "dataset-reject",
      latestSqlDatasetId: "dataset-reject",
      confirmedDatasetId: "dataset-reject",
      steps: [],
      datasets: [],
      events: [],
      createdAt,
      updatedAt: createdAt,
    });
    const materialized = await materializer.materializeSqlResult({
      workflowId: "wf-reject",
      conversationId: "conv-reject",
      sqlRequestId: "sql_req",
      sqlExecutionId: "sql_exec",
      sourceDataSourceId: "source",
      resultColumns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
    });
    await datasets.registerDataset({
      datasetId: "dataset-reject",
      workflowId: "wf-reject",
      conversationId: "conv-reject",
      name: "待拒绝数据集",
      sourceType: "sql_execution_result",
      sqliteTableName: materialized.sqliteTableName,
      sqliteDatabasePath: materialized.sqliteDatabasePath,
      rowCount: 1,
      columnCount: 1,
      schema: { id: "integer" },
      status: "confirmed",
      canQuery: true,
      canAnalyze: true,
      canUseForReport: true,
      createdAt,
      updatedAt: createdAt,
    });
    const runtime = new WorkflowRuntime({
      stateStore: store,
      datasetStateManager: datasets,
      sqliteMaterializer: materializer,
      tempTableRegistry: new TempTableRegistry(),
      sqlToolBridge: mockSqlBridge(),
      pythonBridge: mockPythonBridge(),
      memoryBridge: memory,
    });

    const rejected = await runtime.rejectDataset({
      conversationId: "conv-reject",
      workflowId: "wf-reject",
      datasetId: "dataset-reject",
      reason: "范围不对",
    });
    const dataset = await datasets.getDataset("dataset-reject");

    expect(dataset?.status).toBe("rejected");
    expect(rejected.activeDatasetId).toBeUndefined();
    expect(rejected.latestSqlDatasetId).toBeUndefined();
    expect(rejected.confirmedDatasetId).toBeUndefined();
    expect(memory.list("conv-reject").some((entry) => entry.type === "dataset_rejected")).toBe(true);
    db.close();
  });

  it("reuses datasets across conversations and preserves lineage", async () => {
    const { db, store, datasets, materializer, runtime } = testDb();
    const createdAt = new Date().toISOString();
    await store.create({
      workflowId: "wf-source",
      conversationId: "conv-source",
      userId: "user",
      type: "data_extraction",
      status: "waiting_user_confirmation",
      userGoal: "源数据",
      steps: [],
      datasets: [],
      events: [],
      createdAt,
      updatedAt: createdAt,
    });
    const materialized = await materializer.materializeSqlResult({
      workflowId: "wf-source",
      conversationId: "conv-source",
      sqlRequestId: "sql_req",
      sqlExecutionId: "sql_exec",
      sourceDataSourceId: "source",
      resultColumns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
    });
    await datasets.registerDataset({
      datasetId: materialized.datasetId,
      workflowId: "wf-source",
      conversationId: "conv-source",
      name: "可复用数据集",
      sourceType: "sql_execution_result",
      sqliteTableName: materialized.sqliteTableName,
      sqliteDatabasePath: materialized.sqliteDatabasePath,
      rowCount: 1,
      columnCount: 1,
      schema: { id: "integer" },
      status: "ready",
      canQuery: true,
      canAnalyze: true,
      canUseForReport: true,
      createdAt,
      updatedAt: createdAt,
    });

    const reused = await runtime.reuseDataset({
      sourceDatasetId: materialized.datasetId,
      targetConversationId: "conv-target",
      userId: "user",
    });
    const targetContext = await new WorkflowContextBuilder(store, datasets).build("conv-target");

    expect(reused.workflow.conversationId).toBe("conv-target");
    expect(reused.dataset.parentDatasetIds).toContain(materialized.datasetId);
    expect(reused.dataset.sqliteTableName).toBe(materialized.sqliteTableName);
    expect(targetContext.activeDataset?.datasetId).toBe(reused.dataset.datasetId);
    db.close();
  });

  it("cancels active workflow steps and expires workflow datasets", async () => {
    const { db, store, datasets, materializer, runtime } = testDb();
    const createdAt = new Date().toISOString();
    const workflow: WorkflowSession = {
      workflowId: "wf-cancel",
      conversationId: "conv-cancel",
      userId: "user",
      type: "data_extraction",
      status: "waiting_sql_approval",
      userGoal: "提取数据",
      activeDatasetId: "dataset-cancel",
      latestSqlDatasetId: "dataset-cancel",
      steps: [{ stepId: "step-waiting", type: "sql_request", status: "waiting", startedAt: createdAt }],
      datasets: [],
      events: [],
      createdAt,
      updatedAt: createdAt,
    };
    await store.create(workflow);
    const materialized = await materializer.materializeSqlResult({
      workflowId: workflow.workflowId,
      conversationId: workflow.conversationId,
      sqlRequestId: "sql_req",
      sqlExecutionId: "sql_exec",
      sourceDataSourceId: "source",
      resultColumns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
    });
    await datasets.registerDataset({
      datasetId: "dataset-cancel",
      workflowId: workflow.workflowId,
      conversationId: workflow.conversationId,
      name: "待取消数据集",
      sourceType: "sql_execution_result",
      sqliteTableName: materialized.sqliteTableName,
      sqliteDatabasePath: materialized.sqliteDatabasePath,
      rowCount: 1,
      columnCount: 1,
      schema: { id: "integer" },
      status: "ready",
      canQuery: true,
      canAnalyze: true,
      canUseForReport: true,
      createdAt,
      updatedAt: createdAt,
    });

    const cancelled = await runtime.cancel(workflow.workflowId);
    const dataset = await datasets.getDataset("dataset-cancel");

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.steps[0].status).toBe("cancelled");
    expect(dataset?.status).toBe("expired");
    expect(cancelled.activeDatasetId).toBeUndefined();
    db.close();
  });

  it("cleans up expired datasets and drops materialized tables", async () => {
    const { db, store, datasets, materializer, runtime } = testDb();
    const createdAt = "2026-01-01T00:00:00.000Z";
    const workflow: WorkflowSession = {
      workflowId: "wf-cleanup",
      conversationId: "conv-cleanup",
      userId: "user",
      type: "data_extraction",
      status: "waiting_user_confirmation",
      userGoal: "提取数据",
      steps: [],
      datasets: [],
      events: [],
      createdAt,
      updatedAt: createdAt,
    };
    await store.create(workflow);
    const materialized = await materializer.materializeSqlResult({
      workflowId: workflow.workflowId,
      conversationId: workflow.conversationId,
      sqlRequestId: "sql_req",
      sqlExecutionId: "sql_exec",
      sourceDataSourceId: "source",
      resultColumns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
    });
    await datasets.registerDataset({
      datasetId: materialized.datasetId,
      workflowId: workflow.workflowId,
      conversationId: workflow.conversationId,
      name: "过期数据集",
      sourceType: "sql_execution_result",
      sqliteTableName: materialized.sqliteTableName,
      sqliteDatabasePath: materialized.sqliteDatabasePath,
      rowCount: 1,
      columnCount: 1,
      schema: { id: "integer" },
      status: "ready",
      canQuery: true,
      canAnalyze: true,
      canUseForReport: true,
      createdAt,
      updatedAt: createdAt,
      expiresAt: "2026-01-01T00:00:01.000Z",
    });

    const result = await runtime.cleanupExpiredDatasets({ conversationId: workflow.conversationId, now: "2026-01-01T00:00:02.000Z" });
    const dataset = await datasets.getDataset(materialized.datasetId);

    expect(result.expiredDatasetIds).toEqual([materialized.datasetId]);
    expect(dataset?.status).toBe("expired");
    expect(db.tables.has(materialized.sqliteTableName)).toBe(false);
    db.close();
  });

  it("generates local markdown reports and writes workflow memory", async () => {
    const { db, store, datasets, materializer } = testDb();
    const memory = new InMemoryWorkflowMemoryBridge();
    const createdAt = new Date().toISOString();
    const workflow: WorkflowSession = {
      workflowId: "wf-report",
      conversationId: "conv-report",
      userId: "user",
      type: "report_generation",
      status: "generating_report",
      userGoal: "生成报告",
      confirmedDatasetId: "dataset-report",
      steps: [],
      datasets: [],
      events: [],
      createdAt,
      updatedAt: createdAt,
    };
    await store.create(workflow);
    const materialized = await materializer.materializeSqlResult({
      workflowId: workflow.workflowId,
      conversationId: workflow.conversationId,
      sqlRequestId: "sql_req",
      sqlExecutionId: "sql_exec",
      sourceDataSourceId: "source",
      resultColumns: [{ name: "id", type: "integer" }],
      rows: [{ id: 1 }],
    });
    await datasets.registerDataset({
      datasetId: "dataset-report",
      workflowId: workflow.workflowId,
      conversationId: workflow.conversationId,
      name: "报告数据集",
      sourceType: "sql_execution_result",
      sqliteTableName: materialized.sqliteTableName,
      sqliteDatabasePath: materialized.sqliteDatabasePath,
      rowCount: 1,
      columnCount: 1,
      schema: { id: "integer" },
      status: "confirmed",
      canQuery: true,
      canAnalyze: true,
      canUseForReport: true,
      createdAt,
      updatedAt: createdAt,
    });
    const runtime = new WorkflowRuntime({
      stateStore: store,
      datasetStateManager: datasets,
      sqliteMaterializer: materializer,
      tempTableRegistry: new TempTableRegistry(),
      sqlToolBridge: mockSqlBridge(),
      pythonBridge: mockPythonBridge(),
      reportBridge: new MarkdownReportWorkflowBridge(),
      memoryBridge: memory,
    });

    const completed = await runtime.generateReport({
      conversationId: workflow.conversationId,
      workflowId: workflow.workflowId,
      userId: workflow.userId,
      reportGoal: "生成风险分析报告",
      pythonExecutionId: "py-exec-1",
    });

    expect(completed.status).toBe("completed");
    expect(completed.latestReportVersionId).toBeTruthy();
    expect(memory.list(workflow.conversationId).some((entry) => entry.type === "report_generated")).toBe(true);
    db.close();
  });

  it("recovers stale executing workflows to blocked state", async () => {
    const { db, store, runtime } = testDb();
    await store.create({
      workflowId: "wf-stale",
      conversationId: "conv-stale",
      userId: "user",
      type: "python_analysis",
      status: "executing_python",
      userGoal: "分析数据",
      steps: [{ stepId: "py-step", type: "python_execution", status: "running", startedAt: "2026-01-01T00:00:00.000Z" }],
      datasets: [],
      events: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const recovered = await runtime.recoverStaleWorkflows({
      conversationId: "conv-stale",
      olderThanMs: 1_000,
      now: "2026-01-01T00:01:00.000Z",
    });
    const workflow = await store.get("wf-stale");

    expect(recovered.recoveredWorkflowIds).toEqual(["wf-stale"]);
    expect(workflow?.status).toBe("blocked");
    expect(workflow?.steps[0].status).toBe("blocked");
    expect(workflow?.steps[0].error?.code).toBe("WORKFLOW_INVALID_STATE");
    db.close();
  });
});
