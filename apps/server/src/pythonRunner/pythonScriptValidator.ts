import type { PythonScriptSafetyCheckResult, PythonScriptSafetyIssue } from "./types.js";

const NETWORK_IMPORTS = new Set(["requests", "urllib", "http", "socket", "aiohttp", "websockets"]);
const SHELL_IMPORTS = new Set(["subprocess", "shlex", "pty"]);
const FILE_IMPORTS = new Set(["pathlib", "shutil", "glob", "tempfile"]);
const DYNAMIC_IMPORTS = new Set(["importlib"]);
const ENV_IMPORTS = new Set(["dotenv", "keyring"]);
const PROCESS_IMPORTS = new Set(["multiprocessing", "signal", "ctypes", "resource", "psutil"]);
const PACKAGE_IMPORTS = new Set(["pip", "conda", "ensurepip", "pkg_resources"]);
const DATABASE_IMPORTS = new Set(["sqlalchemy", "pymysql", "psycopg2", "mysql", "cx_Oracle", "pyodbc"]);

export class PythonScriptValidator {
  constructor(private readonly allowedLibraries: string[]) {}

  validate(script: string): PythonScriptSafetyCheckResult {
    const issues: PythonScriptSafetyIssue[] = [];
    const normalizedScript = script.trim();
    if (!normalizedScript) {
      issues.push(issue("PARSE_FAILED", "error", "Python 脚本不能为空。"));
      return result(issues, [], [], false, false, false, false, false);
    }
    if (hasObviousSyntaxFailure(normalizedScript)) {
      issues.push(issue("PARSE_FAILED", "error", "Python 脚本存在明显语法不完整。"));
    }

    const imports = detectImports(normalizedScript);
    const outputs = detectOutputs(normalizedScript);
    const allowed = new Set(this.allowedLibraries.map((name) => name.toLowerCase()));
    let usesNetwork = false;
    let usesShell = false;
    let usesFileSystem = false;
    let usesDynamicExecution = false;
    let usesDatabaseConnection = false;

    for (const imported of imports) {
      const root = imported.split(".")[0].toLowerCase();
      if (NETWORK_IMPORTS.has(root)) {
        usesNetwork = true;
        issues.push(issue("NETWORK_ACCESS", "critical", `禁止网络访问库：${imported}`));
      } else if (SHELL_IMPORTS.has(root)) {
        usesShell = true;
        issues.push(issue("SHELL_EXECUTION", "critical", `禁止系统命令相关库：${imported}`));
      } else if (DYNAMIC_IMPORTS.has(root)) {
        usesDynamicExecution = true;
        issues.push(issue("DYNAMIC_EXECUTION", "critical", `禁止动态导入或动态执行库：${imported}`));
      } else if (ENV_IMPORTS.has(root)) {
        issues.push(issue("ENV_ACCESS", "critical", `禁止环境密钥相关库：${imported}`));
      } else if (PACKAGE_IMPORTS.has(root)) {
        issues.push(issue("PACKAGE_INSTALL", "critical", `禁止包管理或安装逻辑：${imported}`));
      } else if (DATABASE_IMPORTS.has(root)) {
        usesDatabaseConnection = true;
        issues.push(issue("DATABASE_DIRECT_CONNECTION", "critical", `禁止数据库直连库：${imported}`));
      } else if (FILE_IMPORTS.has(root)) {
        usesFileSystem = true;
        issues.push(issue("UNAUTHORIZED_FILE_ACCESS", "warning", `文件系统库需要受限使用：${imported}`));
      } else if (PROCESS_IMPORTS.has(root)) {
        issues.push(issue("UNSUPPORTED_SCRIPT", "error", `禁止进程或系统资源库：${imported}`));
      } else if (!allowed.has(root)) {
        issues.push(issue("FORBIDDEN_IMPORT", "error", `未在白名单中的 Python 库：${imported}`));
      }
    }

    for (const [pattern, code, message] of FORBIDDEN_CALLS) {
      if (pattern.test(normalizedScript)) {
        if (code === "SHELL_EXECUTION") {
          usesShell = true;
        }
        if (code === "DYNAMIC_EXECUTION") {
          usesDynamicExecution = true;
        }
        if (code === "ENV_ACCESS") {
          usesFileSystem = true;
        }
        if (code === "DATABASE_DIRECT_CONNECTION") {
          usesDatabaseConnection = true;
        }
        if (code === "UNAUTHORIZED_FILE_ACCESS") {
          usesFileSystem = true;
        }
        issues.push(issue(code, "critical", message));
      }
    }

    usesFileSystem = validateSandboxPathLiterals(normalizedScript, issues) || usesFileSystem;
    if (/\bwhile\s+True\s*:/.test(normalizedScript)) {
      issues.push(issue("UNBOUNDED_LOOP_RISK", "warning", "检测到可能无限循环：while True。"));
    }
    if (/\b[A-Za-z_][\w]*\s*=\s*\[[^\]]*\]\s*\*\s*(?:10{6,}|\d{7,})/.test(normalizedScript)) {
      issues.push(issue("MEMORY_RISK", "warning", "检测到可能的大内存列表构造。"));
    }

