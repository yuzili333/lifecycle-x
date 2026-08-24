import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, safeStorage, shell, type MenuItemConstructorOptions } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import defaultDockIconPath from "../../build/icon.png?asset";
import type { DataSourceMenuAction } from "../preload";
import type { SkillIpcResult, SkillOperation } from "../shared/skills";
import type { ReportExportRequest } from "../shared/reportExport";
import { AssistantRuntime, type AssistantStreamEvent } from "./assistantRuntime";
import { ReportExportService } from "./reportExportService";
import { asSkillOperationError, LocalSkillManager } from "./skills";

const isMac = process.platform === "darwin";
const secretStoreFileName = "cycle-probe-secrets.json";
let refreshToken: string | null = null;

let currentDockIcon = nativeImage.createFromPath(defaultDockIconPath);
let assistantRuntime: AssistantRuntime | null = null;
let localSkillManager: LocalSkillManager | null = null;

const e2eCdpPort = (process.env.LIFECYCLE_X_E2E_CDP_PORT ?? (app.isPackaged ? "" : "9333")).trim();
if (e2eCdpPort && /^\d{2,5}$/.test(e2eCdpPort)) {
  app.commandLine.appendSwitch("remote-debugging-port", e2eCdpPort);
  app.commandLine.appendSwitch("remote-allow-origins", "*");
}

type SecretStore = {
  modelApiKeys?: Record<string, string>;
};

function secretStorePath() {
  return join(app.getPath("userData"), secretStoreFileName);
}

async function readSecretStore(): Promise<SecretStore> {
  try {
    const content = await readFile(secretStorePath(), "utf8");
    return JSON.parse(content) as SecretStore;
  } catch {
    return {};
  }
}

async function writeSecretStore(store: SecretStore) {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(secretStorePath(), JSON.stringify(store, null, 2), "utf8");
}

function secretKeyForUser(userId: string) {
  return userId.trim() || "anonymous";
}

function encryptLocalSecret(secret: string) {
  if (safeStorage.isEncryptionAvailable()) {
    return `safe:${safeStorage.encryptString(secret).toString("base64")}`;
  }
  return `base64:${Buffer.from(secret, "utf8").toString("base64")}`;
}

function decryptLocalSecret(secret: string) {
  if (secret.startsWith("safe:")) {
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    try {
      return safeStorage.decryptString(Buffer.from(secret.slice("safe:".length), "base64"));
    } catch {
      return null;
    }
  }
  if (secret.startsWith("base64:")) {
    return Buffer.from(secret.slice("base64:".length), "base64").toString("utf8");
  }
  return null;
}

function sendDataSourceAction(action: DataSourceMenuAction) {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  targetWindow?.webContents.send("data-source:action", action);
}

async function modelApiKeyForUser(userId: string) {
  const store = await readSecretStore();
  const encrypted = store.modelApiKeys?.[secretKeyForUser(userId)];
  return encrypted ? decryptLocalSecret(encrypted) : null;
}

function broadcastAssistantEvent(event: AssistantStreamEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("assistant:stream-event", event);
  }
}

function getAssistantRuntime() {
  if (!assistantRuntime) {
    assistantRuntime = new AssistantRuntime({
      dbPath: join(app.getPath("userData"), "cycle-probe-assistant.sqlite3"),
      csvSqlitePath: join(process.env.LIFECYCLE_X_DATA_DIR ?? join(homedir(), ".cycle-probe"), "csv-data.sqlite"),
      toolLogPath: join(app.getPath("userData"), "cycle-probe-tool-calls.jsonl"),
      getModelApiKey: modelApiKeyForUser,
      emit: broadcastAssistantEvent,
      loadSkill: (userId, skillId) => getLocalSkillManager().load(userId, skillId),
    });
  }
  return assistantRuntime;
}

function getLocalSkillManager() {
  if (!localSkillManager) {
    localSkillManager = new LocalSkillManager({
      userDataRoot: app.getPath("userData"),
    });
  }
  return localSkillManager;
}

async function runSkillOperation<T>(
  operation: SkillOperation,
  action: () => Promise<T>,
): Promise<SkillIpcResult<T>> {
  const traceId = randomUUID();
  try {
    return { success: true, data: await action() };
  } catch (error) {
    return {
      success: false,
      error: asSkillOperationError(error, operation, traceId),
    };
  }
}

function buildApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
        {
          label: app.name,
          submenu: [{ role: "about" as const }, { type: "separator" as const }, { role: "quit" as const }],
        },
      ]
      : []),
    {
      label: "Data Source",
      submenu: [
        {
          label: "连接数据库",
          accelerator: "CommandOrControl+Shift+N",
          click: () => sendDataSourceAction("create-connection"),
        },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1080,
    minHeight: 720,
    title: "溯据",
    icon: currentDockIcon,
    backgroundColor: "#f7fafc",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  let windowShown = false;
  const showWindow = () => {
    if (windowShown || mainWindow.isDestroyed()) {
      return;
    }
    windowShown = true;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
    if (isMac) {
      app.dock.show();
      app.focus({ steal: true });
      setTimeout(() => {
        if (mainWindow.isDestroyed()) {
          return;
        }
        mainWindow.moveTop();
        mainWindow.focus();
        app.focus({ steal: true });
      }, 150);
    }
  };

  const showWindowFallback = setTimeout(showWindow, 1500);

  mainWindow.once("ready-to-show", showWindow);
  mainWindow.webContents.once("did-finish-load", showWindow);
  mainWindow.on("closed", () => {
    clearTimeout(showWindowFallback);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[main] renderer load failed", {
      errorCode,
      errorDescription,
      validatedURL,
    });
    showWindow();
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[main] renderer process gone", details);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

ipcMain.handle("app:info", () => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
}));

ipcMain.handle("auth:get-refresh-token", () => refreshToken);
ipcMain.handle("auth:set-refresh-token", (_event, token: string) => {
  refreshToken = token;
  return true;
});
ipcMain.handle("auth:clear-refresh-token", () => {
  refreshToken = null;
  return true;
});
ipcMain.handle("shell:open-external", (_event, url: string) => shell.openExternal(url));
ipcMain.handle("model-api-key:has", async (_event, userId: string) => {
  return Boolean(await modelApiKeyForUser(userId));
});
ipcMain.handle("model-api-key:set", async (_event, userId: string, apiKey: string) => {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) {
    return false;
  }

  const store = await readSecretStore();
  await writeSecretStore({
    ...store,
    modelApiKeys: {
      ...store.modelApiKeys,
      [secretKeyForUser(userId)]: encryptLocalSecret(normalizedKey),
    },
  });
  return true;
});

ipcMain.handle("skill:list", (_event, userId: string) =>
  runSkillOperation("list", () => getLocalSkillManager().list(userId)));
ipcMain.handle("skill:pick-and-install", async (_event, userId: string) => {
  const selected = await dialog.showOpenDialog({
    title: "安装个人 Skill",
    properties: ["openFile"],
    filters: [{ name: "Skill 安装包", extensions: ["zip"] }],
  });
  if (selected.canceled || !selected.filePaths[0]) {
    return { success: true, data: { status: "cancelled" } };
  }
  return runSkillOperation("install", () =>
    getLocalSkillManager().install(userId, selected.filePaths[0]));
});
ipcMain.handle("skill:set-enabled", (_event, userId: string, skillId: string, enabled: boolean) =>
  runSkillOperation("set_enabled", () =>
    getLocalSkillManager().setEnabled(userId, skillId, enabled)));
ipcMain.handle("skill:remove", (_event, userId: string, skillId: string) =>
  runSkillOperation("remove", () =>
    getLocalSkillManager().remove(userId, skillId)));
