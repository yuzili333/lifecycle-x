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
import type { ChatCsvAttachment, ImportConversationCsvInput } from "../main/chatCsvTempSource";
import type { ArtifactRecord, ConversationToolState, ToolCallRecord, ToolKind } from "../main/toolOrchestration";
import type { WorkflowContextSummary, WorkflowDatasetRef } from "../main/workflowRuntime";
import type { ResolvedReportVisualizationArtifact } from "../shared/visualization";
import type { ResolvedReportEvidenceCard } from "../shared/evidence";
import type { AgentRunRecord } from "../main/agentOrchestration";

export type DataSourceMenuAction = "open-database" | "open-csv" | "create-connection" | "import-csv";

const lifecycleXApi = {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
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
    createConversation: (userId: string, title?: string) =>
      ipcRenderer.invoke("assistant:conversation:create", userId, title) as Promise<AssistantConversation>,
    renameConversation: (userId: string, conversationId: string, title: string) =>
      ipcRenderer.invoke("assistant:conversation:rename", userId, conversationId, title) as Promise<AssistantConversation>,
    deleteConversation: (userId: string, conversationId: string) =>
      ipcRenderer.invoke("assistant:conversation:delete", userId, conversationId) as Promise<{ success: true; conversationId: string }>,
    listMessages: (userId: string, conversationId: string) =>
      ipcRenderer.invoke("assistant:messages:list", userId, conversationId) as Promise<AssistantMessage[]>,
    getAgentRun: (userId: string, messageId: string) =>
      ipcRenderer.invoke("assistant:agent-run:get", userId, messageId) as Promise<AgentRunRecord | null>,
    listAgentRuns: (userId: string, conversationId: string) =>
      ipcRenderer.invoke("assistant:agent-runs:list", userId, conversationId) as Promise<AgentRunRecord[]>,
    sendMessage: (input: AssistantSendInput) =>
      ipcRenderer.invoke("assistant:message:send", input) as Promise<AssistantSendResult>,
    retryMessage: (input: AssistantRetryInput) =>
      ipcRenderer.invoke("assistant:message:retry", input) as Promise<AssistantRetryResult>,
    cancelMessage: (messageId: string) =>
      ipcRenderer.invoke("assistant:message:cancel", messageId) as Promise<boolean>,
    importConversationCsv: (input: ImportConversationCsvInput) =>
      ipcRenderer.invoke("assistant:chat-csv:import", input) as Promise<ChatCsvAttachment>,
    listConversationCsvAttachments: (userId: string, conversationId: string) =>
      ipcRenderer.invoke("assistant:chat-csv:list", userId, conversationId) as Promise<ChatCsvAttachment[]>,
    removeConversationCsvAttachment: (userId: string, conversationId: string, tempDataSourceId: string) =>
      ipcRenderer.invoke("assistant:chat-csv:remove", userId, conversationId, tempDataSourceId) as Promise<{ success: true; tempDataSourceId: string }>,
    getConversationTempSchemaContext: (userId: string, conversationId: string, tempDataSourceIds?: string[]) =>
      ipcRenderer.invoke("assistant:chat-csv:schema-context", userId, conversationId, tempDataSourceIds) as Promise<string | null>,
    approveTool: (userId: string, toolCallId: string, approved: boolean) =>
      ipcRenderer.invoke("assistant:tool:approve", userId, toolCallId, approved) as Promise<{
        success: true;
        toolCall: unknown;
        message: AssistantMessage;
      }>,
    getWorkflowContext: (userId: string, conversationId: string) =>
      ipcRenderer.invoke("assistant:workflow:context", userId, conversationId) as Promise<WorkflowContextSummary>,
    getToolState: (userId: string, conversationId: string) =>
      ipcRenderer.invoke("assistant:tools:state", userId, conversationId) as Promise<ConversationToolState>,
    listToolCalls: (userId: string, conversationId: string) =>
      ipcRenderer.invoke("assistant:tools:list", userId, conversationId) as Promise<ToolCallRecord[]>,
    getLatestToolResult: (userId: string, conversationId: string, toolKind: ToolKind) =>
      ipcRenderer.invoke("assistant:tools:latest", userId, conversationId, toolKind) as Promise<ToolCallRecord | null>,
    selectToolResult: (userId: string, conversationId: string, toolKind: ToolKind, toolCallId: string) =>
      ipcRenderer.invoke("assistant:tools:select", userId, conversationId, toolKind, toolCallId) as Promise<ConversationToolState>,
    getToolArtifact: (userId: string, conversationId: string, artifactId: string) =>
      ipcRenderer.invoke("assistant:tools:artifact", userId, conversationId, artifactId) as Promise<ArtifactRecord | null>,
    resolveReportVisualization: (userId: string, conversationId: string, reportArtifactId: string, reportVersion: number, visualizationArtifactId: string) =>
      ipcRenderer.invoke("assistant:reports:visualization", userId, conversationId, reportArtifactId, reportVersion, visualizationArtifactId) as Promise<ResolvedReportVisualizationArtifact>,
    resolveReportEvidence: (userId: string, conversationId: string, reportArtifactId: string, reportVersion: number, evidenceCardId: string) =>
      ipcRenderer.invoke("assistant:reports:evidence", userId, conversationId, reportArtifactId, reportVersion, evidenceCardId) as Promise<ResolvedReportEvidenceCard>,
    confirmWorkflowDataset: (userId: string, conversationId: string, datasetId?: string) =>
      ipcRenderer.invoke("assistant:workflow:confirm-dataset", userId, conversationId, datasetId) as Promise<{
        success: true;
        dataset: WorkflowDatasetRef;
        context: WorkflowContextSummary;
      }>,
    rejectWorkflowDataset: (userId: string, conversationId: string, datasetId: string, reason?: string) =>
      ipcRenderer.invoke("assistant:workflow:reject-dataset", userId, conversationId, datasetId, reason) as Promise<{
        success: true;
        dataset: WorkflowDatasetRef;
        context: WorkflowContextSummary;
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
