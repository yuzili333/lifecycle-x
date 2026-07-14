import type {
  ChartRenderingToolInput,
  ExecuteSingleToolInput,
  PythonAnalysisToolInput,
  ReportGenerationToolInput,
  ResolvedToolInput,
  ResolveToolApprovalInput,
  SqlQueryToolInput,
  ToolBridgeOutput,
  ToolCallRecord,
  ToolExecutionEvent,
  ToolExecutionPlan,
  ToolExecutionPlanStep,
  ToolKind,
  ToolOrchestrationModuleConfig,
} from "./types";
import { TOOL_NAMES, TOOL_SCHEMAS } from "./types";
import { ToolDependencyResolver, ToolPlanBuilder, ToolPlanValidator } from "./plan";
import { ToolInputResolver } from "./inputResolver";
import { createId, nowIso, toolError, unique } from "./utils";

type ExecutionEngineConfig = ToolOrchestrationModuleConfig & {
  emit?: (event: ToolExecutionEvent) => void;
};

export class ToolExecutionEngine {
  private readonly validator = new ToolPlanValidator();
  private readonly dependencyResolver = new ToolDependencyResolver(this.validator);
  private readonly inputResolver: ToolInputResolver;

  constructor(private readonly config: ExecutionEngineConfig) {
    this.inputResolver = new ToolInputResolver(config.resultRegistry);
  }

  async executePlan(plan: ToolExecutionPlan) {
    this.validator.validate(plan);
    this.emit({ type: "plan_created", planId: plan.planId });
    const orderedSteps = this.dependencyResolver.order(plan);
    const completedStepRecords = new Map<string, ToolCallRecord>();
    const failedStepIds = new Set<string>();
    const waitingApprovalStepIds = new Set<string>();
    const waitingInputStepIds = new Set<string>();
    let hasFailure = false;
    let hasWaitingApproval = false;
    let hasWaitingInput = false;

    for (const step of orderedSteps) {
      if (step.dependencies.some((dependency) => failedStepIds.has(dependency))) {
        const blocked = await this.createRecord(plan, step, { mode: "no_input", reason: "上游依赖失败，当前步骤被阻断。" }, "blocked");
        failedStepIds.add(step.stepId);
        hasFailure = true;
        this.emit({ type: "tool_call_failed", toolCallId: blocked.toolCallId, error: blocked.error ?? toolError("TOOL_EXECUTION_FAILED", "上游依赖失败。") });
        continue;
      }
      if (step.dependencies.some((dependency) => waitingApprovalStepIds.has(dependency))) {
        await this.createRecord(plan, step, { mode: "no_input", reason: "上游依赖正在等待审批，当前步骤暂不执行。" }, "blocked");
        waitingApprovalStepIds.add(step.stepId);
        hasWaitingApproval = true;
        continue;
      }
      if (step.dependencies.some((dependency) => waitingInputStepIds.has(dependency))) {
        await this.createRecord(plan, step, { mode: "no_input", reason: "上游依赖缺少输入，当前步骤暂不执行。" }, "blocked");
        waitingInputStepIds.add(step.stepId);
        hasWaitingInput = true;
        continue;
      }

      const dependencyInput = this.inputFromDependencies(step, completedStepRecords);
      const resolvedInput = dependencyInput ?? await this.inputResolver.resolve({
        conversationId: plan.conversationId,
        toolKind: step.toolKind,
        explicitInputRefs: step.explicitInputRefs,
      });
      if (resolvedInput.mode === "no_input" && step.toolKind !== "sql_query" && step.toolKind !== "report_generation") {
        await this.createRecord(plan, step, resolvedInput, "waiting_input");
        waitingInputStepIds.add(step.stepId);
        hasWaitingInput = true;
        continue;
      }

      const started = await this.createRecord(plan, step, resolvedInput, "executing");
      this.emit({ type: "tool_call_started", toolCallId: started.toolCallId, toolKind: step.toolKind });
      try {
        const bridgeOutput = await this.executeBridge(plan, step, started, resolvedInput);
        const status = bridgeOutput.status;
        if (status === "waiting_approval") {
          const waiting = await this.config.resultRegistry.update(started.toolCallId, {
            status,
            result: resultRef(started.toolCallId, step.toolKind, bridgeOutput),
            outputArtifactIds: bridgeOutput.artifactIds,
          });
          this.emit({ type: "tool_call_waiting_approval", toolCallId: waiting.toolCallId });
          waitingApprovalStepIds.add(step.stepId);
          hasWaitingApproval = true;
          continue;
        }
        if (status !== "completed") {
          throw toolError("TOOL_EXECUTION_FAILED", `工具返回非完成状态：${status}`, { conversationId: plan.conversationId, planId: plan.planId, toolCallId: started.toolCallId });
        }
        const completed = await this.config.resultRegistry.update(started.toolCallId, {
          status: "completed",
          result: resultRef(started.toolCallId, step.toolKind, bridgeOutput),
          outputArtifactIds: bridgeOutput.artifactIds,
          parentToolCallIds: unique([...(started.parentToolCallIds ?? []), ...(resolvedInput.sourceToolCallId ? [resolvedInput.sourceToolCallId] : [])]),
          sourceArtifactIds: resolvedInput.sourceArtifactIds,
          completedAt: nowIso(),
          metadata: { ...started.metadata, ...bridgeOutput.metadata },
        });
        completedStepRecords.set(step.stepId, completed);
        await this.writeMemory(plan, completed);
        this.emit({ type: "tool_call_completed", toolCallId: completed.toolCallId, artifactIds: completed.outputArtifactIds ?? [] });
      } catch (error) {
        const normalized = isToolCallError(error)
          ? error
          : toolError("TOOL_EXECUTION_FAILED", error instanceof Error ? error.message : "工具执行失败。", {
              conversationId: plan.conversationId,
              planId: plan.planId,
              toolCallId: started.toolCallId,
            });
        await this.config.resultRegistry.update(started.toolCallId, { status: "failed", error: normalized, completedAt: nowIso() });
        failedStepIds.add(step.stepId);
        hasFailure = true;
        this.emit({ type: "tool_call_failed", toolCallId: started.toolCallId, error: normalized! });
      }
    }

    if (hasFailure) {
      this.emit({ type: "plan_failed", planId: plan.planId });
    } else if (!hasWaitingApproval && !hasWaitingInput) {
      this.emit({ type: "plan_completed", planId: plan.planId });
    }
    const status = hasFailure ? "failed" as const : hasWaitingApproval ? "waiting_approval" as const : hasWaitingInput ? "draft" as const : "completed" as const;
    return {
      ...plan,
      status,
      updatedAt: nowIso(),
    };
  }

