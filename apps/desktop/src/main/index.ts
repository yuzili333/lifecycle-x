import { app, BrowserWindow, Menu, ipcMain, nativeImage, safeStorage, shell, type MenuItemConstructorOptions } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import defaultDockIconPath from "../../build/icon.png?asset";
import dockIconDark512Path from "../resources/cycle_probe_docker_icon_dark_512.png?asset";
import dockIconLight512Path from "../resources/cycle_probe_docker_icon_light_512.png?asset";
import type { DataSourceMenuAction } from "../preload";
import { AssistantRuntime, type AssistantStreamEvent } from "./assistantRuntime";

const isMac = process.platform === "darwin";
const secretStoreFileName = "cycle-probe-secrets.json";
let refreshToken: string | null = null;

type DockIconVariant = "dark" | "light";

const dockIconPaths: Record<DockIconVariant, string> = {
  dark: dockIconDark512Path,
  light: dockIconLight512Path,
};

function createDockIcon(variant: DockIconVariant) {
  return nativeImage.createFromPath(dockIconPaths[variant]);
}

let currentDockIcon = nativeImage.createFromPath(defaultDockIconPath);
let assistantRuntime: AssistantRuntime | null = null;

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

function applyDockIcon(variant: DockIconVariant) {
  const nextDockIcon = createDockIcon(variant);
  if (nextDockIcon.isEmpty()) {
    return false;
  }

  currentDockIcon = nextDockIcon;
  for (const window of BrowserWindow.getAllWindows()) {
    window.setIcon(currentDockIcon);
  }
  if (isMac) {
    app.dock.setIcon(currentDockIcon);
  }
  return true;
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
      getModelApiKey: modelApiKeyForUser,
      emit: broadcastAssistantEvent,
    });
  }
  return assistantRuntime;
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
          label: "New Connection",
          accelerator: "CommandOrControl+Shift+N",
          click: () => sendDataSourceAction("create-connection"),
        },
        {
          label: "Import CSV",
          accelerator: "CommandOrControl+Shift+I",
          click: () => sendDataSourceAction("import-csv"),
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
    title: "Cycle Probe",
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
ipcMain.handle("dock-icon:set", (_event, variant: DockIconVariant) => {
  if (!Object.hasOwn(dockIconPaths, variant)) {
    return false;
  }
  return applyDockIcon(variant);
});
ipcMain.handle("model-api-key:has", async (_event, userId: string) => {
  const store = await readSecretStore();
  return Boolean(store.modelApiKeys?.[secretKeyForUser(userId)]);
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
ipcMain.handle("assistant:conversations:list", (_event, userId: string) => getAssistantRuntime().listConversations(userId));
ipcMain.handle("assistant:conversation:create", (_event, userId: string) => getAssistantRuntime().createConversation(userId));
ipcMain.handle("assistant:conversation:rename", (_event, userId: string, conversationId: string, title: string) =>
  getAssistantRuntime().renameConversation(userId, conversationId, title),
);
ipcMain.handle("assistant:conversation:delete", (_event, userId: string, conversationId: string) =>
  getAssistantRuntime().deleteConversation(userId, conversationId),
);
ipcMain.handle("assistant:messages:list", (_event, userId: string, conversationId: string) =>
  getAssistantRuntime().getConversationMessages(userId, conversationId),
);
ipcMain.handle("assistant:message:send", (_event, input) => getAssistantRuntime().sendMessage(input));
ipcMain.handle("assistant:message:retry", (_event, input) => getAssistantRuntime().retryAssistantMessage(input));
ipcMain.handle("assistant:message:cancel", (_event, messageId: string) => {
  getAssistantRuntime().cancelMessage(messageId);
  return true;
});
ipcMain.handle("assistant:tool:approve", (_event, userId: string, toolCallId: string, approved: boolean) =>
  getAssistantRuntime().approveTool(userId, toolCallId, approved),
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
