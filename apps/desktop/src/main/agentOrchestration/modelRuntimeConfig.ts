export type TaskComplexity = "L0" | "L1" | "L2" | "L3" | "L4";
export type KimiThinkingProfileName = "fast" | "standard" | "analytical" | "complex" | "deep";
export type QwenExecutionProfileName = "router" | "sql" | "python" | "chart" | "report";

export type ModelRequestProfile = {
  enableThinking: boolean;
  thinkingBudget?: number;
  stream: boolean;
  temperature: number;
  maxTokens: number;
};

export const KIMI_THINKING_PROFILES: Record<KimiThinkingProfileName, ModelRequestProfile> = {
  fast: { enableThinking: false, stream: true, temperature: 0, maxTokens: 2_048 },
  standard: { enableThinking: true, thinkingBudget: 512, stream: true, temperature: 0, maxTokens: 4_096 },
  analytical: { enableThinking: true, thinkingBudget: 1_024, stream: true, temperature: 0, maxTokens: 8_192 },
  complex: { enableThinking: true, thinkingBudget: 2_048, stream: true, temperature: 0, maxTokens: 12_000 },
  deep: { enableThinking: true, thinkingBudget: 4_096, stream: true, temperature: 0, maxTokens: 16_000 },
};

export const QWEN_EXECUTION_PROFILES: Record<QwenExecutionProfileName, ModelRequestProfile> = {
  router: { enableThinking: false, stream: true, temperature: 0, maxTokens: 800 },
  sql: { enableThinking: false, stream: false, temperature: 0, maxTokens: 4_096 },
  python: { enableThinking: false, stream: false, temperature: 0.1, maxTokens: 8_192 },
  chart: { enableThinking: false, stream: false, temperature: 0, maxTokens: 4_096 },
  report: { enableThinking: false, stream: true, temperature: 0.2, maxTokens: 12_000 },
};

export type ThinkingOptimizationConfig = {
  enabled: boolean;
  reasonerModel: string;
  executorModel: string;
  defaultKimiProfile: KimiThinkingProfileName;
  maxThinkingBudget: number;
  maxKimiCallsPerTask: number;
  maxCumulativeThinkingBudget: number;
  rawReasoningVisible: false;
  rawReasoningPersisted: false;
  enableDynamicRouting: boolean;
  enableAutomaticBudgetUpgrade: boolean;
  enableQwenFallback: boolean;
  allowDeepThinking: boolean;
  firstEventTimeoutMs: number;
  planningTimeoutMs: number;
  reasoningContextTokenBudget: number;
  rolloutPercentage: number;
  kimiProfiles: Record<KimiThinkingProfileName, ModelRequestProfile>;
  qwenProfiles: Record<QwenExecutionProfileName, ModelRequestProfile>;
};

export type ThinkingDecision = {
  useKimi: boolean;
  complexity: TaskComplexity;
  profile: KimiThinkingProfileName;
  request: ModelRequestProfile;
  maxAutoUpgradeBudget: number;
  reason: string;
};

type ConfigOverrides = {
  reasonerModel?: string;
  executorModel?: string;
  enabled?: boolean;
};

const SAFE_DEFAULTS: ThinkingOptimizationConfig = {
  enabled: true,
  reasonerModel: "Pro/moonshotai/Kimi-K2.6",
  executorModel: "Qwen/Qwen3-32B",
  defaultKimiProfile: "standard",
  maxThinkingBudget: 4_096,
  maxKimiCallsPerTask: 2,
  maxCumulativeThinkingBudget: 6_144,
  rawReasoningVisible: false,
  rawReasoningPersisted: false,
  enableDynamicRouting: true,
  enableAutomaticBudgetUpgrade: true,
  enableQwenFallback: true,
  allowDeepThinking: true,
  firstEventTimeoutMs: 20_000,
  planningTimeoutMs: 90_000,
  reasoningContextTokenBudget: 8_000,
  rolloutPercentage: 100,
  kimiProfiles: KIMI_THINKING_PROFILES,
  qwenProfiles: QWEN_EXECUTION_PROFILES,
};

