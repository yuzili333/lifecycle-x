import { contextBridge, ipcRenderer } from "electron";

const lifecycleXApi = {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
};

contextBridge.exposeInMainWorld("lifecycleX", lifecycleXApi);

export type LifecycleXApi = typeof lifecycleXApi;
