# Agent Repository Map

## Project

Lifecycle X is an Electron-based local data analysis assistant for post-loan
data exploration, controlled SQL/Python execution, visualization, and reports.

## Start Here

1. Read [the repository map](docs/repo-map.md).
2. Locate the affected module and read only its relevant architecture notes.
3. Check [active work](docs/work/active/). For non-trivial work, create or
   update a task file from [the task template](docs/work/task-template.md).
4. Preserve the current structure and keep unrelated refactors out of scope.
5. Run mechanical checks, then complete the independent
   [design review](docs/quality/design-review.md).

Renderer work under `apps/desktop/` must also follow
[`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md).

## Core Modules

- Agent and workflow: `apps/desktop/src/main/assistantRuntime.ts`,
  `apps/desktop/src/main/agentOrchestration/`, `apps/desktop/src/main/workflowRuntime.ts`
- Tool orchestration and artifacts: `apps/desktop/src/main/toolOrchestration/`
- SQL execution: `apps/server/src/sqlTool/`
- Python analysis: `apps/server/src/pythonRunner/`
- Visualization: `apps/desktop/src/shared/visualization/`,
  `apps/desktop/src/renderer/src/components/VisualizationRenderer.tsx`
- Reports: `apps/desktop/src/renderer/src/components/tool-calls/`
- CSV and data sources: `apps/server/src/dataManagementStore.ts`,
  `apps/desktop/src/main/chatCsvTempSource.ts`
- Chat UI: `apps/desktop/src/renderer/src/DataAssistantWorkspace.tsx`
- Electron IPC: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`

## Non-Negotiable Boundaries

- Renderer code uses preload IPC and does not access SQLite or Node privileges directly.
- SQL remains read-only, permission-controlled, and audited.
- Python consumes controlled datasets and does not connect to business databases.
- Models receive schemas and summaries, not full source datasets.
- Tool and Artifact lineage is preserved; data and tool results are never fabricated.
- Tests prove encoded assertions only. Design correctness requires a separate review.

## Verification

- Harness only: `pnpm harness:check`
- Fast verification: `pnpm verify:fast`
- Full verification: `pnpm verify`
- Design review: `docs/quality/design-review.md`
- Refactor checkpoint: `docs/quality/refactor-checkpoint.md`

## Documentation Map

- Documentation index: `docs/README.md`
- Repository map: `docs/repo-map.md`
- Architecture and boundaries: `docs/architecture/`
- Decisions: `docs/decisions/`
- Work records: `docs/work/`
- Quality checks: `docs/quality/`
