# Repository Map

## Top-Level Areas

| Area | Responsibility |
| --- | --- |
| `apps/desktop/` | Electron main/preload processes and React workbench |
| `apps/server/` | Authentication, data management, SQL, Python, schema, and memory services |
| `skill/` | Locally installed domain Skill definitions and templates |
| `docs/` | Stable architecture, decisions, work records, and quality checks |
| `goal/`, `plan/` | Requirement and design inputs; not active task status |
| `reports/`, `reference/`, `prototype/` | Report templates, domain references, and product artifacts |
| `scripts/` | Repository-level verification automation |

The repository is a pnpm monorepo. Root scripts coordinate the desktop and
server packages.

## Runtime Surfaces

| Surface | Responsibility | Start Here |
| --- | --- | --- |
| Electron main | Privileged local runtime, IPC, model and workflow coordination | `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/assistantRuntime.ts` |
| Preload | Typed renderer-to-main capability bridge | `apps/desktop/src/preload/index.ts` |
| Renderer | Workbench, chat, data management, tool state, charts, reports | `apps/desktop/src/renderer/src/` |
| Agent orchestration | Routing, planning, execution parameters, progress | `apps/desktop/src/main/agentOrchestration/` |
| Workflow | Dataset materialization, checkpoints, context and memory | `apps/desktop/src/main/workflowRuntime.ts` |
| Tool layer | Tool plans, input resolution, approval state, Artifact registry | `apps/desktop/src/main/toolOrchestration/` |
| SQL | Read-only parsing, safety, permissions, audit, result processing | `apps/server/src/sqlTool/` |
| Python | Script validation, sandbox policy, permissions, audit, results | `apps/server/src/pythonRunner/` |
| Data management | Persistent database/CSV sources and dictionaries | `apps/server/src/dataManagementStore.ts` |
| Temporary CSV | Conversation-scoped imported files and schema context | `apps/desktop/src/main/chatCsvTempSource.ts` |
| Visualization | Shared schema/rules plus React rendering | `apps/desktop/src/shared/visualization/`, `apps/desktop/src/renderer/src/components/VisualizationRenderer.tsx` |
| Reports | Report Markdown, cards, visualization Artifact resolution | `apps/desktop/src/renderer/src/components/tool-calls/`, `apps/desktop/src/main/reportVisualizationArtifactResolver.ts` |

## Change Map

| Change Type | Start Here | Smallest Useful Check |
| --- | --- | --- |
| Agent routing or prompt | `apps/desktop/src/main/agentOrchestration/`, `apps/desktop/src/main/assistantRuntime.ts` | `pnpm --dir apps/desktop test` |
| Tool plans or lineage | `apps/desktop/src/main/toolOrchestration/` | `pnpm --dir apps/desktop test` |
| SQL safety/execution | `apps/server/src/sqlTool/` | `pnpm --filter @lifecycle-x/server test` |
| Python sandbox/execution | `apps/server/src/pythonRunner/` | `pnpm --filter @lifecycle-x/server test` |
| Persistent CSV import | `apps/server/src/dataManagementStore.ts` | `pnpm --filter @lifecycle-x/server test` |
| Temporary chat CSV | `apps/desktop/src/main/chatCsvTempSource.ts` | `pnpm --dir apps/desktop test` |
| Chart protocol/rendering | `apps/desktop/src/shared/visualization/`, `apps/desktop/src/renderer/src/components/VisualizationRenderer.tsx` | `pnpm --dir apps/desktop test` |
| Report rendering | `apps/desktop/src/renderer/src/components/tool-calls/` | `pnpm --dir apps/desktop test` |
| ChatComposer/workbench | `apps/desktop/src/renderer/src/DataAssistantWorkspace.tsx` | `pnpm desktop:typecheck` |
| Data management UI | `apps/desktop/src/renderer/src/DataManagementWorkspace.tsx` | `pnpm desktop:typecheck` |
| Authentication API | `apps/server/src/authApp.ts`, `apps/desktop/src/renderer/src/useAuthStore.ts` | `pnpm --filter @lifecycle-x/server test` |

Renderer UI changes also require the Astryx-specific rules in
[`apps/desktop/AGENTS.md`](../apps/desktop/AGENTS.md).

## Dependency Direction

```text
Renderer -> Preload IPC -> Electron main
Electron main -> Agent/workflow/tool orchestration -> Server capabilities
SQL -> controlled source data -> Workflow Dataset
Python -> Workflow Dataset/Artifact -> Analysis Artifact
Chart -> SQL/Python Artifact -> Visualization Artifact
Report -> existing analysis/chart Artifacts -> Report Artifact
```

Forbidden reverse dependencies and security constraints are defined in
[architecture boundaries](architecture/boundaries.md).

## Verification Map

- Harness structure and links: `pnpm harness:check`
- Harness verifier tests: `pnpm harness:test`
- Lint and type safety: `pnpm lint`, `pnpm typecheck`
- Desktop tests: `pnpm --dir apps/desktop test`
- Server tests: `pnpm --filter @lifecycle-x/server test`
- Fast repository checks: `pnpm verify:fast`
- Full tests and builds: `pnpm verify`

`pnpm verify` temporarily rebuilds `better-sqlite3` for Node-based tests and
restores the Electron ABI in a `finally` step, including failed test runs.

Mechanical checks do not establish requirement or design correctness. Complete
the [design review](quality/design-review.md) independently.
