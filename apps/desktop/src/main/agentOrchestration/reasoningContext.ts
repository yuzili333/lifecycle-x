export type ReasoningContext = {
  userGoal: string;
  businessDomain: string;
  selectedSources: Array<{ id: string; type: "database" | "csv" | "temporary_table"; description?: string }>;
  candidateTables: Array<{ name: string; description?: string; relevantFields?: string[] }>;
  metricDefinitions: Array<{ name: string; definition: string }>;
  previousStepResults: Array<{ stepId: string; summary: string }>;
  constraints: {
    readOnly: boolean;
    maxRows?: number;
    sensitiveFieldsMasked: boolean;
    allowedSchemas?: string[];
  };
};

export type ContextSection = {
  name: string;
  priority: number;
  content: string;
};

export type CompressedReasoningContext = {
  content: string;
  estimatedTokens: number;
  includedSections: string[];
  omittedSections: string[];
  truncated: boolean;
};

export function compressReasoningContext(sections: ContextSection[], tokenBudget: number): CompressedReasoningContext {
  const safeBudget = Math.max(256, Math.floor(tokenBudget));
  const ordered = [...sections]
    .filter((section) => section.content.trim())
    .sort((left, right) => right.priority - left.priority);
  const included: ContextSection[] = [];
  const omitted: string[] = [];
  let remaining = safeBudget;
  for (const section of ordered) {
    const tokens = estimateContextTokens(section.content);
    if (tokens <= remaining) {
      included.push(section);
      remaining -= tokens;
      continue;
    }
    if (included.length === 0 && remaining >= 128) {
      const clipped = clipToEstimatedTokens(section.content, remaining);
      included.push({ ...section, content: clipped });
      remaining = 0;
    } else {
      omitted.push(section.name);
    }
  }
  const content = included.map((section) => section.content.trim()).join("\n\n");
  return {
    content,
    estimatedTokens: estimateContextTokens(content),
    includedSections: included.map((section) => section.name),
    omittedSections: omitted,
    truncated: omitted.length > 0 || included.some((section) => !sections.find((source) => source.name === section.name)?.content.endsWith(section.content)),
  };
}

export function estimateContextTokens(value: string) {
  if (!value) return 0;
  const cjk = value.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g)?.length ?? 0;
  return Math.ceil(cjk + (value.length - cjk) / 4);
}

function clipToEstimatedTokens(value: string, tokenBudget: number) {
  if (estimateContextTokens(value) <= tokenBudget) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateContextTokens(value.slice(0, middle)) <= tokenBudget - 8) low = middle;
    else high = middle - 1;
  }
  return `${value.slice(0, low).trimEnd()}\n[上下文已按 Token 预算裁剪]`;
}
