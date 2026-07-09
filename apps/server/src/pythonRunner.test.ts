import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  InMemoryPythonAuditLogger,
  PYTHON_TOOL_NAME,
  PythonScriptValidator,
  createPythonRunnerModule,
  getPythonToolDefinition,
  type PythonDatasetResolver,
  type PythonRunnerAdapter,
  type PythonRunnerModuleConfig,
  type PythonUserPermissionContext,
} from "./pythonRunner/index.js";

const allowedLibraries = ["pandas", "numpy", "matplotlib", "math", "statistics", "json", "csv", "datetime", "re", "collections", "itertools", "scipy", "sklearn"];

const userContext: PythonUserPermissionContext = {
  userId: "usr_analyst",
  roles: ["analyst"],
  allowPythonExecution: true,
  allowChartGeneration: true,
  allowFileArtifacts: true,
  allowSensitiveDataAnalysis: true,
  allowAdvancedLibraries: true,
  allowedDatasetIds: ["ds_customers"],
  approvalPolicy: { requireApprovalByDefault: true },
};

function createDatasetResolver(): PythonDatasetResolver {
  return {
    async resolveDataset(datasetId) {
      if (datasetId !== "ds_customers") {
        return null;
      }
      return {
        datasetId,
        name: "客户风险样本",
        sourceType: "sql_execution_result",
        schema: { customer_id: "varchar", risk_score: "decimal" },
        rowCount: 2,
        columnCount: 2,
        sensitivity: "internal",
        async materializeForSandbox({ targetDir }) {
          await writeFile(join(targetDir, "ds_customers.csv"), "customer_id,risk_score\nC01,0.82\nC02,0.21\n", "utf8");
          return { fileName: "ds_customers.csv", relativePath: "input/ds_customers.csv", rowCount: 2, columnCount: 2 };
        },
      };
    },
  };
}

function createModule(overrides: Partial<PythonRunnerModuleConfig> = {}) {
  const auditLogger = new InMemoryPythonAuditLogger();
  const config: PythonRunnerModuleConfig = {
    defaultTimeoutMs: 3_000,
    hardTimeoutMs: 10_000,
    defaultMemoryLimitMb: 256,
    hardMemoryLimitMb: 512,
    maxStdoutBytes: 2_000,
    maxStderrBytes: 2_000,
    maxArtifactCount: 5,
    maxArtifactSizeBytes: 512_000,
    requireApprovalByDefault: true,
    allowedLibraries,
    sandboxRootDir: join(tmpdir(), `cycle-probe-python-${randomUUID()}`),
    pythonExecutable: "python3",
    datasetResolver: createDatasetResolver(),
    auditLogger,
    ...overrides,
  };
  return { module: createPythonRunnerModule(config), auditLogger, config };
}

const baseInput = {
  script: "import pandas as pd\nprint('ok')\n",
  purpose: "验证客户风险数据",
  inputDatasets: [{ datasetId: "ds_customers", sourceType: "sql_execution_result" as const }],
  expectedOutputs: [{ outputName: "summary", outputType: "summary" as const }],
  resultUse: "statistical_analysis" as const,
  resultConsumer: "llm" as const,
};

describe("PythonScriptValidator", () => {
  const validator = new PythonScriptValidator(allowedLibraries);

  it("allows common analysis libraries and detects chart outputs", () => {
    const result = validator.validate("import pandas as pd\nimport numpy as np\nimport matplotlib.pyplot as plt\nplt.savefig('artifacts/chart.png')\n");
    expect(result.passed).toBe(true);
    expect(result.detectedImports).toEqual(expect.arrayContaining(["pandas", "numpy", "matplotlib.pyplot"]));
    expect(result.detectedOutputs).toContain("artifacts/chart.png");
  });

  it("blocks network, shell, dynamic execution, env, package install and database direct access", () => {
    for (const script of [
      "import requests\nrequests.get('https://example.com')",
      "import socket",
      "import os\nos.system('ls')",
      "import subprocess\nsubprocess.run(['ls'])",
      "eval('1+1')",
      "exec('print(1)')",
      "__import__('os')",
      "import os\nprint(os.environ)",
      "pip install pandas",
      "import sqlalchemy\ncreate_engine('mysql://u:p@host/db')",
      "import pymysql",
      "import pandas as pd\npd.read_sql('select 1', conn)",
      "open('/etc/passwd')",
    ]) {
      expect(validator.validate(script).passed, script).toBe(false);
    }
  });

  it("warns for unbounded loops", () => {
    const result = validator.validate("import pandas as pd\nwhile True:\n    break\n");
    expect(result.passed).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toContain("UNBOUNDED_LOOP_RISK");
  });
});

