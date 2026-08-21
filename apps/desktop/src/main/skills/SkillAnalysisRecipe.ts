type JsonRecord = Record<string, unknown>;

type FieldRole = "group" | "risk" | "amount" | "recordId";

type GroupedRiskDistributionRecipe = {
  kind: "grouped-risk-distribution-v1";
  fieldRoles: Record<FieldRole, { candidates: string[] }>;
  groupOrder: string[];
  groupRules: Array<{ label: string; keywords: string[] }>;
  riskRules: {
    normal: string[];
    attention: string[];
    nonperforming: string[];
  };
  output: {
    distributionKey: string;
    groupLabelKey: string;
    specialMetrics?: Array<{
      key: string;
      groupSourceContains: string;
      risk: "normal" | "attention" | "nonperforming";
    }>;
  };
};

export type CompiledSkillAnalysisRecipe = {
  script: string;
  fieldBindings: {
    group: string;
    risk: string;
    amount: string;
    recordId: string | null;
  };
};

export type SkillAnalysisRecipeCompilation =
  | { ok: true; value: CompiledSkillAnalysisRecipe }
  | { ok: false; error: string };

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) return null;
  return value.map((item) => item.trim());
}

function parseRecipe(value: unknown): GroupedRiskDistributionRecipe | null {
  if (!isRecord(value) || value.kind !== "grouped-risk-distribution-v1") return null;
  if (!isRecord(value.fieldRoles) || !isRecord(value.riskRules) || !isRecord(value.output)) return null;
  const roles = {} as GroupedRiskDistributionRecipe["fieldRoles"];
  for (const role of ["group", "risk", "amount", "recordId"] as const) {
    const definition = value.fieldRoles[role];
    if (!isRecord(definition)) return null;
    const candidates = stringArray(definition.candidates);
    if (!candidates?.length) return null;
    roles[role] = { candidates };
  }
  const groupOrder = stringArray(value.groupOrder);
  if (!groupOrder?.length || !Array.isArray(value.groupRules)) return null;
  const groupRules = value.groupRules.flatMap((item) => {
    if (!isRecord(item) || typeof item.label !== "string") return [];
    const keywords = stringArray(item.keywords);
    return keywords?.length ? [{ label: item.label.trim(), keywords }] : [];
  });
  if (groupRules.length !== value.groupRules.length) return null;
  const normal = stringArray(value.riskRules.normal);
  const attention = stringArray(value.riskRules.attention);
  const nonperforming = stringArray(value.riskRules.nonperforming);
  if (!normal?.length || !attention?.length || !nonperforming?.length) return null;
  if (typeof value.output.distributionKey !== "string" || typeof value.output.groupLabelKey !== "string") return null;
  const specialMetrics = Array.isArray(value.output.specialMetrics)
    ? value.output.specialMetrics.flatMap((item) => {
        if (!isRecord(item) || typeof item.key !== "string" || typeof item.groupSourceContains !== "string") return [];
        if (!(["normal", "attention", "nonperforming"] as const).includes(item.risk as never)) return [];
        return [{
          key: item.key.trim(),
          groupSourceContains: item.groupSourceContains.trim(),
          risk: item.risk as "normal" | "attention" | "nonperforming",
        }];
      })
    : undefined;
  if (Array.isArray(value.output.specialMetrics) && specialMetrics?.length !== value.output.specialMetrics.length) return null;
  return {
    kind: value.kind,
    fieldRoles: roles,
    groupOrder,
    groupRules,
    riskRules: { normal, attention, nonperforming },
    output: {
      distributionKey: value.output.distributionKey.trim(),
      groupLabelKey: value.output.groupLabelKey.trim(),
      specialMetrics,
    },
  };
}

function normalizedFieldName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")");
}

function unitlessFieldName(value: string) {
  return normalizedFieldName(value).replace(/\((?:人民币)?(?:元|万|万元|亿|亿元)\)$/u, "");
}