export function resolveThinkingOptimizationConfig(
  overrides: ConfigOverrides = {},
  env: Record<string, string | undefined> = process.env,
): ThinkingOptimizationConfig {
  const maxThinkingBudget = boundedInteger(env.CYCLE_PROBE_MAX_THINKING_BUDGET, SAFE_DEFAULTS.maxThinkingBudget, 0, 4_096);
  const kimiProfiles = resolveKimiProfiles(env);
  const qwenProfiles = resolveQwenProfiles(env);
  return {
    ...SAFE_DEFAULTS,
    enabled: overrides.enabled ?? booleanValue(env.CYCLE_PROBE_THINKING_OPTIMIZATION_ENABLED, SAFE_DEFAULTS.enabled),
    reasonerModel: nonEmpty(overrides.reasonerModel) || nonEmpty(env.CYCLE_PROBE_REASONER_MODEL) || SAFE_DEFAULTS.reasonerModel,
    executorModel: nonEmpty(overrides.executorModel) || nonEmpty(env.CYCLE_PROBE_EXECUTOR_MODEL) || SAFE_DEFAULTS.executorModel,
    defaultKimiProfile: profileValue(env.CYCLE_PROBE_DEFAULT_KIMI_PROFILE, SAFE_DEFAULTS.defaultKimiProfile),
    maxThinkingBudget,
    maxKimiCallsPerTask: boundedInteger(env.CYCLE_PROBE_MAX_KIMI_CALLS_PER_TASK, SAFE_DEFAULTS.maxKimiCallsPerTask, 0, 4),
    maxCumulativeThinkingBudget: boundedInteger(
      env.CYCLE_PROBE_MAX_CUMULATIVE_THINKING_BUDGET,
      SAFE_DEFAULTS.maxCumulativeThinkingBudget,
      0,
      16_384,
    ),
    enableDynamicRouting: booleanValue(env.CYCLE_PROBE_DYNAMIC_ROUTING_ENABLED, SAFE_DEFAULTS.enableDynamicRouting),
    enableAutomaticBudgetUpgrade: booleanValue(env.CYCLE_PROBE_THINKING_AUTO_UPGRADE_ENABLED, SAFE_DEFAULTS.enableAutomaticBudgetUpgrade),
    enableQwenFallback: booleanValue(env.CYCLE_PROBE_QWEN_FALLBACK_ENABLED, SAFE_DEFAULTS.enableQwenFallback),
    allowDeepThinking: booleanValue(env.CYCLE_PROBE_DEEP_THINKING_ENABLED, SAFE_DEFAULTS.allowDeepThinking),
    firstEventTimeoutMs: boundedInteger(env.CYCLE_PROBE_REASONER_FIRST_EVENT_TIMEOUT_MS, SAFE_DEFAULTS.firstEventTimeoutMs, 1_000, 120_000),
    planningTimeoutMs: boundedInteger(env.CYCLE_PROBE_PLANNING_TIMEOUT_MS, SAFE_DEFAULTS.planningTimeoutMs, 5_000, 180_000),
    reasoningContextTokenBudget: boundedInteger(
      env.CYCLE_PROBE_REASONING_CONTEXT_TOKEN_BUDGET,
      SAFE_DEFAULTS.reasoningContextTokenBudget,
      1_000,
      32_000,
    ),
    rolloutPercentage: boundedInteger(env.CYCLE_PROBE_THINKING_ROLLOUT_PERCENTAGE, SAFE_DEFAULTS.rolloutPercentage, 0, 100),
    kimiProfiles,
    qwenProfiles,
  };
}

export function thinkingDecisionForComplexity(
  complexity: TaskComplexity,
  config: ThinkingOptimizationConfig,
  reason = "task_complexity",
): ThinkingDecision {
  const requestedProfile: KimiThinkingProfileName =
    complexity === "L4" ? "deep" :
      complexity === "L3" ? "analytical" :
        complexity === "L2" ? "standard" : "fast";
  const useKimi = config.enabled && complexity !== "L0" && complexity !== "L1";
  const allowedProfile = requestedProfile === "deep" && !config.allowDeepThinking ? "complex" : requestedProfile;
  const base = config.kimiProfiles[allowedProfile];
  const thinkingBudget = base.enableThinking
    ? Math.min(base.thinkingBudget ?? 0, config.maxThinkingBudget, config.maxCumulativeThinkingBudget)
    : undefined;
  const effectiveProfile = base.enableThinking ? profileForBudget(thinkingBudget ?? 0) : "fast";
  const effectiveBase = config.kimiProfiles[effectiveProfile];
  return {
    useKimi: useKimi && config.maxKimiCallsPerTask > 0 && (thinkingBudget ?? 0) > 0,
    complexity,
    profile: effectiveProfile,
    request: {
      ...effectiveBase,
      ...(effectiveBase.enableThinking ? { thinkingBudget } : {}),
    },
    maxAutoUpgradeBudget: complexity === "L3"
      ? Math.min(2_048, config.maxThinkingBudget, config.maxCumulativeThinkingBudget)
      : complexity === "L2"
        ? Math.min(1_024, config.maxThinkingBudget, config.maxCumulativeThinkingBudget)
        : thinkingBudget ?? 0,
    reason,
  };
}

