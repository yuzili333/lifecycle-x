import type { ToolKind } from "../toolOrchestration";

export type AgentModelRole = "reasoning" | "execution";
export type AgentRunStatus =
  | "planning"
  | "responding"
  | "clarifying"
  | "executing"
  | "waiting_approval"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type AgentProgressPhase =
  | "accepted"
  | "planning"
  | "plan_ready"
  | "responding"
  | "clarifying"
  | "preparing_step"
  | "validating_parameters"
  | "waiting_approval"
  | "tool_executing"
  | "step_completed"
  | "step_failed"
  | "fallback"
  | "completed"
  | "failed"
  | "cancelled";

export type PlannerOutcome = "execute" | "respond" | "clarify";
export type PlannerRequestedOutput = "query" | "analysis" | "chart" | "report";

export type PlannerStep = {
  stepId: string;
  toolKind: ToolKind;
  purpose: string;
  dependencies: string[];
  inputResolution: "selected_data_source" | "current_run" | "conversation_history" | "artifact_lineage";
  expectedOutput: string;
};

export type PlannerDecision = {
  outcome: PlannerOutcome;
  summary: string;
  responseText?: string;
  requestedOutputs: PlannerRequestedOutput[];
  steps: PlannerStep[];
};

export type AgentProgressEvent = {
  eventId: string;
  runId: string;
  conversationId: string;
  messageId: string;
  phase: AgentProgressPhase;
  status: "info" | "running" | "waiting" | "success" | "error" | "cancelled";
  summary: string;
  createdAt: string;
  stepId?: string;
  toolCallId?: string;
  modelRole?: AgentModelRole;
  activeDurationMs?: number;
  waitingDurationMs?: number;
  detail?: Record<string, unknown>;
};

export type AgentRunError = {
  code: string;
  phase: AgentProgressPhase;
  message: string;
  recoverable: boolean;
  traceId: string;
  stepId?: string;
  toolCallId?: string;
  retryTrace: string[];
  fallbackTrace: string[];
  conflictTrace: string[];
};

export type AgentRunRecord = {
  runId: string;
  conversationId: string;
  messageId: string;
  userId: string;
  attempt: number;
  status: AgentRunStatus;
  reasoningModelName: string;
  executionModelName: string;
  plan?: PlannerDecision;
  currentStepId?: string;
  completedStepIds: string[];
  failedStepIds: string[];
  activeDurationMs: number;
  waitingDurationMs: number;
  activeStartedAt?: string;
  waitingStartedAt?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  input?: Record<string, unknown>;
  error?: AgentRunError;
  events: AgentProgressEvent[];
};

export type CreateAgentRunInput = Pick<
  AgentRunRecord,
  "runId" | "conversationId" | "messageId" | "userId" | "attempt" | "reasoningModelName" | "executionModelName"
> & {
  input?: Record<string, unknown>;
};

export type AgentStepExecutionResult = {
  status: "completed" | "waiting_approval" | "failed";
  toolCallId?: string;
  summary?: string;
  error?: AgentRunError;
};

export type AgentRunWithEvents = AgentRunRecord;
