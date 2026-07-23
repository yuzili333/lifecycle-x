import { randomUUID } from "node:crypto";
import type { SQLiteAgentProgressStore } from "./progressStore";
import type {
  AgentModelRole,
  AgentProgressEvent,
  AgentProgressPhase,
  AgentRunError,
  AgentRunRecord,
  AgentRunStatus,
  CreateAgentRunInput,
  PlannerDecision,
  PlannerStep,
} from "./types";

type ProgressEmitter = (event: AgentProgressEvent, run: AgentRunRecord) => void;

export class AgentTurnOrchestrator {
  constructor(private readonly store: SQLiteAgentProgressStore, private readonly emit: ProgressEmitter) {}

  start(input: CreateAgentRunInput) {
    const run = this.store.create(input);
    return this.progress(run.runId, {
      phase: "planning",
      status: "running",
      summary: "思考中",
      modelRole: "reasoning",
    });
  }

  planReady(runId: string, plan: PlannerDecision) {
    this.store.update(runId, { plan, status: "executing" });
    return this.progress(runId, {
      phase: "plan_ready",
      status: "success",
      summary: plan.summary,
      modelRole: "reasoning",
      detail: {
        requestedOutputs: plan.requestedOutputs,
        steps: plan.steps.map((step) => ({ stepId: step.stepId, toolKind: step.toolKind, purpose: step.purpose, dependencies: step.dependencies })),
      },
    });
  }

  responding(runId: string, summary: string) {
    this.transition(runId, "responding");
    return this.progress(runId, { phase: "responding", status: "running", summary, modelRole: "reasoning" });
  }

  clarifying(runId: string, summary: string) {
    this.transition(runId, "clarifying");
    return this.progress(runId, { phase: "clarifying", status: "success", summary, modelRole: "reasoning" });
  }

  preparingStep(runId: string, step: PlannerStep) {
    this.transition(runId, "executing", { currentStepId: step.stepId });
    return this.progress(runId, {
      phase: "preparing_step",
      status: "running",
      summary: `${toolLabel(step.toolKind)}：正在生成受控工具参数。`,
      stepId: step.stepId,
      modelRole: "execution",
      detail: { purpose: step.purpose, expectedOutput: step.expectedOutput },
    });
  }

  validatingParameters(runId: string, step: PlannerStep, toolCallId?: string) {
    return this.progress(runId, {
      phase: "validating_parameters",
      status: "running",
      summary: `${toolLabel(step.toolKind)}：正在进行本地参数校验。`,
      stepId: step.stepId,
      toolCallId,
      modelRole: "execution",
    });
  }

  toolExecuting(runId: string, step: PlannerStep, toolCallId?: string) {
    return this.progress(runId, {
      phase: "tool_executing",
      status: "running",
      summary: `${toolLabel(step.toolKind)}：参数已确认，正在执行。`,
      stepId: step.stepId,
      toolCallId,
      modelRole: "execution",
    });
  }

  waitingApproval(runId: string, step: PlannerStep, toolCallId?: string) {
    this.transition(runId, "waiting_approval", { currentStepId: step.stepId });
    return this.progress(runId, {
      phase: "waiting_approval",
      status: "waiting",
      summary: `${toolLabel(step.toolKind)}：参数已生成，等待用户审批。`,
      stepId: step.stepId,
      toolCallId,
      modelRole: "execution",
    });
  }

  resumeAfterApproval(runId: string, step: PlannerStep, toolCallId?: string) {
    this.transition(runId, "executing", { currentStepId: step.stepId });
    return this.progress(runId, {
      phase: "tool_executing",
      status: "running",
      summary: `${toolLabel(step.toolKind)}：审批通过，继续执行。`,
      stepId: step.stepId,
      toolCallId,
      modelRole: "execution",
    });
  }

  stepCompleted(runId: string, step: PlannerStep, toolCallId?: string, summary?: string) {
    const run = this.requiredRun(runId);
    this.store.update(runId, {
      completedStepIds: unique([...run.completedStepIds, step.stepId]),
      currentStepId: null,
    });
    return this.progress(runId, {
      phase: "step_completed",
      status: "success",
      summary: summary?.trim() || `${toolLabel(step.toolKind)}已完成。`,
      stepId: step.stepId,
      toolCallId,
      modelRole: "execution",
    });
  }

  stepFailed(runId: string, step: PlannerStep, error: AgentRunError) {
    const run = this.requiredRun(runId);
    this.store.update(runId, {
      failedStepIds: unique([...run.failedStepIds, step.stepId]),
      currentStepId: null,
      error,
    });
    return this.progress(runId, {
      phase: "step_failed",
      status: "error",
      summary: `${toolLabel(step.toolKind)}失败：${error.message}`,
      stepId: step.stepId,
      toolCallId: error.toolCallId,
      modelRole: "execution",
      detail: { code: error.code, recoverable: error.recoverable, traceId: error.traceId },
    });
  }

  fallback(runId: string, summary: string, detail?: Record<string, unknown>) {
    return this.progress(runId, { phase: "fallback", status: "info", summary, detail });
  }