ipcMain.handle("assistant:conversations:list", (_event, userId: string) => getAssistantRuntime().listConversations(userId));
ipcMain.handle("assistant:conversation:create", (_event, userId: string, title?: string) => getAssistantRuntime().createConversation(userId, title));
ipcMain.handle("assistant:conversation:rename", (_event, userId: string, conversationId: string, title: string) =>
  getAssistantRuntime().renameConversation(userId, conversationId, title),
);
ipcMain.handle("assistant:conversation:delete", (_event, userId: string, conversationId: string) =>
  getAssistantRuntime().deleteConversation(userId, conversationId),
);
ipcMain.handle("assistant:messages:list", (_event, userId: string, conversationId: string) =>
  getAssistantRuntime().getConversationMessages(userId, conversationId),
);
ipcMain.handle("assistant:agent-run:get", (_event, userId: string, messageId: string) =>
  getAssistantRuntime().getAgentRun(userId, messageId),
);
ipcMain.handle("assistant:agent-runs:list", (_event, userId: string, conversationId: string) =>
  getAssistantRuntime().listConversationAgentRuns(userId, conversationId),
);
ipcMain.handle("assistant:message:send", (_event, input) => getAssistantRuntime().sendMessage(input));
ipcMain.handle("assistant:message:retry", (_event, input) => getAssistantRuntime().retryAssistantMessage(input));
ipcMain.handle("assistant:message:cancel", (_event, messageId: string) => {
  getAssistantRuntime().cancelMessage(messageId);
  return true;
});
ipcMain.handle("assistant:chat-csv:import", (_event, input) => getAssistantRuntime().importConversationCsv(input));
ipcMain.handle("assistant:chat-csv:list", (_event, userId: string, conversationId: string) =>
  getAssistantRuntime().listConversationCsvAttachments(userId, conversationId),
);
ipcMain.handle("assistant:chat-csv:remove", (_event, userId: string, conversationId: string, tempDataSourceId: string) =>
  getAssistantRuntime().removeConversationCsvAttachment(userId, conversationId, tempDataSourceId),
);
ipcMain.handle("assistant:chat-csv:schema-context", (_event, userId: string, conversationId: string, tempDataSourceIds?: string[]) =>
  getAssistantRuntime().buildConversationTempSchemaContext(userId, conversationId, tempDataSourceIds),
);
ipcMain.handle("assistant:tool:approve", (_event, userId: string, toolCallId: string, approved: boolean) =>
  getAssistantRuntime().approveTool(userId, toolCallId, approved),
);
ipcMain.handle("assistant:workflow:context", (_event, userId: string, conversationId: string) =>
  getAssistantRuntime().getWorkflowContext(userId, conversationId),
);
ipcMain.handle("assistant:tools:state", (_event, userId: string, conversationId: string) =>
  getAssistantRuntime().getConversationToolState(userId, conversationId),
);
ipcMain.handle("assistant:tools:list", (_event, userId: string, conversationId: string) =>
  getAssistantRuntime().listConversationToolCalls(userId, conversationId),
);
ipcMain.handle("assistant:tools:latest", (_event, userId: string, conversationId: string, toolKind: import("./toolOrchestration").ToolKind) =>
  getAssistantRuntime().getLatestConversationToolResult(userId, conversationId, toolKind),
);
ipcMain.handle("assistant:tools:select", (_event, userId: string, conversationId: string, toolKind: import("./toolOrchestration").ToolKind, toolCallId: string) =>
  getAssistantRuntime().selectConversationToolResult(userId, conversationId, toolKind, toolCallId),
);
ipcMain.handle("assistant:tools:artifact", (_event, userId: string, conversationId: string, artifactId: string) =>
  getAssistantRuntime().getConversationToolArtifact(userId, conversationId, artifactId),
);
ipcMain.handle("assistant:reports:visualization", (_event, userId: string, conversationId: string, reportArtifactId: string, reportVersion: number, visualizationArtifactId: string) =>
  getAssistantRuntime().resolveConversationReportVisualization(userId, conversationId, reportArtifactId, reportVersion, visualizationArtifactId),
);
ipcMain.handle("assistant:reports:evidence", (_event, userId: string, conversationId: string, reportArtifactId: string, reportVersion: number, evidenceCardId: string) =>
  getAssistantRuntime().resolveConversationReportEvidence(userId, conversationId, reportArtifactId, reportVersion, evidenceCardId),
);
ipcMain.handle("assistant:reports:export", (_event, request: ReportExportRequest) =>
  new ReportExportService(getAssistantRuntime()).export(request),
);
ipcMain.handle("assistant:workflow:confirm-dataset", (_event, userId: string, conversationId: string, datasetId?: string) =>
  getAssistantRuntime().confirmWorkflowDataset(userId, conversationId, datasetId),
);
ipcMain.handle("assistant:workflow:reject-dataset", (_event, userId: string, conversationId: string, datasetId: string, reason?: string) =>
  getAssistantRuntime().rejectWorkflowDataset(userId, conversationId, datasetId, reason),
);

app.whenReady().then(() => {
  app.setAppUserModelId("com.lifecycle-x.desktop");
  if (isMac) {
    app.setActivationPolicy("regular");
  }
  if (isMac && !currentDockIcon.isEmpty()) {
    app.dock.setIcon(currentDockIcon);
  }
  buildApplicationMenu();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (!isMac) {
    app.quit();
  }
});
