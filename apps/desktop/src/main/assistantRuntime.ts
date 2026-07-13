import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  AuditedWorkflowStateStore,
  SQLiteDatasetStateManager,
  SQLiteMaterializer,
  SQLiteWorkflowAuditLogger,
  SQLiteWorkflowMemoryBridge,
  SQLiteWorkflowStateStore,
  TempTableRegistry,
  WorkflowContextBuilder,
  type WorkflowContextSummary,
  type WorkflowDatasetRef,
  type WorkflowSession,
  type WorkflowStateStore,
} from "./workflowRuntime";
import { rewriteCompoundOrderByForSqlite } from "./sqliteSqlRewrite";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

export type AssistantApprovalMode = "full_access" | "request_approval" | "no_access";
export type AssistantSkill = "general_analysis" | "schema_explorer";
export type AssistantBlockType = "text" | "markdown" | "json" | "card" | "mermaid";
export type AssistantMessageRole = "system" | "user" | "assistant" | "tool";
export type AssistantMessageStatus =
  | "draft"
  | "sending"
  | "sent"
  | "receiving"
  | "processing"
  | "completed"
  | "awaiting_approval"
  | "stopped"
  | "error";

export type AssistantBlock = {
  id: string;
  type: AssistantBlockType;
  content: string;
  title?: string;
  language?: string;
  toolCallId?: string;
  toolStatus?: AssistantToolStatus;
  toolName?: AssistantToolKind;
  toolTarget?: string;
  toolFiles?: string[];
  toolDurationMs?: number;
};

export type AssistantMessageContext = {
  dataSourceLabel?: string | null;
  skill?: AssistantSkill | null;
};

export type AssistantConversation = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantMessage = {
  id: string;
  conversationId: string;
  userId: string;
  role: AssistantMessageRole;
  status: AssistantMessageStatus;
  content: string;
  blocks: AssistantBlock[];
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  integrityHash: string;
  previousHash?: string;
  clientRequestId?: string;
  providerTraceId?: string;
  context?: AssistantMessageContext;
};

export type AssistantToolKind = "sql" | "python";
export type AssistantToolStatus = "pending_approval" | "running" | "completed" | "declined" | "blocked" | "error";

export type AssistantToolCall = {
  id: string;
  conversationId: string;
  messageId: string;
  userId: string;
  kind: AssistantToolKind;
  status: AssistantToolStatus;
  script: string;
  result?: string;
  errorMessage?: string;
  approvalMode: AssistantApprovalMode;
  createdAt: string;
  updatedAt: string;
};

export type AssistantSendInput = {
  userId: string;
  conversationId?: string;
  clientRequestId: string;
  prompt: string;
  modelName: string;
  dataSourceId?: string | null;
  dataSourceLabel?: string | null;
  schemaContextMarkdown?: string | null;
  skill?: AssistantSkill | null;
  approvalMode: AssistantApprovalMode;
};

export type AssistantRetryInput = {
  userId: string;
  messageId: string;
  clientRequestId: string;
  modelName: string;
  dataSourceLabel?: string | null;
  schemaContextMarkdown?: string | null;
  skill?: AssistantSkill | null;
  approvalMode: AssistantApprovalMode;
};

export type AssistantStreamEvent =
  | { type: "conversation"; conversation: AssistantConversation }
  | { type: "message"; conversationId: string; message: AssistantMessage }
  | { type: "message-delta"; conversationId: string; messageId: string; content: string; blocks: AssistantBlock[]; status: AssistantMessageStatus }
  | { type: "tool"; conversationId: string; toolCall: AssistantToolCall; message: AssistantMessage }
  | { type: "workflow"; conversationId: string; context: WorkflowContextSummary }
  | { type: "error"; conversationId: string; messageId?: string; message: string; traceId: string };

export type AssistantSendResult = {
  success: true;
  conversation: AssistantConversation;
  userMessage: AssistantMessage;
  assistantMessage: AssistantMessage;
};

export type AssistantRetryResult = {
  success: true;
  conversation: AssistantConversation;
  assistantMessage: AssistantMessage;
};

type AssistantRuntimeOptions = {
  dbPath: string;
  csvSqlitePath: string;
  toolLogPath: string;
  getModelApiKey: (userId: string) => Promise<string | null>;
  emit: (event: AssistantStreamEvent) => void;
};

type CsvDatasetTableRow = {
  data_source_id: string;
  table_id: string;
  sqlite_table_name: string;
  display_name: string;
};

type CsvDatasetColumnRow = {
  name: string;
  sqlite_column_name: string;
  ordinal_index: number;
};

type ToolDetection = {
  kind: AssistantToolKind;
  script: string;
};

