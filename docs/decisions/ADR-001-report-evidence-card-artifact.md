# ADR-001: Store Report Evidence Cards as Version-Bound Artifacts

- Status: Accepted
- Date: 2026-07-23

## Context

Reports need auditable evidence derived from existing tool calls and Artifact
lineage. The evidence must follow report versions, survive report rendering
failures, and remain permission checked without introducing a parallel audit
database.

## Decision

Build EvidenceCard records in the Electron main process from the existing Tool
Result Registry and Artifact Manager. Persist each card as an `evidence_card`
Artifact and bind its ID and status to one report Artifact version. Markdown
contains only an inert evidence-card reference. Renderer code resolves the card
through a report-scoped preload IPC endpoint.

## Consequences

Evidence inherits existing local persistence, ownership, and lineage
mechanisms. Report rendering remains lightweight and does not expose evidence
JSON. Artifact types and report metadata gain a backward-compatible extension,
and formal report creation must build and validate evidence before completion.

## Alternatives Considered

- Embed the full EvidenceCard JSON in Markdown: rejected because it duplicates
  audit data and risks leaking internal details.
- Add dedicated evidence database tables: rejected as a parallel audit system.
- Let the report model write evidence prose: rejected because it cannot prove
  actual execution or lineage.

## Follow-up

Verify version isolation, permission checks, redaction, incomplete lineage
degradation, and report readability when evidence resolution fails.
