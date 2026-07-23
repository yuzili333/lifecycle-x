# Work Records

Use a task record for work that changes multiple files, alters behavior or
boundaries, needs staged verification, or is likely to continue across
sessions. Small isolated fixes do not require one.

## Lifecycle

1. Check `active/` for an existing record.
2. Copy [the task template](task-template.md) to
   `active/YYYY-MM-DD-short-task-name.md`.
3. Define scope, non-goals, invariants, and observable acceptance criteria
   before implementation.
4. Keep the plan and verification evidence current without copying chat logs.
5. Run mechanical checks, then perform the independent design review.
6. Fill Outcome and Follow-up, set `Status: completed`, and move the file to
   `completed/`.

Tasks are concise records of intent and evidence, not chronological journals.
Known debt is either resolved, accepted explicitly, or recorded in Follow-up.
