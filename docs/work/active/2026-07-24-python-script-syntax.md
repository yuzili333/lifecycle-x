# Task: Python Tool Script Syntax

- Status: completed
- Owner: human + agent
- Started: 2026-07-24

## Goal

Prevent model-generated Python tool parameters from reaching execution with
wrapper markup, and define the actual SQL Artifact input contract.

## Evidence

The latest local tool log recorded `</script>` as the final line of Python tool
call `f6a4b515-bf52-4090-8965-3414d4b9a711`. Python raised
`SyntaxError: invalid syntax` at that line. The same script guessed that input
would arrive through stdin or an undefined global variable.

## Scope

- Normalize boundary code fences and script/code tags before approval.
- Feed the latest authorized SQL rows to Python stdin when the script reads it.
- State the stdin JSON contract in the execution-model prompt.
- Reject residual boundary markup in the server Python validator.
- Add focused regression tests and desktop/server type checks.

## Constraints

- Do not rewrite valid Python business logic.
- Do not expose complete source rows to the model.
- Do not add database access to Python.
- Do not run full regression or interactive page verification.

## Verification

- Local tool log:
  - Confirmed Python tool call `f6a4b515-bf52-4090-8965-3414d4b9a711`
    ended with `</script>` and failed at line 291.
  - Confirmed the generated script expected stdin or an undefined
    `artifact_data` global while the runtime ignored stdin.
- Desktop focused tests:
  - `node ../../node_modules/vitest/vitest.mjs run src/main/assistantRuntime.test.ts`
  - 39 tests passed.
- Server focused tests:
  - `node ../../node_modules/vitest/vitest.mjs run src/pythonRunner.test.ts`
  - 15 tests passed.
- Type checks:
  - `pnpm --filter @lifecycle-x/desktop typecheck`
  - `pnpm --filter @lifecycle-x/server typecheck`
- Mechanical check:
  - `git diff --check`
- Full regression and interactive page verification were not run by request.

## Design Review

- Python wrapper normalization is deterministic and limited to outer Markdown
  fences and `script`, `python`, or `code` tags. Valid business logic is not
  rewritten.
- Normalization occurs before approval and again before execution, so users
  review the executable script and residual wrappers cannot bypass the model
  tool boundary.
- Full SQL rows are resolved from the latest successful local SQL Dataset only
  when the script explicitly consumes stdin. Rows are sent to the isolated
  Python child process and are not added to model context.
- The execution prompt defines one supported input contract:
  `json.load(sys.stdin)`. It prohibits guessed globals and local path access.
- The server validator rejects residual wrapper markup as defense in depth.
- No business-specific field mapping, report fallback, database access, or
  dedicated workflow was introduced.