  async executeSingleTool(input: ExecuteSingleToolInput) {
    const builder = new ToolPlanBuilder();
    const plan = builder.build({
      conversationId: input.conversationId,
      userId: input.userId,
      userMessage: input.userMessage,
      intentResult: {
        conversationId: input.conversationId,
        userMessage: input.userMessage,
        intents: [{
          toolKind: input.toolKind,
          action: "create",
          purpose: input.purpose ?? input.userMessage,
          confidence: 1,
        }],
        requiresClarification: false,
        confidence: 1,
      },
    });
    if (input.request) {
      plan.steps[0].requestedChanges = input.request;
    }
    return this.executePlan(plan);
  }

  async resolveWaitingApproval(input: ResolveToolApprovalInput) {
    const record = await this.config.resultRegistry.get(input.toolCallId);
    if (!record) {
      throw toolError("TOOL_RESULT_NOT_FOUND", `工具调用不存在：${input.toolCallId}`, { toolCallId: input.toolCallId });
    }
    if (record.status !== "waiting_approval") {
      throw toolError("TOOL_RESULT_INCOMPATIBLE", `工具调用当前状态不是等待审批：${record.status}`, {
        conversationId: record.conversationId,
        toolCallId: record.toolCallId,
      });
    }
    if (input.userId && input.userId !== record.userId) {
      throw toolError("TOOL_INPUT_PERMISSION_DENIED", "当前用户无权审批该工具调用。", {
        conversationId: record.conversationId,
        toolCallId: record.toolCallId,
      });
    }
    if (!input.approved) {
      const rejected = await this.config.resultRegistry.update(record.toolCallId, {
        status: "rejected",
        completedAt: nowIso(),
        error: toolError("TOOL_APPROVAL_REQUIRED", "用户拒绝执行该工具调用。", {
          conversationId: record.conversationId,
          toolCallId: record.toolCallId,
          recoverable: false,
        }),
      });
      this.emit({ type: "tool_call_failed", toolCallId: rejected.toolCallId, error: rejected.error! });
      return rejected;
    }

    const approvedAt = nowIso();
    const approved = await this.config.resultRegistry.update(record.toolCallId, {
      status: "approved",
      request: {
        ...record.request,
        ...(input.requestPatch ?? {}),
        approvalStatus: "approved",
        approvedAt,
      },
      metadata: {
        ...record.metadata,
        approvalStatus: "approved",
        approvedAt,
      },
    });
    const executing = await this.config.resultRegistry.update(approved.toolCallId, { status: "executing" });
    this.emit({ type: "tool_call_started", toolCallId: executing.toolCallId, toolKind: executing.toolKind });

    const plan = planFromRecord(executing);
    const step = stepFromRecord(executing);
    const resolvedInput = executing.resolvedInput ?? { mode: "no_input", reason: "审批恢复时未找到已解析输入。" };
    try {
      const bridgeOutput = await this.executeBridge(plan, step, executing, resolvedInput);
      if (bridgeOutput.status === "waiting_approval") {
        const waiting = await this.config.resultRegistry.update(executing.toolCallId, {
          status: "waiting_approval",
          result: resultRef(executing.toolCallId, executing.toolKind, bridgeOutput),
          outputArtifactIds: bridgeOutput.artifactIds,
        });
        this.emit({ type: "tool_call_waiting_approval", toolCallId: waiting.toolCallId });
        return waiting;
      }
      if (bridgeOutput.status !== "completed") {
        throw toolError("TOOL_EXECUTION_FAILED", `工具返回非完成状态：${bridgeOutput.status}`, {
          conversationId: executing.conversationId,
          toolCallId: executing.toolCallId,
        });
      }
      const completed = await this.config.resultRegistry.update(executing.toolCallId, {
        status: "completed",
        result: resultRef(executing.toolCallId, executing.toolKind, bridgeOutput),
        outputArtifactIds: bridgeOutput.artifactIds,
        parentToolCallIds: unique([...(executing.parentToolCallIds ?? []), ...(resolvedInput.sourceToolCallId ? [resolvedInput.sourceToolCallId] : [])]),
        sourceArtifactIds: resolvedInput.sourceArtifactIds,
        completedAt: nowIso(),
        metadata: { ...executing.metadata, ...bridgeOutput.metadata },
      });
      await this.writeMemory(plan, completed);
      this.emit({ type: "tool_call_completed", toolCallId: completed.toolCallId, artifactIds: completed.outputArtifactIds ?? [] });
      return completed;
    } catch (error) {
      const normalized = isToolCallError(error)
        ? error
        : toolError("TOOL_EXECUTION_FAILED", error instanceof Error ? error.message : "工具执行失败。", {
            conversationId: executing.conversationId,
            toolCallId: executing.toolCallId,
          });
      const failed = await this.config.resultRegistry.update(executing.toolCallId, { status: "failed", error: normalized, completedAt: nowIso() });
      this.emit({ type: "tool_call_failed", toolCallId: failed.toolCallId, error: normalized });
      return failed;
    }
  }

