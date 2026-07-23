import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentProgressEvent, AgentRunRecord } from "./agentOrchestration";
import { AgentProgressPanel, formatDurationMs, isActiveAgentRun, shouldShowMessageMetadataStatus } from "../renderer/src/DataAssistantWorkspace";

describe("AgentProgressPanel", () => {
  it("renders structured progress while a run is active", () => {
    const run = createRun("executing", [
      createEvent("planning", "running", "正在识别任务目标并规划工具执行顺序。"),
      createEvent("plan_ready", "success", "执行查询和分析。"),
      createEvent("preparing_step", "running", "SQL 查询：正在生成受控工具参数。", "query"),
    ]);

    const html = renderToStaticMarkup(<AgentProgressPanel run={run} />);

    expect(isActiveAgentRun(run)).toBe(true);
    expect(html).toContain("Assistant 工作进度");
    expect(html).toContain("执行查询和分析。");
    expect(html).toContain('data-agent-run-status="executing"');
  });

  it("merges planning updates into one thinking record", () => {
    const run = createRun("planning", [
      createEvent("accepted", "running", "已接收任务，正在分析目标与可用数据。"),
      createEvent("planning", "running", "思考中"),
      createEvent("planning", "running", "思考中"),
    ]);

    const html = renderToStaticMarkup(<AgentProgressPanel run={run} />);

    expect(html.match(/思考中/g)).toHaveLength(1);
    expect(html).not.toContain("已接收任务，正在分析目标与可用数据。");
    expect(shouldShowMessageMetadataStatus(true, run)).toBe(false);
  });

  it("renders a completed run as a collapsible work record with active-only duration", () => {
    const run = createRun("completed", [
      createEvent("preparing_step", "running", "SQL 查询仍在执行。", "query"),
      createEvent("step_completed", "success", "SQL 查询已完成。", "query"),
      createEvent("completed", "success", "本轮 1 项任务已完成。"),
    ]);

    const html = renderToStaticMarkup(<AgentProgressPanel run={run} />);

    expect(isActiveAgentRun(run)).toBe(false);
    expect(formatDurationMs(125_000)).toBe("2m 5s");
    expect(html).toContain("Assistant 工作记录");
    expect(html).toContain("本轮 1 项任务已完成。");
    expect(html).not.toContain("SQL 查询仍在执行。");
    expect(html).not.toContain("assistant-message-status-spinner");
    expect(html).not.toContain("等待审批 45s");
    expect(shouldShowMessageMetadataStatus(true, run)).toBe(true);
  });
});

function createRun(status: AgentRunRecord["status"], events: AgentProgressEvent[]): AgentRunRecord {
  return {
    runId: "run-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    userId: "user-1",
    attempt: 1,
    status,
    reasoningModelName: "reasoning-model",
    executionModelName: "execution-model",
    completedStepIds: status === "completed" ? ["query"] : [],
    failedStepIds: [],
    activeDurationMs: 125_000,
    waitingDurationMs: 45_000,
    startedAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:03:00.000Z",
    events,
  };
}

function createEvent(
  phase: AgentProgressEvent["phase"],
  status: AgentProgressEvent["status"],
  summary: string,
  stepId?: string,
): AgentProgressEvent {
  return {
    eventId: `${phase}-${stepId ?? "run"}`,
    runId: "run-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    phase,
    status,
    summary,
    stepId,
    createdAt: "2026-07-23T00:00:00.000Z",
  };
}
