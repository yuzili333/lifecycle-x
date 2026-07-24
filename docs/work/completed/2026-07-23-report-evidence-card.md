# Task: Report Evidence Card

- Status: completed
- Owner: human + agent
- Started: 2026-07-23

## Goal

Add a version-bound, system-built evidence card to formal analysis reports so
users can trace data sources, scope, filters, formulas, tool executions,
Artifacts, and lineage without exposing credentials or local paths.

## Scope

Add shared EvidenceCard types and Markdown node parsing, a main-process builder
and resolver, Artifact persistence and report binding, preload IPC, structured
report UI, report prompt/template integration, validation, redaction, and
targeted unit/UI tests.

## Non-goals

No risk decision automation, approval workbench, PDF signing, blockchain
evidence, remote audit platform, new tool engine, or lineage database.

## Constraints

Evidence comes only from persisted Tool Result Registry and Artifact records.
The model cannot construct EvidenceCard JSON. Existing SQL/Python/chart/report
execution semantics and security boundaries remain unchanged.

## Affected Areas

`apps/desktop/src/main/`, `apps/desktop/src/shared/`,
`apps/desktop/src/preload/`, `apps/desktop/src/renderer/`, report prompts and
templates, tests, and architecture documentation.

## Invariants

- Renderer accesses evidence only through preload IPC.
- Failed or missing evidence is never represented as verified.
- Reports remain readable when evidence loading fails.
- Report versions retain their own evidence card.
- Credentials, sensitive parameters, and absolute paths never enter evidence UI.

## Implementation Plan

1. Audit current report, tool, Artifact, version, and custom Markdown protocols.
2. Define and validate the shared EvidenceCard and Markdown node.
3. Build evidence from real tool and Artifact records and persist it with reports.
4. Add permission-checked IPC resolution and structured report rendering.
5. Integrate formal report prompts/templates and degradation behavior.
6. Add builder, lineage, safety, report, version, and UI tests.

## Acceptance Criteria

- Formal reports contain one evidence-card node and no embedded evidence JSON.
- Evidence cards expose all required sections with explicit missing evidence.
- SQL/Python status, approval, duration, rows, fields, and Artifact lineage come
  from persisted records.
- Evidence cards bind to a report Artifact and version and are permission checked.
- Complete, partial, invalid, and unavailable UI states are explicit.
- Targeted tests cover data sources, scope, filters, formulas, executions,
  lineage, redaction, versions, custom nodes, and rendering.

## Verification

- `CI=true pnpm --filter @lifecycle-x/desktop typecheck`
- `node ../../node_modules/vitest/vitest.mjs run src/main/evidenceCard.test.tsx src/main/reportVisualizationMarkdown.test.tsx src/main/assistantRuntime.test.ts src/main/toolOrchestration/toolOrchestration.test.ts`
- Result: 4 test files, 84 tests passed.
- 2026-07-24 refinement: desktop typecheck passed; evidence and report
  Markdown suites passed with 2 files and 26 tests.
- UI coverage uses server rendering for complete, partial, invalid, unavailable,
  report-body continuity, and removal of unsafe temporary image references.
- No interactive page validation was run because the user explicitly requested
  that page validation only run when separately requested.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

Independent re-read conclusion: shared code owns the inert Markdown protocol and
data contract; the main process owns construction, redaction, persistence, and
permission checks; the renderer owns only presentation through preload IPC.
The existing Artifact registry is reused without a parallel database. Evidence
storage failure cannot remove or invalidate the already persisted report.
The presentation refinement keeps lineage collection intact while reducing the
visible card to traceable, decision-relevant Markdown. No renderer access to
tool internals or new execution dependency was introduced.

## Outcome

Formal report versions now bind a system-generated `evidence_card` Artifact.
The full report viewer renders data sources, scope, filters, formulas, SQL and
Python execution summaries, execution-ordered Artifact references, validation,
limitations, and the controlled-analysis statement. Detailed lineage remains
in the evidence Artifact but is not duplicated in the report UI. All visible
evidence content is generated as Markdown and rendered by the same Astryx
Markdown component and styles as the report body. Evidence JSON is not embedded
in report Markdown. Legacy reports are upgraded on first authorized load.

The 2026-07-24 presentation refinement numbers the evidence chapter and child
headings, removes scope prose, sample-range details, SQL text, Python runtime
boundaries, and the visible lineage subsection, and leaves successful
validation notes blank. Query and analysis purposes now come from persisted
planner/tool purposes instead of falling back to the user's original message.

## Acceptance Audit

1. Formal reports contain a fixed evidence node: passed.
2. Data sources are displayed: passed.
3. Analysis scope is displayed: passed.
4. Filters are displayed or explicitly missing: passed.
5. Verified formulas are displayed: passed.
6. SQL executions are displayed with status, approval, duration, rows, and hash: passed.
7. Python executions are displayed without script bodies: passed.
8. Upstream and downstream Artifacts are represented: passed.
9. Artifact rows follow execution order; detailed lineage remains available in
   the evidence Artifact without being duplicated in the report UI: passed.
10. Evidence comes only from persisted tool and Artifact records: passed.
11. Model prompts and schemas prohibit model-authored evidence: passed.
12. Report prose and structured evidence remain separate: passed.
13. UI distinguishes data facts, statistical interpretation, and risk judgment: passed.
14. Controlled-analysis statement is always present: passed.
15. Report Artifact ID and version are permission checked: passed.
16. Missing evidence yields partial or invalid status: passed.
17. Credentials, PII patterns, connection strings, and local paths are redacted: passed.
18. Evidence failure leaves report Markdown readable: passed.
19. UI uses Astryx neutral components and theme tokens: passed.
20. Builder, parser, resolver, security, status, and UI tests pass: passed.
21. Existing tool, report, Artifact, and renderer boundaries were preserved: passed.

## Follow-up

Complex SQL predicates that cannot be represented by the P0 operator parser are
reported as incomplete evidence rather than inferred. A future parser upgrade
can improve coverage without changing the EvidenceCard or IPC contracts.