  finish(runId: string, summary: string) {
    const current = this.requiredRun(runId);
    const status: AgentRunStatus = current.failedStepIds.length > 0 && current.completedStepIds.length > 0
      ? "partial"
      : current.failedStepIds.length > 0
        ? "failed"
        : "completed";
    this.transition(runId, status, { currentStepId: null, completedAt: new Date().toISOString() });
    return this.progress(runId, {
      phase: status === "failed" ? "failed" : "completed",
      status: status === "failed" ? "error" : "success",
      summary,
    });
  }

  fail(runId: string, error: AgentRunError) {
    this.transition(runId, "failed", { error, completedAt: new Date().toISOString(), currentStepId: null });
    return this.progress(runId, {
      phase: "failed",
      status: "error",
      summary: error.message,
      stepId: error.stepId,
      toolCallId: error.toolCallId,
      detail: { code: error.code, traceId: error.traceId, recoverable: error.recoverable },
    });
  }

  cancel(runId: string, summary = "用户已停止本轮任务。") {
    const run = this.store.get(runId);
    if (!run || isTerminal(run.status)) return run;
    this.transition(runId, "cancelled", { completedAt: new Date().toISOString(), currentStepId: null });
    return this.progress(runId, { phase: "cancelled", status: "cancelled", summary });
  }

  progress(runId: string, input: {
    phase: AgentProgressPhase;
    status: AgentProgressEvent["status"];
    summary: string;
    stepId?: string;
    toolCallId?: string;
    modelRole?: AgentModelRole;
    detail?: Record<string, unknown>;
  }) {
    const run = this.requiredRun(runId);
    const durations = currentDurations(run);
    const event: AgentProgressEvent = {
      eventId: randomUUID(),
      runId,
      conversationId: run.conversationId,
      messageId: run.messageId,
      phase: input.phase,
      status: input.status,
      summary: input.summary,
      createdAt: new Date().toISOString(),
      stepId: input.stepId,
      toolCallId: input.toolCallId,
      modelRole: input.modelRole,
      activeDurationMs: durations.activeDurationMs,
      waitingDurationMs: durations.waitingDurationMs,
      detail: sanitizeDetail(input.detail),
    };
    this.store.append(event);
    const next = this.requiredRun(runId);
    this.emit(event, next);
    return next;
  }

  private transition(runId: string, status: AgentRunStatus, patch: Parameters<SQLiteAgentProgressStore["update"]>[1] = {}) {
    const run = this.requiredRun(runId);
    const now = new Date();
    const durations = currentDurations(run, now.getTime());
    const nextActive = isActive(status) ? now.toISOString() : null;
    const nextWaiting = status === "waiting_approval" ? now.toISOString() : null;
    return this.store.update(runId, {
      ...patch,
      status,
      activeDurationMs: durations.activeDurationMs,
      waitingDurationMs: durations.waitingDurationMs,
      activeStartedAt: nextActive,
      waitingStartedAt: nextWaiting,
    });
  }

  private requiredRun(runId: string) {
    const run = this.store.get(runId);
    if (!run) throw new Error(`Agent Run 不存在：${runId}`);
    return run;
  }
}

export function currentDurations(run: AgentRunRecord, nowMs = Date.now()) {
  const activeSegment = run.activeStartedAt ? Math.max(0, nowMs - Date.parse(run.activeStartedAt)) : 0;
  const waitingSegment = run.waitingStartedAt ? Math.max(0, nowMs - Date.parse(run.waitingStartedAt)) : 0;
  return {
    activeDurationMs: run.activeDurationMs + activeSegment,
    waitingDurationMs: run.waitingDurationMs + waitingSegment,
  };
}

export function agentRunError(input: Partial<AgentRunError> & Pick<AgentRunError, "code" | "phase" | "message">): AgentRunError {
  return {
    code: input.code,
    phase: input.phase,
    message: input.message,
    recoverable: input.recoverable ?? false,
    traceId: input.traceId ?? randomUUID(),
    stepId: input.stepId,
    toolCallId: input.toolCallId,
    retryTrace: input.retryTrace ?? [],
    fallbackTrace: input.fallbackTrace ?? [],
    conflictTrace: input.conflictTrace ?? [],
  };
}

function currentSegment(startedAt?: string) {
  return startedAt ? Math.max(0, Date.now() - Date.parse(startedAt)) : 0;
}

function isActive(status: AgentRunStatus) {
  return status === "planning" || status === "responding" || status === "executing";
}

function isTerminal(status: AgentRunStatus) {
  return status === "completed" || status === "partial" || status === "failed" || status === "cancelled";
}

function toolLabel(toolKind: PlannerStep["toolKind"]) {
  if (toolKind === "sql_query") return "SQL 查询";
  if (toolKind === "python_analysis") return "Python 分析";
  if (toolKind === "chart_rendering") return "绘制图表";
  return "生成报告";
}

function sanitizeDetail(detail?: Record<string, unknown>) {
  if (!detail) return undefined;
  const blocked = /api.?key|authorization|password|connection|string|script|sql|rows|content/i;
  return Object.fromEntries(Object.entries(detail).filter(([key]) => !blocked.test(key)));
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
