# Task: Python Runtime Repair and Stop Timing

- Status: completed
- Owner: human + agent
- Started: 2026-08-20
- Completed: 2026-08-20

## Goal

Fix the latest Python execution failure and make stopped-message duration match the frozen Agent active-processing duration.

## Scope

- Prevent Python parameter generation from expanding to the visible script limit with invalid or unused imports.
- Classify and retry the first Python runtime failure once without duplicating the repair path.
- Prevent late async work from mutating a cancelled Agent Run.
- Use the cancelled Run active duration for both the stopped message and the `已处理` display.
- Add focused orchestration, runtime and renderer tests.

## Non-goals

- No changes to Python sandbox permissions, approval policy or data-source access.
- No full regression or interactive page validation.

## Evidence

- Latest failed script length: 15,998 characters.
- Runtime error: `ModuleNotFoundError: No module named 'collections.namedtuple'`.
- Run active duration at cancellation: 197,464ms.
- Persisted stopped text used the approval-resume interval: `你在 1m 37s 后停止了`.
- Late events after `cancelled`: duplicate `fallback`, `preparing_step`, and `step_failed`; persisted Run status returned to `executing`.

## Invariants

- Python still receives only authorized upstream rows.
- Syntax, sandbox, approval, timeout and output validation remain active.
- Terminal Agent Runs cannot be resumed by stale async completions.
- Approval waiting time remains excluded from active-processing duration.

## Verification

- 85 focused orchestration, runtime, prompt and progress-panel tests passed.
- 2 focused dual-model Python tests passed, including runtime repair and noncanonical stdin access.
- Desktop TypeScript typecheck passed.
- `git diff --check` passed.
- Electron `better-sqlite3` ABI was restored after Node-based tests.

## Design Review

- Python import-target validation checks executability only; import count, source layout and stdin coding style remain unrestricted.
- The model-visible tool Schema no longer exposes a maximum script length that can be mistaken for a generation target.
- The existing execution-model fallback is retained but is idempotent per step and abort-aware.
- Terminal Run immutability is enforced in the persistence and progress layers, preventing stale async callbacks from resurrecting cancelled work.
- Active duration remains distinct from approval waiting time and is now the single source for both stopped text and work-duration metadata.
- Existing standard stopped messages are reconciled from their persisted cancelled Run duration when the conversation is loaded.
- Sandbox, approval, timeout, data-source and Artifact boundaries are unchanged.

## Outcome

The logged 15,998-character Python script failed because it imported `collections.namedtuple` and similar attributes as modules. Initial parameter guidance now requires minimal valid imports, and import targets are checked before approval. Runtime repair occurs at most once. Cancelling the run freezes its 197,464ms active duration, suppresses later progress mutations, and renders both duration surfaces as `3m 17s`; the existing mismatched stopped record is corrected when that conversation is loaded after restart.