function resolveRoleField(input: {
  role: FieldRole;
  candidates: string[];
  availableFields: string[];
  selectedFieldNames: string[];
  optional?: boolean;
}): { value: string | null } | { error: string } {
  const available = Array.from(new Set(input.availableFields.map((field) => field.trim()).filter(Boolean)));
  const selectedRaw = new Set(input.selectedFieldNames.map((field) => field.trim()).filter(Boolean));
  const selected = new Set(input.selectedFieldNames.map(normalizedFieldName));
  const rawSelectedAvailable = available.filter((field) => selectedRaw.has(field));
  const selectedAvailable = rawSelectedAvailable.length > 0
    ? rawSelectedAvailable
    : available.filter((field) => selected.has(normalizedFieldName(field)));
  const candidateNames = input.candidates.map(normalizedFieldName);
  const selectedExact = Array.from(new Set(selectedAvailable.filter((field) => candidateNames.includes(normalizedFieldName(field)))));
  if (selectedExact.length === 1) return { value: selectedExact[0] };
  if (selectedExact.length > 1) return { error: `${input.role} 字段存在多个用户已选候选：${selectedExact.join("、")}` };
  const exact = available.filter((field) => candidateNames.includes(normalizedFieldName(field)));
  const exactUnique = Array.from(new Set(exact));
  if (exactUnique.length === 1) return { value: exactUnique[0] } as const;
  if (exactUnique.length > 1) return { error: `${input.role} 字段存在多个精确候选：${exactUnique.join("、")}` } as const;

  const candidateBases = new Set(input.candidates.map(unitlessFieldName));
  const selectedSemantic = Array.from(new Set(selectedAvailable.filter((field) => candidateBases.has(unitlessFieldName(field)))));
  if (selectedSemantic.length === 1) return { value: selectedSemantic[0] };
  if (selectedSemantic.length > 1) return { error: `${input.role} 字段存在多个用户已选语义候选：${selectedSemantic.join("、")}` };
  const semantic = available.filter((field) => candidateBases.has(unitlessFieldName(field)));
  const semanticUnique = Array.from(new Set(semantic));
  if (semanticUnique.length === 1) return { value: semanticUnique[0] } as const;
  if (semanticUnique.length > 1) return { error: `${input.role} 字段存在多个语义候选：${semanticUnique.join("、")}` } as const;
  return input.optional
    ? ({ value: null } as const)
    : ({ error: `未在 SQL 查询结果中找到 ${input.role} 字段；可用字段：${available.join("、") || "无"}` } as const);
}

function amountSourceUnit(fieldName: string) {
  const name = normalizedFieldName(fieldName);
  if (/(?:亿|亿元)\)?$/u.test(name)) return "亿元";
  if (/(?:万|万元)\)?$/u.test(name)) return "万元";
  if (/(?:元)\)?$/u.test(name)) return "元";
  return null;
}

function pythonString(value: unknown) {
  return JSON.stringify(JSON.stringify(value));
}

function buildGroupedRiskDistributionScript(input: {
  recipe: GroupedRiskDistributionRecipe;
  fields: CompiledSkillAnalysisRecipe["fieldBindings"];
  amountUnit: string;
  dataSourceName: string;
}) {
  const config = {
    fields: input.fields,
    amountUnit: input.amountUnit,
    dataSourceName: input.dataSourceName,
    groupOrder: input.recipe.groupOrder,
    groupRules: input.recipe.groupRules,
    riskRules: input.recipe.riskRules,
    output: input.recipe.output,
  };
  return `# cycle-probe:skill-analysis-recipe-v1
import json
import sys
from decimal import Decimal, InvalidOperation

cfg = json.loads(${pythonString(config)})
rows = json.load(sys.stdin)

def text(value):
    return "" if value is None else str(value).strip()

def decimal_value(value):
    raw = text(value).replace(",", "")
    if not raw:
        return None
    try:
        parsed = Decimal(raw)
        return parsed if parsed.is_finite() and parsed >= 0 else None
    except (InvalidOperation, ValueError):
        return None

def amount_in_wan(value):
    parsed = decimal_value(value)
    if parsed is None:
        return None
    factors = {"元": Decimal("0.0001"), "万元": Decimal("1"), "亿元": Decimal("10000")}
    return parsed * factors[cfg["amountUnit"]]

def source_name(value):
    raw = text(value)
    return raw.split("--", 1)[1].strip() if "--" in raw else raw

def group_name(value):
    raw = source_name(value)
    if not raw:
        return None
    for rule in cfg["groupRules"]:
        if any(keyword in raw for keyword in rule["keywords"]):
            return rule["label"]
    return "其他" if "其他" in cfg["groupOrder"] else None

def risk_name(value):
    raw = source_name(value)
    if not raw:
        return None
    for risk in ("attention", "nonperforming", "normal"):
        if any(keyword in raw for keyword in cfg["riskRules"][risk]):
            return risk
    return None

clean = []
for row in rows:
    group_raw = text(row.get(cfg["fields"]["group"]))
    risk_raw = text(row.get(cfg["fields"]["risk"]))
    group = group_name(group_raw)
    risk = risk_name(risk_raw)
    amount = amount_in_wan(row.get(cfg["fields"]["amount"]))
    if group is None or risk is None or amount is None:
        continue
    record_id = text(row.get(cfg["fields"]["recordId"])) if cfg["fields"]["recordId"] else ""
    clean.append({"group": group, "risk": risk, "amount": amount, "recordId": record_id, "groupRaw": group_raw, "riskRaw": risk_raw})

fallback_code = None
records = clean
if not cfg["fields"]["recordId"]:
    fallback_code = "missing_contract_serial"
elif any(not item["recordId"] for item in clean):
    fallback_code = "blank_contract_serial"
else:
    unique = {}
    conflict = False
    for item in clean:
        signature = (item["groupRaw"], item["riskRaw"], item["amount"])
        previous = unique.get(item["recordId"])
        if previous is not None and previous[0] != signature:
            conflict = True
            break
        unique[item["recordId"]] = (signature, item)
    if conflict:
        fallback_code = "conflicting_contract_records"
    else:
        records = [entry[1] for entry in unique.values()]

risks = ("normal", "attention", "nonperforming")
stats = {group: {"counts": {risk: 0 for risk in risks}, "amounts": {risk: Decimal("0") for risk in risks}} for group in cfg["groupOrder"]}
for item in records:
    stats[item["group"]]["counts"][item["risk"]] += 1
    stats[item["group"]]["amounts"][item["risk"]] += item["amount"]

def ratio(numerator, denominator):
    return None if denominator == 0 else float(numerator / denominator)

def result_row(label, values):
    count_total = sum(values["counts"].values())
    amount_total = sum(values["amounts"].values(), Decimal("0"))
    counts = {risk: values["counts"][risk] for risk in risks}
    amounts = {risk: float(values["amounts"][risk]) for risk in risks}
    counts.update({"total": count_total, "nonperformingRate": ratio(counts["nonperforming"], count_total), "attentionRate": ratio(counts["attention"], count_total)})
    amounts.update({"total": float(amount_total), "nonperformingRate": ratio(values["amounts"]["nonperforming"], amount_total), "attentionRate": ratio(values["amounts"]["attention"], amount_total)})
    return {cfg["output"]["groupLabelKey"]: label, "counts": counts, "amounts": amounts}

distribution = [result_row(group, stats[group]) for group in cfg["groupOrder"]]
overall_values = {
    "counts": {risk: sum(stats[group]["counts"][risk] for group in cfg["groupOrder"]) for risk in risks},
    "amounts": {risk: sum((stats[group]["amounts"][risk] for group in cfg["groupOrder"]), Decimal("0")) for risk in risks},
}
overall = result_row("合计", overall_values)
result = {
    "dataSourceName": cfg["dataSourceName"],
    "sourceFields": {
        "guaranteeMethod": cfg["fields"]["group"],
        "fiveLevelClassification": cfg["fields"]["risk"],
        "amount": cfg["fields"]["amount"],
        "amountSourceUnit": cfg["amountUnit"],
        "contractSerial": cfg["fields"]["recordId"],
    },
    "sourceRowCount": len(rows),
    "countBasis": "valid_rows" if fallback_code else "contract_serial",
    "countBasisField": None if fallback_code else cfg["fields"]["recordId"],
    "fallbackCode": fallback_code,
    "analyzedRecordCount": len(records),
    "excludedRecordCount": len(rows) - len(clean),
    cfg["output"]["distributionKey"]: distribution,
    "overall": overall,
}
for metric in cfg["output"].get("specialMetrics", []):
    result[metric["key"]] = sum(1 for item in records if metric["groupSourceContains"] in source_name(item["groupRaw"]) and item["risk"] == metric["risk"])
result["validation"] = {
    "categorySetReconciled": [row[cfg["output"]["groupLabelKey"]] for row in distribution] == cfg["groupOrder"],
    "countReconciled": sum(row["counts"]["total"] for row in distribution) == overall["counts"]["total"],
    "amountReconciled": sum((stats[group]["amounts"][risk] for group in cfg["groupOrder"] for risk in risks), Decimal("0")) == sum(overall_values["amounts"].values(), Decimal("0")),
}
print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
`;
}

