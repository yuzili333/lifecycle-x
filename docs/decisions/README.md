# Architecture Decision Records

Use an ADR for decisions that are important, non-obvious, and expensive to
reverse:

- module or process boundary changes;
- important persisted data model changes;
- tool input/output protocol changes;
- security boundary changes;
- adoption or removal of a key dependency.

Do not create an ADR for ordinary bug fixes, copy changes, or small component
renames.

## Workflow

1. Copy [the ADR template](ADR-000-template.md) to
   `ADR-NNN-short-title.md`.
2. Use the next available number and record the decision date.
3. Keep alternatives and consequences concise.
4. Link the ADR from the affected active task.
5. Mark replaced decisions `Superseded` and link both records; do not rewrite
   accepted history.

Accepted ADRs describe architectural decisions, not implementation logs or
chat transcripts.
