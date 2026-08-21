type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function schemaTypes(schema: JsonRecord) {
  return Array.isArray(schema.type)
    ? schema.type.filter((item): item is string => typeof item === "string")
    : typeof schema.type === "string" ? [schema.type] : [];
}

function resolveReference(root: JsonRecord, reference: unknown) {
  if (typeof reference !== "string" || !reference.startsWith("#/")) return null;
  let current: unknown = root;
  for (const segment of reference.slice(2).split("/")) {
    if (!isRecord(current)) return null;
    current = current[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return isRecord(current) ? current : null;
}

function matchesType(type: string, value: unknown) {
  if (type === "null") return value === null;
  if (type === "object") return isRecord(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  return true;
}

function validateNode(root: JsonRecord, schema: JsonRecord, value: unknown, path: string, errors: string[], depth: number) {
  if (errors.length >= 12 || depth > 20) return;
  const referenced = resolveReference(root, schema.$ref);
  if (referenced) {
    validateNode(root, referenced, value, path, errors, depth + 1);
    return;
  }
  if ("const" in schema && !Object.is(schema.const, value)) {
    errors.push(`${path} 必须为 ${JSON.stringify(schema.const)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path} 不在允许值范围内`);
    return;
  }
  const types = schemaTypes(schema);
  if (types.length > 0 && !types.some((type) => matchesType(type, value))) {
    errors.push(`${path} 类型应为 ${types.join("|")}`);
    return;
  }
  if (isRecord(value) && (types.includes("object") || isRecord(schema.properties))) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    for (const key of required) {
      if (!(key in value)) errors.push(`${path}.${key} 缺失`);
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value && isRecord(childSchema)) {
        validateNode(root, childSchema, value[key], `${path}.${key}`, errors, depth + 1);
      }
    }
    if (isRecord(schema.additionalProperties)) {
      for (const [key, childValue] of Object.entries(value)) {
        if (!(key in properties)) {
          validateNode(root, schema.additionalProperties, childValue, `${path}.${key}`, errors, depth + 1);
        }
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}.${key} 未在结果契约中定义`);
      }
    }
  }
  if (Array.isArray(value) && types.includes("array")) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path} 至少需要 ${schema.minItems} 项`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${path} 最多允许 ${schema.maxItems} 项`);
    }
    if (isRecord(schema.items)) {
      value.forEach((item, index) => validateNode(root, schema.items as JsonRecord, item, `${path}[${index}]`, errors, depth + 1));
    }
  }
  if (typeof value === "string" && typeof schema.minLength === "number" && value.length < schema.minLength) {
    errors.push(`${path} 不能为空`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path} 不能小于 ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path} 不能大于 ${schema.maximum}`);
  }
}

function contractNode(root: JsonRecord, schema: JsonRecord, depth: number): string {
  if (depth > 12) return "unknown";
  const referenced = resolveReference(root, schema.$ref);
  if (referenced) return contractNode(root, referenced, depth + 1);
  if ("const" in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map((item) => JSON.stringify(item)).join("|");
  const types = schemaTypes(schema);
  if (types.includes("object") || isRecord(schema.properties)) {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const additionalSchema = isRecord(schema.additionalProperties) ? schema.additionalProperties : null;
    const contractProperties: Array<[string, unknown]> = [...Object.entries(properties)];
    for (const key of required) {
      if (typeof key === "string" && !(key in properties) && additionalSchema) {
        contractProperties.push([key, additionalSchema]);
      }
    }
    if (contractProperties.length === 0 && additionalSchema) {
      contractProperties.push(["*", additionalSchema]);
    }
    return `{${contractProperties.map(([key, child]) =>
      `${JSON.stringify(key)}${required.has(key) ? "" : "?"}:${isRecord(child) ? contractNode(root, child, depth + 1) : "unknown"}`
    ).join(",")}}`;
  }
  if (types.includes("array")) {
    return `[${isRecord(schema.items) ? contractNode(root, schema.items, depth + 1) : "unknown"}]`;
  }
  return types.join("|") || "unknown";
}

export function compactSkillResultContract(schema: JsonRecord) {
  return contractNode(schema, schema, 0);
}

export function validateSkillResult(schema: JsonRecord, value: unknown) {
  const errors: string[] = [];
  validateNode(schema, schema, value, "$", errors, 0);
  return { valid: errors.length === 0, errors } as const;
}
