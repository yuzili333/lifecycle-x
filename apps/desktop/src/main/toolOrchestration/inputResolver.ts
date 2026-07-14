import type { ResolvedToolInput, ToolCallRecord, ToolKind, ToolResultRegistry } from "./types";
import { selectedPointerKey } from "./utils";

export class ToolInputResolver {
  constructor(private readonly registry: ToolResultRegistry) {}

  async resolve(input: { conversationId: string; toolKind: ToolKind; explicitInputRefs?: string[] }): Promise<ResolvedToolInput> {
    if (input.explicitInputRefs?.length) {
      const explicitRefs = input.explicitInputRefs.filter((ref) => ref.toLowerCase() !== "latest");
      if (explicitRefs.length === 0) {
        return this.resolve({ conversationId: input.conversationId, toolKind: input.toolKind });
      }
      const explicit = await this.resolveExplicit(input.conversationId, input.toolKind, explicitRefs);
      if (explicit) {
        return explicit;
      }
      return {
        mode: "explicit",
        sourceArtifactIds: explicitRefs,
        reason: "用户显式指定了输入引用，优先使用这些 artifact/toolCall/version 引用。",
      };
    }

    if (input.toolKind === "sql_query") {
      return { mode: "no_input", reason: "SQL 查询工具以用户自然语言和数据源上下文作为输入。" };
    }
    if (input.toolKind === "python_analysis") {
      return this.resolveFromSelectedOrLatest(input.conversationId, "sql_query", "Python 分析默认使用会话最新一次成功 SQL 查询结果。");
    }
    if (input.toolKind === "chart_rendering") {
      const python = await this.resolveFromSelectedOrLatest(input.conversationId, "python_analysis", "图表默认优先使用会话最新一次成功 Python 分析结果。", false);
      if (python.mode !== "no_input") {
        return python;
      }
      return this.resolveFromSelectedOrLatest(input.conversationId, "sql_query", "当前无 Python 结果，图表改用最新一次成功 SQL 查询结果。");
    }

    const python = await this.resolveFromSelectedOrLatest(input.conversationId, "python_analysis", "报告默认优先使用最新 Python 分析结果。", false);
    const chart = await this.resolveFromSelectedOrLatest(input.conversationId, "chart_rendering", "报告同时引用最新图表结果。", false);
    const sql = await this.resolveFromSelectedOrLatest(input.conversationId, "sql_query", "报告必要时补充最新 SQL 查询摘要。", false);
    const artifactIds = [...(python.sourceArtifactIds ?? []), ...(chart.sourceArtifactIds ?? []), ...(sql.sourceArtifactIds ?? [])];
    if (artifactIds.length > 0) {
      const selected = [python, chart, sql].find((item) => item.mode === "selected_result");
      return {
        mode: selected ? "selected_result" : "latest_result",
        sourceToolKind: python.sourceToolKind ?? chart.sourceToolKind ?? sql.sourceToolKind,
        sourceToolCallId: python.sourceToolCallId ?? chart.sourceToolCallId ?? sql.sourceToolCallId,
        sourceArtifactIds: Array.from(new Set(artifactIds)),
        reason: selected ? "报告工具已聚合用户选择的历史结果及可用最新结果作为输入。" : "报告工具已聚合最新 Python、图表和 SQL 结果作为输入。",
      };
    }
    return {
      mode: "no_input",
      reason: "当前没有可用工具结果；仅允许生成无数据报告模板，不得编造结果。",
    };
  }

  private async resolveExplicit(conversationId: string, toolKind: ToolKind, refs: string[]) {
    const records = await this.registry.listByConversation(conversationId);
    const candidateKinds = explicitSourceKindsFor(toolKind);
    const versionRef = refs.find((ref) => /^v\d+$/i.test(ref));
    const directMatches = records.filter((record) => refs.includes(record.toolCallId) || artifactIdsForRecord(record).some((artifactId) => refs.includes(artifactId)));
    const byVersion = versionRef
      ? records
        .filter((record) => candidateKinds.includes(record.toolKind))
        .sort((a, b) => candidateKinds.indexOf(a.toolKind) - candidateKinds.indexOf(b.toolKind))
        .find((record) => `v${record.version}`.toLowerCase() === versionRef.toLowerCase())
      : null;
    const selectedRecords = uniqueRecords([...directMatches, ...(byVersion ? [byVersion] : [])]);
    const explicitArtifactRefs = refs.filter((ref) => !/^v\d+$/i.test(ref) && !selectedRecords.some((record) => record.toolCallId === ref));
    const unmatchedArtifactRefs = explicitArtifactRefs.filter((ref) => !selectedRecords.some((record) => artifactIdsForRecord(record).includes(ref)));
    if (selectedRecords.length === 0) {
      return null;
    }
    const primary = selectedRecords[0];
    return {
      mode: "explicit",
      sourceToolKind: primary.toolKind,
      sourceToolCallId: primary.toolCallId,
      sourceArtifactIds: Array.from(new Set([...selectedRecords.flatMap(artifactIdsForRecord), ...unmatchedArtifactRefs])),
      reason: `用户显式指定 ${refs.join(", ")}，已解析为 ${selectedRecords.length} 个工具调用输入。`,
    } satisfies ResolvedToolInput;
  }

  private async resolveFromSelectedOrLatest(conversationId: string, sourceToolKind: ToolKind, reason: string, requireInput = true): Promise<ResolvedToolInput> {
    const state = await this.registry.getConversationState(conversationId);
    const selectedToolCallId = state[selectedPointerKey(sourceToolKind)];
    const selected = selectedToolCallId ? await this.registry.get(selectedToolCallId) : null;
    if (selected?.status === "completed") {
      return {
        mode: "selected_result",
        sourceToolKind,
        sourceToolCallId: selected.toolCallId,
        sourceArtifactIds: selected.outputArtifactIds ?? selected.result?.artifactIds ?? [],
        reason: `用户已选择 ${sourceToolKind} 历史结果，优先作为输入。`,
      };
    }
    const latest = await this.registry.getLatestSuccessful(conversationId, sourceToolKind);
    if (latest) {
      return {
        mode: "latest_result",
        sourceToolKind,
        sourceToolCallId: latest.toolCallId,
        sourceArtifactIds: latest.outputArtifactIds ?? latest.result?.artifactIds ?? [],
        reason,
      };
    }
    return {
      mode: "no_input",
      sourceToolKind,
      reason: requireInput ? `${sourceToolKind} 没有可用成功结果，工具调用需要等待输入。` : `${sourceToolKind} 没有可用成功结果，跳过该默认输入。`,
    };
  }
}

function artifactIdsForRecord(record: ToolCallRecord) {
  return record.outputArtifactIds ?? record.result?.artifactIds ?? [];
}

function uniqueRecords(records: ToolCallRecord[]) {
  const map = new Map<string, ToolCallRecord>();
  for (const record of records) {
    map.set(record.toolCallId, record);
  }
  return Array.from(map.values());
}

function explicitSourceKindsFor(toolKind: ToolKind): ToolKind[] {
  if (toolKind === "python_analysis") {
    return ["sql_query", "python_analysis"];
  }
  if (toolKind === "chart_rendering") {
    return ["python_analysis", "sql_query", "chart_rendering"];
  }
  if (toolKind === "report_generation") {
    return ["python_analysis", "chart_rendering", "sql_query", "report_generation"];
  }
  return ["sql_query"];
}
