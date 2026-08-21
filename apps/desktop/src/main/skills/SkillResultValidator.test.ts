import { describe, expect, it } from "vitest";
import { compactSkillResultContract, validateSkillResult } from "./SkillResultValidator";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["basis", "rows", "validation"],
  properties: {
    basis: { type: "string", enum: ["contract_serial", "valid_rows"] },
    rows: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/row" },
    },
    validation: {
      type: "object",
      additionalProperties: false,
      required: ["reconciled"],
      properties: { reconciled: { const: true } },
    },
  },
  $defs: {
    row: {
      type: "object",
      additionalProperties: false,
      required: ["name", "count", "rate"],
      properties: {
        name: { type: "string", minLength: 1 },
        count: { type: "integer", minimum: 0 },
        rate: { type: ["number", "null"], minimum: 0, maximum: 1 },
      },
    },
  },
};

describe("Skill result contract", () => {
  it("renders a compact producer contract with references resolved", () => {
    const contract = compactSkillResultContract(schema);
    expect(contract).toContain('"basis":"contract_serial"|"valid_rows"');
    expect(contract).toContain('"rows":[{"name":string,"count":integer,"rate":number|null}]');
    expect(contract).toContain('"validation":{"reconciled":true}');
    expect(contract).not.toContain("$defs");
  });

  it("accepts a matching result and rejects missing, extra, and invalid values", () => {
    expect(validateSkillResult(schema, {
      basis: "contract_serial",
      rows: [{ name: "保证", count: 2, rate: 0.25 }],
      validation: { reconciled: true },
    })).toEqual({ valid: true, errors: [] });

    const invalid = validateSkillResult(schema, {
      basis: "unknown",
      rows: [{ name: "", count: 1.5, rate: 2, extra: true }],
      validation: { reconciled: false },
      markdown: "should not be here",
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join("\n")).toContain("$.basis 不在允许值范围内");
    expect(invalid.errors.join("\n")).toContain("$.rows[0].count 类型应为 integer");
    expect(invalid.errors.join("\n")).toContain("$.validation.reconciled 必须为 true");
    expect(invalid.errors.join("\n")).toContain("$.markdown 未在结果契约中定义");
  });

  it("renders and validates required dynamic object properties", () => {
    const dynamicSchema = {
      type: "object",
      required: ["sourceFields"],
      properties: {
        sourceFields: {
          type: "object",
          required: ["contractSerial", "amount"],
          additionalProperties: { type: ["string", "null"] },
        },
      },
    };
    expect(compactSkillResultContract(dynamicSchema)).toContain(
      '"sourceFields":{"contractSerial":string|null,"amount":string|null}',
    );
    expect(validateSkillResult(dynamicSchema, {
      sourceFields: { contractSerial: "合同流水号", amount: 10 },
    }).errors).toContain("$.sourceFields.amount 类型应为 string|null");
  });
});
