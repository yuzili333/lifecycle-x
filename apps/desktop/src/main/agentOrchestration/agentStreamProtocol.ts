import type { AgentProgressEvent, AgentProgressPhase } from "./types";

export type AgentBusinessEventType =
  | "task.accepted"
  | "task.summary.delta"
  | "routing.completed"
  | "planning.started"
  | "planning.progress"
  | "plan.completed"
  | "tool.started"
  | "tool.progress"
  | "tool.completed"
  | "validation.completed"
  | "report.delta"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentBusinessEvent = {
  type: AgentBusinessEventType;
  taskId: string;
  conversationId: string;
  messageId: string;
  timestamp: number;
  summary?: string;
  stepId?: string;
  toolCallId?: string;
  detail?: Record<string, unknown>;
};

export function progressPhaseToBusinessEventType(phase: AgentProgressPhase): AgentBusinessEventType {
  if (phase === "accepted") return "task.accepted";
  if (phase === "routing") return "task.summary.delta";
  if (phase === "routing_completed") return "routing.completed";
  if (phase === "planning") return "planning.progress";
  if (phase === "plan_ready") return "plan.completed";
  if (phase === "preparing_step") return "tool.started";
  if (phase === "validating_parameters" || phase === "waiting_approval" || phase === "tool_executing") return "tool.progress";
  if (phase === "step_completed") return "tool.completed";
  if (phase === "validation_completed") return "validation.completed";
  if (phase === "reporting") return "report.delta";
  if (phase === "completed") return "completed";
  if (phase === "cancelled") return "cancelled";
  if (phase === "failed" || phase === "step_failed") return "failed";
  return "planning.progress";
}

export function toAgentBusinessEvent(event: AgentProgressEvent): AgentBusinessEvent {
  return {
    type: event.businessEventType ?? progressPhaseToBusinessEventType(event.phase),
    taskId: event.runId,
    conversationId: event.conversationId,
    messageId: event.messageId,
    timestamp: Date.parse(event.createdAt),
    summary: event.summary,
    stepId: event.stepId,
    toolCallId: event.toolCallId,
    detail: event.detail,
  };
}

export function validateAgentBusinessEvent(value: unknown): value is AgentBusinessEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const allowed = new Set<AgentBusinessEventType>([
    "task.accepted", "task.summary.delta", "routing.completed", "planning.started", "planning.progress",
    "plan.completed", "tool.started", "tool.progress", "tool.completed", "validation.completed",
    "report.delta", "completed", "failed", "cancelled",
  ]);
  return (
    typeof event.type === "string" &&
    allowed.has(event.type as AgentBusinessEventType) &&
    typeof event.taskId === "string" &&
    typeof event.conversationId === "string" &&
    typeof event.messageId === "string" &&
    typeof event.timestamp === "number" &&
    Number.isFinite(event.timestamp)
  );
}
