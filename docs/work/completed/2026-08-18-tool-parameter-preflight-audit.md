# Task: Tool Parameter Preflight Audit

- Status: completed
- Owner: human + agent
- Started: 2026-08-18

## Goal

Keep SQL/Python preflight focused on executable and security-critical failures without triggering model regeneration for harmless implementation choices.

## Scope

Audit recent failures, relax duplicate-import and Decimal-style checks, broaden the Python stdin/JSON contract, and make empty SQL identifier detection context-aware.

## Non-goals

Do not remove read-only SQL enforcement, selected-source enforcement, Python syntax checks, script-size limits, permissions, sandboxing, or Artifact contracts.

## Constraints

Local preflight must be deterministic and must not call a model. Non-blocking quality preferences belong in prompts or telemetry, not execution gates.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/sqliteSqlRewrite.ts`
- Focused SQL/Python validation tests

## Invariants

- Invalid SQL identifiers and syntax do not reach approval or execution.
- Python must consume authorized stdin and emit JSON to stdout.
- Harmless duplicate imports and valid alternative JSON I/O forms are executable.
- Runtime failures remain visible and eligible for the existing single repair path.

## Implementation Plan

1. Classify recent validation failures by necessity and false-positive risk.
2. Remove non-safety Python style gates.
3. Broaden equivalent Python input/output forms.
4. Restrict empty double-quoted SQL detection to identifier contexts.
5. Run focused tests, typecheck, diff check, and design review.

## Acceptance Criteria

- Duplicate imports no longer trigger parameter regeneration.
- Decimal usage does not reject unrelated integer division during preflight.
- `json.loads(sys.stdin.read())` and `json.dump(result, sys.stdout)` satisfy the analysis contract.
- Empty SQL string expressions are allowed while empty qualified fields and FROM/JOIN targets remain blocked.

## Verification

- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/sqliteSqlRewrite.test.ts` (60 tests passed)
- `pnpm --filter @lifecycle-x/desktop typecheck` (passed)
- `git diff --check` (passed)
- Full regression and interactive page validation were not run, per project/user scope.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

- Recent logs confirmed that local validation itself completes quickly; the long delay comes from starting another model request after a blocking result.
- Retained blocking checks for SQL read-only safety, complete identifiers/syntax, selected source, planned fields and SQLite preparation.
- Retained blocking checks for Python script presence/size, AST syntax, invalid module targets and controlled stdin/JSON output.
- Removed duplicate-import and Decimal calculation-style failures because they are not syntax or security failures and can reject executable scripts.
- Broadened the Python data contract to accept equivalent `json.loads(sys.stdin.read())` and `json.dump(..., sys.stdout)` forms.
- Made empty double-quoted SQL tokens context-aware so valid SQLite empty-string expressions do not trigger regeneration, while empty qualified fields and table targets remain blocked.
- `ParameterRepairEngine` was reviewed and remains limited to required parameter/type validation; it does not perform model-backed preflight.

## Follow-up

- Provider output truncation, missing tool calls and model timeouts are separate from local preflight. They should remain observable as model/protocol failures rather than be attributed to validation.
- If regeneration latency remains high, measure retry counts by validation reason and consider a no-model deterministic repair only for narrowly provable syntax normalization. Do not weaken execution safety checks.