  private async createRecord(plan: ToolExecutionPlan, step: ToolExecutionPlanStep, resolvedInput: ResolvedToolInput, status: ToolCallRecord["status"]) {
    const previousRecords = (await this.config.resultRegistry.listByConversation(plan.conversationId)).filter((record) => record.toolKind === step.toolKind);
    const previousRecord = previousRecords.at(-1);
    const version = previousRecords.length + 1;
    const createdAt = nowIso();
    const request = {
      ...(step.requestedChanges ?? {}),
      userRequest: plan.userMessage,
      purpose: step.purpose,
      requestedChanges: step.requestedChanges,
    };
    const delta = previousRecord ? requestDelta(previousRecord.request, request) : null;
    const record: ToolCallRecord = {
      toolCallId: createId(toolPrefix(step.toolKind)),
      conversationId: plan.conversationId,
      messageId: plan.userMessageId,
      userId: plan.userId,
      toolKind: step.toolKind,
      toolName: step.toolName,
      status,
      request,
      resolvedInput,
      parentToolCallIds: resolvedInput.sourceToolCallId ? [resolvedInput.sourceToolCallId] : [],
      sourceArtifactIds: resolvedInput.sourceArtifactIds,
      outputArtifactIds: [],
      version,
      isLatestSuccessful: false,
      createdAt,
      updatedAt: createdAt,
      error: status === "blocked" ? toolError("TOOL_EXECUTION_FAILED", resolvedInput.reason, { conversationId: plan.conversationId, planId: plan.planId }) : undefined,
      metadata: {
        planId: plan.planId,
        stepId: step.stepId,
        previousToolCallId: previousRecord?.toolCallId,
        changedRequestKeys: delta?.changedKeys,
        requestDeltaSummary: delta?.summary,
      },
    };
    await this.config.resultRegistry.register(record);
    return record;
  }