export function compileSkillAnalysisRecipe(input: {
  recipe: Record<string, unknown>;
  availableFields: string[];
  selectedFieldNames?: string[];
  dataSourceName: string;
}): SkillAnalysisRecipeCompilation {
  const recipe = parseRecipe(input.recipe);
  if (!recipe) return { ok: false, error: "Skill 分析配方无效或当前运行时不支持。" };
  const selectedFieldNames = input.selectedFieldNames ?? [];
  const group = resolveRoleField({ role: "group", candidates: recipe.fieldRoles.group.candidates, availableFields: input.availableFields, selectedFieldNames });
  const risk = resolveRoleField({ role: "risk", candidates: recipe.fieldRoles.risk.candidates, availableFields: input.availableFields, selectedFieldNames });
  const amount = resolveRoleField({ role: "amount", candidates: recipe.fieldRoles.amount.candidates, availableFields: input.availableFields, selectedFieldNames });
  const recordId = resolveRoleField({ role: "recordId", candidates: recipe.fieldRoles.recordId.candidates, availableFields: input.availableFields, selectedFieldNames, optional: true });
  if ("error" in group) return { ok: false, error: group.error };
  if ("error" in risk) return { ok: false, error: risk.error };
  if ("error" in amount) return { ok: false, error: amount.error };
  if ("error" in recordId) return { ok: false, error: recordId.error };
  const unit = amountSourceUnit(amount.value as string);
  if (!unit) {
    return { ok: false, error: `无法从真实金额字段“${amount.value}”确认元、万元或亿元单位，请选择带单位的金额字段。` };
  }
  const fieldBindings = {
    group: group.value as string,
    risk: risk.value as string,
    amount: amount.value as string,
    recordId: recordId.value ?? null,
  };
  return {
    ok: true,
    value: {
      fieldBindings,
      script: buildGroupedRiskDistributionScript({
        recipe,
        fields: fieldBindings,
        amountUnit: unit,
        dataSourceName: input.dataSourceName.trim() || "当前数据源",
      }),
    },
  };
}
