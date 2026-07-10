import { contextBridge, ipcRenderer } from "electron";
import type {
  AssistantConversation,
  AssistantMessage,
  AssistantRetryInput,
  AssistantRetryResult,
  AssistantSendInput,
  AssistantSendResult,
  AssistantStreamEvent,
} from "../main/assistantRuntime";

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
  assistant: {
    listConversations: (userId: string) =>
      ipcRenderer.invoke("assistant:conversations:list", userId) as Promise<AssistantConversation[]>,
    createConversation: (userId: string) =>
      ipcRenderer.invoke("assistant:conversation:create", userId) as Promise<AssistantConversation>,
    renameConversation: (userId: string, conversationId: string, title: string) =>
      ipcRenderer.invoke("assistant:conversation:rename", userId, conversationId, title) as Promise<AssistantConversation>,
    deleteConversation: (userId: string, conversationId: string) =>
      ipcRenderer.invoke("assistant:conversation:delete", userId, conversationId) as Promise<{ success: true; conversationId: string }>,
    listMessages: (userId: string, conversationId: string) =>
      ipcRenderer.invoke("assistant:messages:list", userId, conversationId) as Promise<AssistantMessage[]>,
    sendMessage: (input: AssistantSendInput) =>
      ipcRenderer.invoke("assistant:message:send", input) as Promise<AssistantSendResult>,
    retryMessage: (input: AssistantRetryInput) =>
      ipcRenderer.invoke("assistant:message:retry", input) as Promise<AssistantRetryResult>,
    cancelMessage: (messageId: string) =>
      ipcRenderer.invoke("assistant:message:cancel", messageId) as Promise<boolean>,
    approveTool: (userId: string, toolCallId: string, approved: boolean) =>
      ipcRenderer.invoke("assistant:tool:approve", userId, toolCallId, approved) as Promise<{
        success: true;
        toolCall: unknown;
        message: AssistantMessage;
      }>,
    onStreamEvent: (handler: (event: AssistantStreamEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: AssistantStreamEvent) => handler(event);
      ipcRenderer.on("assistant:stream-event", listener);
      return () => {
        ipcRenderer.removeListener("assistant:stream-event", listener);
      };
    },
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