  private inputFromDependencies(step: ToolExecutionPlanStep, completedStepRecords: Map<string, ToolCallRecord>): ResolvedToolInput | null {
    const parents = step.dependencies.map((dependency) => completedStepRecords.get(dependency)).filter((record): record is ToolCallRecord => Boolean(record));
    if (parents.length === 0) {
      return null;
    }
    return {
      mode: "latest_result",
      sourceToolKind: parents.at(-1)?.toolKind,
      sourceToolCallId: parents.at(-1)?.toolCallId,
      sourceArtifactIds: unique(parents.flatMap((record) => record.outputArtifactIds ?? [])),
      reason: "当前步骤使用同一执行计划中上游工具的成功结果。",
    };
  }

  private async executeBridge(plan: ToolExecutionPlan, step: ToolExecutionPlanStep, record: ToolCallRecord, resolvedInput: ResolvedToolInput): Promise<ToolBridgeOutput> {
    const context = {
      conversationId: plan.conversationId,
      userId: plan.userId,
      planId: plan.planId,
      stepId: step.stepId,
      toolCallId: record.toolCallId,
      version: record.version,
      resolvedInput,
    };
    const request = record.request;
    if (step.toolKind === "sql_query") {
      return this.config.sqlBridge.execute({ ...request, purpose: step.purpose, userRequest: plan.userMessage } as SqlQueryToolInput, context);
    }
    if (step.toolKind === "python_analysis") {
      return this.config.pythonBridge.execute({
        ...request,
        purpose: step.purpose,
        userRequest: plan.userMessage,
        inputArtifactIds: resolvedInput.sourceArtifactIds,
        sourceSqlToolCallId: resolvedInput.sourceToolKind === "sql_query" ? resolvedInput.sourceToolCallId : undefined,
      } as PythonAnalysisToolInput, context);
    }
    if (step.toolKind === "chart_rendering") {
      return this.config.chartBridge.execute({
        ...request,
        purpose: step.purpose,
        userRequest: plan.userMessage,
        inputArtifactIds: resolvedInput.sourceArtifactIds,
        sourceSqlToolCallId: resolvedInput.sourceToolKind === "sql_query" ? resolvedInput.sourceToolCallId : undefined,
        sourcePythonToolCallId: resolvedInput.sourceToolKind === "python_analysis" ? resolvedInput.sourceToolCallId : undefined,
      } as ChartRenderingToolInput, context);
    }
    return this.config.reportBridge.execute({
      ...request,
      purpose: step.purpose,
      userRequest: plan.userMessage,
      inputArtifactIds: resolvedInput.sourceArtifactIds,
      sourceSqlToolCallId: resolvedInput.sourceToolKind === "sql_query" ? resolvedInput.sourceToolCallId : undefined,
      sourcePythonToolCallId: resolvedInput.sourceToolKind === "python_analysis" ? resolvedInput.sourceToolCallId : undefined,
    } as ReportGenerationToolInput, context);
  }

