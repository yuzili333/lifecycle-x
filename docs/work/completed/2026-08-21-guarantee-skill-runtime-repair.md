# Task: Repair Guarantee Risk Skill Runtime

- Status: completed
- Owner: human + agent
- Started: 2026-08-21

## Goal

Make the built-in guarantee-method risk distribution Skill complete reliably while preserving the planner, executor, SQL, Python, and report responsibility boundaries.

## Scope

- Preserve the selected Skill snapshot across resumed Agent steps.
- Give Python parameter generation a compact, exact result contract.
- Validate Python stdout against the selected Skill result Schema before registering a successful Artifact.
- Submit a verified single-source detail SQL skeleton locally when the request has no filter intent.
- Keep fallback attempts bounded and update focused tests and Skill metadata.

## Non-goals

- No hard-coded guarantee statistics implementation.
- No report composition in SQL or Python.
- No changes to report layout or business metrics.
- No full regression or interactive page validation.

## Constraints

- SQL remains read-only and query-only.
- Python consumes authorized upstream rows and produces numeric structured results only.
- Report generation remains model-owned and consumes validated analysis results.
- Existing approval, Artifact lineage, and source selection behavior must remain intact.

## Affected Areas

- `apps/desktop/src/main/assistantRuntime.ts`
- `apps/desktop/src/main/agentOrchestration/modelAdapters.ts`
- `apps/desktop/src/main/skills/SkillResultValidator.ts`
- focused desktop tests
- `skill/guarantee-method-risk-distribution-report/`

## Invariants

- No simulated data, hidden source switching, or physical-field hard coding.
- Filtered SQL still requires execution-model parameter generation.
- Invalid Python results cannot become successful analysis Artifacts.

## Implementation Plan

1. Repair Skill snapshot propagation and stage-scoped prompt construction.
2. Add compact output-contract rendering and runtime result validation.
3. Add deterministic submission for verified unfiltered detail SQL.
4. Bound recovery behavior and update focused tests.
5. Run typecheck, targeted tests, diff checks, and design review.

## Acceptance Criteria

- Resumed steps resolve the same immutable Skill snapshot as the initial Run.
- Python receives only its tool responsibility plus a compact result contract, not report template instructions.
- Python JSON that violates the Skill Schema fails before Artifact registration and can be repaired once.
- Verified unfiltered detail SQL does not spend a model request reproducing table and field identifiers.
- Filtered requests continue through the execution model.

## Verification

- `pnpm --dir apps/desktop typecheck`: passed.
- Focused runtime, Skill, validator, and adapter tests: 96 passed.
- `assistantDualModelRuntime.test.ts`: 39 passed after rebuilding the Node test ABI.
- Electron ABI was restored with `apps/desktop/scripts/rebuild-native-deps.mjs` and verified by loading `better-sqlite3` through Electron.
- `git diff --check`: passed.
- No full regression or interactive page validation was run, as requested.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The Skill is version `1.1.0`. Planner-visible content still describes only the business target and statistical definitions. SQL remains detail-query-only; for this Skill's common unfiltered report request, the runtime submits the already verified table-and-field skeleton without another model round. Filtered requests still use execution-model parameter generation.

Python receives only its stage responsibility and a compact contract derived from the immutable Skill output Schema. Its stdout is validated before the tool call is marked complete or an Artifact is registered. Contract failures are visible as a Python tool failure and may be repaired once. Report generation continues to consume completed analysis Artifacts and remains responsible for Markdown structure and narrative.

The selected Skill snapshot now follows `run.messageId` through resumed steps and is recovered from persisted Run input during post-restart approval. System Skill SQL failures no longer enter the additional high-reliability diagnostic round, and chart protocol failures do not consume SQL/Python correction retries or block independent report completion.

## Follow-up

A live run with the production model and the user's representative 200-row CSV remains useful for measuring end-to-end latency and model first-pass success. Repository tests use deterministic provider fixtures and cannot establish production-provider latency.
