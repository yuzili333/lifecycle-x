import type { PythonRunnerErrorCode } from "./types.js";

export class PythonRunnerError extends Error {
  constructor(
    readonly code: PythonRunnerErrorCode,
    message: string,
    readonly context: { requestId?: string; executionId?: string; details?: Record<string, unknown> } = {},
  ) {
    super(`${code}:${sanitizeMessage(message)}`);
    this.name = "PythonRunnerError";
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

export function sanitizeMessage(value: unknown) {
  return String(value).replace(/(password|token|api[_-]?key|secret|connection\s*string)/gi, "[REDACTED]");
}
