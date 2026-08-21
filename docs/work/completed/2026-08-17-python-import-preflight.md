# Task: Python Import Preflight

- Status: completed
- Owner: human + agent
- Started: 2026-08-17

## Goal

Prevent model-generated Python scripts from reaching approval and execution with invalid standard-library imports such as `import collections.namedtuple`.

## Scope

- Validate model-generated Python import structure during the existing local preflight.
- Reject repeated or pathological import lists before tool-call creation.
- Clarify the execution-model import and script-length contract.
- Allow one controlled repair for a runtime `ModuleNotFoundError` if preflight cannot detect it.

## Non-goals

- Execute the user script or resolve third-party packages during validation.
- Change Python sandbox permissions or install packages.
- Run full regression or page validation.

## Constraints

- Validation remains local and deterministic.
- Python continues to use authorized upstream rows through stdin.
- Valid symbol imports such as `from collections import namedtuple` remain supported.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- Focused main-process tests.

## Invariants

- Python syntax, Decimal consistency, safety and approval checks remain active.
- Infrastructure failures are not treated as script repair candidates.
- No model-generated script is silently rewritten into different business logic.

## Implementation Plan

1. Add AST-based import target and import-bloat checks to Python preflight.
2. Strengthen Python parameter instructions and repair context.
3. Classify missing-module script errors as repairable once.
4. Add focused tests and run type checking.
5. Complete design review.

## Acceptance Criteria

- `import collections.namedtuple` fails before approval.
- `from collections import namedtuple` passes preflight.
- Repeated import padding fails before approval and triggers the existing one-time preflight repair.
- Focused tests and desktop type checking pass.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/agentOrchestration/thinkingOptimization.test.ts` passed: 70 tests.
- `pnpm --filter @lifecycle-x/desktop typecheck` passed.
- `git diff --check` passed.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The failed script was a valid Python syntax tree but contained an 8,000-character padded import statement that treated standard-library attributes as modules. Local preflight now validates dotted standard-library module targets through isolated Python metadata resolution, rejects repeated imports and import lists over 32 entries, and sends the validation error through the existing single parameter-repair attempt before approval. Execution prompts now state that 8,000 characters is an upper bound rather than a target and define valid module versus symbol import forms. Missing-module runtime errors are repairable once if they evade preflight.

## Follow-up

The server safety validator still checks import permission by root module. Import existence remains a desktop parameter-quality check because it uses the same isolated Python runtime that will execute the script.
