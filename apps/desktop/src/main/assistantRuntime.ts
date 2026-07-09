import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

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
  getModelApiKey: (userId: string) => Promise<string | null>;
  emit: (event: AssistantStreamEvent) => void;
};

type ToolDetection = {
  kind: AssistantToolKind;
  script: string;
};

const SILICONFLOW_CHAT_COMPLETIONS_URL = "https://api.siliconflow.cn/v1/chat/completions";
const MAX_STORED_MESSAGES_FOR_CONTEXT = 12;
const MAX_STREAM_CHARS = 120_000;
const PYTHON_TIMEOUT_MS = 5_000;

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
    return extractSqlTarget(toolCall.script);
  }
  return "Python 脚本";
}

function parseAssistantBlocks(content: string): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  const fencePattern = /```([a-z0-9_+#.-]+)?\s*([\s\S]*?)```/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(content))) {
    const before = content.slice(cursor, match.index).trim();
    if (before) {
      blocks.push({ id: randomUUID(), type: "markdown", content: before });
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
    const type: AssistantBlockType = rest.startsWith("{") || rest.startsWith("[") ? "json" : "markdown";
    blocks.push({ id: randomUUID(), type, content: rest, title: type === "json" ? "JSON" : undefined });
  }

  return blocks.length > 0 ? blocks : [{ id: randomUUID(), type: "text", content: "" }];
}

export class AssistantRuntime {
  private db: any;
  private integrityKey: string;
  private abortControllers = new Map<string, AbortController>();
  private readonly options: AssistantRuntimeOptions;

  constructor(options: AssistantRuntimeOptions) {
    this.options = options;
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new Database(options.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
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

    void this.streamModelResponse(
      {
        userId: input.userId,
        conversationId: conversation.id,
        clientRequestId: input.clientRequestId,
        prompt: sourceUserMessage.content,
        modelName,
        dataSourceLabel: input.dataSourceLabel,
        schemaContextMarkdown: input.schemaContextMarkdown,
        skill: input.skill,
        approvalMode: input.approvalMode,
      },
      nextConversation,
      assistantMessage,
    );

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
      create index if not exists idx_conversations_user_updated on conversations(user_id, updated_at desc);
      create index if not exists idx_messages_conversation_created on messages(conversation_id, created_at);
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

  private toolBlock(toolCall: AssistantToolCall, body: string): AssistantBlock {
    const files = extractScriptFiles(toolCall.script);
    return {
      id: randomUUID(),
      type: toolCall.status === "completed" ? "json" : "card",
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

  private async handleToolCall(input: AssistantSendInput, conversation: AssistantConversation, message: AssistantMessage, tool: ToolDetection) {
    if (input.approvalMode === "no_access") {
      const toolCall = this.insertToolCall({
        conversationId: conversation.id,
        messageId: message.id,
        userId: input.userId,
        kind: tool.kind,
        script: tool.script,
        approvalMode: input.approvalMode,
        status: "blocked",
        errorMessage: "当前审批权限禁止执行脚本工具。",
      });
      const updated = this.updateMessage(message.id, {
        status: "error",
        content: "当前审批权限禁止执行脚本工具。",
        blocks: [this.toolBlock(toolCall, "当前审批权限为“禁止访问权限”，工具调用已被拦截。")],
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
      kind: tool.kind,
      script: tool.script,
      approvalMode: input.approvalMode,
      status,
    });

    if (input.approvalMode === "request_approval") {
      const updated = this.updateMessage(message.id, {
        status: "awaiting_approval",
        content: "工具调用等待审批。",
        blocks: [this.toolBlock(toolCall, `检测到 ${tool.kind.toUpperCase()} 脚本调用。审批通过后执行。`)],
      });
      this.options.emit({ type: "tool", conversationId: conversation.id, toolCall, message: updated });
      return;
    }

    await this.executeToolCall(toolCall);
  }

  private async executeToolCall(toolCall: AssistantToolCall) {
    const running = this.updateToolCall(toolCall.id, "running");
    let runningMessage = this.updateMessage(toolCall.messageId, {
      status: "processing",
      content: "工具调用执行中。",
      blocks: [this.toolBlock(running, "工具调用执行中，请稍候。")],
    });
    this.options.emit({ type: "tool", conversationId: toolCall.conversationId, toolCall: running, message: runningMessage });

    try {
      const result = toolCall.kind === "sql" ? this.executeReadonlySql(toolCall.script) : await this.executePython(toolCall.script);
      const completed = this.updateToolCall(toolCall.id, "completed", result);
      const message = this.updateMessage(toolCall.messageId, {
        status: "completed",
        content: result,
        blocks: [this.toolBlock(completed, result)],
      });
      this.options.emit({ type: "tool", conversationId: toolCall.conversationId, toolCall: completed, message });
      return { success: true as const, toolCall: completed, message };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "工具调用失败。";
      const failed = this.updateToolCall(toolCall.id, "error", undefined, messageText);
      runningMessage = this.updateMessage(toolCall.messageId, {
        status: "error",
        content: messageText,
        blocks: [this.toolBlock(failed, messageText)],
        errorMessage: messageText,
      });
      this.options.emit({ type: "tool", conversationId: toolCall.conversationId, toolCall: failed, message: runningMessage });
      return { success: true as const, toolCall: failed, message: runningMessage };
    }
  }

  private executeReadonlySql(script: string) {
    if (!isReadonlySql(script)) {
      throw new Error("SQL 安全网已拦截：仅允许单条只读 SELECT / WITH / PRAGMA 查询。");
    }
    const rows = this.db.prepare(script).all().slice(0, 50);
    return JSON.stringify({ rows, rowLimit: 50 }, null, 2);
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
        resolve(JSON.stringify({ stdout: stdout.trim(), stderr: stderr.trim() || null }, null, 2));
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
          messages: this.buildProviderMessages(input.userId, conversation.id, input.prompt, input.dataSourceLabel, input.schemaContextMarkdown, input.skill, input.approvalMode),
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

  private buildProviderMessages(
    userId: string,
    conversationId: string,
    prompt: string,
    dataSourceLabel: string | null | undefined,
    schemaContextMarkdown: string | null | undefined,
    skill: AssistantSkill | null | undefined,
    approvalMode: AssistantApprovalMode,
  ) {
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
          "不要编造数据库结果；需要查询数据源时，应优先使用 request_sql_query_execution 语义生成候选只读 SQL、查询目的和结果用途，SQL 必须先经过安全校验、权限校验、风险评估和用户审批。",
          "仅在本地脚本调试场景才输出 /sql 或 /python 代码块，客户端会按审批权限处理。",
          `当前数据源：${dataSourceLabel || "未选择"}`,
          `当前 Skill：${skill || "未选择"}`,
          `审批权限：${approvalMode}`,
          schemaContextMarkdown ? `\n以下是已授权数据源 Schema Context。请遵守其中 Usage Policy、安全约束和工具调用要求，不要基于样例行推断全量结论。\n${schemaContextMarkdown}` : undefined,
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
