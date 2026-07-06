import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";

const isMac = process.platform === "darwin";
let refreshToken: string | null = null;

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1080,
    minHeight: 720,
    title: "存续期数据探针智能体",
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

app.whenReady().then(() => {
  app.setAppUserModelId("com.lifecycle-x.desktop");
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
