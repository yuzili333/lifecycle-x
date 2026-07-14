import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredTools = [
  "request_sql_query_execution",
  "request_python_analysis_execution",
  "request_chart_rendering",
  "request_markdown_report_generation",
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

async function readText(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

const manifest = await readJson("manifest.json");
assert.equal(manifest.skillId, "overall-risk-classification-distribution");
assert.equal(manifest.name, "overall-risk-classification-distribution");
assert.equal(manifest.displayName, "整体风险分类分布（笔数+金额）");
assert.equal(manifest.sourceType, "local_builtin");
assert.equal(manifest.clientOnly, true);
assert.equal(manifest.enabled, true);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.deepEqual(manifest.requiredTools, requiredTools);
assert.equal(manifest.entryFile, "SKILL.md");
assert.equal(manifest.templateFile, "report-template.md");
assert.equal(manifest.inputSchemaFile, "schemas/skill-input.schema.json");
assert.equal(manifest.reportDataSchemaFile, "schemas/report-data.schema.json");
assert.ok(manifest.aliases.includes("@整体风险分类分布"));
assert.ok(manifest.aliases.includes("@风险分类"));
assert.ok(manifest.aliases.includes("@资产质量分析"));

const skill = await readText("SKILL.md");
assert.match(skill, /^---\nname: overall-risk-classification-distribution\n/s);
assert.ok(skill.includes("request_sql_query_execution"));
assert.ok(skill.includes("request_python_analysis_execution"));
assert.ok(skill.includes("request_chart_rendering"));
assert.ok(skill.includes("request_markdown_report_generation"));
assert.ok(skill.includes("不得使用报告模板中的示例数字"));
assert.ok(skill.includes("正常3 + 全部关注类"));
assert.ok(skill.includes("Tool Flow"));

const template = await readText("report-template.md");
for (const token of [
  "{{reportTitle}}",
  "{{fiveLevelRows}}",
  "{{twelveLevelSection}}",
  "{{sourceDatasetArtifactId}}",
  "{{analysisArtifactId}}",
]) {
  assert.ok(template.includes(token), `missing template token ${token}`);
}

const inputSchema = await readJson("schemas/skill-input.schema.json");
assert.equal(inputSchema.title, "OverallRiskClassificationSkillInput");
assert.equal(inputSchema.additionalProperties, false);
assert.deepEqual(inputSchema.properties.analysisOptions.properties.amountUnit.enum, [
  "yuan",
  "ten_thousand_yuan",
  "hundred_million_yuan",
]);

const reportSchema = await readJson("schemas/report-data.schema.json");
assert.equal(reportSchema.title, "OverallRiskClassificationReportData");
assert.ok(reportSchema.required.includes("artifactRefs"));
assert.ok(reportSchema.required.includes("provenance"));
assert.deepEqual(reportSchema.$defs.fiveLevelItem.properties.classification.enum, [
  "正常",
  "关注",
  "次级",
  "可疑",
  "损失",
  "未识别",
]);

const policy = await readJson("tool-policy.json");
assert.deepEqual(policy.requiredTools, requiredTools);
assert.equal(policy.security.clientOnly, true);
assert.equal(policy.security.allowRemoteMarketplace, false);
assert.equal(policy.security.allowExecutableSkillCode, false);
assert.equal(policy.approval.request_sql_query_execution, "required");
assert.equal(policy.approval.request_python_analysis_execution, "required");

const toolExamples = await readText("examples/tool-call-examples.md");
for (const tool of requiredTools) {
  assert.ok(toolExamples.includes(tool), `missing example for ${tool}`);
}

const exampleReport = await readText("examples/example-report.md");
assert.ok(exampleReport.includes("本示例仅展示报告结构"));
assert.ok(!exampleReport.includes(["92", "55"].join(".") + "亿元"));
assert.ok(!exampleReport.includes(["925", "520"].join(",")));

console.log("overall-risk-classification-distribution skill package is valid");
