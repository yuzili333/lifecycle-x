import type { ArtifactDataResolver, ResolvedVisualizationData } from "../shared/visualization";
import type { DatasetStateManager, WorkflowDatasetRef } from "./workflowRuntime";

export class WorkflowArtifactDataResolver implements ArtifactDataResolver {
  constructor(private readonly datasetStateManager: DatasetStateManager) {}

  async resolve(input: {
    artifactId: string;
    userId?: string;
    expectedSchema?: Record<string, string>;
    maxRowsForInline?: number;
  }): Promise<ResolvedVisualizationData> {
    const datasetId = normalizeDatasetArtifactId(input.artifactId);
    const dataset = await this.datasetStateManager.getDataset(datasetId);
    if (!dataset) {
      throw new VisualizationArtifactResolverError("VISUALIZATION_DATA_NOT_FOUND", `Artifact 不存在：${input.artifactId}`);
    }
    if (!["ready", "confirmed"].includes(dataset.status)) {
      throw new VisualizationArtifactResolverError("VISUALIZATION_ARTIFACT_FAILED", `Artifact 状态不可用：${dataset.status}`);
    }
    if (!dataset.canUseForReport && !dataset.canAnalyze && !dataset.canQuery) {
      throw new VisualizationArtifactResolverError("VISUALIZATION_DATA_PERMISSION_DENIED", "当前 Artifact 不允许用于可视化。");
    }
    validateExpectedSchema(dataset, input.expectedSchema);

    const profileRows = dataset.profile?.previewRows ?? [];
    const maxRows = input.maxRowsForInline ?? 20;
    const rows = profileRows.slice(0, maxRows);
    const columns = dataset.profile?.columns?.map((column) => ({ name: column.name, type: column.type })) ?? Object.entries(dataset.schema ?? {}).map(([name, type]) => ({ name, type }));
    const rowCount = dataset.rowCount ?? dataset.profile?.rowCount ?? rows.length;
    const truncated = rows.length < rowCount;

    return {
      artifactId: input.artifactId,
      columns,
      rows,
      dataRef: dataset.sqliteTableName ? `workflow-dataset:${dataset.datasetId}` : undefined,
      rowCount,
      truncated,
      masked: Boolean(dataset.metadata?.masked),
      warnings: [
        ...(dataset.profile?.warnings ?? []),
        ...(truncated ? ["Artifact 数据量较大，仅返回受控预览行，完整数据通过 dataRef 引用。"] : []),
      ],
    };
  }
}

export class VisualizationArtifactResolverError extends Error {
  constructor(
    readonly code:
      | "VISUALIZATION_DATA_NOT_FOUND"
      | "VISUALIZATION_DATA_PERMISSION_DENIED"
      | "VISUALIZATION_SCHEMA_MISMATCH"
      | "VISUALIZATION_ARTIFACT_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "VisualizationArtifactResolverError";
  }
}

function normalizeDatasetArtifactId(artifactId: string) {
  return artifactId.startsWith("workflow-dataset:") ? artifactId.slice("workflow-dataset:".length) : artifactId;
}

function validateExpectedSchema(dataset: WorkflowDatasetRef, expectedSchema: Record<string, string> | undefined) {
  if (!expectedSchema) {
    return;
  }
  const schema = dataset.schema ?? Object.fromEntries(dataset.profile?.columns.map((column) => [column.name, column.type]) ?? []);
  for (const [field, expectedType] of Object.entries(expectedSchema)) {
    const actualType = schema[field];
    if (!actualType) {
      throw new VisualizationArtifactResolverError("VISUALIZATION_SCHEMA_MISMATCH", `Artifact 缺少字段：${field}`);
    }
    if (expectedType && actualType && !actualType.toLowerCase().includes(expectedType.toLowerCase()) && !expectedType.toLowerCase().includes(actualType.toLowerCase())) {
      throw new VisualizationArtifactResolverError("VISUALIZATION_SCHEMA_MISMATCH", `Artifact 字段类型不匹配：${field}`);
    }
  }
}
