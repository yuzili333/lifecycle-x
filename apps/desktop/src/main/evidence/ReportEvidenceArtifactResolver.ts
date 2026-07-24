import { reportEvidenceCardIds, type EvidenceCard, type EvidenceCardErrorCode, type ResolvedReportEvidenceCard } from "../../shared/evidence";
import type { ArtifactManager, ToolCallRecord, ToolResultRegistry } from "../toolOrchestration";

export class ReportEvidenceArtifactResolver {
  constructor(
    private readonly artifactManager: ArtifactManager,
    private readonly toolResultRegistry: ToolResultRegistry,
  ) {}

  async resolve(input: {
    conversationId: string;
    reportArtifactId: string;
    reportVersion: number;
    evidenceCardId: string;
  }): Promise<ResolvedReportEvidenceCard> {
    const records = await this.toolResultRegistry.listByConversation(input.conversationId);
    const reportRecord = completedOwner(records, input.reportArtifactId, "report_generation");
    if (!reportRecord || reportRecord.version !== input.reportVersion) {
      throw evidenceError("EVIDENCE_PERMISSION_DENIED", "当前报告版本不允许加载该溯据卡。");
    }
    const reportArtifact = await this.artifactManager.getArtifact(input.reportArtifactId);
    if (!reportArtifact || reportArtifact.artifactType !== "report_markdown" || typeof reportArtifact.content !== "string") {
      throw evidenceError("REPORT_ARTIFACT_NOT_FOUND", "报告内容不存在或已失效。");
    }
    const declaredIds = reportEvidenceCardIds(reportArtifact.content);
    const metadataId = typeof reportArtifact.metadata?.evidenceCardId === "string" ? reportArtifact.metadata.evidenceCardId : undefined;
    if (!declaredIds.includes(input.evidenceCardId) || metadataId !== input.evidenceCardId) {
      throw evidenceError("EVIDENCE_PERMISSION_DENIED", "报告未绑定该溯据卡。");
    }
    const evidenceArtifact = await this.artifactManager.getArtifact(input.evidenceCardId);
    if (!evidenceArtifact || evidenceArtifact.artifactType !== "evidence_card" || !isEvidenceCard(evidenceArtifact.content)) {
      throw evidenceError("EVIDENCE_CARD_NOT_FOUND", "溯据卡不存在或已失效。");
    }
    const card = evidenceArtifact.content;
    if (card.reportArtifactId !== input.reportArtifactId || card.reportVersion !== input.reportVersion || card.evidenceCardId !== input.evidenceCardId) {
      throw evidenceError("EVIDENCE_VALIDATION_FAILED", "溯据卡与当前报告版本不匹配。");
    }
    return {
      evidenceCardId: card.evidenceCardId,
      reportArtifactId: card.reportArtifactId,
      reportVersion: card.reportVersion,
      status: card.status,
      evidenceCard: card,
    };
  }
}

export class ReportEvidenceResolverError extends Error {
  constructor(readonly code: EvidenceCardErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "ReportEvidenceResolverError";
  }
}

function completedOwner(records: ToolCallRecord[], artifactId: string, kind: ToolCallRecord["toolKind"]) {
  return records.find((record) =>
    record.toolKind === kind
    && record.status === "completed"
    && [...(record.outputArtifactIds ?? []), ...(record.result?.artifactIds ?? [])].includes(artifactId));
}

function isEvidenceCard(value: unknown): value is EvidenceCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<EvidenceCard>;
  return card.title === "溯据卡"
    && card.generatedBy === "system"
    && typeof card.evidenceCardId === "string"
    && typeof card.reportArtifactId === "string"
    && typeof card.reportVersion === "number"
    && ["complete", "partial", "invalid"].includes(card.status ?? "");
}

function evidenceError(code: EvidenceCardErrorCode, message: string) {
  return new ReportEvidenceResolverError(code, message);
}