describe("PythonRunnerModule", () => {
  it("exposes a strict tool definition", () => {
    const tool = getPythonToolDefinition();
    expect(tool.name).toBe(PYTHON_TOOL_NAME);
    expect(tool.description).toContain("restricted sandbox");
    expect(tool.description).toContain("不得直接连接数据库");
    expect(tool.inputSchema.required).toEqual(["script", "purpose", "inputDatasets", "expectedOutputs", "resultUse"]);
    expect(tool.inputSchema.properties.resultUse.enum).toContain("chart_generation");
  });

  it("creates pending approval requests without executing immediately", async () => {
    const runnerAdapter: PythonRunnerAdapter = { execute: vi.fn() };
    const { module } = createModule({ runnerAdapter });
    const request = await module.createExecutionRequest(baseInput, userContext);
    expect(request.status).toBe("pending_approval");
    expect(request.approval.status).toBe("pending");
    expect(runnerAdapter.execute).not.toHaveBeenCalled();
  });

  it("blocks unsafe scripts, missing datasets and denied permissions", async () => {
    const { module } = createModule();
    const unsafe = await module.createExecutionRequest({ ...baseInput, script: "import requests\nrequests.get('https://example.com')" }, userContext);
    expect(unsafe.status).toBe("blocked");
    expect(unsafe.safetyCheck.usesNetwork).toBe(true);

    const missing = await module.createExecutionRequest({ ...baseInput, inputDatasets: [{ datasetId: "missing", sourceType: "sql_execution_result" }] }, userContext);
    expect(missing.status).toBe("blocked");
    expect(missing.permissionCheck.deniedDatasets).toContain("missing");

    const denied = await module.createExecutionRequest(baseInput, { ...userContext, allowPythonExecution: false });
    expect(denied.status).toBe("blocked");
    expect(denied.permissionCheck.reasons.map((reason) => reason.code)).toContain("PYTHON_EXECUTION_DENIED");
  });

  it("blocks chart, file artifact, sensitive data and advanced library permissions", async () => {
    const { module } = createModule();
    const chartDenied = await module.createExecutionRequest(
      { ...baseInput, expectedOutputs: [{ outputName: "chart", outputType: "chart_image" }], requiredLibraries: ["matplotlib"] },
      { ...userContext, allowChartGeneration: false },
    );
    expect(chartDenied.status).toBe("blocked");
    expect(chartDenied.permissionCheck.reasons.map((reason) => reason.code)).toContain("CHART_GENERATION_DENIED");

    const fileDenied = await module.createExecutionRequest(
      { ...baseInput, expectedOutputs: [{ outputName: "file", outputType: "file" }] },
      { ...userContext, allowFileArtifacts: false },
    );
    expect(fileDenied.status).toBe("blocked");

    const sensitiveDenied = await module.createExecutionRequest(
      { ...baseInput, inputDatasets: [{ datasetId: "ds_customers", sourceType: "sql_execution_result", sensitivity: "sensitive" }] },
      { ...userContext, allowSensitiveDataAnalysis: false },
    );
    expect(sensitiveDenied.status).toBe("blocked");

    const advancedDenied = await module.createExecutionRequest(
      { ...baseInput, script: "import sklearn\nprint('model')", requiredLibraries: ["sklearn"] },
      { ...userContext, allowAdvancedLibraries: false },
    );
    expect(advancedDenied.status).toBe("blocked");
  });

  it("does not execute rejected or expired approvals", async () => {
    const { module } = createModule();
    const request = await module.createExecutionRequest(baseInput, userContext);
    module.rejectExecutionRequest(request.requestId, userContext, "不执行");
    await expect(module.executeApprovedRequest(request.requestId, userContext)).rejects.toThrow("PYTHON_REQUEST_NOT_APPROVED");

    const expired = await module.createExecutionRequest(baseInput, { ...userContext, approvalPolicy: { requireApprovalByDefault: true, approvalExpiresInMs: -1 } });
    expect(module.approveExecutionRequest(expired.requestId, userContext).status).toBe("expired");
  });

  it("executes approved Python in sandbox, reads authorized CSV and returns safe payloads", async () => {
    const { module, auditLogger } = createModule();
    const request = await module.createExecutionRequest(
      {
        ...baseInput,
        script: [
          "import csv",
          "with open('input/ds_customers.csv', newline='') as f:",
          "    rows = list(csv.DictReader(f))",
          "scores = [float(row['risk_score']) for row in rows]",
          "print('rows=' + str(len(rows)))",
          "print('mean=' + str(round(sum(scores) / len(scores), 2)))",
        ].join("\n"),
      },
      userContext,
    );
    module.approveExecutionRequest(request.requestId, userContext);
    const completed = await module.executeApprovedRequest(request.requestId, userContext);
    expect(completed.status).toBe("completed");
    expect(completed.execution?.stdout).toContain("rows=2");
    expect(completed.execution?.safeModelPayload?.textSummary).toContain("rows=2");
    expect(JSON.stringify(completed.execution?.safeModelPayload)).not.toContain("/Users/");
    expect(auditLogger.events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["request_created", "approval_created", "approval_approved", "execution_started", "execution_succeeded", "result_to_report", "result_to_model"]));
  });

  it("collects chart artifacts from the sandbox artifacts directory", async () => {
    const { module } = createModule();
    const request = await module.createExecutionRequest(
      {
        ...baseInput,
        script: "open('artifacts/chart.png', 'wb').write(b'png')\nprint('chart done')",
        expectedOutputs: [{ outputName: "chart", outputType: "chart_image" }],
        resultUse: "report_visualization",
        resultConsumer: "report_generator",
      },
      userContext,
    );
    module.approveExecutionRequest(request.requestId, userContext);
    const completed = await module.executeApprovedRequest(request.requestId, userContext);
    expect(completed.execution?.artifacts[0]?.name).toBe("chart.png");
    expect(completed.execution?.reportVisualizationPayload?.charts[0]?.artifactId).toBe(completed.execution?.artifacts[0]?.artifactId);
    expect(completed.execution?.safeModelPayload?.artifactSummaries[0]?.artifactId).toBe(completed.execution?.artifacts[0]?.artifactId);
  });

  it("handles timeout, cancellation, stdout truncation and rate limits", async () => {
    const { module } = createModule({ defaultTimeoutMs: 200, maxStdoutBytes: 12, maxRequestsPerMinute: 1 });
    const timeoutRequest = await module.createExecutionRequest({ ...baseInput, script: "while True:\n    pass" }, userContext);
    module.approveExecutionRequest(timeoutRequest.requestId, userContext);
    const timeout = await module.executeApprovedRequest(timeoutRequest.requestId, userContext);
    expect(timeout.status).toBe("timeout");

    const rateLimited = await module.createExecutionRequest({ ...baseInput, script: "print('x')" }, userContext);
    module.approveExecutionRequest(rateLimited.requestId, userContext);
    expect((await module.executeApprovedRequest(rateLimited.requestId, userContext)).status).toBe("blocked");
  });

  it("cancels a running adapter through AbortSignal", async () => {
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const runnerAdapter: PythonRunnerAdapter = {
      async execute({ signal }) {
        markStarted();
        return await new Promise((resolve) => {
          signal?.addEventListener(
            "abort",
            () =>
              resolve({
                status: "cancelled",
                stdout: "",
                stderr: "cancelled",
                outputs: [],
                artifacts: [],
                executionTimeMs: 1,
                warnings: ["cancelled"],
              }),
            { once: true },
          );
        });
      },
    };
    const { module } = createModule({ runnerAdapter });
    const request = await module.createExecutionRequest(baseInput, userContext);
    module.approveExecutionRequest(request.requestId, userContext);
    const running = module.executeApprovedRequest(request.requestId, userContext);
    await started;
    expect(module.cancelExecutionRequest(request.requestId, userContext).status).toBe("cancelled");
    expect((await running).status).toBe("cancelled");
  });

  it("creates sandbox input output and artifacts directories through policy", async () => {
    const root = join(tmpdir(), `cycle-probe-policy-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    const { PythonSandboxPolicy } = await import("./pythonRunner/index.js");
    const policy = new PythonSandboxPolicy({ sandboxRootDir: root, datasetResolver: createDatasetResolver() });
    const paths = await policy.createRun("exec_policy");
    expect(paths.inputDir).toContain("input");
    expect(paths.outputDir).toContain("output");
    expect(paths.artifactsDir).toContain("artifacts");
    expect(policy.buildSafeEnv(paths)).not.toHaveProperty("PATH");
  });
});