const SILICONFLOW_CHAT_COMPLETIONS_URL = "https://api.siliconflow.cn/v1/chat/completions";
const MAX_STORED_MESSAGES_FOR_CONTEXT = 12;
const MAX_STREAM_CHARS = 120_000;
const PYTHON_TIMEOUT_MS = 5_000;
const MAX_TOOL_CONTEXT_CHARS = 30_000;
const WORKFLOW_DATASET_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function isReadonlySql(sql: string) {
  const normalized = sql.trim().replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!normalized) {
    return false;
  }
  if (normalized.split(";").filter((part) => part.trim()).length > 1) {
    return false;
  }
  return /^(select|with|pragma)\b/i.test(normalized) && !/\b(insert|update|delete|drop|alter|create|attach|detach|vacuum|replace|load_extension)\b/i.test(normalized);
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeSqliteAlias(value: string) {
  return value.trim().replace(/^["'`\[]|["'`\]]$/g, "");
}

function normalizeCsvSchemaQualifiedSql(sql: string) {
  return sql.replace(/\b(from|join)\s+csv_imports\.([`"[]?[\w.-]+[`"\]]?)/gi, (_match, keyword: string, tableName: string) => {
    return `${keyword} ${tableName}`;
  });
}

function extractFencedCode(prompt: string, language: AssistantToolKind) {
  const pattern = new RegExp("```" + language + "\\s*([\\s\\S]*?)```", "i");
  const match = prompt.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function detectTool(prompt: string): ToolDetection | null {
  const trimmed = prompt.trim();
  const slashSql = trimmed.match(/^\/sql\s+([\s\S]+)/i)?.[1]?.trim();
  if (slashSql) {
    return { kind: "sql", script: slashSql };
  }
  const fencedSql = extractFencedCode(prompt, "sql");
  if (fencedSql) {
    return { kind: "sql", script: fencedSql };
  }

  const slashPython = trimmed.match(/^\/python\s+([\s\S]+)/i)?.[1]?.trim();
  if (slashPython) {
    return { kind: "python", script: slashPython };
  }
  const fencedPython = extractFencedCode(prompt, "python");
  if (fencedPython) {
    return { kind: "python", script: fencedPython };
  }

  return null;
}

function detectToolFromAssistantOutput(content: string): ToolDetection | null {
  const fencedTool = detectTool(content);
  if (fencedTool) {
    return fencedTool;
  }

  const sqlMatch = content.match(/(?:^|\n)\s*((?:select|with|pragma)\b[\s\S]*?)(?:;|\n\s*\n|$)/i);
  const sql = sqlMatch?.[1]?.trim();
  if (sql && isReadonlySql(sql)) {
    return { kind: "sql", script: sql };
  }

  return null;
}

function replaceToolBlock(blocks: AssistantBlock[], toolBlock: AssistantBlock) {
  return [...blocks.filter((block) => block.toolCallId !== toolBlock.toolCallId), toolBlock];
}

function hasRenderableNonToolContent(message: AssistantMessage) {
  return message.blocks.some((block) => !block.toolCallId && block.content.trim().length > 0);
}

function shouldAnalyzePriorSqlResult(prompt: string) {
  return (
    /(sql\s*查询结果|查询结果数据|查询结果|上一轮|上一次|工具调用结果|结果数据)/i.test(prompt) &&
    /(统计|占比|对比|排名|前三|top\s*3|报告|分析)/i.test(prompt)
  );
}

function shouldAutoStartPythonReport(prompt: string) {
  return /(输出|生成|形成|给出|撰写).{0,12}(分析)?报告|分析报告|报告输出/i.test(prompt) || (/分析/i.test(prompt) && /(占比|比例|分布|统计|对比)/i.test(prompt));
}

function parseSqlToolRows(result: string | undefined) {
  if (!result) {
    return [];
  }
  try {
    const parsed = JSON.parse(result) as { rows?: Array<Record<string, unknown>>; previewRows?: Array<Record<string, unknown>> };
    return Array.isArray(parsed.rows) ? parsed.rows : Array.isArray(parsed.previewRows) ? parsed.previewRows : [];
  } catch {
    return [];
  }
}

function parseSqlToolPreviewRows(result: string | undefined) {
  if (!result) {
    return [];
  }
  try {
    const parsed = JSON.parse(result) as { rows?: Array<Record<string, unknown>>; previewRows?: Array<Record<string, unknown>> };
    return Array.isArray(parsed.rows) ? parsed.rows : Array.isArray(parsed.previewRows) ? parsed.previewRows : [];
  } catch {
    return [];
  }
}

function parseSqlToolRowCount(result: string | undefined) {
  if (!result) {
    return null;
  }
  try {
    const parsed = JSON.parse(result) as { rowCount?: unknown; rows?: Array<Record<string, unknown>>; previewRows?: Array<Record<string, unknown>> };
    if (typeof parsed.rowCount === "number") {
      return parsed.rowCount;
    }
    if (Array.isArray(parsed.rows)) {
      return parsed.rows.length;
    }
    if (Array.isArray(parsed.previewRows)) {
      return parsed.previewRows.length;
    }
    return null;
  } catch {
    return null;
  }
}

function truncateText(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]` : value;
}

function extractSqlTarget(script: string) {
  const match = script.match(/\b(?:from|join|pragma)\s+([`"[\]\w.-]+)/i);
  if (!match?.[1]) {
    return "SQL 查询";
  }
  return match[1].replace(/^[`"\[]|[`"\]]$/g, "");
}

function extractScriptFiles(script: string) {
  const files = new Set<string>();
  const filePattern = /(?:^|[^\w./-])([\w./-]+\.(?:ts|tsx|js|jsx|sql|py|json|csv|md|txt|xlsx?))\b/gi;
  let match: RegExpExecArray | null;
  while ((match = filePattern.exec(script))) {
    files.add(match[1]);
  }
  return Array.from(files);
}

function toolCallDurationMs(toolCall: AssistantToolCall) {
  if (toolCall.status === "pending_approval" || toolCall.status === "running") {
    return undefined;
  }
  const startedAt = Date.parse(toolCall.createdAt);
  const endedAt = Date.parse(toolCall.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return undefined;
  }
  return endedAt - startedAt;
}

function toolTarget(toolCall: AssistantToolCall) {
  const files = extractScriptFiles(toolCall.script);
  if (files.length > 0) {
    return files.join(", ");
  }
  if (toolCall.kind === "sql") {
    return "SQL Script";
  }
  return "Python Script";
}

function isMarkdownLikeContent(content: string) {
  return (
    /(^|\n)\s{0,3}#{1,6}\s+\S/.test(content) ||
    /(^|\n)\s{0,3}(?:[-*+]|\d+\.)\s+\S/.test(content) ||
    /(^|\n)\s{0,3}>\s+\S/.test(content) ||
    /(^|\n)\|.+\|/.test(content) ||
    /[*_`~]{1,3}[^*_`~]+[*_`~]{1,3}/.test(content) ||
    /\b(?:报告|方案|步骤|清单|结论|摘要|分析结果)\b/.test(content)
  );
}

function assistantBlockTypeForContent(content: string): AssistantBlockType {
  if (content.startsWith("{") || content.startsWith("[")) {
    return "json";
  }
  return isMarkdownLikeContent(content) ? "markdown" : "text";
}

function parseAssistantBlocks(content: string): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  const fencePattern = /```([a-z0-9_+#.-]+)?\s*([\s\S]*?)```/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(content))) {
    const before = content.slice(cursor, match.index).trim();
    if (before) {
      blocks.push({ id: randomUUID(), type: assistantBlockTypeForContent(before), content: before });
    }

    const language = (match[1] ?? "markdown").toLowerCase();
    const body = match[2].trim();
    const isMarkdown = language === "markdown" || language === "md";
    blocks.push({
      id: randomUUID(),
      type: language === "json" ? "json" : language === "mermaid" ? "mermaid" : "markdown",
      content: body,
      title: language === "json" ? "JSON" : language === "mermaid" ? "Mermaid" : isMarkdown ? undefined : language.toUpperCase(),
      language,
    });
    cursor = fencePattern.lastIndex;
  }

  const rest = content.slice(cursor).trim();
  if (rest) {
    const type = assistantBlockTypeForContent(rest);
    blocks.push({ id: randomUUID(), type, content: rest, title: type === "json" ? "JSON" : undefined });
  }

  return blocks.length > 0 ? blocks : [{ id: randomUUID(), type: "text", content: "" }];
}

export class AssistantRuntime {
  private db: any;
  private integrityKey: string;
  private abortControllers = new Map<string, AbortController>();
  private readonly options: AssistantRuntimeOptions;
  private readonly workflowStore: WorkflowStateStore;
  private readonly datasetStateManager: SQLiteDatasetStateManager;
  private readonly tempTableRegistry = new TempTableRegistry();
  private readonly sqliteMaterializer: SQLiteMaterializer;
  private readonly workflowContextBuilder: WorkflowContextBuilder;
  private readonly workflowMemoryBridge: SQLiteWorkflowMemoryBridge;

  constructor(options: AssistantRuntimeOptions) {
    this.options = options;
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new Database(options.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.workflowStore = new AuditedWorkflowStateStore(new SQLiteWorkflowStateStore(this.db), new SQLiteWorkflowAuditLogger(this.db));
    this.datasetStateManager = new SQLiteDatasetStateManager(this.db, this.workflowStore);
    this.sqliteMaterializer = new SQLiteMaterializer(this.db, {
      sqliteDatabasePath: options.dbPath,
      batchSize: 500,
      maxDatabaseSizeBytes: 1024 * 1024 * 1024,
      onProgress: (progress) => {
        this.db
          .prepare(
            `insert into tool_call_logs
              (id, tool_call_id, conversation_id, user_id, kind, phase, status, message, detail_json, created_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(randomUUID(), null, progress.conversationId, null, "sql", "workflow-materialization-progress", "info", "SQL 结果物化进度更新。", JSON.stringify(progress), nowIso());
      },
    });
    this.workflowContextBuilder = new WorkflowContextBuilder(this.workflowStore, this.datasetStateManager);
    this.workflowMemoryBridge = new SQLiteWorkflowMemoryBridge(this.db);
    this.integrityKey = this.readIntegrityKey();
  }

  listConversations(userId: string): AssistantConversation[] {
    const conversations = this.db
      .prepare("select id, user_id as userId, title, created_at as createdAt, updated_at as updatedAt from conversations where user_id = ? order by updated_at desc")
      .all(userId);
    conversations.forEach((conversation: AssistantConversation) => this.verifyConversationIntegrity(conversation));
    return conversations;
  }

  getConversationMessages(userId: string, conversationId: string): AssistantMessage[] {
    return this.db
      .prepare("select * from messages where user_id = ? and conversation_id = ? order by created_at asc")
      .all(userId, conversationId)
      .map((row: Record<string, unknown>) => this.messageFromRow(row))
      .map((message: AssistantMessage) => this.verifyMessageIntegrity(message));
  }

  createConversation(userId: string, title = "新对话"): AssistantConversation {
    const createdAt = nowIso();
    const conversation: AssistantConversation = {
      id: randomUUID(),
      userId,
      title,
      createdAt,
      updatedAt: createdAt,
    };
    this.db
      .prepare("insert into conversations (id, user_id, title, created_at, updated_at, integrity_hash) values (?, ?, ?, ?, ?, ?)")
      .run(conversation.id, userId, title, createdAt, createdAt, this.hashRecord("conversation", conversation));
    return conversation;
  }

  renameConversation(userId: string, conversationId: string, title: string): AssistantConversation {
    const normalizedTitle = title.trim().slice(0, 200);
    if (!normalizedTitle) {
      throw new Error("记录名称不能为空。");
    }
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话记录不存在。");
    }
    const next: AssistantConversation = {
      ...conversation,
      title: normalizedTitle,
      updatedAt: nowIso(),
    };
    this.persistConversation(next);
    return next;
  }

  deleteConversation(userId: string, conversationId: string): { success: true; conversationId: string } {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话记录不存在。");
    }
    this.db.prepare("delete from conversations where id = ? and user_id = ?").run(conversationId, userId);
    return { success: true, conversationId };
  }

  async sendMessage(input: AssistantSendInput): Promise<AssistantSendResult> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error("消息内容不能为空。");
    }
    if (!input.modelName.trim()) {
      throw new Error("请先在用户设置中配置模型名称。");
    }

    const replay = this.db.prepare("select id from messages where client_request_id = ?").get(input.clientRequestId);
    if (replay) {
      throw new Error("检测到重复消息请求，已阻止重放。");
    }

    const conversation = input.conversationId
      ? this.findConversation(input.userId, input.conversationId) ?? this.createConversation(input.userId)
      : this.createConversation(input.userId, prompt.slice(0, 18) || "新对话");

    if (conversation.title === "新对话") {
      conversation.title = prompt.slice(0, 18) || "新对话";
      conversation.updatedAt = nowIso();
      this.persistConversation(conversation);
    }

    const userMessage = this.insertMessage({
      conversationId: conversation.id,
      userId: input.userId,
      role: "user",
      status: "sent",
      content: prompt,
      blocks: [{ id: randomUUID(), type: "text", content: prompt }],
      clientRequestId: input.clientRequestId,
      context: {
        dataSourceLabel: input.dataSourceLabel ?? null,
        skill: input.skill ?? null,
      },
    });
    const assistantMessage = this.insertMessage({
      conversationId: conversation.id,
      userId: input.userId,
      role: "assistant",
      status: "receiving",
      content: "",
      blocks: [{ id: randomUUID(), type: "text", content: "" }],
    });

    this.options.emit({ type: "conversation", conversation });
    this.options.emit({ type: "message", conversationId: conversation.id, message: userMessage });
    this.options.emit({ type: "message", conversationId: conversation.id, message: assistantMessage });

    const tool = detectTool(prompt);
    if (tool) {
      void this.handleToolCall(input, conversation, assistantMessage, tool);
    } else if (await this.routePriorSqlAnalysis(input, conversation, assistantMessage)) {
      // Routed to a governed Python tool call.
    } else {
      void this.streamModelResponse(input, conversation, assistantMessage);
    }

    return { success: true, conversation, userMessage, assistantMessage };
  }

  async approveTool(userId: string, toolCallId: string, approved: boolean) {
    const row = this.db.prepare("select * from tool_calls where id = ? and user_id = ?").get(toolCallId, userId);
    if (!row) {
      throw new Error("工具调用不存在。");
    }
    const toolCall = this.toolCallFromRow(row);
    if (toolCall.status !== "pending_approval") {
      throw new Error("工具调用状态已变更，无法重复审批。");
    }

    if (!approved) {
      const next = this.updateToolCall(toolCall.id, "declined", undefined, "用户已拒绝执行该工具调用。");
      const message = this.updateMessage(toolCall.messageId, {
        status: "stopped",
        content: "用户已拒绝执行该工具调用。",
        blocks: [this.toolBlock(next, "用户已拒绝执行该工具调用。")],
        errorMessage: "用户拒绝",
      });
      this.options.emit({ type: "tool", conversationId: toolCall.conversationId, toolCall: next, message });
      return { success: true as const, toolCall: next, message };
    }

    return this.executeToolCall(toolCall);
  }

  async getWorkflowContext(userId: string, conversationId: string) {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }
    await this.cleanupExpiredWorkflowDatasets(conversationId);
    return this.workflowContextBuilder.build(conversationId);
  }

  async confirmWorkflowDataset(userId: string, conversationId: string, datasetId?: string) {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }
    const dataset = datasetId ? await this.datasetStateManager.getDataset(datasetId) : await this.datasetStateManager.getActiveDataset(conversationId);
    if (!dataset) {
      throw new Error("当前没有可确认的数据集。");
    }
    const confirmed = await this.datasetStateManager.confirmDataset(dataset.datasetId);
    await this.workflowMemoryBridge.writeWorkflowMemory({
      conversationId,
      userId,
      type: "dataset_confirmed",
      summary: `数据集 ${confirmed.name} 已确认，可用于 Python 分析和报告生成。`,
      payload: {
        datasetId: confirmed.datasetId,
        rowCount: confirmed.rowCount,
        columnCount: confirmed.columnCount,
        sqliteTableName: confirmed.sqliteTableName,
      },
    });
    const workflow = await this.workflowStore.get(confirmed.workflowId);
    if (workflow) {
      await this.workflowStore.update(workflow.workflowId, {
        status: "waiting_python_approval",
        activeDatasetId: confirmed.datasetId,
        confirmedDatasetId: confirmed.datasetId,
        steps: [
          ...workflow.steps,
          {
            stepId: randomUUID(),
            type: "user_confirmation",
            status: "success",
            input: { datasetId: confirmed.datasetId },
            output: { canAnalyze: true, canUseForReport: true },
            completedAt: nowIso(),
          },
        ],
      });
      await this.workflowStore.appendEvent(workflow.workflowId, {
        eventId: randomUUID(),
        workflowId: workflow.workflowId,
        conversationId,
        type: "dataset_confirmed",
        message: "用户已确认工作流数据集。",
        payload: { datasetId: confirmed.datasetId },
        createdAt: nowIso(),
      });
    }
    const context = await this.workflowContextBuilder.build(conversationId);
    this.options.emit({ type: "workflow", conversationId, context });
    return { success: true as const, dataset: confirmed, context };
  }

  async rejectWorkflowDataset(userId: string, conversationId: string, datasetId: string, reason?: string) {
    const conversation = this.findConversation(userId, conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }
    const workflow = await this.workflowStore.getActiveByConversation(conversationId);
    if (!workflow) {
      throw new Error("当前没有可拒绝的数据集。");
    }
    const rejected = await this.datasetStateManager.rejectDataset(datasetId, reason);
    await this.workflowMemoryBridge.writeWorkflowMemory({
      conversationId,
      userId,
      type: "dataset_rejected",
      summary: `数据集 ${rejected.name} 已被拒绝，后续分析不会使用该数据集。`,
      payload: {
        datasetId: rejected.datasetId,
        reason,
      },
    });
    await this.workflowStore.update(workflow.workflowId, {
      status: "waiting_user_confirmation",
      activeDatasetId: workflow.activeDatasetId === rejected.datasetId ? undefined : workflow.activeDatasetId,
      latestSqlDatasetId: workflow.latestSqlDatasetId === rejected.datasetId ? undefined : workflow.latestSqlDatasetId,
      confirmedDatasetId: workflow.confirmedDatasetId === rejected.datasetId ? undefined : workflow.confirmedDatasetId,
      steps: [
        ...workflow.steps,
        {
          stepId: randomUUID(),
          type: "user_confirmation",
          status: "failed",
          input: { datasetId: rejected.datasetId, reason },
          completedAt: nowIso(),
        },
      ],
    });
    await this.workflowStore.appendEvent(workflow.workflowId, {
      eventId: randomUUID(),
      workflowId: workflow.workflowId,
      conversationId,
      type: "dataset_rejected",
      message: "用户已拒绝工作流数据集。",
      payload: { datasetId: rejected.datasetId, reason },
      createdAt: nowIso(),
    });
    const context = await this.workflowContextBuilder.build(conversationId);
    this.options.emit({ type: "workflow", conversationId, context });
    return { success: true as const, dataset: rejected, context };
  }

  cancelMessage(messageId: string) {
    const controller = this.abortControllers.get(messageId);
    controller?.abort();
    this.abortControllers.delete(messageId);
  }

  async retryAssistantMessage(input: AssistantRetryInput): Promise<AssistantRetryResult> {
    const modelName = input.modelName.trim();
    if (!modelName) {
      throw new Error("请先在用户设置中配置模型名称。");
    }

    const sourceMessageRow = this.db.prepare("select * from messages where id = ? and user_id = ?").get(input.messageId, input.userId);
    if (!sourceMessageRow) {
      throw new Error("待重试消息不存在。");
    }
    const sourceMessage = this.messageFromRow(sourceMessageRow);
    if (sourceMessage.role !== "assistant") {
      throw new Error("仅支持重试助手消息。");
    }
    if (sourceMessage.status !== "error") {
      throw new Error("当前消息状态不支持重试。");
    }

    const conversation = this.findConversation(input.userId, sourceMessage.conversationId);
    if (!conversation) {
      throw new Error("对话不存在或已失效。");
    }

    const sourceUserRow = this.db
      .prepare(
        `select *
         from messages
         where conversation_id = ?
           and user_id = ?
           and role = 'user'
           and created_at <= ?
         order by created_at desc
         limit 1`,
      )
      .get(sourceMessage.conversationId, input.userId, sourceMessage.createdAt);
    if (!sourceUserRow) {
      throw new Error("未找到可重试的用户问题。");
    }

    const sourceUserMessage = this.messageFromRow(sourceUserRow);
    const assistantMessage = this.insertMessage({
      conversationId: conversation.id,
      userId: input.userId,
      role: "assistant",
      status: "receiving",
      content: "",
      blocks: [{ id: randomUUID(), type: "text", content: "" }],
      clientRequestId: input.clientRequestId,
    });

    const nextConversation = this.findConversation(input.userId, conversation.id) ?? conversation;
    this.options.emit({ type: "conversation", conversation: nextConversation });
    this.options.emit({ type: "message", conversationId: conversation.id, message: assistantMessage });

    const retryInput = {
      userId: input.userId,
      conversationId: conversation.id,
      clientRequestId: input.clientRequestId,
      prompt: sourceUserMessage.content,
      modelName,
      dataSourceLabel: input.dataSourceLabel,
      schemaContextMarkdown: input.schemaContextMarkdown,
      skill: input.skill,
      approvalMode: input.approvalMode,
    };

    if (!(await this.routePriorSqlAnalysis(retryInput, nextConversation, assistantMessage))) {
      void this.streamModelResponse(retryInput, nextConversation, assistantMessage);
    }

    return { success: true, conversation: nextConversation, assistantMessage };
  }

  private migrate() {
    this.db.exec(`
      create table if not exists metadata (
        key text primary key,
        value text not null
      );
      create table if not exists conversations (
        id text primary key,
        user_id text not null,
        title text not null,
        created_at text not null,
        updated_at text not null,
        archived_at text,
        integrity_hash text not null
      );
      create table if not exists messages (
        id text primary key,
        conversation_id text not null references conversations(id) on delete cascade,
        user_id text not null,
        role text not null,
        status text not null,
        content text not null,
        blocks_json text not null,
        created_at text not null,
        updated_at text not null,
        error_message text,
        integrity_hash text not null,
        previous_hash text,
        client_request_id text unique,
        provider_trace_id text,
        context_json text
      );
      create table if not exists tool_calls (
        id text primary key,
        conversation_id text not null,
        message_id text not null references messages(id) on delete cascade,
        user_id text not null,
        kind text not null,
        status text not null,
        script text not null,
        result_json text,
        error_message text,
        approval_mode text not null,
        created_at text not null,
        updated_at text not null,
        integrity_hash text not null
      );
      create table if not exists tool_call_logs (
        id text primary key,
        tool_call_id text,
        conversation_id text,
        user_id text,
        kind text not null,
        phase text not null,
        status text not null,
        message text not null,
        detail_json text,
        created_at text not null
      );
      create index if not exists idx_conversations_user_updated on conversations(user_id, updated_at desc);
      create index if not exists idx_messages_conversation_created on messages(conversation_id, created_at);
      create index if not exists idx_tool_call_logs_tool_created on tool_call_logs(tool_call_id, created_at);
    `);
    try {
      this.db.prepare("alter table messages add column context_json text").run();
    } catch {
      // Column already exists in migrated local databases.
    }
  }

  private readIntegrityKey() {
    const row = this.db.prepare("select value from metadata where key = 'integrity_key'").get();
    if (row?.value) {
      return row.value as string;
    }
    const key = randomBytes(32).toString("base64url");
    this.db.prepare("insert into metadata (key, value) values ('integrity_key', ?)").run(key);
    return key;
  }

  private hashRecord(scope: string, value: unknown, previousHash = "") {
    return createHmac("sha256", this.integrityKey).update(scope).update("\n").update(stableJson(value)).update("\n").update(previousHash).digest("hex");
  }

  private findConversation(userId: string, conversationId: string): AssistantConversation | null {
    const row = this.db
      .prepare("select id, user_id as userId, title, created_at as createdAt, updated_at as updatedAt from conversations where id = ? and user_id = ?")
      .get(conversationId, userId);
    if (!row) {
      return null;
    }
    return this.verifyConversationIntegrity(row as AssistantConversation);
  }

  private insertMessage(input: {
    conversationId: string;
    userId: string;
    role: AssistantMessageRole;
    status: AssistantMessageStatus;
    content: string;
    blocks: AssistantBlock[];
    clientRequestId?: string;
    errorMessage?: string;
    context?: AssistantMessageContext;
  }): AssistantMessage {
    const createdAt = nowIso();
    const previous = this.db
      .prepare("select integrity_hash from messages where conversation_id = ? order by created_at desc limit 1")
      .get(input.conversationId);
    const draft = {
      id: randomUUID(),
      conversationId: input.conversationId,
      userId: input.userId,
      role: input.role,
      status: input.status,
      content: input.content,
      blocks: input.blocks,
      createdAt,
      updatedAt: createdAt,
      errorMessage: input.errorMessage,
      previousHash: previous?.integrity_hash,
      clientRequestId: input.clientRequestId,
      context: input.context,
    };
    const integrityHash = this.hashRecord("message", draft, draft.previousHash);
    const message: AssistantMessage = { ...draft, integrityHash };
    this.db
      .prepare(
        `insert into messages
          (id, conversation_id, user_id, role, status, content, blocks_json, created_at, updated_at, error_message, integrity_hash, previous_hash, client_request_id, context_json)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.conversationId,
        message.userId,
        message.role,
        message.status,
        message.content,
        JSON.stringify(message.blocks),
        message.createdAt,
        message.updatedAt,
        message.errorMessage ?? null,
        message.integrityHash,
        message.previousHash ?? null,
        message.clientRequestId ?? null,
        message.context ? JSON.stringify(message.context) : null,
      );
    this.touchConversation(message.conversationId);
    return message;
  }

  private updateMessage(messageId: string, patch: Partial<Pick<AssistantMessage, "status" | "content" | "blocks" | "errorMessage" | "providerTraceId">>) {
    const current = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(messageId));
    const updatedAt = nowIso();
    const next: AssistantMessage = {
      ...current,
      ...patch,
      blocks: patch.blocks ?? current.blocks,
      updatedAt,
    };
    next.integrityHash = this.hashRecord("message", { ...next, integrityHash: undefined }, next.previousHash);
    this.db
      .prepare("update messages set status = ?, content = ?, blocks_json = ?, updated_at = ?, error_message = ?, provider_trace_id = ?, integrity_hash = ? where id = ?")
      .run(next.status, next.content, JSON.stringify(next.blocks), next.updatedAt, next.errorMessage ?? null, next.providerTraceId ?? null, next.integrityHash, messageId);
    this.touchConversation(next.conversationId);
    return next;
  }

  private touchConversation(conversationId: string) {
    const current = this.db
      .prepare("select id, user_id as userId, title, created_at as createdAt, updated_at as updatedAt from conversations where id = ?")
      .get(conversationId) as AssistantConversation | undefined;
    if (!current) {
      return;
    }
    current.updatedAt = nowIso();
    this.persistConversation(current);
  }

  private persistConversation(conversation: AssistantConversation) {
    const integrityHash = this.hashRecord("conversation", conversation);
    this.db
      .prepare("update conversations set title = ?, updated_at = ?, integrity_hash = ? where id = ?")
      .run(conversation.title, conversation.updatedAt, integrityHash, conversation.id);
  }

  private messageFromRow(row: Record<string, unknown>): AssistantMessage {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      userId: row.user_id as string,
      role: row.role as AssistantMessageRole,
      status: row.status as AssistantMessageStatus,
      content: row.content as string,
      blocks: JSON.parse(row.blocks_json as string) as AssistantBlock[],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      errorMessage: (row.error_message as string | null) ?? undefined,
      integrityHash: row.integrity_hash as string,
      previousHash: (row.previous_hash as string | null) ?? undefined,
      clientRequestId: (row.client_request_id as string | null) ?? undefined,
      providerTraceId: (row.provider_trace_id as string | null) ?? undefined,
      context: row.context_json ? (JSON.parse(row.context_json as string) as AssistantMessageContext) : undefined,
    };
  }

  private verifyConversationIntegrity(conversation: AssistantConversation) {
    const stored = this.db.prepare("select integrity_hash from conversations where id = ?").get(conversation.id) as { integrity_hash?: string } | undefined;
    const expected = this.hashRecord("conversation", conversation);
    if (!stored?.integrity_hash || stored.integrity_hash !== expected) {
      throw new Error(`本地会话完整性校验失败：${conversation.id}`);
    }
    return conversation;
  }

  private verifyMessageIntegrity(message: AssistantMessage) {
    const expected = this.hashRecord(
      "message",
      {
        ...message,
        integrityHash: undefined,
      },
      message.previousHash,
    );
    if (message.integrityHash !== expected) {
      throw new Error(`本地消息完整性校验失败：${message.id}`);
    }
    return message;
  }

  private toolCallFromRow(row: Record<string, unknown>): AssistantToolCall {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      messageId: row.message_id as string,
      userId: row.user_id as string,
      kind: row.kind as AssistantToolKind,
      status: row.status as AssistantToolStatus,
      script: row.script as string,
      result: (row.result_json as string | null) ?? undefined,
      errorMessage: (row.error_message as string | null) ?? undefined,
      approvalMode: row.approval_mode as AssistantApprovalMode,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private latestCompletedToolCall(userId: string, conversationId: string, kind?: AssistantToolKind) {
    const row = this.db
      .prepare(
        `select *
         from tool_calls
         where conversation_id = ?
           and user_id = ?
           and status = 'completed'
           ${kind ? "and kind = ?" : ""}
         order by updated_at desc
         limit 1`,
      )
      .get(...(kind ? [conversationId, userId, kind] : [conversationId, userId]));
    return row ? this.toolCallFromRow(row) : null;
  }

  private recentCompletedToolCalls(userId: string, conversationId: string, limit = 3) {
    return (this.db
      .prepare(
        `select *
         from tool_calls
         where conversation_id = ?
           and user_id = ?
           and status = 'completed'
         order by updated_at desc
         limit ?`,
      )
      .all(conversationId, userId, limit) as Array<Record<string, unknown>>).map((row) => this.toolCallFromRow(row));
  }

  private async latestSqlRowsForConversation(userId: string, conversationId: string) {
    const latestSqlToolCall = this.latestCompletedToolCall(userId, conversationId, "sql");
    const latestSqlDataset = await this.datasetStateManager.getLatestSqlDataset(conversationId);
    return {
      latestSqlToolCall,
      rows: this.rowsForSqlAnalysis(latestSqlToolCall ?? undefined, latestSqlDataset ?? undefined),
    };
  }

  private shouldReplacePythonScript(script: string) {
    return /\bwf_[a-z0-9_]+\b/i.test(script) || /\bsqlite3\.connect\s*\(/i.test(script) || /\bimport\s+(pandas|numpy)\b|\bfrom\s+(pandas|numpy)\b/i.test(script);
  }

  private async normalizePythonToolScript(input: { userId: string; conversationId: string; prompt?: string; script: string }) {
    if (!this.shouldReplacePythonScript(input.script)) {
      return input.script;
    }
    const { latestSqlToolCall, rows } = await this.latestSqlRowsForConversation(input.userId, input.conversationId);
    if (!latestSqlToolCall || rows.length === 0) {
      return input.script;
    }
    return this.buildPythonAnalysisScript(input.prompt || this.sourcePromptForToolCall(latestSqlToolCall) || "基于上一轮 SQL 结果输出分析报告。", latestSqlToolCall, rows);
  }

  private recentToolContext(userId: string, conversationId: string) {
    const toolCalls = this.recentCompletedToolCalls(userId, conversationId);
    if (toolCalls.length === 0) {
      return null;
    }

    return truncateText(
      [
        "最近已完成工具调用摘要（供后续自然语言分析复用，除非用户明确要求重新查询，否则不要重复发起 SQL；完整数据请通过工作流数据集或 Python 工具读取）：",
        ...toolCalls.map((toolCall, index) => {
          const rows = toolCall.kind === "sql" ? parseSqlToolPreviewRows(toolCall.result) : [];
          const rowCount = toolCall.kind === "sql" ? parseSqlToolRowCount(toolCall.result) : null;
          const columns = rows[0] ? Object.keys(rows[0]) : [];
          return [
            `## Tool Result ${index + 1}`,
            `kind: ${toolCall.kind}`,
            `updatedAt: ${toolCall.updatedAt}`,
            `rowCount: ${toolCall.kind === "sql" ? rowCount ?? "--" : "--"}`,
            `columns: ${columns.length > 0 ? columns.join(", ") : "--"}`,
            "script:",
            "```",
            toolCall.script,
            "```",
          ].join("\n");
        }),
      ].join("\n\n"),
      MAX_TOOL_CONTEXT_CHARS,
    );
  }

  private async routePriorSqlAnalysis(input: AssistantSendInput, conversation: AssistantConversation, assistantMessage: AssistantMessage) {
    if (!shouldAnalyzePriorSqlResult(input.prompt)) {
      return false;
    }

    const latestSqlToolCall = this.latestCompletedToolCall(input.userId, conversation.id, "sql");
    const latestSqlDataset = await this.datasetStateManager.getLatestSqlDataset(conversation.id);
    const rows = this.rowsForSqlAnalysis(latestSqlToolCall ?? undefined, latestSqlDataset ?? undefined);
    if (!latestSqlToolCall || rows.length === 0) {
      return false;
    }

    this.appendToolLog(
      {
        conversationId: conversation.id,
        userId: input.userId,
        kind: "python",
      },
      "workflow-routing",
      "info",
      "用户要求基于上一轮 SQL 查询结果继续分析，已路由到 Python 工具调用，避免重复生成 SQL。",
      {
        latestSqlToolCallId: latestSqlToolCall.id,
        latestSqlDatasetId: latestSqlDataset?.datasetId,
        prompt: input.prompt,
      },
    );

    void this.handleToolCall(input, conversation, assistantMessage, {
      kind: "python",
      script: this.buildPythonAnalysisScript(input.prompt, latestSqlToolCall, rows),
    });
    return true;
  }

  private rowsForSqlAnalysis(sqlToolCall?: AssistantToolCall, dataset?: WorkflowDatasetRef) {
    if (dataset?.sqliteTableName) {
      try {
        const tableName = quoteIdentifier(dataset.sqliteTableName);
        return this.db.prepare(`select * from ${tableName}`).all() as Array<Record<string, unknown>>;
      } catch {
        // Fall back to the tool-call preview rows below. Missing materialized tables should not block approval routing.
      }
    }
    return parseSqlToolRows(sqlToolCall?.result);
  }

  private buildPythonAnalysisScript(prompt: string, sqlToolCall: AssistantToolCall, rowsOverride?: Array<Record<string, unknown>>) {
    const rows = rowsOverride?.length ? rowsOverride : parseSqlToolRows(sqlToolCall.result);
    const rowsJson = JSON.stringify(rows);
    const promptJson = JSON.stringify(prompt);
    return [
      "import json",
      "from collections import Counter, defaultdict",
      "",
      `rows = json.loads(${JSON.stringify(rowsJson)})`,
      `question = ${promptJson}`,
      "",
      "def pct(value, total):",
      "    return round(value * 100.0 / total, 2) if total else 0.0",
      "",
      "total_rows = len(rows)",
      "term_field = 'loan_term_type'",
      "branch_field = 'branch_name'",
      "preferred_terms = ['短期', '中期', '长期']",
      "lines = []",
      "lines.append('# SQL查询结果统计分析报告')",
      "lines.append('')",
      "lines.append(f'- 分析对象：上一轮 SQL 工具调用返回结果')",
      "lines.append(f'- 样本行数：{total_rows}')",
      "lines.append(f'- 说明：以下结论仅基于已返回的 SQL 工具结果数据，不重新查询数据源。')",
      "lines.append('')",
      "",
      "if not rows:",
      "    lines.append('## 结论')",
      "    lines.append('上一轮 SQL 工具调用未返回可分析行数据。')",
      "elif {'stat_type', 'dimension', 'record_count'}.issubset(set(rows[0].keys())):",
      "    def number(row, key):",
      "        try:",
      "            return float(row.get(key) or 0)",
      "        except (TypeError, ValueError):",
      "            return 0.0",
      "    branch_rows = [row for row in rows if row.get('stat_type') in ('branch', '分行占比')]",
      "    term_business_rows = [row for row in rows if row.get('stat_type') in ('term_business', '组合分布')]",
      "    total_rows_data = [row for row in rows if row.get('stat_type') in ('total', '总计')]",
      "    total_count = int(number(total_rows_data[0], 'record_count')) if total_rows_data else int(sum(number(row, 'record_count') for row in branch_rows))",
      "    lines.append('## 总体概况')",
      "    lines.append(f'- 本次 SQL 查询结果共返回 {len(rows)} 条统计记录。')",
      "    if total_count:",
      "        lines.append(f'- 不良数据总计：{total_count}。')",
      "    lines.append('')",
      "    if branch_rows:",
      "        lines.append('## 分行占比')",
      "        lines.append('| 排名 | 分行 | 记录数 | 占比 |')",
      "        lines.append('|---:|---|---:|---:|')",
      "        for rank, row in enumerate(sorted(branch_rows, key=lambda item: number(item, 'record_count'), reverse=True), start=1):",
      "            count = int(number(row, 'record_count'))",
      "            percentage = number(row, 'percentage') or pct(count, total_count)",
      "            lines.append(f\"| {rank} | {row.get('dimension') or '--'} | {count} | {percentage}% |\")",
      "        top_branch = max(branch_rows, key=lambda item: number(item, 'record_count'))",
      "        lines.append('')",
      "        lines.append(f\"- 分行维度最高的是 {top_branch.get('dimension') or '--'}，记录数 {int(number(top_branch, 'record_count'))}，占比 {number(top_branch, 'percentage') or pct(number(top_branch, 'record_count'), total_count)}%。\")",
      "    if term_business_rows:",
      "        lines.append('')",
      "        lines.append('## 贷款类型与业务分类组合分布')",
      "        lines.append('| 排名 | 贷款类型 + 业务分类 | 记录数 | 占比 |')",
      "        lines.append('|---:|---|---:|---:|')",
      "        for rank, row in enumerate(sorted(term_business_rows, key=lambda item: number(item, 'record_count'), reverse=True), start=1):",
      "            count = int(number(row, 'record_count'))",
      "            percentage = number(row, 'percentage') or pct(count, total_count)",
      "            lines.append(f\"| {rank} | {row.get('dimension') or '--'} | {count} | {percentage}% |\")",
      "        top_combo = max(term_business_rows, key=lambda item: number(item, 'record_count'))",
      "        lines.append('')",
      "        lines.append(f\"- 组合分布最高的是 {top_combo.get('dimension') or '--'}，记录数 {int(number(top_combo, 'record_count'))}，占比 {number(top_combo, 'percentage') or pct(number(top_combo, 'record_count'), total_count)}%。\")",
      "    lines.append('')",
      "    lines.append('## 分析结论')",
      "    if branch_rows and term_business_rows:",
      "        lines.append('- 不良样本呈现出可识别的分行集中度和产品期限/业务分类结构差异，建议优先对占比最高的分行及组合维度做穿透复核。')",
      "    elif branch_rows:",
      "        lines.append('- 当前结果可支撑分行集中度判断，但缺少贷款类型与业务分类组合维度。')",
      "    else:",
      "        lines.append('- 当前结果可支撑组合分布判断，但缺少分行维度占比。')",
      "elif term_field in rows[0] and branch_field in rows[0] and 'cnt' in rows[0]:",
      "    normalized = []",
      "    for row in rows:",
      "        try:",
      "            count = int(float(row.get('cnt') or 0))",
      "        except (TypeError, ValueError):",
      "            count = 0",
      "        normalized.append({",
      "            'term': row.get(term_field) or '--',",
      "            'branch': row.get(branch_field) or '--',",
      "            'count': count,",
      "            'term_total': int(float(row.get('term_cnt') or 0)) if str(row.get('term_cnt') or '').replace('.', '', 1).isdigit() else 0,",
      "            'total': int(float(row.get('total_cnt') or 0)) if str(row.get('total_cnt') or '').replace('.', '', 1).isdigit() else 0,",
      "        })",
      "    term_counts = Counter()",
      "    branch_by_term = defaultdict(Counter)",
      "    for item in normalized:",
      "        term_counts[item['term']] += item['count']",
      "        branch_by_term[item['term']][item['branch']] += item['count']",
      "    total_rows = max([item['total'] for item in normalized] + [sum(term_counts.values())])",
      "    lines.append('## 期限类型总量')",
      "    lines.append('| 期限类型 | 总计个数 | 占样本比例 |')",
      "    lines.append('|---|---:|---:|')",
      "    for term in preferred_terms:",
      "        count = term_counts.get(term, 0)",
      "        lines.append(f'| {term} | {count} | {pct(count, total_rows)}% |')",
      "    lines.append('')",
      "    lines.append('## 各分行占比')",
      "    lines.append('| 期限类型 | 分行 | 个数 | 类型内占比 | 总样本占比 |')",
      "    lines.append('|---|---|---:|---:|---:|')",
      "    for term in preferred_terms:",
      "        term_total = term_counts.get(term, 0)",
      "        for branch, count in branch_by_term.get(term, Counter()).most_common():",
      "            lines.append(f'| {term} | {branch} | {count} | {pct(count, term_total)}% | {pct(count, total_rows)}% |')",
      "    lines.append('')",
      "    lines.append('## 中期与长期占比最高前三分行')",
      "    lines.append('| 期限类型 | 排名 | 分行 | 个数 | 类型内占比 | 总样本占比 |')",
      "    lines.append('|---|---:|---|---:|---:|---:|')",
      "    for term in ['中期', '长期']:",
      "        term_total = term_counts.get(term, 0)",
      "        for rank, (branch, count) in enumerate(branch_by_term.get(term, Counter()).most_common(3), start=1):",
      "            lines.append(f'| {term} | {rank} | {branch} | {count} | {pct(count, term_total)}% | {pct(count, total_rows)}% |')",
      "    lines.append('')",
      "    lines.append('## 分析结论')",
      "    mid_top = branch_by_term.get('中期', Counter()).most_common(1)",
      "    long_top = branch_by_term.get('长期', Counter()).most_common(1)",
      "    if mid_top:",
      "        branch, count = mid_top[0]",
      "        lines.append(f'- 中期占比最高分行为 {branch}，数量 {count}，类型内占比 {pct(count, term_counts.get(\"中期\", 0))}%。')",
      "    if long_top:",
      "        branch, count = long_top[0]",
      "        lines.append(f'- 长期占比最高分行为 {branch}，数量 {count}，类型内占比 {pct(count, term_counts.get(\"长期\", 0))}%。')",
      "    if mid_top and long_top and mid_top[0][0] == long_top[0][0]:",
      "        lines.append(f'- {mid_top[0][0]}同时位于中期和长期最高分行，建议重点复核该分行风险合同期限结构。')",
      "    else:",
      "        lines.append('- 中期与长期头部分行不同，建议分别拆解分行客户结构、授信品类与期限配置差异。')",
      "elif term_field in rows[0] and branch_field in rows[0]:",
      "    term_counts = Counter((row.get(term_field) or '--') for row in rows)",
      "    lines.append('## 期限类型总量')",
      "    lines.append('| 期限类型 | 总计个数 | 占样本比例 |')",
      "    lines.append('|---|---:|---:|')",
      "    for term in preferred_terms:",
      "        count = term_counts.get(term, 0)",
      "        lines.append(f'| {term} | {count} | {pct(count, total_rows)}% |')",
      "    other_count = sum(count for term, count in term_counts.items() if term not in preferred_terms)",
      "    if other_count:",
      "        lines.append(f'| 其他 | {other_count} | {pct(other_count, total_rows)}% |')",
      "    lines.append('')",
      "    branch_by_term = defaultdict(Counter)",
      "    for row in rows:",
      "        term = row.get(term_field) or '--'",
      "        branch = row.get(branch_field) or '--'",
      "        branch_by_term[term][branch] += 1",
      "    lines.append('## 各分行占比')",
      "    lines.append('| 期限类型 | 分行 | 个数 | 类型内占比 | 总样本占比 |')",
      "    lines.append('|---|---|---:|---:|---:|')",
      "    for term in preferred_terms:",
      "        term_total = term_counts.get(term, 0)",
      "        for branch, count in branch_by_term.get(term, Counter()).most_common():",
      "            lines.append(f'| {term} | {branch} | {count} | {pct(count, term_total)}% | {pct(count, total_rows)}% |')",
      "    lines.append('')",
      "    lines.append('## 中期与长期占比最高前三分行')",
      "    lines.append('| 期限类型 | 排名 | 分行 | 个数 | 类型内占比 | 总样本占比 |')",
      "    lines.append('|---|---:|---|---:|---:|---:|')",
      "    for term in ['中期', '长期']:",
      "        term_total = term_counts.get(term, 0)",
      "        for rank, (branch, count) in enumerate(branch_by_term.get(term, Counter()).most_common(3), start=1):",
      "            lines.append(f'| {term} | {rank} | {branch} | {count} | {pct(count, term_total)}% | {pct(count, total_rows)}% |')",
      "    lines.append('')",
      "    lines.append('## 分析结论')",
      "    mid_top = branch_by_term.get('中期', Counter()).most_common(1)",
      "    long_top = branch_by_term.get('长期', Counter()).most_common(1)",
      "    if mid_top:",
      "        branch, count = mid_top[0]",
      "        lines.append(f'- 中期样本中，{branch}数量最高，为 {count} 笔，占中期样本 {pct(count, term_counts.get(\"中期\", 0))}%。')",
      "    if long_top:",
      "        branch, count = long_top[0]",
      "        lines.append(f'- 长期样本中，{branch}数量最高，为 {count} 笔，占长期样本 {pct(count, term_counts.get(\"长期\", 0))}%。')",
      "    if mid_top and long_top and mid_top[0][0] == long_top[0][0]:",
      "        lines.append(f'- {mid_top[0][0]}同时位于中期和长期最高分行，建议优先复核该分行相关合同风险迁徙原因。')",
      "    else:",
      "        lines.append('- 中期与长期高占比分行存在差异，建议分别从区域行业集中度、客户结构和授信期限配置进行对比复核。')",
      "else:",
      "    lines.append('## 数据概览')",
      "    lines.append('上一轮 SQL 工具结果未同时包含 loan_term_type 与 branch_name 字段，无法按指定维度完成统计。')",
      "    lines.append('')",
      "    lines.append('| 字段 | 非空样本数 | 去重值数量 |')",
      "    lines.append('|---|---:|---:|')",
      "    keys = list(rows[0].keys()) if rows else []",
      "    for key in keys:",
      "        values = [row.get(key) for row in rows if row.get(key) not in (None, '')]",
      "        lines.append(f'| {key} | {len(values)} | {len(set(map(str, values)))} |')",
      "",
      "print('\\n'.join(lines))",
    ].join("\n");
  }

  private insertToolCall(input: {
    conversationId: string;
    messageId: string;
    userId: string;
    kind: AssistantToolKind;
    script: string;
    approvalMode: AssistantApprovalMode;
    status: AssistantToolStatus;
    errorMessage?: string;
  }): AssistantToolCall {
    const createdAt = nowIso();
    const toolCall: AssistantToolCall = {
      id: randomUUID(),
      conversationId: input.conversationId,
      messageId: input.messageId,
      userId: input.userId,
      kind: input.kind,
      status: input.status,
      script: input.script,
      approvalMode: input.approvalMode,
      errorMessage: input.errorMessage,
      createdAt,
      updatedAt: createdAt,
    };
    const integrityHash = this.hashRecord("tool_call", toolCall);
    this.db
      .prepare(
        `insert into tool_calls
          (id, conversation_id, message_id, user_id, kind, status, script, result_json, error_message, approval_mode, created_at, updated_at, integrity_hash)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        toolCall.id,
        toolCall.conversationId,
        toolCall.messageId,
        toolCall.userId,
        toolCall.kind,
        toolCall.status,
        toolCall.script,
        null,
        toolCall.errorMessage ?? null,
        toolCall.approvalMode,
        toolCall.createdAt,
        toolCall.updatedAt,
        integrityHash,
      );
    return toolCall;
  }

  private updateToolCall(toolCallId: string, status: AssistantToolStatus, result?: string, errorMessage?: string): AssistantToolCall {
    const current = this.toolCallFromRow(this.db.prepare("select * from tool_calls where id = ?").get(toolCallId));
    const updatedAt = nowIso();
    const next: AssistantToolCall = { ...current, status, result, errorMessage, updatedAt };
    const integrityHash = this.hashRecord("tool_call", next);
    this.db
      .prepare("update tool_calls set status = ?, result_json = ?, error_message = ?, updated_at = ?, integrity_hash = ? where id = ?")
      .run(next.status, next.result ?? null, next.errorMessage ?? null, next.updatedAt, integrityHash, toolCallId);
    return next;
  }

  private updateToolCallScript(toolCallId: string, script: string): AssistantToolCall {
    const current = this.toolCallFromRow(this.db.prepare("select * from tool_calls where id = ?").get(toolCallId));
    if (current.script === script) {
      return current;
    }
    const updatedAt = nowIso();
    const next: AssistantToolCall = { ...current, script, updatedAt };
    const integrityHash = this.hashRecord("tool_call", next);
    this.db
      .prepare("update tool_calls set script = ?, updated_at = ?, integrity_hash = ? where id = ?")
      .run(next.script, next.updatedAt, integrityHash, toolCallId);
    return next;
  }

  private appendToolLog(
    toolCall: AssistantToolCall | (Pick<AssistantToolCall, "conversationId" | "userId" | "kind"> & { id?: string | null }),
    phase: string,
    status: "info" | "success" | "error",
    message: string,
    detail?: Record<string, unknown>,
  ) {
    const log = {
      id: randomUUID(),
      toolCallId: toolCall.id ?? null,
      conversationId: toolCall.conversationId,
      userId: toolCall.userId,
      kind: toolCall.kind,
      phase,
      status,
      message,
      detail,
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `insert into tool_call_logs
          (id, tool_call_id, conversation_id, user_id, kind, phase, status, message, detail_json, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        log.id,
        log.toolCallId,
        log.conversationId,
        log.userId,
        log.kind,
        log.phase,
        log.status,
        log.message,
        log.detail ? JSON.stringify(log.detail) : null,
        log.createdAt,
      );

    try {
      mkdirSync(dirname(this.options.toolLogPath), { recursive: true });
      appendFileSync(this.options.toolLogPath, `${JSON.stringify(log)}\n`, "utf8");
    } catch {
      // SQLite logs remain available if file logging is temporarily unavailable.
    }
  }

  private prepareCsvSqlViews(toolCall: AssistantToolCall) {
    if (!existsSync(this.options.csvSqlitePath)) {
      this.appendToolLog(toolCall, "sql-csv-views", "info", "CSV SQLite 数据库不存在，跳过 CSV 表视图挂载。", {
        csvSqlitePath: this.options.csvSqlitePath,
      });
      return [];
    }

    const alias = "csvdata";
    const databases = this.db.prepare("pragma database_list").all() as Array<{ name: string; file: string }>;
    const attached = databases.some((database) => database.name === alias);
    if (!attached) {
      this.db.prepare(`attach database ? as ${quoteIdentifier(alias)}`).run(this.options.csvSqlitePath);
    }
    const datasets = this.db
      .prepare(
        `select data_source_id, table_id, sqlite_table_name, display_name
         from ${quoteIdentifier(alias)}.csv_dataset_tables
         order by updated_at desc`,
      )
      .all() as CsvDatasetTableRow[];
    const preparedViews: string[] = [];

    for (const dataset of datasets) {
      const columns = this.db
        .prepare(
          `select name, sqlite_column_name, ordinal_index
           from ${quoteIdentifier(alias)}.csv_dataset_columns
           where data_source_id = ?
           order by ordinal_index`,
        )
        .all(dataset.data_source_id) as CsvDatasetColumnRow[];
      const selectList =
        columns.length > 0
          ? columns
            .map((column) => `${quoteIdentifier(column.sqlite_column_name)} as ${quoteIdentifier(column.name)}`)
            .join(", ")
          : "*";
      const viewNames = Array.from(
        new Set(
          [dataset.display_name, dataset.table_id, dataset.sqlite_table_name]
            .map(normalizeSqliteAlias)
            .filter((name) => name.length > 0),
        ),
      );
      for (const viewName of viewNames) {
        this.dropTempViewIfExists(viewName, toolCall);
        this.db
          .prepare(
            `create temp view ${quoteIdentifier(viewName)} as select ${selectList} from ${quoteIdentifier(alias)}.${quoteIdentifier(dataset.sqlite_table_name)}`,
          )
          .run();
        preparedViews.push(viewName);
      }
    }

    this.appendToolLog(toolCall, "sql-csv-views", "success", "CSV SQLite 表视图已挂载到 SQL 工具执行上下文。", {
      csvSqlitePath: this.options.csvSqlitePath,
      views: preparedViews,
    });
    return preparedViews;
  }

  private dropTempViewIfExists(viewName: string, toolCall: AssistantToolCall) {
    const existing = this.db.prepare("select type from sqlite_temp_master where name = ?").get(viewName) as
      | { type?: string }
      | undefined;
    if (!existing) {
      return;
    }
    if (existing.type !== "view") {
      this.appendToolLog(
        toolCall,
        "sql-csv-views",
        "error",
        "临时对象名称被非视图对象占用，无法重建 CSV 查询视图。",
        { viewName, existingType: existing.type },
      );
      throw new Error(`临时 SQL 对象名称冲突：${viewName}`);
    }
    this.db.prepare(`drop view if exists temp.${quoteIdentifier(viewName)}`).run();
  }

  private toolBlock(toolCall: AssistantToolCall, body: string): AssistantBlock {
    const files = extractScriptFiles(toolCall.script);
    const isMarkdownResult = toolCall.status === "completed" && toolCall.kind === "python" && isMarkdownLikeContent(body);
    return {
      id: randomUUID(),
      type: isMarkdownResult ? "markdown" : toolCall.status === "completed" ? "json" : "card",
      title: `${toolCall.kind.toUpperCase()} 工具调用：${toolCall.status}`,
      content: body,
      toolCallId: toolCall.id,
      toolStatus: toolCall.status,
      toolName: toolCall.kind,
      toolTarget: toolTarget(toolCall),
      toolFiles: files.length > 0 ? files : undefined,
      toolDurationMs: toolCallDurationMs(toolCall),
    };
  }

  private async handleToolCall(input: AssistantSendInput, conversation: AssistantConversation, message: AssistantMessage, tool: ToolDetection, options: { appendToMessage?: boolean } = {}) {
    const normalizedTool: ToolDetection =
      tool.kind === "python"
        ? {
            ...tool,
            script: await this.normalizePythonToolScript({
              userId: input.userId,
              conversationId: conversation.id,
              prompt: input.prompt,
              script: tool.script,
            }),
          }
        : tool;

    if (normalizedTool.kind === "sql" && !isReadonlySql(normalizedTool.script)) {
      const toolCall = this.insertToolCall({
        conversationId: conversation.id,
        messageId: message.id,
        userId: input.userId,
        kind: normalizedTool.kind,
        script: normalizedTool.script,
        approvalMode: input.approvalMode,
        status: "blocked",
        errorMessage: "SQL 安全校验未通过。",
      });
      this.appendToolLog(toolCall, "safety-check", "error", "SQL 安全校验未通过。", { script: normalizedTool.script });
      const toolBlock = this.toolBlock(toolCall, "SQL 安全校验未通过：仅允许单条只读 SELECT / WITH / PRAGMA 查询。");
      const current = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(message.id));
      const keepContent = options.appendToMessage && current.content.trim();
      const updated = this.updateMessage(message.id, {
        status: "error",
        content: keepContent ? current.content : "SQL 安全校验未通过。",
        blocks: options.appendToMessage ? replaceToolBlock(current.blocks, toolBlock) : [toolBlock],
        errorMessage: "SQL 安全校验未通过。",
      });
      this.options.emit({ type: "tool", conversationId: conversation.id, toolCall, message: updated });
      return;
    }

    if (input.approvalMode === "no_access") {
      const toolCall = this.insertToolCall({
        conversationId: conversation.id,
        messageId: message.id,
        userId: input.userId,
        kind: normalizedTool.kind,
        script: normalizedTool.script,
        approvalMode: input.approvalMode,
        status: "blocked",
        errorMessage: "当前审批权限禁止执行脚本工具。",
      });
      this.appendToolLog(toolCall, "permission-check", "error", "审批权限禁止执行脚本工具。", { approvalMode: input.approvalMode });
      const toolBlock = this.toolBlock(toolCall, "当前审批权限为“禁止访问权限”，工具调用已被拦截。");
      const current = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(message.id));
      const keepContent = options.appendToMessage && current.content.trim();
      const updated = this.updateMessage(message.id, {
        status: "error",
        content: keepContent ? current.content : "当前审批权限禁止执行脚本工具。",
        blocks: options.appendToMessage ? replaceToolBlock(current.blocks, toolBlock) : [toolBlock],
        errorMessage: "工具调用被权限策略拦截。",
      });
      this.options.emit({ type: "tool", conversationId: conversation.id, toolCall, message: updated });
      return;
    }

    const status: AssistantToolStatus = input.approvalMode === "request_approval" ? "pending_approval" : "running";
    const toolCall = this.insertToolCall({
      conversationId: conversation.id,
      messageId: message.id,
      userId: input.userId,
      kind: normalizedTool.kind,
      script: normalizedTool.script,
      approvalMode: input.approvalMode,
      status,
    });

    if (input.approvalMode === "request_approval") {
      this.appendToolLog(toolCall, "approval", "info", "工具调用已创建，等待用户审批。", {
        approvalMode: input.approvalMode,
        script: normalizedTool.script,
        originalScript: normalizedTool.script === tool.script ? undefined : tool.script,
      });
      const toolBlock = this.toolBlock(
        toolCall,
        normalizedTool.kind === "sql"
          ? "SQL 安全校验通过，已创建审批单。审批通过后执行查询。"
          : `检测到 ${normalizedTool.kind.toUpperCase()} 脚本调用。审批通过后执行。`,
      );
      const current = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(message.id));
      const keepContent = options.appendToMessage && current.content.trim();
      const updated = this.updateMessage(message.id, {
        status: "awaiting_approval",
        content: keepContent ? current.content : "工具调用等待审批。",
        blocks: options.appendToMessage ? replaceToolBlock(current.blocks, toolBlock) : [toolBlock],
      });
      this.options.emit({ type: "tool", conversationId: conversation.id, toolCall, message: updated });
      return;
    }

    await this.executeToolCall(toolCall);
  }

  private async executeToolCall(toolCall: AssistantToolCall) {
    const normalizedScript =
      toolCall.kind === "python"
        ? await this.normalizePythonToolScript({
            userId: toolCall.userId,
            conversationId: toolCall.conversationId,
            prompt: this.sourcePromptForToolCall(toolCall),
            script: toolCall.script,
          })
        : toolCall.script;
    const executableToolCall = normalizedScript === toolCall.script ? toolCall : this.updateToolCallScript(toolCall.id, normalizedScript);
    if (executableToolCall.script !== toolCall.script) {
      this.appendToolLog(executableToolCall, "python-script-normalize", "info", "Python 工具脚本已替换为基于 SQL 结果快照的标准库脚本。", {
        originalScript: toolCall.script,
        normalizedScript,
      });
    }
    const running = this.updateToolCall(executableToolCall.id, "running");
    this.appendToolLog(running, "execution-start", "info", "工具调用开始执行。", { script: running.script });
    const currentBeforeRun = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(executableToolCall.messageId));
    const preserveContent = hasRenderableNonToolContent(currentBeforeRun);
    const runningBlock = this.toolBlock(running, executableToolCall.kind === "sql" ? "SQL 已通过审批，正在执行受控只读查询。" : "工具调用执行中，请稍候。");
    let runningMessage = this.updateMessage(executableToolCall.messageId, {
      status: "processing",
      content: preserveContent ? currentBeforeRun.content : "工具调用执行中。",
      blocks: preserveContent ? replaceToolBlock(currentBeforeRun.blocks, runningBlock) : [runningBlock],
    });
    this.options.emit({ type: "tool", conversationId: executableToolCall.conversationId, toolCall: running, message: runningMessage });

    try {
      const sqlExecution = executableToolCall.kind === "sql" ? this.executeReadonlySql(executableToolCall.script, running) : null;
      const result = sqlExecution ? sqlExecution.result : await this.executePython(running.script);
      const completed = this.updateToolCall(toolCall.id, "completed", result);
      if (completed.kind === "sql") {
        await this.registerSqlToolResultDataset(completed, sqlExecution?.rows);
      }
      this.appendToolLog(completed, "execution-complete", "success", "工具调用执行完成。", {
        resultPreview: result.slice(0, 2_000),
      });
      const currentBeforeComplete = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(toolCall.messageId));
      const completedBlock = this.toolBlock(completed, result);
      const message = this.updateMessage(toolCall.messageId, {
        status: "completed",
        content: preserveContent ? currentBeforeComplete.content : result,
        blocks: preserveContent ? replaceToolBlock(currentBeforeComplete.blocks, completedBlock) : [completedBlock],
      });
      this.options.emit({ type: "tool", conversationId: toolCall.conversationId, toolCall: completed, message });
      if (completed.kind === "sql") {
        await this.maybeCreateAutoPythonReportApproval(completed, message, sqlExecution?.rows);
      }
      return { success: true as const, toolCall: completed, message };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "工具调用失败。";
      const failed = this.updateToolCall(toolCall.id, "error", undefined, messageText);
      this.appendToolLog(failed, "execution-error", "error", messageText, {
        script: failed.script,
        stack: error instanceof Error ? error.stack : undefined,
      });
      const currentBeforeFailure = this.messageFromRow(this.db.prepare("select * from messages where id = ?").get(toolCall.messageId));
      const failedBlock = this.toolBlock(failed, messageText);
      runningMessage = this.updateMessage(toolCall.messageId, {
        status: "error",
        content: preserveContent ? currentBeforeFailure.content : messageText,
        blocks: preserveContent ? replaceToolBlock(currentBeforeFailure.blocks, failedBlock) : [failedBlock],
        errorMessage: messageText,
      });
      this.options.emit({ type: "tool", conversationId: toolCall.conversationId, toolCall: failed, message: runningMessage });
      return { success: true as const, toolCall: failed, message: runningMessage };
    }
  }

  private sourcePromptForToolCall(toolCall: AssistantToolCall) {
    const messageRow = this.db.prepare("select created_at from messages where id = ?").get(toolCall.messageId) as { created_at?: string } | undefined;
    const row = this.db
      .prepare(
        `select content
         from messages
         where conversation_id = ?
           and user_id = ?
           and role = 'user'
           and created_at <= ?
         order by created_at desc
         limit 1`,
      )
      .get(toolCall.conversationId, toolCall.userId, messageRow?.created_at ?? toolCall.createdAt) as { content?: string } | undefined;
    return row?.content?.trim() ?? "";
  }

  private async maybeCreateAutoPythonReportApproval(toolCall: AssistantToolCall, message: AssistantMessage, rows?: Array<Record<string, unknown>>) {
    if (toolCall.approvalMode === "no_access") {
      return;
    }
    const sourcePrompt = this.sourcePromptForToolCall(toolCall);
    if (!sourcePrompt || !shouldAutoStartPythonReport(sourcePrompt)) {
      return;
    }
    const existingPendingPython = this.db
      .prepare(
        `select id
         from tool_calls
         where conversation_id = ?
           and user_id = ?
           and kind = 'python'
           and status in ('pending_approval', 'running')
         order by created_at desc
         limit 1`,
      )
      .get(toolCall.conversationId, toolCall.userId);
    if (existingPendingPython) {
      return;
    }
    const conversation = this.findConversation(toolCall.userId, toolCall.conversationId);
    if (!conversation) {
      return;
    }
    const analysisRows = rows?.length ? rows : parseSqlToolRows(toolCall.result);
    this.appendToolLog(toolCall, "workflow-routing", "info", "SQL 查询完成后根据用户报告需求自动创建 Python 分析审批。", {
      sourcePrompt,
      rowCount: analysisRows.length,
    });
    await this.handleToolCall(
      {
        userId: toolCall.userId,
        conversationId: toolCall.conversationId,
        clientRequestId: `auto-python-${toolCall.id}`,
        prompt: sourcePrompt,
        modelName: "local-workflow",
        approvalMode: toolCall.approvalMode,
      },
      conversation,
      message,
      {
        kind: "python",
        script: this.buildPythonAnalysisScript(sourcePrompt, toolCall, analysisRows),
      },
      { appendToMessage: true },
    );
  }

  private async registerSqlToolResultDataset(toolCall: AssistantToolCall, materializationRows?: Array<Record<string, unknown>>) {
    const rows = materializationRows ?? parseSqlToolRows(toolCall.result);
    const existing = (await this.datasetStateManager.listDatasets(toolCall.conversationId)).find((dataset) => dataset.sourceSqlExecutionId === toolCall.id);
    if (existing) {
      this.appendToolLog(toolCall, "workflow-materialization", "info", "SQL 工具结果已存在对应工作流数据集，跳过重复物化。", {
        datasetId: existing.datasetId,
      });
      return existing;
    }

    const workflow = await this.ensureWorkflowForToolCall(toolCall);
    const activeDataset = await this.datasetStateManager.getActiveDataset(toolCall.conversationId);
    const parentDataset = activeDataset && this.referencesDatasetTable(toolCall.script, activeDataset) ? activeDataset : null;
    const resultColumns = this.inferResultColumns(rows);
    if (resultColumns.length === 0) {
      this.appendToolLog(toolCall, "workflow-materialization", "info", "SQL 工具结果为空，未创建工作流数据集。", {
        workflowId: workflow.workflowId,
      });
      await this.workflowStore.update(workflow.workflowId, {
        status: "waiting_user_confirmation",
        steps: [
          ...workflow.steps,
          {
            stepId: randomUUID(),
            type: "sqlite_materialization",
            status: "skipped",
            input: { toolCallId: toolCall.id },
            output: { reason: "empty_result" },
            completedAt: nowIso(),
          },
        ],
      });
      return null;
    }

    const materialized = await this.sqliteMaterializer.materializeSqlResult({
      workflowId: workflow.workflowId,
      conversationId: toolCall.conversationId,
      sqlRequestId: toolCall.id,
      sqlExecutionId: toolCall.id,
      sourceDataSourceId: toolCall.conversationId,
      resultColumns,
      rows,
      targetTableName: `wf_${toolCall.id.replaceAll("-", "_")}`,
      parentDatasetIds: parentDataset ? [parentDataset.datasetId] : undefined,
      metadata: {
        sourceToolCallId: toolCall.id,
        sourceScript: toolCall.script,
      },
    });
    this.tempTableRegistry.register(materialized);
    const datasetCreatedAt = materialized.createdAt;
    const dataset: WorkflowDatasetRef = {
      datasetId: materialized.datasetId,
      workflowId: workflow.workflowId,
      conversationId: toolCall.conversationId,
      name: `${toolTarget(toolCall)} 结果集`,
      sourceType: parentDataset ? "refined_sql_result" : "sql_execution_result",
      sqliteTableName: materialized.sqliteTableName,
      sqliteDatabasePath: materialized.sqliteDatabasePath,
      parentDatasetIds: parentDataset ? [parentDataset.datasetId] : undefined,
      sourceSqlRequestId: toolCall.id,
      sourceSqlExecutionId: toolCall.id,
      rowCount: materialized.rowCount,
      columnCount: materialized.columnCount,
      schema: materialized.schema,
      status: "ready",
      canQuery: true,
      canAnalyze: true,
      canUseForReport: true,
      createdAt: datasetCreatedAt,
      updatedAt: datasetCreatedAt,
      expiresAt: new Date(Date.parse(datasetCreatedAt) + WORKFLOW_DATASET_TTL_MS).toISOString(),
      metadata: {
        sourceToolCallId: toolCall.id,
        sourceScriptHash: sha256(toolCall.script),
        userId: toolCall.userId,
      },
    };
    dataset.profile = this.sqliteMaterializer.profileDataset(dataset);
    await this.datasetStateManager.registerDataset(dataset);
    const latestWorkflow = (await this.workflowStore.get(workflow.workflowId)) ?? workflow;
    const updated = await this.workflowStore.update(workflow.workflowId, {
      status: "waiting_user_confirmation",
      activeDatasetId: dataset.datasetId,
      latestSqlDatasetId: dataset.datasetId,
      steps: [
        ...latestWorkflow.steps,
        {
          stepId: randomUUID(),
          type: "sql_execution",
          status: "success",
          input: { toolCallId: toolCall.id, script: toolCall.script },
          output: { rowCount: dataset.rowCount, columnCount: dataset.columnCount },
          startedAt: toolCall.createdAt,
          completedAt: toolCall.updatedAt,
        },
        {
          stepId: randomUUID(),
          type: "sqlite_materialization",
          status: "success",
          input: { toolCallId: toolCall.id },
          output: { datasetId: dataset.datasetId, sqliteTableName: dataset.sqliteTableName },
          startedAt: materialized.createdAt,
          completedAt: nowIso(),
        },
        {
          stepId: randomUUID(),
          type: "dataset_profile",
          status: "success",
          input: { datasetId: dataset.datasetId },
          output: {
            rowCount: dataset.profile.rowCount,
            columnCount: dataset.profile.columnCount,
            previewRows: Math.min(dataset.profile.previewRows?.length ?? 0, 20),
          },
          completedAt: dataset.profile.generatedAt,
        },
      ],
    });
    await this.workflowStore.appendEvent(updated.workflowId, {
      eventId: randomUUID(),
      workflowId: updated.workflowId,
      conversationId: toolCall.conversationId,
      type: parentDataset ? "dataset_refined" : "dataset_materialized",
      message: "SQL 查询结果已物化为 SQLite 工作流数据集。",
      payload: {
        datasetId: dataset.datasetId,
        sqliteTableName: dataset.sqliteTableName,
        rowCount: dataset.rowCount,
        columnCount: dataset.columnCount,
        parentDatasetIds: dataset.parentDatasetIds,
      },
      createdAt: nowIso(),
    });
    await this.workflowMemoryBridge.writeWorkflowMemory({
      conversationId: toolCall.conversationId,
      userId: toolCall.userId,
      type: "dataset_materialized",
      summary: `SQL 查询结果已物化为数据集 ${dataset.datasetId}，共 ${dataset.rowCount ?? 0} 行、${dataset.columnCount ?? 0} 列。`,
      payload: {
        workflowId: workflow.workflowId,
        datasetId: dataset.datasetId,
        sqliteTableName: dataset.sqliteTableName,
        rowCount: dataset.rowCount,
        columnCount: dataset.columnCount,
        parentDatasetIds: dataset.parentDatasetIds,
      },
    });
    this.appendToolLog(toolCall, "workflow-materialization", "success", "SQL 查询结果已物化为工作流数据集。", {
      workflowId: workflow.workflowId,
      datasetId: dataset.datasetId,
      sqliteTableName: dataset.sqliteTableName,
      rowCount: dataset.rowCount,
      columnCount: dataset.columnCount,
      parentDatasetIds: dataset.parentDatasetIds,
    });
    this.options.emit({ type: "workflow", conversationId: toolCall.conversationId, context: await this.workflowContextBuilder.build(toolCall.conversationId) });
    return dataset;
  }

  private async cleanupExpiredWorkflowDatasets(conversationId: string) {
    const nowTime = Date.now();
    const datasets = await this.datasetStateManager.listDatasets(conversationId);
    const expiredDatasetIds: string[] = [];
    for (const dataset of datasets) {
      if (!dataset.expiresAt || Date.parse(dataset.expiresAt) > nowTime || dataset.status === "expired") {
        continue;
      }
      if (dataset.sqliteTableName) {
        this.sqliteMaterializer.dropTable(dataset.sqliteTableName);
      }
      this.tempTableRegistry.unregister(dataset.datasetId);
      await this.datasetStateManager.expireDataset(dataset.datasetId);
      expiredDatasetIds.push(dataset.datasetId);
      await this.workflowMemoryBridge.writeWorkflowMemory({
        conversationId,
        userId: dataset.metadata?.userId as string || "system",
        type: "dataset_expired",
        summary: `工作流数据集 ${dataset.datasetId} 已按 TTL 过期清理。`,
        payload: {
          workflowId: dataset.workflowId,
          datasetId: dataset.datasetId,
          sqliteTableName: dataset.sqliteTableName,
        },
      });
    }
    if (expiredDatasetIds.length === 0) {
      return;
    }
    const workflow = await this.workflowStore.getActiveByConversation(conversationId);
    if (!workflow) {
      return;
    }
    await this.workflowStore.update(workflow.workflowId, {
      activeDatasetId: expiredDatasetIds.includes(workflow.activeDatasetId ?? "") ? undefined : workflow.activeDatasetId,
      latestSqlDatasetId: expiredDatasetIds.includes(workflow.latestSqlDatasetId ?? "") ? undefined : workflow.latestSqlDatasetId,
      confirmedDatasetId: expiredDatasetIds.includes(workflow.confirmedDatasetId ?? "") ? undefined : workflow.confirmedDatasetId,
    });
  }

  private async ensureWorkflowForToolCall(toolCall: AssistantToolCall): Promise<WorkflowSession> {
    const active = await this.workflowStore.getActiveByConversation(toolCall.conversationId);
    if (active) {
      return active;
    }
    const createdAt = nowIso();
    const workflow: WorkflowSession = {
      workflowId: randomUUID(),
      conversationId: toolCall.conversationId,
      userId: toolCall.userId,
      type: "data_extraction",
      status: "materializing_dataset",
      title: toolTarget(toolCall),
      userGoal: toolCall.script,
      steps: [
        {
          stepId: randomUUID(),
          type: "sql_request",
          status: "success",
          input: { toolCallId: toolCall.id, script: toolCall.script },
          output: { toolCallId: toolCall.id },
          startedAt: toolCall.createdAt,
          completedAt: toolCall.createdAt,
        },
      ],
      datasets: [],
      events: [
        {
          eventId: randomUUID(),
          workflowId: randomUUID(),
          conversationId: toolCall.conversationId,
          type: "workflow_created",
          message: "从已审批 SQL 工具调用创建工作流。",
          payload: { toolCallId: toolCall.id },
          createdAt,
        },
      ],
      createdAt,
      updatedAt: createdAt,
    };
    workflow.events = workflow.events.map((item) => ({ ...item, workflowId: workflow.workflowId }));
    return this.workflowStore.create(workflow);
  }

  private inferResultColumns(rows: Array<Record<string, unknown>>) {
    const first = rows[0];
    if (!first) {
      return [];
    }
    return Object.keys(first).map((name) => {
      const value = first[name];
      let type = "text";
      if (typeof value === "number") {
        type = Number.isInteger(value) ? "integer" : "real";
      } else if (typeof value === "boolean") {
        type = "integer";
      }
      return { name, type };
    });
  }

  private referencesDatasetTable(script: string, dataset: WorkflowDatasetRef) {
    if (!dataset.sqliteTableName) {
      return false;
    }
    const escaped = dataset.sqliteTableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\w])["'\`]?${escaped}["'\`]?(?=$|[^\\w])`, "i").test(script);
  }

  private executeReadonlySql(script: string, toolCall: AssistantToolCall) {
    if (!isReadonlySql(script)) {
      throw new Error("SQL 安全网已拦截：仅允许单条只读 SELECT / WITH / PRAGMA 查询。");
    }
    const views = this.prepareCsvSqlViews(toolCall);
    let executableScript = normalizeCsvSchemaQualifiedSql(script);
    this.appendToolLog(toolCall, "sql-execute", "info", "开始执行只读 SQL。", {
      script,
      executableScript,
      mountedCsvViews: views,
    });
    let rows: Array<Record<string, unknown>>;
    try {
      rows = this.db.prepare(executableScript).all() as Array<Record<string, unknown>>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rewrittenScript = /ORDER BY term does not match any column in the result set/i.test(message)
        ? rewriteCompoundOrderByForSqlite(executableScript)
        : null;
      if (!rewrittenScript) {
        throw error;
      }
      this.appendToolLog(toolCall, "sql-rewrite", "info", "已兼容 SQLite 复合查询 ORDER BY 规则并重试执行。", {
        reason: message,
        executableScript,
        rewrittenScript,
      });
      executableScript = rewrittenScript;
      rows = this.db.prepare(executableScript).all() as Array<Record<string, unknown>>;
    }
    const previewRows = rows.slice(0, 20);
    this.appendToolLog(toolCall, "sql-execute", "success", "只读 SQL 执行完成。", {
      rowCount: rows.length,
      rowLimit: null,
      previewRowCount: previewRows.length,
    });
    return {
      rows,
      result: JSON.stringify(
        {
          rowCount: rows.length,
          previewRows,
          previewRowLimit: 20,
          rowLimit: null,
          materialization: "SQL 查询结果将物化为本地 SQLite 工作流数据集，后续分析应读取 workflow dataset，而不是重复查询数据源。",
        },
        null,
        2,
      ),
    };
  }

  private executePython(script: string) {
    return new Promise<string>((resolve, reject) => {
      const workingDirectory = join(tmpdir(), "cycle-probe-python-sandbox");
      mkdirSync(workingDirectory, { recursive: true });
      const child = spawn("python3", ["-I", "-S", "-c", script], {
        cwd: workingDirectory,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Python 执行超时，已终止。"));
      }, PYTHON_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Python 退出码 ${code}`));
          return;
        }
        const normalizedStdout = stdout.trim();
        if (normalizedStdout && isMarkdownLikeContent(normalizedStdout)) {
          resolve(normalizedStdout);
          return;
        }
        resolve(JSON.stringify({ stdout: normalizedStdout, stderr: stderr.trim() || null }, null, 2));
      });
    });
  }

  private async streamModelResponse(input: AssistantSendInput, conversation: AssistantConversation, assistantMessage: AssistantMessage) {
    const apiKey = await this.options.getModelApiKey(input.userId);
    if (!apiKey) {
      const message = this.updateMessage(assistantMessage.id, {
        status: "error",
        content: "模型 API Key 未配置。",
        blocks: [{ id: randomUUID(), type: "card", title: "配置缺失", content: "请先在用户设置中保存模型 API Key。" }],
        errorMessage: "模型 API Key 未配置。",
      });
      this.options.emit({ type: "message", conversationId: conversation.id, message });
      return;
    }

    const controller = new AbortController();
    this.abortControllers.set(assistantMessage.id, controller);
    let content = "";
    let providerTraceId: string | undefined;

    try {
      const response = await fetch(SILICONFLOW_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: input.modelName,
          stream: true,
          messages: await this.buildProviderMessages(input.userId, conversation.id, input.prompt, input.dataSourceLabel, input.schemaContextMarkdown, input.skill, input.approvalMode),
          temperature: 0.7,
        }),
        signal: controller.signal,
      });
      providerTraceId = response.headers.get("x-siliconcloud-trace-id") ?? undefined;
      if (!response.ok || !response.body) {
        throw new Error(`模型服务返回 ${response.status}。Trace: ${providerTraceId ?? "unknown"}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) {
            continue;
          }
          const payload = trimmed.slice("data:".length).trim();
          if (payload === "[DONE]") {
            break;
          }
          const delta = this.readSiliconFlowDelta(payload);
          if (!delta) {
            continue;
          }
          content = `${content}${delta}`;
          if (content.length > MAX_STREAM_CHARS) {
            throw new Error("模型输出超过本地安全限制，已终止。");
          }
          const blocks = parseAssistantBlocks(content);
          const updated = this.updateMessage(assistantMessage.id, {
            status: "receiving",
            content,
            blocks,
            providerTraceId,
          });
          this.options.emit({ type: "message-delta", conversationId: conversation.id, messageId: assistantMessage.id, content, blocks: updated.blocks, status: updated.status });
        }
      }

      const completed = this.updateMessage(assistantMessage.id, {
        status: "completed",
        content,
        blocks: parseAssistantBlocks(content),
        providerTraceId,
      });
      this.options.emit({ type: "message", conversationId: conversation.id, message: completed });

      const tool = detectToolFromAssistantOutput(content);
      if (tool) {
        await this.handleToolCall(input, conversation, completed, tool, { appendToMessage: true });
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      const messageText = aborted ? "用户已停止生成。" : error instanceof Error ? error.message : "消息接收失败。";
      const failed = this.updateMessage(assistantMessage.id, {
        status: aborted ? "stopped" : "error",
        content: content || messageText,
        blocks: content ? parseAssistantBlocks(content) : [{ id: randomUUID(), type: "card", title: "消息异常", content: messageText }],
        errorMessage: aborted ? undefined : messageText,
        providerTraceId,
      });
      this.options.emit({ type: "message", conversationId: conversation.id, message: failed });
      if (!aborted) {
        this.options.emit({ type: "error", conversationId: conversation.id, messageId: assistantMessage.id, message: messageText, traceId: providerTraceId ?? sha256(messageText).slice(0, 12) });
      }
    } finally {
      this.abortControllers.delete(assistantMessage.id);
    }
  }

  private async buildProviderMessages(
    userId: string,
    conversationId: string,
    prompt: string,
    dataSourceLabel: string | null | undefined,
    schemaContextMarkdown: string | null | undefined,
    skill: AssistantSkill | null | undefined,
    approvalMode: AssistantApprovalMode,
  ) {
    const recentToolContext = this.recentToolContext(userId, conversationId);
    const workflowContext = await this.workflowContextBuilder.buildMarkdown(conversationId);
    const history = this.getConversationMessages(userId, conversationId)
      .filter((message) => (message.role === "user" || message.role === "assistant") && message.status === "completed" && message.content.trim())
      .slice(-MAX_STORED_MESSAGES_FOR_CONTEXT)
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      }));

    return [
      {
        role: "system",
        content: [
          "你是 Cycle Probe 的数据助手。请用中文回答。",
          "所有模型回复必须流式输出。默认普通问答、说明和简短结论使用流式 text；只有报告、方案、结构化分析、代码块、SQL 候选语句、工具调用执行结果和需要长期查看的产物使用流式 markdown。",
          "不要编造数据库结果；需要查询数据源时，应优先使用 request_sql_query_execution 语义生成候选只读 SQL、查询目的和结果用途，SQL 必须先经过安全校验、权限校验、风险评估和用户审批。",
          "当用户要求统计、筛选或读取数据源内容时，必须输出单个 ```sql 代码块承载候选只读 SQL；客户端会自动捕获该 SQL 并进入安全校验、审批和工具执行流程。",
          "当 Workflow Context 中存在 activeDataset 且用户提到上一轮、当前结果、这批数据或刚才的数据时，候选 SQL 必须优先查询 activeDataset 的 sqliteTableName；不要重新访问原始业务表，除非用户明确要求重新查询原始数据源。",
          "如果用户明确要求“根据 SQL 查询结果/上一轮查询结果/工具调用结果”继续统计、对比或生成报告，必须复用最近工具结果，不得重新生成 SQL；需要计算时输出单个 ```python 代码块，报告正文必须为 Markdown。",
          "Python 工具运行在受限本地沙箱中，只能使用 Python 标准库；不得 import pandas、numpy、openpyxl、matplotlib 或任何第三方库。需要读取工作流数据集时使用 sqlite3 连接 Workflow Context 中的 sqliteDatabasePath，并读取 activeDataset.sqliteTableName。",
          "仅在本地脚本调试场景才输出 /sql 或 /python 代码块，客户端会按审批权限处理。",
          `当前数据源：${dataSourceLabel || "未选择"}`,
          `当前 Skill：${skill || "未选择"}`,
          `审批权限：${approvalMode}`,
          schemaContextMarkdown ? `\n以下是已授权数据源 Schema Context。请遵守其中 Usage Policy、安全约束和工具调用要求，不要基于样例行推断全量结论。\n${schemaContextMarkdown}` : undefined,
          workflowContext ? `\n${workflowContext}` : undefined,
          recentToolContext ? `\n${recentToolContext}` : undefined,
        ].filter(Boolean).join("\n"),
      },
      ...history,
      { role: "user", content: prompt },
    ];
  }

  private readSiliconFlowDelta(payload: string) {
    try {
      const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
      return parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? "";
    } catch {
      return "";
    }
  }
}
