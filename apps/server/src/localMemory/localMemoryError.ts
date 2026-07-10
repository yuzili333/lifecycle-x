import type { LocalMemoryErrorCode } from "./types.js";

export class LocalMemoryError extends Error {
  readonly code: LocalMemoryErrorCode;
  readonly traceId: string;
  readonly details?: Record<string, unknown>;

  constructor(code: LocalMemoryErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "LocalMemoryError";
    this.code = code;
    this.traceId = details?.traceId?.toString() ?? `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.details = details;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        traceId: this.traceId,
      },
    };
  }
}
