import { ModelAdapterError } from "./errors";
import type {
  AggregatedToolCall,
  JsonSchema,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionMode,
  ToolExecutionResult,
} from "./types";
import { mergeAbortSignals, nowIso, parseJsonSafely } from "./utils";

const TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  registerTool(tool: ToolDefinition) {
    validateToolName(tool.name);
    this.tools.set(tool.name, tool);
  }

  unregisterTool(toolName: string) {
    this.tools.delete(toolName);
  }

  getTool(toolName: string) {
    return this.tools.get(toolName);
  }

  getTools() {
    return Array.from(this.tools.values());
  }

  toOpenAICompatibleTools() {
    return this.getTools().map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  parseToolInput(toolCall: AggregatedToolCall) {
    const tool = this.getTool(toolCall.name);
    if (!tool) {
      throw new ModelAdapterError("TOOL_NOT_FOUND", `工具不存在：${toolCall.name}`);
    }
    const parsed = parseJsonSafely(toolCall.argumentsText || "{}");
    if (!parsed.success) {
      throw new ModelAdapterError("TOOL_INPUT_INVALID", `工具参数不是有效 JSON：${toolCall.name}`, parsed.error);
    }
    validateInputSchema(tool.inputSchema, parsed.value, tool.name);
    return parsed.value;
  }

  async executeToolCalls(
    toolCalls: AggregatedToolCall[],
    mode: ToolExecutionMode,
    context: Omit<ToolExecutionContext, "toolCallId">,
  ) {
    if (mode === "parallel") {
      return Promise.all(toolCalls.map((toolCall) => this.executeOne(toolCall, context)));
    }
    const results: ToolExecutionResult[] = [];
    for (const toolCall of toolCalls) {
      results.push(await this.executeOne(toolCall, context));
    }
    return results;
  }

  private async executeOne(toolCall: AggregatedToolCall, context: Omit<ToolExecutionContext, "toolCallId">): Promise<ToolExecutionResult> {
    const tool = this.getTool(toolCall.name);
    if (!tool) {
      const startedAt = nowIso();
      return toolErrorResult(toolCall, startedAt, new ModelAdapterError("TOOL_NOT_FOUND", `工具不存在：${toolCall.name}`));
    }

    let input: unknown;
    try {
      input = this.parseToolInput(toolCall);
    } catch (error) {
      const startedAt = nowIso();
      return toolErrorResult(toolCall, startedAt, error);
    }

    const startedAt = nowIso();
    const timeoutController = new AbortController();
    const timeout = tool.timeoutMs ? setTimeout(() => timeoutController.abort(), tool.timeoutMs) : undefined;
    const signal = mergeAbortSignals([context.signal, timeoutController.signal]);
    try {
      const output = await tool.handler(input, { ...context, toolCallId: toolCall.toolCallId, signal });
      const endedAt = nowIso();
      return {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.name,
        success: true,
        startedAt,
        endedAt,
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        output,
      };
    } catch (error) {
      const adapterError =
        timeoutController.signal.aborted && !context.signal?.aborted
          ? new ModelAdapterError("TOOL_EXECUTION_TIMEOUT", `工具执行超时：${toolCall.name}`, error)
          : new ModelAdapterError("TOOL_EXECUTION_FAILED", `工具执行失败：${toolCall.name}`, error);
      return toolErrorResult(toolCall, startedAt, adapterError);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

export function aggregateToolCallDelta(current: Map<string, AggregatedToolCall>, delta: { toolCallId: string; index: number; name?: string; argumentsDelta?: string }) {
  const existing = current.get(delta.toolCallId) ?? {
    toolCallId: delta.toolCallId,
    index: delta.index,
    name: delta.name ?? "",
    argumentsText: "",
  };
  existing.name = delta.name ?? existing.name;
  existing.argumentsText = `${existing.argumentsText}${delta.argumentsDelta ?? ""}`;
  current.set(delta.toolCallId, existing);
  return existing;
}

function validateToolName(name: string) {
  if (!TOOL_NAME_PATTERN.test(name)) {
    throw new ModelAdapterError("TOOL_INPUT_INVALID", `工具名称不合法：${name}`);
  }
}

function validateInputSchema(schema: JsonSchema, value: unknown, toolName: string, path = "input") {
  if (schema.anyOf?.length) {
    const matched = schema.anyOf.some((candidate) => {
      try {
        validateInputSchema(candidate, value, toolName, path);
        return true;
      } catch {
        return false;
      }
    });
    if (!matched) {
      throw new ModelAdapterError("TOOL_INPUT_INVALID", `${toolName} 参数 ${path} 未满足任一允许的参数组合`);
    }
  }
  if (!schema.type) {
    return;
  }
  if (schema.type === "object") {
    if (typeof value !== "object" || value == null || Array.isArray(value)) {
      throw new ModelAdapterError("TOOL_INPUT_INVALID", `${toolName} 参数 ${path} 必须是对象`);
    }
    const record = value as Record<string, unknown>;
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in record)) {
        throw new ModelAdapterError("TOOL_INPUT_INVALID", `${toolName} 缺少必填参数：${requiredKey}`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in record) {
        validateInputSchema(childSchema, record[key], toolName, `${path}.${key}`);
      }
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      throw new ModelAdapterError("TOOL_INPUT_INVALID", `${toolName} 参数 ${path} 必须是数组`);
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      throw new ModelAdapterError("TOOL_INPUT_INVALID", `${toolName} 参数 ${path} 至少需要 ${schema.minItems} 项`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateInputSchema(schema.items as JsonSchema, item, toolName, `${path}[${index}]`));
    }
    return;
  }
  if (!matchesPrimitiveType(schema.type, value)) {
    throw new ModelAdapterError("TOOL_INPUT_INVALID", `${toolName} 参数 ${path} 类型应为 ${schema.type}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    throw new ModelAdapterError("TOOL_INPUT_INVALID", `${toolName} 参数 ${path} 不在允许值范围内`);
  }
  if (schema.type === "string" && typeof schema.minLength === "number" && (value as string).length < schema.minLength) {
    throw new ModelAdapterError("TOOL_INPUT_INVALID", `${toolName} 参数 ${path} 长度不能小于 ${schema.minLength}`);
  }
}

function matchesPrimitiveType(type: string, value: unknown) {
  if (type === "string") {
    return typeof value === "string";
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  if (type === "null") {
    return value === null;
  }
  return true;
}

function toolErrorResult(toolCall: AggregatedToolCall, startedAt: string, error: unknown): ToolExecutionResult {
  const adapterError = error instanceof ModelAdapterError ? error : new ModelAdapterError("TOOL_EXECUTION_FAILED", `工具执行失败：${toolCall.name}`, error);
  const endedAt = nowIso();
  return {
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.name,
    success: false,
    startedAt,
    endedAt,
    durationMs: Date.parse(endedAt) - Date.parse(startedAt),
    error: adapterError.serialize(),
  };
}
