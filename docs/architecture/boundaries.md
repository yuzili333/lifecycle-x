# Architecture Boundaries

These are stable constraints. Changes that intentionally alter one require an
ADR and explicit design review.

## Process Boundaries

```text
Renderer
-> calls typed preload IPC
-> does not import Node/Electron privileged modules
-> does not open SQLite or business database connections

Preload
-> exposes the narrow application API
-> does not move business orchestration into the renderer

Electron main
-> owns local privileged operations and persisted Agent state
-> validates user and conversation ownership before returning Artifacts
```

## Agent and Model Boundaries

```text
Planner
-> selects goals, tools, dependencies, and input sources
-> does not generate authoritative tool results

Execution model
-> generates parameters for one planned tool
-> does not change the plan or add unrequested analysis

Model context
-> receives schemas, mappings, summaries, and necessary Artifact references
-> does not receive full source datasets or credentials
```

Raw reasoning is not user-visible project state. Decisions, tasks, constraints,
and verification evidence belong in repository documents.

## Tool Boundaries

```text
SQL
-> reads authorized source data
-> remains read-only, permission-controlled, safety-checked, and audited

Python
-> reads controlled Workflow Datasets or Artifacts
-> does not connect directly to business databases
-> does not fabricate rows when input is unavailable

Chart
-> consumes SQL/Python results
-> does not re-query source databases or invent missing measures

Report
-> consumes registered analysis/chart Artifacts
-> does not silently recompute or invent key metrics
```

Every tool can validate its own request. Workflow ordering may provide inputs,
but safety validation must not depend on an unrelated tool having run.

## Data and Lineage Boundaries

- A failed source is not replaced with an unselected source or simulated data.
- Multi-source results retain their source identity; conflicts are explicit.
- Tool calls and Artifacts preserve parent call and source Artifact identifiers.
- Conversation-scoped temporary CSV data is not promoted to persistent data
  without an explicit import operation.
- Sensitive data, API keys, database credentials, full result sets, and raw
  scripts are not written into Harness documents or ordinary observation logs.

## Change Discipline

- Prefer existing abstractions and small reversible changes.
- Do not redesign stable business modules to make them easier for an Agent to read.
- A passing test suite does not prove the requirement, data semantics, security
  boundary, or user experience is correct.
- Large changes complete both the
  [design review](../quality/design-review.md) and
  [refactor checkpoint](../quality/refactor-checkpoint.md).
