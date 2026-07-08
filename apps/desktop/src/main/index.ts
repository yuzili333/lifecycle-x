import { app, BrowserWindow, Menu, ipcMain, nativeImage, safeStorage, shell, type MenuItemConstructorOptions } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import defaultDockIconPath from "../../build/icon.png?asset";
import dockIconDark512Path from "../resources/cycle_probe_docker_icon_dark_512.png?asset";
import dockIconLight512Path from "../resources/cycle_probe_docker_icon_light_512.png?asset";
import type { DataSourceMenuAction } from "../preload";

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

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
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

app.whenReady().then(() => {
  app.setAppUserModelId("com.lifecycle-x.desktop");
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
