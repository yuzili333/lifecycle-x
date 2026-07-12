import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { ContextMenu } from "@astryxdesign/core/ContextMenu";
import { Dialog } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Pagination } from "@astryxdesign/core/Pagination";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Table, proportional, useTableColumnResize, type TableColumn } from "@astryxdesign/core/Table";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Toast, type ToastType } from "@astryxdesign/core/Toast";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import connectIcon from "./assets/connect.svg";
import csvImportIcon from "./assets/csv-import.svg";
import csvIcon from "./assets/csv.svg";
import databaseSourceIcon from "./assets/database-source.svg";
import tableSheetIcon from "./assets/table-sheet.svg";
import type { AuthFailure } from "./auth";
import { useAppToast } from "./useAppToast";
import type { DataSourceMenuAction } from "../../preload";
import {
  workbenchApi,
  type ApiResult,
  type DatabaseSchema,
  type DatabaseTable,
  type DataSourceInput,
  type DataSourceSummary,
  type SampleDataResult,
} from "./workbenchApi";

type RequestWithRefresh = <T extends { success: true }>(
  call: (accessToken: string) => Promise<ApiResult<T>>,
) => Promise<ApiResult<T>>;

type DataManagementWorkspaceProps = {
  isActive: boolean;
  canManage: boolean;
  requestWithRefresh: RequestWithRefresh;
  menuAction?: DataSourceMenuAction | null;
  onMenuActionHandled?: () => void;
};

type TableRow = Record<string, unknown> & {
  id: string;
  name: string;
  description: string;
  type: string;
  rows: string;
  size: string;
  flags: string;
  updatedAt: string;
};

type SchemaRow = Record<string, unknown> & {
  id: string;
  name: string;
  description: string;
  tables: string;
  views: string;
  source: string;
};

type CompassDataTab =
  | {
    id: string;
    kind: "database";
    sourceId: string;
    schema: string;
    label: string;
  }
  | {
    id: string;
    kind: "table";
    sourceId: string;
    schema: string;
    tableId: string;
    label: string;
  };

type PendingLargeTable = {
  sourceId: string;
  tabId: string;
  table: DatabaseTable;
};

type DataManagementPage = "database" | "csv";

type ConnectionTestToast = {
  id: number;
  type: ToastType;
  body: string;
};

const defaultConnectionForm: DataSourceInput = {
  name: "新增 MySQL 数据源",
  type: "mysql",
  environment: "staging",
  host: "127.0.0.1",
  port: 3306,
  database: "post_loan",
  username: "readonly_user",
  password: "",
  readonly: true,
};

const MAX_RESOURCE_LOAD_ATTEMPTS = 3;
const MIN_TABLE_COLUMN_WIDTH = 96;
const DEFAULT_TABLE_PAGE_SIZE = 10;
const TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50];
const TABLE_PAGE_SIZE_SELECTOR_OPTIONS = TABLE_PAGE_SIZE_OPTIONS.map((value) => ({
  value: String(value),
  label: `${value}条`,
}));
const LEGACY_DEFAULT_SOURCE_NAME = "贷后核心业务库";
const LEGACY_DEFAULT_SOURCE_HOST = "readonly.core-bank.internal";

function isFailure<T extends { success: true }>(result: ApiResult<T>): result is AuthFailure {
  return result.success === false;
}

function statusBadge(source: DataSourceSummary) {
  if (source.status === "online") {
    return <Badge variant="success" label="在线" />;
  }
  if (source.status === "degraded") {
    return <Badge variant="warning" label="降级" />;
  }
  if (source.status === "disabled") {
    return <Badge variant="error" label="禁用" />;
  }
  return <Badge variant="neutral" label="离线" />;
}