export function upgradeThinkingDecision(
  current: ThinkingDecision,
  config: ThinkingOptimizationConfig,
  signals: {
    tableCount?: number;
    nonBlockingAmbiguityCount?: number;
    asksForExplanation?: boolean;
    requiresMethodSelection?: boolean;
    resultConflict?: boolean;
    toolCallCount?: number;
    dataQualityWarning?: boolean;
    resultMismatch?: boolean;
    requiresSecondValidationQuery?: boolean;
    anomalyAffectsConclusion?: boolean;
    crossPeriodAttribution?: boolean;
    firstDiagnosisUnresolved?: boolean;
    userRequestedDeepAnalysis?: boolean;
  },
): ThinkingDecision {
  if (!current.useKimi || !config.enableAutomaticBudgetUpgrade) return current;
  let target = current.request.thinkingBudget ?? 0;
  const standardUpgrade =
    (signals.tableCount ?? 0) >= 3 ||
    (signals.nonBlockingAmbiguityCount ?? 0) > 1 ||
    signals.asksForExplanation ||
    signals.requiresMethodSelection ||
    signals.dataQualityWarning ||
    signals.resultMismatch ||
    signals.requiresSecondValidationQuery;
  const complexUpgrade =
    signals.resultConflict ||
    (signals.toolCallCount ?? 0) >= 3 ||
    signals.anomalyAffectsConclusion ||
    signals.crossPeriodAttribution ||
    signals.firstDiagnosisUnresolved;
  if (target <= 512 && standardUpgrade) target = 1_024;
  if (target <= 1_024 && complexUpgrade) target = 2_048;
  if (signals.userRequestedDeepAnalysis && current.complexity === "L4" && config.allowDeepThinking) target = 4_096;
  target = Math.min(target, current.maxAutoUpgradeBudget || target, config.maxThinkingBudget, config.maxCumulativeThinkingBudget);
  if (target === current.request.thinkingBudget) return current;
  const profile: KimiThinkingProfileName = target >= 4_096 ? "deep" : target >= 2_048 ? "complex" : target >= 1_024 ? "analytical" : "standard";
  return {
    ...current,
    profile,
    request: { ...config.kimiProfiles[profile], thinkingBudget: target },
    reason: "controlled_budget_upgrade",
  };
}

export function qwenProfileForTool(
  toolKind: "sql_query" | "python_analysis" | "chart_rendering" | "report_generation",
  config?: ThinkingOptimizationConfig,
) {
  const profiles = config?.qwenProfiles ?? QWEN_EXECUTION_PROFILES;
  if (toolKind === "sql_query") return profiles.sql;
  if (toolKind === "python_analysis") return profiles.python;
  if (toolKind === "chart_rendering") return profiles.chart;
  return profiles.report;
}

export function isOptimizationEnabledForScope(
  config: ThinkingOptimizationConfig,
  scope: { userId: string; conversationId: string; taskId: string },
) {
  if (!config.enabled || config.rolloutPercentage <= 0) return false;
  if (config.rolloutPercentage >= 100) return true;
  const bucket = stableHash(`${scope.userId}:${scope.conversationId}:${scope.taskId}`) % 100;
  return bucket < config.rolloutPercentage;
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function booleanValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return fallback;
}

function profileValue(value: string | undefined, fallback: KimiThinkingProfileName) {
  return value && value in KIMI_THINKING_PROFILES ? value as KimiThinkingProfileName : fallback;
}

function profileForBudget(budget: number): KimiThinkingProfileName {
  if (budget >= 4_096) return "deep";
  if (budget >= 2_048) return "complex";
  if (budget >= 1_024) return "analytical";
  if (budget > 0) return "standard";
  return "fast";
}

function nonEmpty(value: string | undefined) {
  return value?.trim() ?? "";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resolveKimiProfiles(env: Record<string, string | undefined>) {
  return Object.fromEntries((Object.keys(KIMI_THINKING_PROFILES) as KimiThinkingProfileName[]).map((name) => {
    const base = KIMI_THINKING_PROFILES[name];
    const prefix = `CYCLE_PROBE_KIMI_${name.toUpperCase()}`;
    return [name, {
      ...base,
      thinkingBudget: base.enableThinking
        ? boundedInteger(env[`${prefix}_THINKING_BUDGET`], base.thinkingBudget ?? 0, 1, 4_096)
        : undefined,
      maxTokens: boundedInteger(env[`${prefix}_MAX_TOKENS`], base.maxTokens, 256, 32_000),
    }];
  })) as Record<KimiThinkingProfileName, ModelRequestProfile>;
}

function resolveQwenProfiles(env: Record<string, string | undefined>) {
  return Object.fromEntries((Object.keys(QWEN_EXECUTION_PROFILES) as QwenExecutionProfileName[]).map((name) => {
    const base = QWEN_EXECUTION_PROFILES[name];
    const prefix = `CYCLE_PROBE_QWEN_${name.toUpperCase()}`;
    return [name, {
      ...base,
      enableThinking: false,
      maxTokens: boundedInteger(env[`${prefix}_MAX_TOKENS`], base.maxTokens, 256, 32_000),
    }];
  })) as Record<QwenExecutionProfileName, ModelRequestProfile>;
}
