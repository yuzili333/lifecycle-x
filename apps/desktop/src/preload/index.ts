import { contextBridge, ipcRenderer } from "electron";

const lifecycleXApi = {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  auth: {
    getRefreshToken: () => ipcRenderer.invoke("auth:get-refresh-token") as Promise<string | null>,
    setRefreshToken: (token: string) => ipcRenderer.invoke("auth:set-refresh-token", token) as Promise<boolean>,
    clearRefreshToken: () => ipcRenderer.invoke("auth:clear-refresh-token") as Promise<boolean>,
  },
};

contextBridge.exposeInMainWorld("lifecycleX", lifecycleXApi);

export type LifecycleXApi = typeof lifecycleXApi;
