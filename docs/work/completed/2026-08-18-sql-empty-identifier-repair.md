# Task: SQL Empty Identifier Repair

- Status: completed
- Owner: human + agent
- Started: 2026-08-18

## Goal

Prevent SQL parameter generation from returning empty identifiers or table-less placeholder queries for a verified temporary CSV source.

## Findings

- The latest plan correctly resolved one table and four required fields.
- The SQL execution model still received about 12.9k characters containing duplicate Skill, full-schema, and history context.
- The first SQL was only 10 characters and did not reference the selected table; the executor retry returned a 32-character query with an empty quoted identifier.
- After the second local preflight failure, no high-reliability SQL parameter fallback existed.

## Implementation Plan

1. Add an executable SELECT skeleton to the verified SQL scope context.
2. Omit duplicate Skill, full-schema, and history content when verified SQL scope fields are available.
3. Make SQL repair prompts direct the model to copy the verified skeleton.
4. Add one reasoning-model fallback after the executor retry still fails local SQL preflight.
5. Add focused context, preflight, and dual-model tests; run typecheck and diff check.

## Verification

- `pnpm --filter @lifecycle-x/desktop typecheck`
- `pnpm --dir apps/desktop exec vitest run src/main/assistantRuntime.test.ts src/main/sqliteSqlRewrite.test.ts` (59 passed)
- `pnpm exec vitest run src/main/assistantDualModelRuntime.test.ts -t "uses the verified SQL skeleton"` (1 passed)
- `pnpm --dir apps/desktop exec vitest run src/main/agentOrchestration/thinkingOptimization.test.ts` (21 passed)
- `git diff --check`
- Electron ABI restored with `apps/desktop/scripts/rebuild-native-deps.mjs` after the Node-targeted integration test.

## Design Review

- Verified SQL scope remains derived from the planner output intersected with the real temporary CSV Schema.
- The execution model receives less duplicated context without losing the selected table, required fields, step purpose, approval mode, or user request.
- The generated skeleton is only an input constraint; SQL remains model-submitted, locally validated, read-only, permission-controlled, and audited.
- The reasoning fallback runs only after the execution model and its single repair both fail local SQL preflight.
- No data-source switching, fabricated field, implicit filter, or local business calculation was introduced.

## Outcome

- SQL execution context now omits duplicate Skill instructions, full-table Schema, selected-field mapping, and conversation history when a verified temporary-source field scope is available.
- The verified scope renders a complete `SELECT ... FROM ... AS T1` skeleton using exact SQLite-quoted table and field names.
- Initial and repair prompts require direct skeleton reuse and explicitly forbid empty identifiers, placeholders, and missing `FROM` clauses.
- A second local preflight failure now triggers one high-reliability reasoning-model parameter repair instead of immediately failing the remaining workflow.
- The focused integration test reproduces the latest table-less short SQL followed by `SELECT "" FROM ""`, then verifies successful skeleton-based repair.
