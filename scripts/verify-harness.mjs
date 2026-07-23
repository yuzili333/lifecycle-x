import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_PATHS = [
  "AGENTS.md",
  "README.md",
  "docs/README.md",
  "docs/repo-map.md",
  "docs/architecture/overview.md",
  "docs/architecture/boundaries.md",
  "docs/decisions/README.md",
  "docs/decisions/ADR-000-template.md",
  "docs/work/README.md",
  "docs/work/task-template.md",
  "docs/work/active",
  "docs/work/completed",
  "docs/quality/design-review.md",
  "docs/quality/refactor-checkpoint.md",
  "scripts/verify-project.mjs",
];

const REQUIRED_PROJECT_PATHS = [
  "apps/desktop/src/main/index.ts",
  "apps/desktop/src/main/assistantRuntime.ts",
  "apps/desktop/src/main/agentOrchestration",
  "apps/desktop/src/main/toolOrchestration",
  "apps/desktop/src/main/workflowRuntime.ts",
  "apps/desktop/src/preload/index.ts",
  "apps/desktop/src/renderer/src",
  "apps/desktop/src/shared/visualization",
  "apps/server/src/dataManagementStore.ts",
  "apps/server/src/sqlTool",
  "apps/server/src/pythonRunner",
];

const REQUIRED_SCRIPTS = ["harness:check", "harness:test", "verify:fast", "verify"];

const REQUIRED_TASK_HEADINGS = [
  "Goal",
  "Scope",
  "Non-goals",
  "Constraints",
  "Affected Areas",
  "Invariants",
  "Implementation Plan",
  "Acceptance Criteria",
  "Verification",
  "Design Review",
  "Outcome",
  "Follow-up",
];

const REQUIRED_ADR_HEADINGS = [
  "Context",
  "Decision",
  "Consequences",
  "Alternatives Considered",
  "Follow-up",
];

function displayPath(rootDir, filePath) {
  const path = relative(rootDir, filePath) || ".";
  return path.split(sep).join("/");
}

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
  });
}

function markdownTargets(markdown) {
  const targets = [];
  const pattern = /\[[^\]\r\n]*\]\(([^)\r\n]+)\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const raw = match[1].trim();
    const target = raw.startsWith("<")
      ? raw.slice(1, raw.indexOf(">"))
      : raw.split(/\s+["'(]/, 1)[0];
    if (target) targets.push(target);
  }
  return targets;
}

function localLinkPath(sourcePath, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return null;
  const pathWithoutAnchor = target.split("#", 1)[0].split("?", 1)[0];
  if (!pathWithoutAnchor) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathWithoutAnchor);
  } catch {
    decoded = pathWithoutAnchor;
  }
  return isAbsolute(decoded) ? decoded : resolve(dirname(sourcePath), decoded);
}

function validateTask(rootDir, taskPath) {
  const errors = [];
  const markdown = readFileSync(taskPath, "utf8");
  const shownPath = displayPath(rootDir, taskPath);
  if (!/^- Status:\s*active\s*$/m.test(markdown)) {
    errors.push(`${shownPath}: missing "- Status: active".`);
  }
  if (!/^- Owner:\s*\S.+$/m.test(markdown)) {
    errors.push(`${shownPath}: missing task Owner.`);
  }
  if (!/^- Started:\s*\d{4}-\d{2}-\d{2}\s*$/m.test(markdown)) {
    errors.push(`${shownPath}: Started must use YYYY-MM-DD.`);
  }
  for (const heading of REQUIRED_TASK_HEADINGS) {
    if (!new RegExp(`^## ${heading}\\s*$`, "m").test(markdown)) {
      errors.push(`${shownPath}: missing "## ${heading}".`);
    }
  }
  return errors;
}

function validateTemplateHeadings(rootDir, templatePath, headings) {
  if (!existsSync(templatePath)) return [];
  const markdown = readFileSync(templatePath, "utf8");
  const shownPath = displayPath(rootDir, templatePath);
  return headings
    .filter((heading) => !new RegExp(`^## ${heading}\\s*$`, "m").test(markdown))
    .map((heading) => `${shownPath}: missing "## ${heading}".`);
}

export function verifyHarness(rootDir = process.cwd()) {
  const root = resolve(rootDir);
  const errors = [];

  for (const repositoryPath of [...REQUIRED_PATHS, ...REQUIRED_PROJECT_PATHS]) {
    const absolutePath = resolve(root, repositoryPath);
    if (!existsSync(absolutePath)) {
      errors.push(`Missing required path: ${repositoryPath}`);
    }
  }

  const packagePath = resolve(root, "package.json");
  if (existsSync(packagePath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
      for (const script of REQUIRED_SCRIPTS) {
        if (typeof packageJson.scripts?.[script] !== "string" || !packageJson.scripts[script].trim()) {
          errors.push(`package.json: missing script "${script}".`);
        }
      }
    } catch {
      errors.push("package.json: invalid JSON.");
    }
  } else {
    errors.push("Missing required path: package.json");
  }

  const linkSources = [
    resolve(root, "AGENTS.md"),
    resolve(root, "README.md"),
    resolve(root, "apps/desktop/AGENTS.md"),
    resolve(root, "apps/desktop/README.md"),
    ...markdownFiles(resolve(root, "docs")),
  ].filter((filePath, index, values) => existsSync(filePath) && values.indexOf(filePath) === index);

  for (const sourcePath of linkSources) {
    const markdown = readFileSync(sourcePath, "utf8");
    for (const target of markdownTargets(markdown)) {
      if (isAbsolute(target) || /^[a-z]:[\\/]/i.test(target)) {
        errors.push(`${displayPath(root, sourcePath)}: absolute local link is not portable.`);
        continue;
      }
      const linkedPath = localLinkPath(sourcePath, target);
      if (linkedPath && !existsSync(linkedPath)) {
        errors.push(`${displayPath(root, sourcePath)}: broken link "${target}".`);
      }
    }
  }

  errors.push(...validateTemplateHeadings(
    root,
    resolve(root, "docs/work/task-template.md"),
    REQUIRED_TASK_HEADINGS,
  ));
  errors.push(...validateTemplateHeadings(
    root,
    resolve(root, "docs/decisions/ADR-000-template.md"),
    REQUIRED_ADR_HEADINGS,
  ));

  const activeDirectory = resolve(root, "docs/work/active");
  if (existsSync(activeDirectory) && statSync(activeDirectory).isDirectory()) {
    const activeTasks = readdirSync(activeDirectory)
      .filter((name) => name.endsWith(".md"))
      .map((name) => resolve(activeDirectory, name));
    for (const taskPath of activeTasks) {
      errors.push(...validateTask(root, taskPath));
    }
  }

  return errors;
}

export function formatHarnessResult(errors) {
  if (errors.length === 0) {
    return "Harness check passed.";
  }
  return ["Harness check failed:", ...errors.map((error) => `- ${error}`)].join("\n");
}

function cliRoot(argumentsList) {
  const rootIndex = argumentsList.indexOf("--root");
  return rootIndex >= 0 && argumentsList[rootIndex + 1] ? argumentsList[rootIndex + 1] : process.cwd();
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const errors = verifyHarness(cliRoot(process.argv.slice(2)));
  console.log(formatHarnessResult(errors));
  if (errors.length > 0) process.exitCode = 1;
}
