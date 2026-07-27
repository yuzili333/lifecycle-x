import type { SkillOperation, SkillOperationError } from "../../shared/skills";

export class SkillError extends Error {
  readonly detail: SkillOperationError;

  constructor(detail: SkillOperationError) {
    super(detail.message);
    this.name = "SkillError";
    this.detail = detail;
  }
}

export function skillError(input: Omit<SkillOperationError, "recoverable"> & { recoverable?: boolean }) {
  return new SkillError({
    ...input,
    recoverable: input.recoverable ?? false,
  });
}

export function asSkillOperationError(error: unknown, operation: SkillOperation, traceId: string): SkillOperationError {
  if (error instanceof SkillError) return error.detail;
  return {
    code: "SKILL_OPERATION_FAILED",
    message: "Skill 操作失败，请重试。",
    operation,
    traceId,
    recoverable: false,
  };
}
