import { describe, expect, it } from "vitest";
import { convertCsvValue, parseCsvDictionary, validateCsvRows } from "./semanticFields.js";

const header = "field_order,field_name_zh,field_name_en,business_field_id,source_field_name,logical_type,source_type,sqlite_type,mysql_type,nullable,unique,primary_key,constraints_json,source_example,field_comment,aliases,sensitivity";

describe("semantic field dictionary parser", () => {
  it("accepts unquoted mysql_type values containing commas", () => {
    const result = parseCsvDictionary([
      header,
      "1,贷款余额,loan_balance,credit.loan_balance,贷款余额（万元）,decimal,number,NUMERIC,DECIMAL(18,2),false,false,false,{},1250.50,当前未偿贷款本金余额,本金余额|当前余额,sensitive",
    ].join("\n"));

    expect(result.valid).toBe(true);
    expect(result.definitions[0]?.mysqlType).toBe("DECIMAL(18,2)");
    expect(result.definitions[0]?.businessFieldId).toBe("credit.loan_balance");
  });

  it("accepts relaxed constraints_json objects containing commas", () => {
    const result = parseCsvDictionary([
      header,
      "1,贷款余额,loan_balance,credit.loan_balance,贷款余额（万元）,decimal,number,NUMERIC,DECIMAL(18,2),false,false,false,{min:0,scale:2},1250.50,当前未偿贷款本金余额,本金余额|当前余额,sensitive",
    ].join("\n"));

    expect(result.valid).toBe(true);
    expect(result.definitions[0]?.constraints).toEqual({ min: 0, scale: 2 });
  });

  it("accepts relaxed enum arrays in constraints_json", () => {
    const result = parseCsvDictionary([
      header,
      "1,五级分类,five_level_classification,credit.five_level_classification,风险分类,category,string,TEXT,VARCHAR(16),false,false,false,{enum:[正常,关注,次级,可疑,损失]},正常,贷款五级风险分类,五级分类|风险等级,internal",
    ].join("\n"));

    expect(result.valid).toBe(true);
    expect(result.definitions[0]?.constraints).toEqual({ enum: ["正常", "关注", "次级", "可疑", "损失"] });
  });

  it("accepts standard CSV-escaped JSON objects in constraints_json", () => {
    const result = parseCsvDictionary([
      header,
      '1,贷款余额,loan_balance,credit.loan_balance,贷款余额（万元）,decimal,number,NUMERIC,"DECIMAL(18,2)",false,false,false,"{""min"":0,""scale"":2}",1250.50,当前未偿贷款本金余额,本金余额|当前余额,sensitive',
    ].join("\n"));

    expect(result.valid).toBe(true);
    expect(result.definitions[0]?.mysqlType).toBe("DECIMAL(18,2)");
    expect(result.definitions[0]?.constraints).toEqual({ min: 0, scale: 2 });
  });

  it("accepts standard CSV-escaped JSON arrays in constraints_json", () => {
    const result = parseCsvDictionary([
      header,
      '1,五级分类,five_level_classification,credit.five_level_classification,风险分类,category,string,TEXT,VARCHAR(16),false,false,false,"{""enum"":[""正常"",""关注"",""次级"",""可疑"",""损失""]}",正常,贷款五级风险分类,五级分类|风险等级,internal',
    ].join("\n"));

    expect(result.valid).toBe(true);
    expect(result.definitions[0]?.constraints).toEqual({ enum: ["正常", "关注", "次级", "可疑", "损失"] });
  });

  it("accepts table-dictionary business field ids without builtin dictionary matching", () => {
    const result = parseCsvDictionary([
      header,
      "1,分区日期,p_date,bf.loan_contract.p_date,p_date,date,string,TEXT,DATE,true,false,false,{},2026-06-30,数据分区日期,p_date|统计日期,internal",
      "2,贷款余额,loan_balance,bf.loan_contract.loan_balance,贷款余额（万元）,decimal,number,NUMERIC,DECIMAL(18,2),false,false,false,{min:0},1250.50,贷款余额,本金余额|当前余额,sensitive",
      "3,客户编号,customer_id,bf.loan_contract.customer_id,customer_id,identifier,string,TEXT,VARCHAR(64),true,false,false,{},C001,客户编号,客户号|customer_id,internal",
    ].join("\n"));

    expect(result.valid).toBe(true);
    expect(result.definitions.map((definition) => definition.businessFieldId)).toEqual([
      "bf.loan_contract.p_date",
      "bf.loan_contract.loan_balance",
      "bf.loan_contract.customer_id",
    ]);
  });

  it("accepts code logical type from uploaded table dictionaries", () => {
    const result = parseCsvDictionary([
      header,
      "1,机构代码,branch_code,bf.loan_contract.branch_code,branch_code,code,string,TEXT,VARCHAR(32),true,false,false,{},0012,机构代码,机构号|branch_code,internal",
    ].join("\n"));

    expect(result.valid).toBe(true);
    expect(result.definitions[0]?.logicalType).toBe("code");
    expect(result.definitions[0]?.sqliteType).toBe("TEXT");
  });

  it("accepts name logical type from uploaded table dictionaries", () => {
    const result = parseCsvDictionary([
      header,
      "1,机构名称,branch_name,bf.loan_contract.branch_name,branch_name,name,string,TEXT,VARCHAR(128),true,false,false,{},北京分行,机构名称,分行名称|branch_name,internal",
    ].join("\n"));

    expect(result.valid).toBe(true);
    expect(result.definitions[0]?.logicalType).toBe("name");
    expect(result.definitions[0]?.sqliteType).toBe("TEXT");
  });

  it("accepts dynamic logical types from uploaded table dictionaries", () => {
    const result = parseCsvDictionary([
      header,
      '1,风险分类,risk_class,bf.loan_contract.risk_class,风险分类,enum,文本,TEXT,VARCHAR(20),false,false,false,"{""enum"":[""正常"",""关注""]}",正常,风险分类,"[""五级分类""]",L2_INTERNAL',
      "2,合同金额,contract_amount,bf.loan_contract.contract_amount,合同金额,amount,数值,NUMERIC,DECIMAL(18,2),true,false,false,{min:0},1200.50,合同金额,合同金额|金额,L3_SENSITIVE",
      "3,贷款期限,loan_duration_years,bf.loan_contract.loan_duration_years,贷款期限,duration_years,整数,INTEGER,INT,true,false,false,{min:0},3,贷款期限,期限年,L2_INTERNAL",
      "4,汇率,exchange_rate,bf.loan_contract.exchange_rate,汇率,exchange_rate,数值,NUMERIC,DECIMAL(12,6),true,false,false,{min:0},7.12,汇率,汇率,L2_INTERNAL",
      "5,材料路径,document_path,bf.loan_contract.document_path,材料路径,path,文本,TEXT,VARCHAR(512),true,false,false,{},/tmp/a.pdf,材料路径,文件路径,L2_INTERNAL",
    ].join("\n"));

    expect(result.valid).toBe(true);
    expect(result.definitions.map((definition) => definition.logicalType)).toEqual([
      "enum",
      "amount",
      "duration_years",
      "exchange_rate",
      "path",
    ]);
    expect(result.definitions[0]?.aliases).toEqual(["五级分类"]);
    expect(convertCsvValue("3", result.definitions[2])).toEqual({ ok: true, value: 3 });
  });

  it("treats exported null markers as empty values before type validation", () => {
    const result = parseCsvDictionary([
      header,
      '1,合同终结日期,contract_end_date,bf.loan_contract.contract_end_date,合同终结日期,date,日期,TEXT,DATE,true,false,false,"{""canonical_format"":""YYYY-MM-DD"",""source_format"":""YYYY-MM-DD""}",NULL,合同终结日期,"[""contract end date""]",L3_CONFIDENTIAL',
      "2,合同编号,contract_no,bf.loan_contract.contract_no,合同编号,identifier,文本,TEXT,VARCHAR(64),false,true,true,{},C001,合同编号,合同号,L2_INTERNAL",
    ].join("\n"));

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(convertCsvValue("\\N", result.definitions[0])).toEqual({ ok: true, value: null });

    const nullableValidation = validateCsvRows(
      [{ 合同终结日期: "\\N", 合同编号: "C001" }],
      [
        { sourceHeader: "合同终结日期", definition: result.definitions[0] },
        { sourceHeader: "合同编号", definition: result.definitions[1] },
      ],
    );
    expect(nullableValidation.issues).toHaveLength(0);

    const requiredValidation = validateCsvRows(
      [{ 合同终结日期: "2026-06-30", 合同编号: "NULL" }],
      [
        { sourceHeader: "合同终结日期", definition: result.definitions[0] },
        { sourceHeader: "合同编号", definition: result.definitions[1] },
      ],
    );
    expect(requiredValidation.issues[0]?.code).toBe("PRIMARY_KEY_MISSING");
  });
});
