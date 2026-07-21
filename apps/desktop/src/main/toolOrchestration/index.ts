export * from "./types";
export * from "./registry";
export * from "./router";
export * from "./plan";
export * from "./inputResolver";
export * from "./engine";
export * from "./toolDefinitions";
export * from "./toolPrompts";

import { ToolExecutionEngine } from "./engine";
import { ToolInputResolver } from "./inputResolver";
import { ToolPlanBuilder, ToolPlanValidator } from "./plan";
import { ToolIntentRouter } from "./router";
import { toolError } from "./utils";
import type { ArtifactDependencyRef, BuildPlanInput, SelectHistoricalResultInput, ToolKind, ToolOrchestrationModuleConfig, ToolExecutionPlan } from "./types";

export function createToolOrchestrationModule(config: ToolOrchestrationModuleConfig) {
  const intentRouter = new ToolIntentRouter({
    resultRegistry: config.resultRegistry,
    intentModelAdapter: config.intentModelAdapter,
  });
  const planBuilder = new ToolPlanBuilder();
  const planValidator = new ToolPlanValidator();
  const inputResolver = new ToolInputResolver(config.resultRegistry);
  const executionEngine = new ToolExecutionEngine(config);

  return {
    detectIntent: (input: { conversationId: string; userMessage: string }) => intentRouter.detect(input),
    buildPlan: async (input: BuildPlanInput) => {
      const planningStartedAtMs = Date.now();
      const toolState = await config.resultRegistry.getConversationState(input.conversationId);
      const intentResult = input.intentResult ?? await intentRouter.detect({
        conversationId: input.conversationId,
        userMessage: input.userMessage,
      });
      return planBuilder.build({ ...input, intentResult, toolState, planningStartedAtMs });
    },
    validatePlan: (plan: ToolExecutionPlan) => planValidator.validate(plan),
    executePlan: (plan: ToolExecutionPlan) => executionEngine.executePlan(plan),
    executeSingleTool: (input: Parameters<ToolExecutionEngine["executeSingleTool"]>[0]) => executionEngine.executeSingleTool(input),
    resolveWaitingApproval: (input: Parameters<ToolExecutionEngine["resolveWaitingApproval"]>[0]) => executionEngine.resolveWaitingApproval(input),
    getConversationState: (conversationId: string) => config.resultRegistry.getConversationState(conversationId),
    getToolCall: (toolCallId: string) => config.resultRegistry.get(toolCallId),
    listToolCalls: (conversationId: string) => config.resultRegistry.listByConversation(conversationId),
    getLatestSqlResult: (conversationId: string) => config.resultRegistry.getLatestSuccessful(conversationId, "sql_query"),
    getLatestPythonResult: (conversationId: string) => config.resultRegistry.getLatestSuccessful(conversationId, "python_analysis"),
    getLatestChartResult: (conversationId: string) => config.resultRegistry.getLatestSuccessful(conversationId, "chart_rendering"),
    getLatestReportResult: (conversationId: string) => config.resultRegistry.getLatestSuccessful(conversationId, "report_generation"),
    listArtifactDependencies: async (input: { conversationId: string; artifactId: string }) => listArtifactDependencies(config, input.conversationId, input.artifactId),
    deleteArtifactSafely: async (input: { conversationId: string; artifactId: string }) => {
      const dependencies = await listArtifactDependencies(config, input.conversationId, input.artifactId);
      if (dependencies.length > 0) {
        throw toolError("TOOL_RESULT_INCOMPATIBLE", `Artifact ${input.artifactId} 已被下游工具结果引用，不能直接删除。`, {
          conversationId: input.conversationId,
          metadata: { artifactId: input.artifactId, dependencies },
        });
      }
      if (!config.artifactManager.deleteArtifact) {
        throw toolError("TOOL_EXECUTION_FAILED", "当前 ArtifactManager 不支持删除 Artifact。", {
          conversationId: input.conversationId,
          metadata: { artifactId: input.artifactId },
        });
      }
      return config.artifactManager.deleteArtifact(input.artifactId);
    },
    selectHistoricalResult: async (input: SelectHistoricalResultInput) => {
      await config.resultRegistry.selectResult(input.conversationId, input.toolKind, input.toolCallId);
      const record = await config.resultRegistry.get(input.toolCallId);
      if (record && config.memoryBridge) {
        await config.memoryBridge.write({
          conversationId: input.conversationId,
          userId: record.userId,
          type: `${input.toolKind}_selected`,
          summary: `用户已选择 ${record.toolName} v${record.version} 作为后续默认输入。`,
          toolCallId: record.toolCallId,
          artifactIds: record.outputArtifactIds ?? record.result?.artifactIds ?? [],
          version: record.version,
          lineage: {
            toolCallId: record.toolCallId,
            parentToolCallIds: record.parentToolCallIds ?? [],
            sourceArtifactIds: record.sourceArtifactIds ?? [],
            outputArtifactIds: record.outputArtifactIds ?? [],
          },
        });
      }
    },
    resolveToolInput: (input: { conversationId: string; toolKind: ToolKind; explicitInputRefs?: string[] }) => inputResolver.resolve(input),
    resolveSqlResultInput: (input: { conversationId: string; userRequest: string; explicitInputRefs?: string[]; selectedDataSourceAvailable?: boolean; activeTableCount?: number }) =>
      inputResolver.resolveSqlResult(input),
  };
}

async function listArtifactDependencies(config: ToolOrchestrationModuleConfig, conversationId: string, artifactId: string): Promise<ArtifactDependencyRef[]> {
  const records = await config.resultRegistry.listByConversation(conversationId);
  return records
    .filter((record) => record.sourceArtifactIds?.includes(artifactId))
    .map((record) => ({
      artifactId,
      dependentToolCallId: record.toolCallId,
      dependentToolKind: record.toolKind,
      dependentVersion: record.version,
      dependentArtifactIds: record.outputArtifactIds ?? record.result?.artifactIds ?? [],
    }));
}
