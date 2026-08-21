export type SkillOrigin = "system" | "personal";
export type SkillAvailability = "ready" | "invalid";

export type SkillManifest = {
  skillId: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  category: string;
  tags: string[];
  keywords: string[];
  sourceType: "local_builtin" | "local_personal";
  runtime: "cycle-probe-client";
  clientOnly: true;
  enabled: boolean;
  requiredTools: string[];
  entryFile: string;
  templateFile?: string;
  inputSchemaFile?: string;
  reportDataSchemaFile?: string;
  toolPolicyFile?: string;
  analysisRecipeFile?: string;
  aliases?: string[];
};

export type SkillSummary = {
  skillId: string;
  displayName: string;
  description: string;
  version: string;
  category: string;
  origin: SkillOrigin;
  enabled: boolean;
  availability: SkillAvailability;
  tags: string[];
  keywords: string[];
  aliases: string[];
  canToggle: boolean;
  canDelete: boolean;
  error?: string;
};

export type LoadedSkill = {
  summary: SkillSummary;
  requiredTools: string[];
  instructions: string;
  reportTemplate?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  toolPolicy?: Record<string, unknown>;
  analysisRecipe?: Record<string, unknown>;
  contentHash: string;
  loadedAt: string;
};

export type SkillOperation =
  | "list"
  | "install"
  | "set_enabled"
  | "remove"
  | "load";

export type SkillOperationError = {
  code:
    | "SKILL_PACKAGE_INCOMPLETE"
    | "SKILL_MANIFEST_INVALID"
    | "SKILL_SCHEMA_INVALID"
    | "SKILL_PACKAGE_UNSAFE"
    | "SKILL_ID_RESERVED"
    | "SKILL_ALREADY_INSTALLED"
    | "SKILL_NOT_FOUND"
    | "SKILL_DISABLED"
    | "SKILL_LOAD_FAILED"
    | "SKILL_REMOVE_PARTIAL"
    | "SKILL_OPERATION_FAILED";
  message: string;
  operation: SkillOperation;
  traceId: string;
  skillId?: string;
  recoverable: boolean;
  retryTrace?: string[];
  fallbackTrace?: string[];
  conflictTrace?: string[];
};

export type SkillInstallResult =
  | { status: "cancelled" }
  | { status: "installed"; skill: SkillSummary };

export type SkillRemoveResult = {
  success: true;
  skillId: string;
};

export type SkillIpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: SkillOperationError };
