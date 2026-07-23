import type { AgentProgressEvent, AgentRunRecord, AgentRunStatus, CreateAgentRunInput, PlannerDecision } from "./types";

type DatabaseLike = {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): any; all(...args: unknown[]): any[] };
};

export class SQLiteAgentProgressStore {
  constructor(private readonly db: DatabaseLike) {}

  migrate() {
    this.db.exec(`
      create table if not exists agent_runs (
        run_id text primary key,
        conversation_id text not null,
        message_id text not null,
        user_id text not null,
        attempt integer not null,
        status text not null,
        reasoning_model_name text not null,
        execution_model_name text not null,
        route_json text,
        analysis_plan_json text,
        thinking_decision_json text,
        kimi_call_count integer not null default 0,
        cumulative_thinking_budget integer not null default 0,
        plan_json text,
        current_step_id text,
        completed_step_ids_json text not null,
        failed_step_ids_json text not null,
        active_duration_ms integer not null,
        waiting_duration_ms integer not null,
        active_started_at text,
        waiting_started_at text,
        input_json text,
        error_json text,
        started_at text not null,
        updated_at text not null,
        completed_at text
      );
      create table if not exists agent_progress_events (
        event_id text primary key,
        run_id text not null references agent_runs(run_id) on delete cascade,
        conversation_id text not null,
        message_id text not null,
        phase text not null,
        status text not null,
        summary text not null,
        step_id text,
        tool_call_id text,
        model_role text,
        business_event_type text,
        active_duration_ms integer,
        waiting_duration_ms integer,
        detail_json text,
        created_at text not null
      );
      create index if not exists idx_agent_runs_message_attempt on agent_runs(message_id, attempt desc);
      create index if not exists idx_agent_runs_conversation_started on agent_runs(conversation_id, started_at);
      create index if not exists idx_agent_progress_run_created on agent_progress_events(run_id, created_at);
    `);
    this.ensureColumn("agent_runs", "route_json", "text");
    this.ensureColumn("agent_runs", "analysis_plan_json", "text");
    this.ensureColumn("agent_runs", "thinking_decision_json", "text");
    this.ensureColumn("agent_runs", "kimi_call_count", "integer not null default 0");
    this.ensureColumn("agent_runs", "cumulative_thinking_budget", "integer not null default 0");
    this.ensureColumn("agent_progress_events", "business_event_type", "text");
  }

  create(input: CreateAgentRunInput): AgentRunRecord {
    const now = new Date().toISOString();
    this.db.prepare(`insert into agent_runs
      (run_id, conversation_id, message_id, user_id, attempt, status, reasoning_model_name, execution_model_name,
       completed_step_ids_json, failed_step_ids_json, active_duration_ms, waiting_duration_ms, active_started_at,
       input_json, started_at, updated_at)
      values (?, ?, ?, ?, ?, 'planning', ?, ?, '[]', '[]', 0, 0, ?, ?, ?, ?)`)
      .run(input.runId, input.conversationId, input.messageId, input.userId, input.attempt, input.reasoningModelName,
        input.executionModelName, now, input.input ? JSON.stringify(input.input) : null, now, now);
    return this.get(input.runId)!;
  }

  get(runId: string): AgentRunRecord | null {
    const row = this.db.prepare("select * from agent_runs where run_id = ?").get(runId);
    return row ? this.fromRow(row) : null;
  }

  latestForMessage(messageId: string): AgentRunRecord | null {
    const row = this.db.prepare("select * from agent_runs where message_id = ? order by attempt desc limit 1").get(messageId);
    return row ? this.fromRow(row) : null;
  }

  listByConversation(conversationId: string): AgentRunRecord[] {
    return this.db.prepare(`select r.* from agent_runs r
      join (select message_id, max(attempt) attempt from agent_runs where conversation_id = ? group by message_id) latest
        on latest.message_id = r.message_id and latest.attempt = r.attempt
      order by r.started_at`).all(conversationId).map((row) => this.fromRow(row));
  }

  nextAttempt(messageId: string) {
    const row = this.db.prepare("select max(attempt) attempt from agent_runs where message_id = ?").get(messageId) as { attempt?: number } | undefined;
    return Math.max(1, Number(row?.attempt ?? 0) + 1);
  }

