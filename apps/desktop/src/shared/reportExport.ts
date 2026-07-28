export type ReportExportFormat = "pdf" | "docx" | "markdown";

export type ReportExportVisualizationImage = {
  artifactId: string;
  dataUrl: string;
  width: number;
  height: number;
};

export type ReportExportRequest = {
  userId: string;
  conversationId: string;
  reportArtifactId: string;
  reportVersion: number;
  suggestedTitle: string;
  format: ReportExportFormat;
  visualizationImages: ReportExportVisualizationImage[];
};

export type ReportExportResult =
  | {
      status: "completed";
      format: ReportExportFormat;
      fileName: string;
    }
  | {
      status: "cancelled";
      format: ReportExportFormat;
    };

export type ReportExportErrorCode =
  | "REPORT_EXPORT_REQUEST_INVALID"
  | "REPORT_EXPORT_ARTIFACT_NOT_FOUND"
  | "REPORT_EXPORT_VERSION_MISMATCH"
  | "REPORT_EXPORT_VISUALIZATION_MISSING"
  | "REPORT_EXPORT_VISUALIZATION_INVALID"
  | "REPORT_EXPORT_EVIDENCE_UNAVAILABLE"
  | "REPORT_EXPORT_RENDER_FAILED"
  | "REPORT_EXPORT_WRITE_FAILED";

export type ReportExportErrorDetail = {
  code: ReportExportErrorCode;
  message: string;
  format: ReportExportFormat;
  reportArtifactId: string;
  reportVersion: number;
  traceId: string;
  recoverable: boolean;
};
