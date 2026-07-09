import type { ModelAdapterErrorCode, SerializedModelAdapterError } from "./types";

export class ModelAdapterError extends Error {
  readonly code: ModelAdapterErrorCode;
  readonly causeDetail?: unknown;

  constructor(code: ModelAdapterErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ModelAdapterError";
    this.code = code;
    this.causeDetail = cause;
  }

  serialize(): SerializedModelAdapterError {
    return {
      code: this.code,
      message: this.message,
      cause: safeCauseMessage(this.causeDetail),
    };
  }
}

export function toModelAdapterError(code: ModelAdapterErrorCode, message: string, cause?: unknown) {
  if (cause instanceof ModelAdapterError) {
    return cause;
  }
  return new ModelAdapterError(code, message, cause);
}

export function safeCauseMessage(cause: unknown) {
  if (!cause) {
    return undefined;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]").replace(/api[-_ ]?key["':=\s]+[A-Za-z0-9._~+/=-]+/gi, "apiKey=[REDACTED]");
}
