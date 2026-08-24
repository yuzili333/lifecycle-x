type JsonRecord = Record<string, unknown>;

export const SKILL_ANALYSIS_RECIPE_MARKER = "# cycle-probe:skill-analysis-recipe-v1";

type FieldRole = "group" | "risk" | "amount" | "recordId";
type OverallRiskFieldRole =
  | "fiveLevelClassification"
  | "riskClassificationResult"
  | "loanBalance"
  | "contractAmount"
  | "contractSerial";

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

type OverallRiskDistributionRecipe = {
  kind: "overall-risk-distribution-v1";
  fieldRoles: Record<OverallRiskFieldRole, { candidates: string[] }>;
  categoryOrder: string[];
};

type SkillAnalysisRecipe = GroupedRiskDistributionRecipe | OverallRiskDistributionRecipe;

export type CompiledSkillAnalysisRecipe = {
  script: string;
  fieldBindings: Record<string, string | null>;
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

function parseGroupedRiskRecipe(value: JsonRecord): GroupedRiskDistributionRecipe | null {
  if (value.kind !== "grouped-risk-distribution-v1") return null;
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

function parseOverallRiskRecipe(value: JsonRecord): OverallRiskDistributionRecipe | null {
  if (value.kind !== "overall-risk-distribution-v1" || !isRecord(value.fieldRoles)) return null;
  const roles = {} as OverallRiskDistributionRecipe["fieldRoles"];
  for (const role of ["fiveLevelClassification", "riskClassificationResult", "loanBalance", "contractAmount", "contractSerial"] as const) {
    const definition = value.fieldRoles[role];
    if (!isRecord(definition)) return null;
    const candidates = stringArray(definition.candidates);
    if (!candidates?.length) return null;
    roles[role] = { candidates };
  }
  const categoryOrder = stringArray(value.categoryOrder);
  if (!categoryOrder?.length) return null;
  return { kind: value.kind, fieldRoles: roles, categoryOrder };
}

function parseRecipe(value: unknown): SkillAnalysisRecipe | null {
  if (!isRecord(value)) return null;
  return parseGroupedRiskRecipe(value) ?? parseOverallRiskRecipe(value);
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
  role: FieldRole | OverallRiskFieldRole;
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
  fields: { group: string; risk: string; amount: string; recordId: string | null };
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
  return `${SKILL_ANALYSIS_RECIPE_MARKER}
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

function buildOverallRiskDistributionScript(input: {
  recipe: OverallRiskDistributionRecipe;
  fields: {
    fiveLevelClassification: string;
    riskClassificationResult: string | null;
    loanBalance: string;
    contractAmount: string | null;
    contractSerial: string | null;
  };
  loanBalanceUnit: string;
  contractAmountUnit: string | null;
  dataSourceName: string;
}) {
  const config = {
    fields: input.fields,
    units: {
      loanBalance: input.loanBalanceUnit,
      contractAmount: input.contractAmountUnit,
    },
    dataSourceName: input.dataSourceName,
    categoryOrder: input.recipe.categoryOrder,
  };
  return `${SKILL_ANALYSIS_RECIPE_MARKER}
# recipe-kind: overall-risk-distribution-v1
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

def risk_category(value):
    raw = text(value)
    if "--" in raw:
        raw = raw.split("--", 1)[1].strip()
    for category in ("损失", "可疑", "次级", "关注", "正常"):
        if category in raw:
            return category
    return None

def ratio(numerator, denominator):
    return None if denominator == 0 else float(numerator / denominator)

clean = []
for row in rows:
    category = risk_category(row.get(cfg["fields"]["fiveLevelClassification"]))
    loan_balance = decimal_value(row.get(cfg["fields"]["loanBalance"]))
    if category is None or loan_balance is None:
        continue
    risk_result = text(row.get(cfg["fields"]["riskClassificationResult"])) if cfg["fields"]["riskClassificationResult"] else ""
    contract_amount = decimal_value(row.get(cfg["fields"]["contractAmount"])) if cfg["fields"]["contractAmount"] else None
    contract_serial = text(row.get(cfg["fields"]["contractSerial"])) if cfg["fields"]["contractSerial"] else ""
    clean.append({
        "category": category,
        "riskResult": risk_result,
        "loanBalance": loan_balance,
        "contractAmount": contract_amount,
        "contractSerial": contract_serial,
    })

fallback_code = None
records = clean
if not cfg["fields"]["contractSerial"]:
    fallback_code = "missing_contract_serial"
elif any(not item["contractSerial"] for item in clean):
    fallback_code = "blank_contract_serial"
else:
    unique = {}
    conflict = False
    for item in clean:
        signature = (item["category"], item["riskResult"], item["loanBalance"], item["contractAmount"])
        previous = unique.get(item["contractSerial"])
        if previous is not None and previous[0] != signature:
            conflict = True
            break
        unique[item["contractSerial"]] = (signature, item)
    if conflict:
        fallback_code = "conflicting_contract_records"
    else:
        records = [entry[1] for entry in unique.values()]

def aggregate(items, category):
    selected = [item for item in items if item["category"] == category]
    count = len(selected)
    loan_balance = sum((item["loanBalance"] for item in selected), Decimal("0"))
    contract_amount = None
    if cfg["fields"]["contractAmount"]:
        contract_amount = sum((item["contractAmount"] for item in selected if item["contractAmount"] is not None), Decimal("0"))
    return count, loan_balance, contract_amount

total_count = len(records)
total_loan_balance = sum((item["loanBalance"] for item in records), Decimal("0"))
total_contract_amount = None
if cfg["fields"]["contractAmount"]:
    total_contract_amount = sum((item["contractAmount"] for item in records if item["contractAmount"] is not None), Decimal("0"))

def distribution_item(category, count, loan_balance, contract_amount):
    return {
        "category": category,
        "count": count,
        "countShare": ratio(Decimal(count), Decimal(total_count)),
        "loanBalance": float(loan_balance),
        "loanBalanceShare": ratio(loan_balance, total_loan_balance),
        "contractAmount": float(contract_amount) if contract_amount is not None else None,
    }

five_level_distribution = []
category_values = {}
for category in cfg["categoryOrder"]:
    values = aggregate(records, category)
    category_values[category] = values
    five_level_distribution.append(distribution_item(category, *values))

nonperforming_categories = ("次级", "可疑", "损失")
nonperforming_count = sum(category_values[category][0] for category in nonperforming_categories)
nonperforming_balance = sum((category_values[category][1] for category in nonperforming_categories), Decimal("0"))
nonperforming_contract_amount = None
if cfg["fields"]["contractAmount"]:
    nonperforming_contract_amount = sum((category_values[category][2] for category in nonperforming_categories), Decimal("0"))

risk_result_distribution = []
if cfg["fields"]["riskClassificationResult"]:
    labels = sorted({item["riskResult"] for item in records if item["riskResult"]})
    for label in labels:
        selected = [item for item in records if item["riskResult"] == label]
        count = len(selected)
        loan_balance = sum((item["loanBalance"] for item in selected), Decimal("0"))
        contract_amount = None
        if cfg["fields"]["contractAmount"]:
            contract_amount = sum((item["contractAmount"] for item in selected if item["contractAmount"] is not None), Decimal("0"))
        risk_result_distribution.append(distribution_item(label, count, loan_balance, contract_amount))

result = {
    "dataSourceName": cfg["dataSourceName"],
    "sourceFields": {
        "fiveLevelClassification": cfg["fields"]["fiveLevelClassification"],
        "riskClassificationResult": cfg["fields"]["riskClassificationResult"],
        "loanBalance": cfg["fields"]["loanBalance"],
        "loanBalanceUnit": cfg["units"]["loanBalance"],
        "contractAmount": cfg["fields"]["contractAmount"],
        "contractAmountUnit": cfg["units"]["contractAmount"],
        "contractSerial": cfg["fields"]["contractSerial"],
    },
    "countBasis": "valid_rows" if fallback_code else "contract_serial",
    "countBasisField": None if fallback_code else cfg["fields"]["contractSerial"],
    "fallbackCode": fallback_code,
    "analyzedRecordCount": total_count,
    "excludedRecordCount": len(rows) - len(clean),
    "totals": {
        "count": total_count,
        "loanBalance": float(total_loan_balance),
        "contractAmount": float(total_contract_amount) if total_contract_amount is not None else None,
    },
    "fiveLevelDistribution": five_level_distribution,
    "nonperformingSummary": distribution_item("不良类", nonperforming_count, nonperforming_balance, nonperforming_contract_amount),
    "riskResultDistribution": risk_result_distribution,
    "validation": {
        "countReconciled": sum(item["count"] for item in five_level_distribution) == total_count,
        "loanBalanceReconciled": sum((category_values[category][1] for category in cfg["categoryOrder"]), Decimal("0")) == total_loan_balance,
        "contractAmountReconciled": total_contract_amount is None or sum((category_values[category][2] for category in cfg["categoryOrder"]), Decimal("0")) == total_contract_amount,
    },
}
print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
`;
}

function compileOverallRiskDistributionRecipe(input: {
  recipe: OverallRiskDistributionRecipe;
  availableFields: string[];
  selectedFieldNames: string[];
  dataSourceName: string;
}): SkillAnalysisRecipeCompilation {
  const resolve = (role: OverallRiskFieldRole, optional = false) => resolveRoleField({
    role,
    candidates: input.recipe.fieldRoles[role].candidates,
    availableFields: input.availableFields,
    selectedFieldNames: input.selectedFieldNames,
    optional,
  });
  const fiveLevelClassification = resolve("fiveLevelClassification");
  const riskClassificationResult = resolve("riskClassificationResult", true);
  const loanBalance = resolve("loanBalance");
  const contractAmount = resolve("contractAmount", true);
  const contractSerial = resolve("contractSerial", true);
  if ("error" in fiveLevelClassification) return { ok: false, error: fiveLevelClassification.error };
  if ("error" in riskClassificationResult) return { ok: false, error: riskClassificationResult.error };
  if ("error" in loanBalance) return { ok: false, error: loanBalance.error };
  if ("error" in contractAmount) return { ok: false, error: contractAmount.error };
  if ("error" in contractSerial) return { ok: false, error: contractSerial.error };
  const fields = {
    fiveLevelClassification: fiveLevelClassification.value as string,
    riskClassificationResult: riskClassificationResult.value,
    loanBalance: loanBalance.value as string,
    contractAmount: contractAmount.value,
    contractSerial: contractSerial.value,
  };
  const loanBalanceUnit = amountSourceUnit(fields.loanBalance);
  if (!loanBalanceUnit) {
    return { ok: false, error: `无法从真实金额字段“${fields.loanBalance}”确认元、万元或亿元单位，请选择带单位的金额字段。` };
  }
  const contractAmountUnit = fields.contractAmount ? amountSourceUnit(fields.contractAmount) : null;
  if (fields.contractAmount && !contractAmountUnit) {
    return { ok: false, error: `无法从真实金额字段“${fields.contractAmount}”确认元、万元或亿元单位，请选择带单位的金额字段。` };
  }
  return {
    ok: true,
    value: {
      fieldBindings: fields,
      script: buildOverallRiskDistributionScript({
        recipe: input.recipe,
        fields,
        loanBalanceUnit,
        contractAmountUnit,
        dataSourceName: input.dataSourceName.trim() || "当前数据源",
      }),
    },
  };
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
  if (recipe.kind === "overall-risk-distribution-v1") {
    return compileOverallRiskDistributionRecipe({
      recipe,
      availableFields: input.availableFields,
      selectedFieldNames,
      dataSourceName: input.dataSourceName,
    });
  }
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
