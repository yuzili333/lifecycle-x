import type { SqlToolErrorCode } from "./types.js";

export class SqlToolError extends Error {
  constructor(
    readonly code: SqlToolErrorCode,
    message: string,
    readonly context: { requestId?: string; executionId?: string; details?: Record<string, unknown> } = {},
  ) {
    super(`${code}:${message}`);
    this.name = "SqlToolError";
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        requestId: this.context.requestId,
        executionId: this.context.executionId,
        details: this.context.details,
      },
    };
  }
}