function tableEntityIcon(table?: DatabaseTable) {
  return table?.type === "imported" ? csvIcon : tableSheetIcon;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function tableRows(tables: DatabaseTable[], selectTable: (tableId: string) => void): TableRow[] {
  return tables.map((table) => ({
    id: table.id,
    name: table.name,
    description: table.comment || "-",
    type: table.type === "view" ? "视图" : table.type === "imported" ? "导入表" : "表",
    rows: formatNumber(table.estimatedRows),
    size: `${formatNumber(table.estimatedSizeMb)} MB`,
    flags: [table.isLarge ? "大表" : "", table.isSensitive ? "敏感" : ""].filter(Boolean).join(" / ") || "标准",
    updatedAt: table.updatedAt.slice(0, 16).replace("T", " "),
    onSelect: () => selectTable(table.id),
  }));
}

function isLegacyDefaultDataSource(source: DataSourceSummary) {
  return source.name === LEGACY_DEFAULT_SOURCE_NAME || source.host === LEGACY_DEFAULT_SOURCE_HOST;
}

function databaseTabId(sourceId: string, schema: string) {
  return `database:${sourceId}:${schema}`;
}

function tableTabId(sourceId: string, tableId: string) {
  return `table:${sourceId}:${tableId}`;
}

function paginateRows<T>(rows: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

function TreeRootActionButton({
  label,
  icon,
  variant,
  isDisabled,
  onClick,
}: {
  label: string;
  icon: string;
  variant: "primary" | "secondary";
  isDisabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      label={label}
      variant={variant}
      size="sm"
      isDisabled={isDisabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      icon={<span className="compass-action-icon" style={{ "--compass-icon-url": `url(${icon})` } as CSSProperties} aria-hidden="true" />}
      isIconOnly
      tooltip={label}
      className="compass-tree-root-action"
    />
  );
}

function CompassAssetIcon({ icon }: { icon: string }) {
  return <span className="compass-entity-icon" style={{ "--compass-entity-icon-url": `url(${icon})` } as CSSProperties} aria-hidden="true" />;
}

function CompassEmptyIcon({ icon }: { icon: string }) {
  return <span className="compass-empty-state-icon" style={{ "--compass-empty-icon-url": `url(${icon})` } as CSSProperties} aria-hidden="true" />;
}

function FieldHeader({ name, type, comment }: { name: string; type: string; comment?: string }) {
  return (
    <span className="compass-field-header">
      <strong>{name}</strong>
      <span>{type}</span>
      <em>{comment?.trim() || "--"}</em>
    </span>
  );
}

export function DataManagementWorkspace({ isActive, canManage, requestWithRefresh, menuAction, onMenuActionHandled }: DataManagementWorkspaceProps) {
  const toast = useAppToast();
  const requestWithRefreshRef = useRef(requestWithRefresh);
  const dataSourceLoadAttemptsRef = useRef(0);
  const sourceObjectLoadAttemptsRef = useRef(0);
  const hasLoadedDataSourcesRef = useRef(false);
  const [dataSources, setDataSources] = useState<DataSourceSummary[]>([]);
  const [schemas, setSchemas] = useState<DatabaseSchema[]>([]);
  const [tables, setTables] = useState<DatabaseTable[]>([]);
  const [activePage, setActivePage] = useState<DataManagementPage>("database");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedSchema, setSelectedSchema] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [connectionForm, setConnectionForm] = useState<DataSourceInput>(defaultConnectionForm);
  const [isCsvDialogOpen, setIsCsvDialogOpen] = useState(false);
  const [csvName, setCsvName] = useState("");
  const [csvContent, setCsvContent] = useState("");
  const [csvInputVersion, setCsvInputVersion] = useState(0);
  const [isCsvImporting, setIsCsvImporting] = useState(false);
  const [editingCsvSource, setEditingCsvSource] = useState<DataSourceSummary | null>(null);
  const [editingCsvName, setEditingCsvName] = useState("");
  const [isSavingCsvName, setIsSavingCsvName] = useState(false);
  const [pendingLargeTable, setPendingLargeTable] = useState<PendingLargeTable | null>(null);
  const [schemaColumnWidths, setSchemaColumnWidths] = useState<Record<string, number>>({});
  const [tableColumnWidths, setTableColumnWidths] = useState<Record<string, number>>({});
  const [sampleColumnWidths, setSampleColumnWidths] = useState<Record<string, number>>({});
  const [openTabs, setOpenTabs] = useState<CompassDataTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabPages, setTabPages] = useState<Record<string, number>>({});
  const [tabPageSizes, setTabPageSizes] = useState<Record<string, number>>({});
  const [sampleDataByTabId, setSampleDataByTabId] = useState<Record<string, SampleDataResult>>({});
  const [loadingSampleTabIds, setLoadingSampleTabIds] = useState<string[]>([]);
  const [connectionTestToast, setConnectionTestToast] = useState<ConnectionTestToast | null>(null);
  const [databaseContextMenu, setDatabaseContextMenu] = useState<{
    sourceId: string;
    sourceName: string;
    x: number;
    y: number;
  } | null>(null);

  const databaseSources = useMemo(() => dataSources.filter((source) => source.type === "mysql"), [dataSources]);
  const csvSources = useMemo(() => dataSources.filter((source) => source.type === "csv"), [dataSources]);
  const selectedSource = dataSources.find((source) => source.id === selectedSourceId) ?? null;
  const visibleTabs = useMemo(
    () =>
      openTabs.filter((tab) => {
        const source = dataSources.find((item) => item.id === tab.sourceId);
        return activePage === "database" ? source?.type === "mysql" : source?.type === "csv";
      }),
    [activePage, dataSources, openTabs],
  );
  const activeTab = visibleTabs.find((tab) => tab.id === activeTabId) ?? null;

  const showConnectionTestToast = useCallback((type: ToastType, body: string) => {
    setConnectionTestToast({
      id: Date.now(),
      type,
      body,
    });
  }, []);

  useEffect(() => {
    requestWithRefreshRef.current = requestWithRefresh;
  }, [requestWithRefresh]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (!menuAction) {
      return;
    }
    if (menuAction === "open-database") {
      setActivePage("database");
      onMenuActionHandled?.();
      return;
    }
    if (menuAction === "open-csv") {
      setActivePage("csv");
      onMenuActionHandled?.();
      return;
    }

    if (!canManage) {
      toast({
        type: "error",
        body: "当前账号无数据源管理权限。",
        uniqueID: "data-source-menu-denied",
        collisionBehavior: "overwrite",
      });
      onMenuActionHandled?.();
      return;
    }

    if (menuAction === "create-connection") {
      setActivePage("database");
      setIsConnectionDialogOpen(true);
    }
    if (menuAction === "import-csv") {
      setActivePage("csv");
      setIsCsvDialogOpen(true);
    }
    onMenuActionHandled?.();
  }, [canManage, isActive, menuAction, onMenuActionHandled, toast]);

  const showFailure = useCallback(
    (result: AuthFailure) => {
      if (result.error.code === "SESSION_EXPIRED") {
        return;
      }
      toast({
        type: "error",
        body: `${result.error.message} Trace: ${result.error.traceId}`,
        uniqueID: "data-management-error",
        collisionBehavior: "overwrite",
      });
    },
    [toast],
  );

  const resetCsvImportState = useCallback(() => {
    setCsvName("");
    setCsvContent("");
    setIsCsvImporting(false);
    setCsvInputVersion((current) => current + 1);
  }, []);

  const closeCsvDialog = useCallback(() => {
    setIsCsvDialogOpen(false);
    resetCsvImportState();
  }, [resetCsvImportState]);

  const handleCsvDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setIsCsvDialogOpen(true);
        return;
      }
      if (isCsvImporting) {
        return;
      }
      closeCsvDialog();
    },
    [closeCsvDialog, isCsvImporting],
  );

  const openEditCsvNameDialog = useCallback((source: DataSourceSummary) => {
    setEditingCsvSource(source);
    setEditingCsvName(source.name);
    setIsSavingCsvName(false);
  }, []);

  const closeEditCsvNameDialog = useCallback(() => {
    setEditingCsvSource(null);
    setEditingCsvName("");
    setIsSavingCsvName(false);
  }, []);

  const loadDataSources = useCallback(async (resetAttempts = false) => {
    if (resetAttempts) {
      dataSourceLoadAttemptsRef.current = 0;
    }
    if (dataSourceLoadAttemptsRef.current >= MAX_RESOURCE_LOAD_ATTEMPTS) {
      setIsLoading(false);
      setResourceError(`资源获取失败，已达到 ${MAX_RESOURCE_LOAD_ATTEMPTS} 次重试上限。`);
      return;
    }

    setIsLoading(true);
    setResourceError(null);
    let lastFailure: AuthFailure | null = null;
    while (dataSourceLoadAttemptsRef.current < MAX_RESOURCE_LOAD_ATTEMPTS) {
      dataSourceLoadAttemptsRef.current += 1;
      const result = await requestWithRefreshRef.current(workbenchApi.dataSources);
      if (!isFailure(result)) {
        const visibleDataSources = result.dataSources.filter((source) => !isLegacyDefaultDataSource(source));
        hasLoadedDataSourcesRef.current = true;
        dataSourceLoadAttemptsRef.current = 0;
        setDataSources(visibleDataSources);
        setSelectedSourceId((current) =>
          current && visibleDataSources.some((source) => source.id === current)
            ? current
            : visibleDataSources[0]?.id ?? null,
        );
        setIsLoading(false);
        return;
      }
      lastFailure = result;
    }

    setIsLoading(false);
    const message = lastFailure
      ? `${lastFailure.error.message} Trace: ${lastFailure.error.traceId}`
      : "资源获取失败。";
    setResourceError(`${message} 已停止自动重试。`);
    if (lastFailure) {
      showFailure(lastFailure);
    }
  }, [showFailure]);

  const loadSourceObjects = useCallback(
    async (dataSourceId: string) => {
      sourceObjectLoadAttemptsRef.current = 0;
      setResourceError(null);
      let lastFailure: AuthFailure | null = null;
      while (sourceObjectLoadAttemptsRef.current < MAX_RESOURCE_LOAD_ATTEMPTS) {
        sourceObjectLoadAttemptsRef.current += 1;
        const [schemaResult, tableResult] = await Promise.all([
          requestWithRefreshRef.current((token) => workbenchApi.schemas(token, dataSourceId)),
          requestWithRefreshRef.current((token) => workbenchApi.tables(token, dataSourceId)),
        ]);
        if (isFailure(schemaResult)) {
          lastFailure = schemaResult;
          continue;
        }
        if (isFailure(tableResult)) {
          lastFailure = tableResult;
          continue;
        }
        sourceObjectLoadAttemptsRef.current = 0;
        setSchemas(schemaResult.schemas);
        setTables(tableResult.tables);
        setSelectedSchema((current) => (current && schemaResult.schemas.some((schema) => schema.name === current) ? current : null));
        setSelectedTableId((current) => (current && tableResult.tables.some((table) => table.id === current) ? current : null));
        return { schemas: schemaResult.schemas, tables: tableResult.tables };
      }

      const message = lastFailure
        ? `${lastFailure.error.message} Trace: ${lastFailure.error.traceId}`
        : "资源对象获取失败。";
      setResourceError(`${message} 已停止自动重试。`);
      if (lastFailure) {
        showFailure(lastFailure);
      }
      return null;
    },
    [showFailure],
  );

  useEffect(() => {
    if (!isActive || hasLoadedDataSourcesRef.current) {
      return;
    }
    void loadDataSources(true);
  }, [isActive, loadDataSources]);

  useEffect(() => {
    if (!isActive || !selectedSourceId) {
      return;
    }
    const hasLoadedSourceObjects =
      schemas.some((schema) => schema.dataSourceId === selectedSourceId) ||
      tables.some((table) => table.dataSourceId === selectedSourceId);
    if (!hasLoadedSourceObjects) {
      void loadSourceObjects(selectedSourceId);
    }
  }, [isActive, loadSourceObjects, schemas, selectedSourceId, tables]);

  const openDatabaseTab = useCallback((sourceId: string, schema: string) => {
    const nextTab: CompassDataTab = {
      id: databaseTabId(sourceId, schema),
      kind: "database",
      sourceId,
      schema,
      label: schema,
    };
    setActivePage("database");
    setSelectedSourceId(sourceId);
    setSelectedSchema(schema);
    setSelectedTableId(null);
    setOpenTabs((current) => (current.some((tab) => tab.id === nextTab.id) ? current : [...current, nextTab]));
    setActiveTabId(nextTab.id);
    setTabPages((current) => ({ ...current, [nextTab.id]: current[nextTab.id] ?? 1 }));
  }, []);

  const openTableTab = useCallback(
    (sourceId: string, schema: string, tableId: string) => {
      const table = tables.find((item) => item.id === tableId);
      const nextTab: CompassDataTab = {
        id: tableTabId(sourceId, tableId),
        kind: "table",
        sourceId,
        schema,
        tableId,
        label: table?.name ?? tableId,
      };
      if (table?.type !== "imported") {
        setActivePage("database");
      }
      setSelectedSourceId(sourceId);
      setSelectedSchema(schema);
      setSelectedTableId(tableId);
      setOpenTabs((current) => (current.some((tab) => tab.id === nextTab.id) ? current : [...current, nextTab]));
      setActiveTabId(nextTab.id);
      setTabPages((current) => ({ ...current, [nextTab.id]: current[nextTab.id] ?? 1 }));
    },
    [tables],
  );

  const openCsvDataSource = useCallback(
    async (source: DataSourceSummary) => {
      setActivePage("csv");
      setSelectedSourceId(source.id);
      setSelectedSchema(null);
      setSelectedTableId(null);
      const loaded = await loadSourceObjects(source.id);
      const importedTable = loaded?.tables.find((table) => table.type === "imported") ?? loaded?.tables[0];
      if (!importedTable) {
        setActiveTabId(null);
        return;
      }
      const nextTab: CompassDataTab = {
        id: tableTabId(source.id, importedTable.id),
        kind: "table",
        sourceId: source.id,
        schema: importedTable.schema,
        tableId: importedTable.id,
        label: importedTable.name,
      };
      setSelectedSchema(importedTable.schema);
      setSelectedTableId(importedTable.id);
      setOpenTabs((current) => (current.some((tab) => tab.id === nextTab.id) ? current : [...current, nextTab]));
      setActiveTabId(nextTab.id);
      setTabPages((current) => ({ ...current, [nextTab.id]: current[nextTab.id] ?? 1 }));
    },
    [loadSourceObjects],
  );

  const deleteCsvDataSource = useCallback(
    async (sourceId: string) => {
      const result = await requestWithRefreshRef.current((token) => workbenchApi.deleteCsvDataSource(token, sourceId));
      if (isFailure(result)) {
        showFailure(result);
        return;
      }
      setDataSources((current) => current.filter((source) => source.id !== sourceId));
      setOpenTabs((current) => current.filter((tab) => tab.sourceId !== sourceId));
      setActiveTabId((current) => {
        const activeTabSourceId = openTabs.find((tab) => tab.id === current)?.sourceId;
        return activeTabSourceId === sourceId ? null : current;
      });
      setTabPages((current) => {
        const nextEntries = Object.entries(current).filter(([tabId]) => openTabs.find((tab) => tab.id === tabId)?.sourceId !== sourceId);
        return Object.fromEntries(nextEntries);
      });
      setTabPageSizes((current) => {
        const nextEntries = Object.entries(current).filter(([tabId]) => openTabs.find((tab) => tab.id === tabId)?.sourceId !== sourceId);
        return Object.fromEntries(nextEntries);
      });
      setSampleDataByTabId((current) => {
        const nextEntries = Object.entries(current).filter(([tabId]) => openTabs.find((tab) => tab.id === tabId)?.sourceId !== sourceId);
        return Object.fromEntries(nextEntries);
      });
      setSelectedSourceId((current) => (current === sourceId ? null : current));
      setSelectedSchema(null);
      setSelectedTableId(null);
      toast({
        type: "info",
        body: "CSV 数据集已删除。",
        uniqueID: "csv-data-source-deleted",
        collisionBehavior: "overwrite",
      });
    },
    [openTabs, showFailure, toast],
  );

  const saveCsvName = useCallback(async () => {
    if (!editingCsvSource) {
      return;
    }
    const nextName = editingCsvName.trim();
    if (!nextName) {
      toast({
        type: "error",
        body: "CSV 表名称不能为空。",
        uniqueID: "csv-rename-empty",
        collisionBehavior: "overwrite",
      });
      return;
    }
    if (nextName.length > 100) {
      toast({
        type: "error",
        body: "CSV 表名称不能超过 100 个字符。",
        uniqueID: "csv-rename-too-long",
        collisionBehavior: "overwrite",
      });
      return;
    }

    setIsSavingCsvName(true);
    const result = await requestWithRefreshRef.current((token) => workbenchApi.renameCsvDataSource(token, editingCsvSource.id, nextName));
    setIsSavingCsvName(false);
    if (isFailure(result)) {
      showFailure(result);
      return;
    }

    setDataSources((current) => current.map((source) => (source.id === editingCsvSource.id ? result.dataSource : source)));
    if (result.table) {
      setTables((current) => current.map((table) => (table.id === result.table?.id ? result.table : table)));
      setOpenTabs((current) =>
        current.map((tab) =>
          tab.sourceId === editingCsvSource.id && tab.kind === "table" && tab.tableId === result.table?.id
            ? { ...tab, label: result.table.name }
            : tab,
        ),
      );
    }
    closeEditCsvNameDialog();
    toast({
      type: "info",
      body: "CSV 表名称已更新。",
      uniqueID: "csv-renamed",
      collisionBehavior: "overwrite",
    });
  }, [closeEditCsvNameDialog, editingCsvName, editingCsvSource, showFailure, toast]);

  const closeTab = useCallback(
    (tabId: string) => {
      setOpenTabs((current) => {
        const closingIndex = current.findIndex((tab) => tab.id === tabId);
        const nextTabs = current.filter((tab) => tab.id !== tabId);
        if (tabId === activeTabId) {
          const fallback = nextTabs[Math.max(0, closingIndex - 1)] ?? nextTabs[0] ?? null;
          setActiveTabId(fallback?.id ?? null);
          setSelectedSourceId(fallback?.sourceId ?? selectedSourceId);
          setSelectedSchema(fallback?.schema ?? null);
          setSelectedTableId(fallback?.kind === "table" ? fallback.tableId : null);
        }
        return nextTabs;
      });
      setTabPages((current) => {
        const { [tabId]: _closed, ...rest } = current;
        return rest;
      });
      setTabPageSizes((current) => {
        const { [tabId]: _closed, ...rest } = current;
        return rest;
      });
      setSampleDataByTabId((current) => {
        const { [tabId]: _closed, ...rest } = current;
        return rest;
      });
    },
    [activeTabId, selectedSourceId],
  );

  const closeDatabaseConnection = useCallback(
    (sourceId: string) => {
      setDatabaseContextMenu(null);
      setDataSources((current) => current.filter((source) => source.id !== sourceId));
      setOpenTabs((current) => current.filter((tab) => tab.sourceId !== sourceId));
      setActiveTabId((current) => {
        const activeTabSourceId = openTabs.find((tab) => tab.id === current)?.sourceId;
        return activeTabSourceId === sourceId ? null : current;
      });
      setTabPages((current) => {
        const nextEntries = Object.entries(current).filter(([tabId]) => openTabs.find((tab) => tab.id === tabId)?.sourceId !== sourceId);
        return Object.fromEntries(nextEntries);
      });
      setTabPageSizes((current) => {
        const nextEntries = Object.entries(current).filter(([tabId]) => openTabs.find((tab) => tab.id === tabId)?.sourceId !== sourceId);
        return Object.fromEntries(nextEntries);
      });
      setSampleDataByTabId((current) => {
        const nextEntries = Object.entries(current).filter(([tabId]) => openTabs.find((tab) => tab.id === tabId)?.sourceId !== sourceId);
        return Object.fromEntries(nextEntries);
      });
      setSelectedSourceId((current) => (current === sourceId ? null : current));
      setSelectedSchema(null);
      setSelectedTableId(null);
      setSchemas([]);
      setTables([]);
      toast({
        type: "info",
        body: "连接已关闭。",
        uniqueID: "database-connection-closed",
        collisionBehavior: "overwrite",
      });
    },
    [openTabs, toast],
  );

  const refreshDatabaseConnection = useCallback(
    async (sourceId: string) => {
      setDatabaseContextMenu(null);
      setSelectedSourceId(sourceId);
      setSelectedSchema(null);
      setSelectedTableId(null);
      const syncResult = await requestWithRefreshRef.current((token) => workbenchApi.syncMetadata(token, sourceId));
      if (isFailure(syncResult)) {
        showFailure(syncResult);
        return;
      }
      await loadDataSources(true);
      const ok = await loadSourceObjects(sourceId);
      if (!ok) {
        return;
      }
      toast({
        type: "info",
        body: "数据库元数据已刷新。",
        uniqueID: "database-connection-refreshed",
        collisionBehavior: "overwrite",
      });
    },
    [loadDataSources, loadSourceObjects, showFailure, toast],
  );

  const handleResourceContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (activePage !== "database") {
        return;
      }
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const treeItem = target.closest<HTMLElement>('[data-tree-id^="source:"]');
      const sourceId = treeItem?.dataset.treeId?.replace("source:", "");
      const source = dataSources.find((item) => item.id === sourceId);
      if (!treeItem || !source || source.type !== "mysql") {
        return;
      }

      event.preventDefault();
      setSelectedSourceId(source.id);
      setSelectedSchema(null);
      setSelectedTableId(null);
      setDatabaseContextMenu({
        sourceId: source.id,
        sourceName: source.name,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [activePage, dataSources],
  );

  useEffect(() => {
    if (!databaseContextMenu) {
      return;
    }

    const closeMenu = () => setDatabaseContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [databaseContextMenu]);

  useEffect(() => {
    if (!activeTab) {
      return;
    }
    setSelectedSourceId(activeTab.sourceId);
    setSelectedSchema(activeTab.schema);
    setSelectedTableId(activeTab.kind === "table" ? activeTab.tableId : null);
  }, [activeTab]);

  const databaseTreeItems = useMemo<TreeListItemData[]>(
    () => [
      {
        id: "database-connections",
        label: "我的连接",
        isExpanded: true,
        endContent: (
          <TreeRootActionButton
            label="新增连接"
            icon={connectIcon}
            variant="secondary"
            isDisabled={!canManage}
            onClick={() => setIsConnectionDialogOpen(true)}
          />
        ),
        children: databaseSources.map((source) => ({
          id: `source:${source.id}`,
          label: source.name,
          endContent: statusBadge(source),
          isExpanded: source.id === selectedSourceId,
          isSelected: source.id === selectedSourceId && !selectedSchema && !selectedTableId,
          onClick: () => {
            setActivePage("database");
            setSelectedSourceId(source.id);
            setSelectedSchema(null);
            setSelectedTableId(null);
            setActiveTabId(null);
          },
          children:
            source.id === selectedSourceId
              ? schemas.map((schema) => ({
                id: `schema:${schema.id}`,
                label: schema.name,
                startContent: <CompassAssetIcon icon={databaseSourceIcon} />,
                isExpanded: schema.name === selectedSchema,
                isSelected: schema.name === selectedSchema && !selectedTableId,
                onClick: () => {
                  openDatabaseTab(source.id, schema.name);
                },
                children: tables
                  .filter((table) => table.schema === schema.name)
                  .map((table) => ({
                    id: `table:${table.id}`,
                    label: table.name,
                    startContent: <CompassAssetIcon icon={tableEntityIcon(table)} />,
                    endContent: table.isLarge ? <Badge variant="warning" label="大表" /> : table.isSensitive ? <Badge variant="purple" label="敏感" /> : undefined,
                    isSelected: table.id === selectedTableId,
                    onClick: () => {
                      openTableTab(source.id, schema.name, table.id);
                    },
                  })),
              }))
              : [],
        })),
      },
    ],
    [canManage, databaseSources, openDatabaseTab, openTableTab, schemas, selectedSchema, selectedSourceId, selectedTableId, tables],
  );

  const csvTreeItems = useMemo<TreeListItemData[]>(
    () => [
      {
        id: "csv-datasets",
        label: "CSV数据集",
        isExpanded: true,
        endContent: (
          <TreeRootActionButton
            label="导入CSV"
            icon={csvImportIcon}
            variant="secondary"
            isDisabled={!canManage}
            onClick={() => setIsCsvDialogOpen(true)}
          />
        ),
        children: csvSources.map((source) => ({
          id: `source:${source.id}`,
          label: (
            <ContextMenu
              label={`${source.name} 操作`}
              size="sm"
              items={[
                {
                  label: "编辑名称",
                  onClick: () => openEditCsvNameDialog(source),
                  isDisabled: !canManage,
                },
                {
                  label: "删除CSV数据",
                  onClick: () => {
                    void deleteCsvDataSource(source.id);
                  },
                  isDisabled: !canManage,
                },
              ]}
            >
              <span className="compass-tree-label">{source.name}</span>
            </ContextMenu>
          ),
          startContent: <CompassAssetIcon icon={csvIcon} />,
          endContent: <Badge variant="blue" label="CSV" />,
          isSelected: source.id === selectedSourceId,
          onClick: () => {
            void openCsvDataSource(source);
          },
        })),
      },
    ],
    [canManage, csvSources, deleteCsvDataSource, openCsvDataSource, openEditCsvNameDialog, selectedSourceId],
  );

  const tableColumns = useMemo<Array<TableColumn<TableRow>>>(
    () => [
      {
        key: "name",
        header: "对象名",
        width: proportional(1.4, { minWidth: 140 }),
        renderCell: (row) => (
          <button type="button" className="compass-link-button" onClick={row.onSelect as () => void}>
            {row.name}
          </button>
        ),
      },
      { key: "description", header: "说明", width: proportional(2, { minWidth: 180 }) },
      { key: "type", header: "类型", width: proportional(0.8, { minWidth: 96 }) },
      { key: "rows", header: "估算行数", align: "end", width: proportional(0.9, { minWidth: 100 }) },
      { key: "size", header: "估算大小", align: "end", width: proportional(0.9, { minWidth: 100 }) },
      { key: "flags", header: "标记", width: proportional(0.9, { minWidth: 96 }) },
      { key: "updatedAt", header: "更新时间", width: proportional(1.2, { minWidth: 132 }) },
    ],
    [],
  );

  const schemaColumns = useMemo<Array<TableColumn<SchemaRow>>>(
    () => [
      {
        key: "name",
        header: "数据库",
        width: proportional(1.4, { minWidth: 140 }),
        renderCell: (row) => (
          <button
            type="button"
            className="compass-link-button"
            onClick={() => {
              if (selectedSourceId) {
                openDatabaseTab(selectedSourceId, row.name);
              }
            }}
          >
            {row.name}
          </button>
        ),
      },
      { key: "description", header: "说明", width: proportional(1.8, { minWidth: 180 }) },
      { key: "tables", header: "表", align: "end", width: proportional(0.7, { minWidth: 96 }) },
      { key: "views", header: "视图", align: "end", width: proportional(0.7, { minWidth: 96 }) },
      { key: "source", header: "所属连接", width: proportional(1.4, { minWidth: 140 }) },
    ],
    [openDatabaseTab, selectedSourceId],
  );

  const schemaResizePlugin = useTableColumnResize<SchemaRow>({
    columns: schemaColumns as unknown as Array<TableColumn<Record<string, unknown>>>,
    columnWidths: schemaColumnWidths,
    minWidth: MIN_TABLE_COLUMN_WIDTH,
    onColumnResizeEnd: (updates) => setSchemaColumnWidths((current) => ({ ...current, ...updates })),
  });

  const tableResizePlugin = useTableColumnResize<TableRow>({
    columns: tableColumns as unknown as Array<TableColumn<Record<string, unknown>>>,
    columnWidths: tableColumnWidths,
    minWidth: MIN_TABLE_COLUMN_WIDTH,
    onColumnResizeEnd: (updates) => setTableColumnWidths((current) => ({ ...current, ...updates })),
  });

  const loadSampleData = useCallback(async (tab: Extract<CompassDataTab, { kind: "table" }>) => {
    const table = tables.find((item) => item.id === tab.tableId);
    if (!table) {
      return;
    }
    if (table.isLarge) {
      const plan = await requestWithRefresh((token) => workbenchApi.largeTablePlan(token, tab.sourceId, table.id));
      if (isFailure(plan)) {
        showFailure(plan);
        return;
      }
      setPendingLargeTable({ sourceId: tab.sourceId, tabId: tab.id, table });
      return;
    }
    setLoadingSampleTabIds((current) => (current.includes(tab.id) ? current : [...current, tab.id]));
    const result = await requestWithRefresh((token) => workbenchApi.sampleData(token, tab.sourceId, table.id));
    setLoadingSampleTabIds((current) => current.filter((id) => id !== tab.id));
    if (isFailure(result)) {
      showFailure(result);
      return;
    }
    setSampleDataByTabId((current) => ({ ...current, [tab.id]: result }));
  }, [requestWithRefresh, showFailure, tables]);

  useEffect(() => {
    if (!isActive || !activeTab || activeTab.kind !== "table") {
      return;
    }
    if (sampleDataByTabId[activeTab.id] || loadingSampleTabIds.includes(activeTab.id)) {
      return;
    }
    void loadSampleData(activeTab);
  }, [activeTab, isActive, loadSampleData, loadingSampleTabIds, sampleDataByTabId]);

  const confirmLargeTableRead = async () => {
    if (!pendingLargeTable) {
      return;
    }
    setLoadingSampleTabIds((current) => (current.includes(pendingLargeTable.tabId) ? current : [...current, pendingLargeTable.tabId]));
    const result = await requestWithRefresh((token) => workbenchApi.confirmLargeTable(token, pendingLargeTable.sourceId, pendingLargeTable.table.id));
    setLoadingSampleTabIds((current) => current.filter((id) => id !== pendingLargeTable.tabId));
    if (isFailure(result)) {
      showFailure(result);
      return;
    }
    setSampleDataByTabId((current) => ({ ...current, [pendingLargeTable.tabId]: result }));
    setPendingLargeTable(null);
  };

  const createConnection = async () => {
    const result = await requestWithRefresh((token) => workbenchApi.createDataSource(token, connectionForm));
    if (isFailure(result)) {
      showFailure(result);
      return;
    }
    toast({ type: "info", body: "数据源已创建，元数据已进入缓存。", uniqueID: "data-source-created", collisionBehavior: "overwrite" });
    setIsConnectionDialogOpen(false);
    setSelectedSourceId(result.dataSource.id);
    await loadDataSources(true);
  };

  const testConnectionDraft = async () => {
    const host = connectionForm.host.trim();
    const database = connectionForm.database.trim();
    const username = connectionForm.username.trim();
    const port = Number(connectionForm.port);

    if (!host || !database || !username) {
      showConnectionTestToast("error", "请先填写 Host、数据库和用户名。");
      return;
    }

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      showConnectionTestToast("error", "端口必须为 1 到 65535 之间的有效整数。");
      return;
    }

    const statusText = `连接测试通过，耗时 38ms，可访问 ${database}。`;
    showConnectionTestToast("info", statusText);
  };

  const handleCsvFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      toast({
        type: "error",
        body: "请选择 CSV 文件。",
        uniqueID: "csv-file-invalid",
        collisionBehavior: "overwrite",
      });
      return;
    }
    const content = await file.text();
    setCsvName(file.name);
    setCsvContent(content);
  };

  const importCsv = async () => {
    if (!csvName.trim() || !csvContent.trim()) {
      toast({
        type: "error",
        body: "请先上传 CSV 文件。",
        uniqueID: "csv-file-empty",
        collisionBehavior: "overwrite",
      });
      return;
    }
    setIsCsvImporting(true);
    const upload = await requestWithRefresh((token) => workbenchApi.uploadCsv(token, csvName, csvContent));
    if (isFailure(upload)) {
      setIsCsvImporting(false);
      showFailure(upload);
      return;
    }
    const result = await requestWithRefresh((token) => workbenchApi.importCsv(token, upload.file.id));
    setIsCsvImporting(false);
    if (isFailure(result)) {
      showFailure(result);
      return;
    }
    toast({ type: "info", body: `CSV 导入完成，共 ${result.job.importedRows} 行。`, uniqueID: "csv-imported", collisionBehavior: "overwrite" });
    closeCsvDialog();
    setActivePage("csv");
    setSelectedSourceId(result.job.dataSourceId);
    await loadDataSources(true);
    const loaded = await loadSourceObjects(result.job.dataSourceId);
    const importedTable = loaded?.tables.find((table) => table.id === result.job.importedTableId) ?? loaded?.tables[0];
    if (importedTable) {
      const nextTab: CompassDataTab = {
        id: tableTabId(result.job.dataSourceId, importedTable.id),
        kind: "table",
        sourceId: result.job.dataSourceId,
        schema: importedTable.schema,
        tableId: importedTable.id,
        label: importedTable.name,
      };
      setSelectedSchema(importedTable.schema);
      setSelectedTableId(importedTable.id);
      setOpenTabs((current) => (current.some((tab) => tab.id === nextTab.id) ? current : [...current, nextTab]));
      setActiveTabId(nextTab.id);
      setTabPages((current) => ({ ...current, [nextTab.id]: current[nextTab.id] ?? 1 }));
    }
  };

  const sampleColumns = useMemo<Array<TableColumn<Record<string, unknown>>>>(
    () =>
      (activeTab?.kind === "table" ? sampleDataByTabId[activeTab.id]?.columns : undefined)?.map((column) => ({
        key: column.name,
        header: <FieldHeader name={column.name} type={column.type} comment={column.comment} />,
        width: proportional(1, { minWidth: 140 }),
      })) ?? [],
    [activeTab, sampleDataByTabId],
  );

  const sampleResizePlugin = useTableColumnResize<Record<string, unknown>>({
    columns: sampleColumns,
    columnWidths: sampleColumnWidths,
    minWidth: MIN_TABLE_COLUMN_WIDTH,
    onColumnResizeEnd: (updates) => setSampleColumnWidths((current) => ({ ...current, ...updates })),
  });

  const schemaRows = useMemo<SchemaRow[]>(
    () =>
      schemas.map((schema) => ({
        id: schema.id,
        name: schema.name,
        description: `${formatNumber(schema.tableCount)} 表 / ${formatNumber(schema.viewCount)} 视图`,
        tables: formatNumber(schema.tableCount),
        views: formatNumber(schema.viewCount),
        source: selectedSource?.name ?? "-",
      })),
    [schemas, selectedSource],
  );

  const activeSchemaTables = useMemo(
    () => (activeTab?.kind === "database" ? tables.filter((table) => table.schema === activeTab.schema) : []),
    [activeTab, tables],
  );
  const activeTableRows = useMemo(
    () =>
      activeTab?.kind === "database"
        ? tableRows(activeSchemaTables, (tableId) => openTableTab(activeTab.sourceId, activeTab.schema, tableId))
        : [],
    [activeSchemaTables, activeTab, openTableTab],
  );
  const activeSampleData = activeTab?.kind === "table" ? sampleDataByTabId[activeTab.id] : null;
  const activeSampleRows = activeSampleData?.rows ?? [];
  const activeRowsTotal = activeTab?.kind === "database" ? activeTableRows.length : activeTab?.kind === "table" ? activeSampleRows.length : 0;
  const activePageSize = activeTab ? tabPageSizes[activeTab.id] ?? DEFAULT_TABLE_PAGE_SIZE : DEFAULT_TABLE_PAGE_SIZE;
  const activePaginationPage = activeTab ? tabPages[activeTab.id] ?? 1 : 1;
  const maxActivePage = Math.max(1, Math.ceil(activeRowsTotal / activePageSize));
  const displayPage = Math.min(activePaginationPage, maxActivePage);
  const paginatedTableRows = useMemo(() => paginateRows(activeTableRows, displayPage, activePageSize), [activePageSize, activeTableRows, displayPage]);
  const paginatedSampleRows = useMemo(() => paginateRows(activeSampleRows, displayPage, activePageSize), [activePageSize, activeSampleRows, displayPage]);
  const isActiveSampleLoading = activeTab ? loadingSampleTabIds.includes(activeTab.id) : false;
  const currentTreeItems = activePage === "database" ? databaseTreeItems : csvTreeItems;
  const isCurrentPageEmpty = activePage === "database" ? databaseSources.length === 0 : csvSources.length === 0;
  const emptyStateConfig = activePage === "database"
    ? {
        icon: databaseSourceIcon,
        title: "新增数据库连接",
        description: "空空如也的数据库",
        actionLabel: "新增连接",
        onAction: () => setIsConnectionDialogOpen(true),
      }
    : {
        icon: csvIcon,
        title: "新增CSV数据",
        description: "空空如也的数据集",
        actionLabel: "导入CSV",
        onAction: () => setIsCsvDialogOpen(true),
      };

  const setActivePaginationPage = (page: number) => {
    if (!activeTab) {
      return;
    }
    setTabPages((current) => ({ ...current, [activeTab.id]: page }));
  };

  const setActivePaginationPageSize = (pageSize: number) => {
    if (!activeTab) {
      return;
    }
    setTabPageSizes((current) => ({ ...current, [activeTab.id]: pageSize }));
    setTabPages((current) => ({ ...current, [activeTab.id]: 1 }));
  };

  const handleActivePaginationPageSizeChange = (value: string | null) => {
    const nextPageSize = Number(value);
    if (!TABLE_PAGE_SIZE_OPTIONS.includes(nextPageSize)) {
      return;
    }
    setActivePaginationPageSize(nextPageSize);
  };

  return (
    <section className="data-management-workspace">
      <div className="compass-layout">
        <aside className="compass-resource-panel" onContextMenu={handleResourceContextMenu}>
          {isLoading && <Spinner size="sm" />}
          {!isLoading && resourceError && (
            <Section variant="muted" padding={3}>
              <VStack gap={3} hAlign="stretch">
                <Text type="body" color="secondary">
                  {resourceError}
                </Text>
                <Button label="重试获取资源" variant="secondary" size="sm" onClick={() => void loadDataSources(true)} />
              </VStack>
            </Section>
          )}
          {!isLoading && !resourceError && <TreeList items={currentTreeItems} density="compact" />}
          {databaseContextMenu && (
            <div
              className="compass-context-menu"
              style={{ left: databaseContextMenu.x, top: databaseContextMenu.y }}
              role="menu"
              aria-label={`${databaseContextMenu.sourceName} 操作`}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Button label="关闭连接" variant="ghost" size="sm" onClick={() => closeDatabaseConnection(databaseContextMenu.sourceId)} />
              <Button label="刷新" variant="ghost" size="sm" onClick={() => void refreshDatabaseConnection(databaseContextMenu.sourceId)} />
            </div>
          )}
        </aside>

        <main className="compass-main-panel">
          <div className="compass-tab-region">
            {visibleTabs.length > 0 && (
              <TabList value={activeTabId ?? ""} onChange={setActiveTabId} size="sm" hasDivider>
                {visibleTabs.map((tab) => {
                  const tabIcon =
                    tab.kind === "database"
                      ? databaseSourceIcon
                      : tableEntityIcon(tables.find((table) => table.id === tab.tableId));
                  return (
                    <Tab
                      key={tab.id}
                      value={tab.id}
                      label={tab.label}
                      icon={<CompassAssetIcon icon={tabIcon} />}
                      endContent={
                        <button
                          type="button"
                          className="compass-tab-close"
                          aria-label={`关闭 ${tab.label}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            closeTab(tab.id);
                          }}
                        >
                          ×
                        </button>
                      }
                    />
                  );
                })}
              </TabList>
            )}

            <div className="compass-main-content">
              {!activeTab && isCurrentPageEmpty && !isLoading && !resourceError && (
                <div className="compass-empty-state">
                  <EmptyState
                    icon={<CompassEmptyIcon icon={emptyStateConfig.icon} />}
                    title={emptyStateConfig.title}
                    description={emptyStateConfig.description}
                    actions={<Button label={emptyStateConfig.actionLabel} variant="primary" size="sm" isDisabled={!canManage} onClick={emptyStateConfig.onAction} />}
                    isCompact
                  />
                </div>
              )}

              {!activeTab && !isCurrentPageEmpty && selectedSource && activePage === "database" && (
                <Table<SchemaRow>
                  data={schemaRows}
                  columns={schemaColumns}
                  plugins={{ resize: schemaResizePlugin }}
                  idKey="id"
                  density="compact"
                  dividers="rows"
                  hasHover
                  textOverflow="truncate"
                />
              )}

              {!activeTab && !isCurrentPageEmpty && (!selectedSource || activePage === "csv") && (
                <Section variant="muted" padding={4}>
                  <Text type="body" color="secondary">
                    {activePage === "csv" ? "请选择左侧 CSV 数据集。" : "请选择左侧连接或数据库。"}
                  </Text>
                </Section>
              )}

              {activeTab?.kind === "database" && (
                <Table<TableRow>
                  data={paginatedTableRows}
                  columns={tableColumns}
                  plugins={{ resize: tableResizePlugin }}
                  idKey="id"
                  density="compact"
                  dividers="rows"
                  hasHover
                  textOverflow="truncate"
                />
              )}

              {activeTab?.kind === "table" && (
                <VStack gap={3} hAlign="stretch">
                  <HStack hAlign="between" vAlign="center">
                    <span />
                    {isActiveSampleLoading && <Spinner size="sm" />}
                  </HStack>
                  {activeSampleData ? (
                    <Table<Record<string, unknown>>
                      data={paginatedSampleRows}
                      columns={sampleColumns}
                      plugins={{ resize: sampleResizePlugin }}
                      density="compact"
                      dividers="grid"
                      textOverflow="truncate"
                    />
                  ) : (
                    <Section variant="muted" padding={4}>
                      <Text type="body" color="secondary">
                        {isActiveSampleLoading ? "正在读取数据..." : "暂无可展示数据。"}
                      </Text>
                    </Section>
                  )}
                </VStack>
              )}
            </div>

            {activeTab && activeRowsTotal > 0 && (
              <footer className="compass-pagination-footer">
                <div className="compass-page-size-selector">
                  <Selector
                    label="每页条数"
                    isLabelHidden
                    options={TABLE_PAGE_SIZE_SELECTOR_OPTIONS}
                    value={String(activePageSize)}
                    onChange={handleActivePaginationPageSizeChange}
                    size="sm"
                    placement="above"
                  />
                </div>
                <Pagination
                  page={displayPage}
                  onChange={setActivePaginationPage}
                  totalItems={activeRowsTotal}
                  pageSize={activePageSize}
                  variant="count"
                  size="sm"
                  label="数据表格分页"
                />
              </footer>
            )}
          </div>
        </main>
      </div>

      <Dialog isOpen={isConnectionDialogOpen} onOpenChange={setIsConnectionDialogOpen} width={620} purpose="form" padding={5}>
        <>
          <VStack gap={4} hAlign="stretch">
            <Text type="display-3" as="h2">新增连接</Text>
            <TextInput label="连接名称" value={connectionForm.name} onChange={(name) => setConnectionForm((current) => ({ ...current, name }))} />
            <HStack gap={3}>
              <Selector
                label="环境"
                value={connectionForm.environment}
                options={[
                  { label: "生产", value: "production" },
                  { label: "预发", value: "staging" },
                  { label: "开发", value: "development" },
                ]}
                onChange={(environment) => setConnectionForm((current) => ({ ...current, environment: environment as DataSourceInput["environment"] }))}
              />
              <TextInput label="端口" value={String(connectionForm.port)} onChange={(port) => setConnectionForm((current) => ({ ...current, port: Number(port) || 3306 }))} />
            </HStack>
            <TextInput label="Host" value={connectionForm.host} onChange={(host) => setConnectionForm((current) => ({ ...current, host }))} />
            <TextInput label="数据库" value={connectionForm.database} onChange={(database) => setConnectionForm((current) => ({ ...current, database }))} />
            <TextInput label="用户名" value={connectionForm.username} onChange={(username) => setConnectionForm((current) => ({ ...current, username }))} />
            <TextInput label="密码" type="password" value={connectionForm.password ?? ""} onChange={(password) => setConnectionForm((current) => ({ ...current, password }))} />
            <HStack hAlign="end" gap={2}>
              <Button label="取消" variant="secondary" onClick={() => setIsConnectionDialogOpen(false)} />
              <Button label="测试连接" variant="secondary" onClick={testConnectionDraft} />
              <Button label="保存连接" variant="primary" onClick={createConnection} />
            </HStack>
          </VStack>
          {connectionTestToast && (
            <div className="dialog-local-toast">
              <Toast
                key={connectionTestToast.id}
                type={connectionTestToast.type}
                body={connectionTestToast.body}
                isAutoHide
                autoHideDuration={5000}
                onDismiss={() => setConnectionTestToast(null)}
              />
            </div>
          )}
        </>
      </Dialog>

      <Dialog isOpen={isCsvDialogOpen} onOpenChange={handleCsvDialogOpenChange} width={560} purpose="form" padding={5}>
        <VStack gap={4} hAlign="stretch">
          <Text type="display-3" as="h2">导入 CSV</Text>
          <label className="csv-file-field">
            <span>CSV 文件</span>
            <input
              key={csvInputVersion}
              type="file"
              accept=".csv,text/csv"
              disabled={isCsvImporting}
              onChange={(event) => void handleCsvFileChange(event)}
            />
            <em>{csvName || "请选择本地 CSV 文件"}</em>
          </label>
          {isCsvImporting && <Spinner label="数据导入中...." />}
          <HStack hAlign="end" gap={2}>
            <Button label="取消" variant="secondary" isDisabled={isCsvImporting} onClick={closeCsvDialog} />
            <Button label="确认导入" variant="primary" isDisabled={isCsvImporting} onClick={importCsv} />
          </HStack>
        </VStack>
      </Dialog>

      <Dialog isOpen={Boolean(editingCsvSource)} onOpenChange={(open) => !open && closeEditCsvNameDialog()} width={460} purpose="form" padding={5}>
        <VStack gap={4} hAlign="stretch">
          <Text type="display-3" as="h2">编辑名称</Text>
          <TextInput
            label="表名称"
            value={editingCsvName}
            onChange={(name) => setEditingCsvName(name.slice(0, 100))}
          />
          <HStack hAlign="end" gap={2}>
            <Button label="取消" variant="secondary" isDisabled={isSavingCsvName} onClick={closeEditCsvNameDialog} />
            <Button label="保存" variant="primary" isDisabled={isSavingCsvName} onClick={() => void saveCsvName()} />
          </HStack>
        </VStack>
      </Dialog>

      <AlertDialog
        isOpen={Boolean(pendingLargeTable)}
        onOpenChange={(open) => !open && setPendingLargeTable(null)}
        title="确认读取大表样例数据"
        description="该表满足估算行数 >= 1,000,000、实际数据大小 >= 1GB 或字段数 >= 100 的大表规则，系统将使用字段裁剪、脱敏、5 秒查询超时和主键游标分页策略读取最多 20 行样例数据。"
        cancelLabel="取消"
        actionLabel="确认读取"
        actionVariant="primary"
        onAction={confirmLargeTableRead}
      />
    </section>
  );
}
