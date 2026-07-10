export type MemoryScope = "conversation" | "project" | "user" | "data_source" | "tool" | "report" | "system";

export type MemoryType =
  | "message"
  | "summary"
  | "fact"
  | "preference"
  | "decision"
  | "task_state"
  | "tool_result_summary"
  | "schema_context_summary"
  | "sql_result_summary"
  | "python_result_summary"
  | "report_version_summary"
  | "warning"
  | "todo";

export type MemorySource = {
  sourceType:
    | "user_message"
    | "assistant_message"
    | "tool_call"
    | "tool_result"
    | "schema_context"
    | "sql_execution"
    | "python_execution"
    | "report_generation"
    | "manual"
    | "system";
  conversationId?: string;
  messageId?: string;
  toolCallId?: string;
  requestId?: string;
  executionId?: string;
  dataSourceId?: string;
  versionId?: string;
};

export type MemoryVisibility = "private" | "project" | "session" | "temporary" | "system";

export type MemoryRetentionPolicy = {
  mode: "ephemeral" | "session" | "project" | "persistent";
  ttlMs?: number;
  allowCompression: boolean;
  allowDeletion: boolean;
  allowPromptInjection: boolean;
};

export type LocalMemoryRecord = {
  memoryId: string;
  scope: MemoryScope;
  type: MemoryType;
  title?: string;
  content: string;
  structured?: Record<string, unknown>;
  tags?: string[];
  importance: number;
  confidence?: number;
  source: MemorySource;
  visibility: MemoryVisibility;
  retention: MemoryRetentionPolicy;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  lastAccessedAt?: string;
  accessCount?: number;
  metadata?: Record<string, unknown>;
};

export type MemorySearchQuery = {
  text?: string;
  scope?: MemoryScope[];
  type?: MemoryType[];
  tags?: string[];
  conversationId?: string;
  projectId?: string;
  dataSourceId?: string;
  limit?: number;
  minImportance?: number;
  includeExpired?: boolean;
};

export type MemorySearchResult = {
  record: LocalMemoryRecord;
  score: number;
  reason: string;
};

export type MemoryCleanupInput = {
  now?: string;
  includeEphemeral?: boolean;
  maxDeleted?: number;
};

export type MemoryCleanupResult = {
  deletedCount: number;
  deletedMemoryIds: string[];
  warnings: string[];
};

export type LocalMemoryStore = {
  create(record: LocalMemoryRecord): Promise<LocalMemoryRecord>;
  update(memoryId: string, patch: Partial<LocalMemoryRecord>): Promise<LocalMemoryRecord>;
  get(memoryId: string): Promise<LocalMemoryRecord | null>;
  delete(memoryId: string): Promise<void>;
  search(query: MemorySearchQuery): Promise<MemorySearchResult[]>;
  listByConversation(conversationId: string): Promise<LocalMemoryRecord[]>;
  listByProject(projectId: string): Promise<LocalMemoryRecord[]>;
  cleanup(input?: MemoryCleanupInput): Promise<MemoryCleanupResult>;
};

export type WriteMemoryInput = {
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  title?: string;
  structured?: Record<string, unknown>;
  tags?: string[];
  importance?: number;
  source: MemorySource;
  visibility?: MemoryVisibility;
  retention?: Partial<MemoryRetentionPolicy>;
};

export type RetrieveMemoryInput = {
  conversationId?: string;
  projectId?: string;
  dataSourceIds?: string[];
  userQuestion?: string;
  purpose?: "chat" | "sql_generation" | "python_analysis" | "report_generation" | "risk_analysis" | "context_compression";
  limit?: number;
  maxChars?: number;
};

export type ContextItem = {
  itemId: string;
  type:
    | "system_instruction"
    | "user_message"
    | "assistant_message"
    | "tool_result"
    | "schema_context"
    | "memory"
    | "report_draft"
    | "version"
    | "approval_state"
    | "task_state";
  content: string;
  priority: number;
  tokenEstimate?: number;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export type ContextBudget = {
  maxChars: number;
  maxItems?: number;
  reservedCharsForSystem?: number;
  reservedCharsForUserQuestion?: number;
  reservedCharsForTools?: number;
  reservedCharsForMemory?: number;
  reservedCharsForSchema?: number;
  reservedCharsForRecentMessages?: number;
};

export type CompressedContext = {
  contextId: string;
  conversationId?: string;
  originalItemCount: number;
  compressedItemCount: number;
  originalChars: number;
  compressedChars: number;
  summary: string;
  retainedItems: ContextItem[];
  droppedItems: ContextItem[];
  memoryRefs: string[];
  warnings: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type CompressContextInput = {
  conversationId?: string;
  userQuestion?: string;
  items: ContextItem[];
  budget: ContextBudget;
  compressionMode?: "lossless_priority" | "summary" | "hybrid";
  preserveTypes?: ContextItem["type"][];
};

export type AssembleContextInput = {
  conversationId: string;
  projectId?: string;
  userQuestion: string;
  systemInstruction?: string;
  recentMessages?: ContextItem[];
  schemaContextItems?: ContextItem[];
  toolContextItems?: ContextItem[];
  taskStateItems?: ContextItem[];
  budget: ContextBudget;
  purpose: "chat" | "sql_generation" | "python_analysis" | "report_generation" | "risk_analysis";
};

export type AssembledModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  metadata?: Record<string, unknown>;
};

export type AssembleContextOutput = {
  contextId: string;
  messages: AssembledModelMessage[];
  compressedContext: CompressedContext;
  injectedMemoryIds: string[];
  warnings: string[];
  createdAt: string;
};

export type SensitiveFilterResult = {
  safeContent: string;
  action: "none" | "masked" | "dropped" | "blocked";
  issues: Array<{
    type: string;
    severity: "info" | "warning" | "error" | "critical";
    message: string;
  }>;
};

export type MemoryCompressionInput = {
  conversationId?: string;
  projectId?: string;
  memoryIds?: string[];
  maxSummaryChars?: number;
  deleteSourceMemories?: boolean;
};

export type MemoryCompressionResult = {
  compressedMemory: LocalMemoryRecord;
  sourceMemoryIds: string[];
  droppedMemoryIds: string[];
  warnings: string[];
};

export type MemorySummarizerAdapter = {
  summarize(input: { content: string; purpose: string; maxChars: number }): Promise<{ summary: string; warnings: string[] }>;
};

export type MemoryEmbeddingRetriever = {
  search(input: { query: string; limit: number; filters?: Record<string, unknown> }): Promise<MemorySearchResult[]>;
};

export type LocalMemoryModuleConfig = {
  store?: LocalMemoryStore;
  defaultContextBudget: ContextBudget;
  sensitiveFilterEnabled: boolean;
  summarizerAdapter?: MemorySummarizerAdapter;
  embeddingRetriever?: MemoryEmbeddingRetriever;
  maxMemoryRecordsPerConversation?: number;
  maxMemoryCharsPerConversation?: number;
  enableAutoCompression?: boolean;
};

export type LocalMemoryErrorCode =
  | "MEMORY_NOT_FOUND"
  | "MEMORY_WRITE_BLOCKED"
  | "MEMORY_UPDATE_FAILED"
  | "MEMORY_DELETE_FAILED"
  | "MEMORY_SEARCH_FAILED"
  | "MEMORY_COMPRESSION_FAILED"
  | "CONTEXT_COMPRESSION_FAILED"
  | "CONTEXT_BUDGET_EXCEEDED"
  | "SENSITIVE_CONTENT_BLOCKED"
  | "STORE_UNAVAILABLE"
  | "UNKNOWN_ERROR";