  update(runId: string, patch: {
    status?: AgentRunStatus;
    plan?: PlannerDecision;
    route?: AgentRunRecord["route"];
    analysisPlan?: AgentRunRecord["analysisPlan"];
    thinkingDecision?: AgentRunRecord["thinkingDecision"];
    kimiCallCount?: number;
    cumulativeThinkingBudget?: number;
    currentStepId?: string | null;
    completedStepIds?: string[];
    failedStepIds?: string[];
    activeDurationMs?: number;
    waitingDurationMs?: number;
    activeStartedAt?: string | null;
    waitingStartedAt?: string | null;
    completedAt?: string | null;
    error?: AgentRunRecord["error"] | null;
  }) {
    const current = this.get(runId);
    if (!current) throw new Error(`Agent Run 不存在：${runId}`);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare(`update agent_runs set status = ?, route_json = ?, analysis_plan_json = ?, thinking_decision_json = ?,
      kimi_call_count = ?, cumulative_thinking_budget = ?,
      plan_json = ?, current_step_id = ?, completed_step_ids_json = ?,
      failed_step_ids_json = ?, active_duration_ms = ?, waiting_duration_ms = ?, active_started_at = ?, waiting_started_at = ?,
      error_json = ?, updated_at = ?, completed_at = ? where run_id = ?`).run(
      next.status,
      next.route ? JSON.stringify(next.route) : null,
      next.analysisPlan ? JSON.stringify(next.analysisPlan) : null,
      next.thinkingDecision ? JSON.stringify(next.thinkingDecision) : null,
      next.kimiCallCount,
      next.cumulativeThinkingBudget,
      next.plan ? JSON.stringify(next.plan) : null,
      next.currentStepId ?? null,
      JSON.stringify(next.completedStepIds),
      JSON.stringify(next.failedStepIds),
      next.activeDurationMs,
      next.waitingDurationMs,
      next.activeStartedAt ?? null,
      next.waitingStartedAt ?? null,
      next.error ? JSON.stringify(next.error) : null,
      next.updatedAt,
      next.completedAt ?? null,
      runId,
    );
    return this.get(runId)!;
  }

  append(event: AgentProgressEvent) {
    this.db.prepare(`insert into agent_progress_events
      (event_id, run_id, conversation_id, message_id, phase, status, summary, step_id, tool_call_id, model_role,
       business_event_type, active_duration_ms, waiting_duration_ms, detail_json, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      event.eventId, event.runId, event.conversationId, event.messageId, event.phase, event.status, event.summary,
      event.stepId ?? null, event.toolCallId ?? null, event.modelRole ?? null, event.businessEventType ?? null, event.activeDurationMs ?? null,
      event.waitingDurationMs ?? null, event.detail ? JSON.stringify(event.detail) : null, event.createdAt,
    );
  }

  events(runId: string): AgentProgressEvent[] {
    return this.db.prepare("select * from agent_progress_events where run_id = ? order by created_at, rowid").all(runId).map((row) => ({
      eventId: row.event_id,
      runId: row.run_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      phase: row.phase,
      status: row.status,
      summary: row.summary,
      stepId: row.step_id ?? undefined,
      toolCallId: row.tool_call_id ?? undefined,
      modelRole: row.model_role ?? undefined,
      businessEventType: row.business_event_type ?? undefined,
      activeDurationMs: row.active_duration_ms ?? undefined,
      waitingDurationMs: row.waiting_duration_ms ?? undefined,
      detail: parseJson(row.detail_json, undefined),
      createdAt: row.created_at,
    }));
  }

  stopOrphanedRuns() {
    const now = new Date().toISOString();
    this.db.prepare(`update agent_runs set status = 'cancelled', active_started_at = null, waiting_started_at = null,
      completed_at = ?, updated_at = ? where status in ('routing', 'planning', 'responding', 'executing')`).run(now, now);
  }

  private fromRow(row: any): AgentRunRecord {
    const run: AgentRunRecord = {
      runId: row.run_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      userId: row.user_id,
      attempt: Number(row.attempt),
      status: row.status,
      reasoningModelName: row.reasoning_model_name,
      executionModelName: row.execution_model_name,
      route: parseJson(row.route_json, undefined),
      analysisPlan: parseJson(row.analysis_plan_json, undefined),
      thinkingDecision: parseJson(row.thinking_decision_json, undefined),
      kimiCallCount: Number(row.kimi_call_count ?? 0),
      cumulativeThinkingBudget: Number(row.cumulative_thinking_budget ?? 0),
      plan: parseJson(row.plan_json, undefined),
      currentStepId: row.current_step_id ?? undefined,
      completedStepIds: parseJson(row.completed_step_ids_json, []),
      failedStepIds: parseJson(row.failed_step_ids_json, []),
      activeDurationMs: Number(row.active_duration_ms ?? 0),
      waitingDurationMs: Number(row.waiting_duration_ms ?? 0),
      activeStartedAt: row.active_started_at ?? undefined,
      waitingStartedAt: row.waiting_started_at ?? undefined,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
      input: parseJson(row.input_json, undefined),
      error: parseJson(row.error_json, undefined),
      events: [],
    };
    run.events = this.events(run.runId);
    return run;
  }

  private ensureColumn(table: string, column: string, type: string) {
    const columns = this.db.prepare(`pragma table_info(${table})`).all() as Array<{ name?: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`alter table ${table} add column ${column} ${type}`);
    }
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
