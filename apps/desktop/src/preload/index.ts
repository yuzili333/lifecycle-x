import { contextBridge, ipcRenderer } from "electron";

export type DataSourceMenuAction = "create-connection" | "import-csv";
export type DockIconVariant = "dark" | "light";

const lifecycleXApi = {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  dockIcon: {
    set: (variant: DockIconVariant) => ipcRenderer.invoke("dock-icon:set", variant) as Promise<boolean>,
  },
  auth: {
    getRefreshToken: () => ipcRenderer.invoke("auth:get-refresh-token") as Promise<string | null>,
    setRefreshToken: (token: string) => ipcRenderer.invoke("auth:set-refresh-token", token) as Promise<boolean>,
    clearRefreshToken: () => ipcRenderer.invoke("auth:clear-refresh-token") as Promise<boolean>,
  },
  modelApiKey: {
    has: (userId: string) => ipcRenderer.invoke("model-api-key:has", userId) as Promise<boolean>,
    set: (userId: string, apiKey: string) => ipcRenderer.invoke("model-api-key:set", userId, apiKey) as Promise<boolean>,
  },
  dataSource: {
    onAction: (handler: (action: DataSourceMenuAction) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, action: DataSourceMenuAction) => handler(action);
      ipcRenderer.on("data-source:action", listener);
      return () => {
        ipcRenderer.removeListener("data-source:action", listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("lifecycleX", lifecycleXApi);

export type LifecycleXApi = typeof lifecycleXApi;