  private async writeMemory(plan: ToolExecutionPlan, record: ToolCallRecord) {
    if (!this.config.memoryBridge) {
      return;
    }
    await this.config.memoryBridge.write({
      conversationId: plan.conversationId,
      userId: plan.userId,
      type: `${record.toolKind}_completed`,
      summary: record.result?.summary ?? `${record.toolName} v${record.version} 已完成。`,
      toolCallId: record.toolCallId,
      artifactIds: record.outputArtifactIds,
      version: record.version,
      lineage: {
        toolCallId: record.toolCallId,
        parentToolCallIds: record.parentToolCallIds ?? [],
        sourceArtifactIds: record.sourceArtifactIds ?? [],
        outputArtifactIds: record.outputArtifactIds ?? [],
      },
    });
  }

  private emit(event: ToolExecutionEvent) {
    this.config.emit?.(event);
  }
}

function resultRef(toolCallId: string, toolKind: ToolKind, output: ToolBridgeOutput) {
  return {
    resultId: createId("result"),
    toolKind,
    artifactIds: output.artifactIds,
    primaryArtifactId: output.primaryArtifactId,
    summary: output.summary,
    createdAt: nowIso(),
    metadata: { toolCallId, ...output.metadata },
  };
}

function toolPrefix(toolKind: ToolKind) {
  if (toolKind === "sql_query") {
    return "sql";
  }
  if (toolKind === "python_analysis") {
    return "python";
  }
  if (toolKind === "chart_rendering") {
    return "chart";
  }
  return "report";
}

function planFromRecord(record: ToolCallRecord): ToolExecutionPlan {
  const createdAt = nowIso();
  return {
    planId: typeof record.metadata?.planId === "string" ? record.metadata.planId : `approval_resume_${record.toolCallId}`,
    conversationId: record.conversationId,
    userMessageId: record.messageId,
    userId: record.userId,
    userMessage: typeof record.request.userRequest === "string" ? record.request.userRequest : "",
    steps: [],
    status: "executing",
    createdAt,
    updatedAt: createdAt,
  };
}

function stepFromRecord(record: ToolCallRecord): ToolExecutionPlanStep {
  return {
    stepId: typeof record.metadata?.stepId === "string" ? record.metadata.stepId : record.toolCallId,
    toolKind: record.toolKind,
    toolName: record.toolName,
    purpose: typeof record.request.purpose === "string" ? record.request.purpose : record.toolName,
    dependencies: [],
    inputStrategy: "explicit",
    status: "approved",
    requestedChanges: record.request,
  };
}

function requestDelta(previous: Record<string, unknown>, next: Record<string, unknown>) {
  const ignoredKeys = new Set(["requestedChanges"]);
  const keys = unique([...Object.keys(previous), ...Object.keys(next)]).filter((key) => !ignoredKeys.has(key));
  const changedKeys = keys.filter((key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(next[key] ?? null));
  if (changedKeys.length === 0) {
    return { changedKeys: [], summary: "本次调用与上一版本请求参数无显著差异。" };
  }
  return {
    changedKeys,
    summary: `相对上一版本调整了 ${changedKeys.join(", ")}。`,
  };
}

function isToolCallError(error: unknown): error is NonNullable<ToolCallRecord["error"]> {
  return Boolean(error && typeof error === "object" && "code" in error && "message" in error && "traceId" in error);
}

export function registerOrchestrationTools(toolRegistry: import("../streamingModelAdapter").ToolRegistry, engine: ToolExecutionEngine, userContext: { conversationId: string; userId: string; userMessage: string }) {
  for (const [toolKind, toolName] of Object.entries(TOOL_NAMES) as Array<[ToolKind, string]>) {
    toolRegistry.registerTool({
      name: toolName,
      description: `${toolName} 是 Cycle Probe 会话级工具编排中的独立工具。`,
      inputSchema: TOOL_SCHEMAS[toolKind],
      handler: async (input) => engine.executeSingleTool({
        conversationId: userContext.conversationId,
        userId: userContext.userId,
        userMessage: userContext.userMessage,
        toolKind,
        request: input as Record<string, unknown>,
      }),
    });
  }
}