    return result(issues, imports, outputs, usesFileSystem, usesNetwork, usesShell, usesDynamicExecution, usesDatabaseConnection);
  }
}

const FORBIDDEN_CALLS: Array<[RegExp, PythonScriptSafetyIssue["code"], string]> = [
  [/\bos\s*\.\s*system\s*\(/, "SHELL_EXECUTION", "禁止 os.system 执行系统命令。"],
  [/\bsubprocess\s*\./, "SHELL_EXECUTION", "禁止 subprocess 执行系统命令。"],
  [/\bpopen\s*\(/, "SHELL_EXECUTION", "禁止 popen 执行系统命令。"],
  [/\beval\s*\(/, "DYNAMIC_EXECUTION", "禁止 eval 动态执行。"],
  [/\bexec\s*\(/, "DYNAMIC_EXECUTION", "禁止 exec 动态执行。"],
  [/\bcompile\s*\(/, "DYNAMIC_EXECUTION", "禁止 compile 动态编译执行。"],
  [/\b__import__\s*\(/, "DYNAMIC_EXECUTION", "禁止 __import__ 动态导入。"],
  [/\bos\s*\.\s*environ\b/, "ENV_ACCESS", "禁止读取环境变量。"],
  [/\b(?:pd|pandas)\s*\.\s*read_sql(?:_query)?\s*\(/, "DATABASE_DIRECT_CONNECTION", "禁止 pandas 直接读取 SQL。"],
  [/\bcreate_engine\s*\(/, "DATABASE_DIRECT_CONNECTION", "禁止 SQLAlchemy create_engine 直连数据库。"],
  [/\b(?:mysql|postgresql|postgres|sqlite|oracle|mssql):\/\//i, "DATABASE_DIRECT_CONNECTION", "禁止数据库连接字符串。"],
  [/\bpip\s+install\b|\bconda\s+install\b/, "PACKAGE_INSTALL", "禁止安装 Python 包。"],
  [/\bopen\s*\(\s*['"](?:~|\.env|id_rsa|id_ed25519)/, "UNAUTHORIZED_FILE_ACCESS", "禁止读取敏感文件。"],
];

function validateSandboxPathLiterals(script: string, issues: PythonScriptSafetyIssue[]) {
  let usesFileSystem = false;

  for (const match of script.matchAll(/\bopen\s*\(\s*(['"])([^'"]+)\1\s*(?:,\s*(['"])([^'"]*)\3)?/g)) {
    usesFileSystem = true;
    const mode = match[4] ?? "r";
    const access: "read" | "write" = /[wax+]/.test(mode) ? "write" : "read";
    const message = validateSandboxPath(match[2], access);
    if (message) {
      issues.push(issue("UNAUTHORIZED_FILE_ACCESS", "critical", message));
    }
  }

  for (const match of script.matchAll(/\bPath\s*\(\s*(['"])([^'"]+)\1/g)) {
    usesFileSystem = true;
    const message = validateSandboxPath(match[2], "any");
    if (message) {
      issues.push(issue("UNAUTHORIZED_FILE_ACCESS", "critical", message));
    }
  }

  for (const match of script.matchAll(/\b(?:pd|pandas)\s*\.\s*read_(?:csv|json|excel|parquet)\s*\(\s*(['"])([^'"]+)\1/g)) {
    usesFileSystem = true;
    const message = validateSandboxPath(match[2], "read");
    if (message) {
      issues.push(issue("UNAUTHORIZED_FILE_ACCESS", "critical", "pandas 只能读取注入到沙箱 input/ 下的数据集。"));
    }
  }

  for (const match of script.matchAll(/\bto_(?:csv|json|html)\s*\(\s*(['"])([^'"]+)\1/g)) {
    usesFileSystem = true;
    const message = validateSandboxPath(match[2], "write");
    if (message) {
      issues.push(issue("UNAUTHORIZED_FILE_ACCESS", "critical", message));
    }
  }

  for (const match of script.matchAll(/\bsavefig\s*\(\s*(['"])([^'"]+)\1/g)) {
    usesFileSystem = true;
    const message = validateSandboxPath(match[2], "artifact");
    if (message) {
      issues.push(issue("UNAUTHORIZED_FILE_ACCESS", "critical", "图表文件只能写入沙箱 artifacts/ 目录。"));
    }
  }

  return usesFileSystem;
}

function validateSandboxPath(path: string, access: "read" | "write" | "artifact" | "any") {
  if (/^(?:\/|~|[a-zA-Z]:[\\/])/.test(path) || path.includes("..") || path.includes("://")) {
    return "禁止读取或写入沙箱允许目录之外的路径。";
  }
  if (/(?:^|\/)(?:\.env|id_rsa|id_ed25519)(?:$|\/)/.test(path)) {
    return "禁止读取敏感文件。";
  }
  if (access === "read" && !path.startsWith("input/")) {
    return "Python 脚本只能从沙箱 input/ 目录读取授权数据集。";
  }
  if (access === "write" && !(path.startsWith("output/") || path.startsWith("artifacts/"))) {
    return "Python 脚本只能写入沙箱 output/ 或 artifacts/ 目录。";
  }
  if (access === "artifact" && !path.startsWith("artifacts/")) {
    return "图表文件只能写入沙箱 artifacts/ 目录。";
  }
  if (access === "any" && !(path.startsWith("input/") || path.startsWith("output/") || path.startsWith("artifacts/"))) {
    return "Path 访问只能限定在沙箱 input/、output/ 或 artifacts/ 目录。";
  }
  return null;
}

function detectImports(script: string) {
  const imports = new Set<string>();
  for (const line of script.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      continue;
    }
    const importMatch = trimmed.match(/^import\s+(.+)$/);
    if (importMatch) {
      importMatch[1].split(",").map((part) => part.trim().split(/\s+as\s+/i)[0]).forEach((name) => imports.add(name));
    }
    const fromMatch = trimmed.match(/^from\s+([a-zA-Z_][\w.]*)\s+import\s+/);
    if (fromMatch) {
      imports.add(fromMatch[1]);
    }
  }
  return Array.from(imports);
}

function detectOutputs(script: string) {
  const outputs = new Set<string>();
  const saveFig = script.matchAll(/savefig\s*\(\s*['"]([^'"]+)['"]/g);
  for (const match of saveFig) {
    outputs.add(match[1]);
  }
  const toFile = script.matchAll(/\bto_(?:csv|json|html)\s*\(\s*['"]([^'"]+)['"]/g);
  for (const match of toFile) {
    outputs.add(match[1]);
  }
  return Array.from(outputs);
}

function hasObviousSyntaxFailure(script: string) {
  const opens = (script.match(/\(/g) ?? []).length;
  const closes = (script.match(/\)/g) ?? []).length;
  return opens !== closes;
}

function result(
  issues: PythonScriptSafetyIssue[],
  detectedImports: string[],
  detectedOutputs: string[],
  usesFileSystem: boolean,
  usesNetwork: boolean,
  usesShell: boolean,
  usesDynamicExecution: boolean,
  usesDatabaseConnection: boolean,
): PythonScriptSafetyCheckResult {
  const hasBlockingIssue = issues.some((item) => item.severity === "error" || item.severity === "critical");
  return {
    passed: !hasBlockingIssue,
    level: hasBlockingIssue ? "blocked" : issues.some((item) => item.severity === "warning") ? "warning" : "safe",
    issues,
    detectedImports,
    detectedOutputs,
    usesFileSystem,
    usesNetwork,
    usesShell,
    usesDynamicExecution,
    usesDatabaseConnection,
  };
}

function issue(code: PythonScriptSafetyIssue["code"], severity: PythonScriptSafetyIssue["severity"], message: string): PythonScriptSafetyIssue {
  return { code, severity, message };
}
