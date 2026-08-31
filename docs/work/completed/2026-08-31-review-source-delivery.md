# Task: Review Source Delivery

- Status: completed
- Owner: human + agent
- Started: 2026-08-31
- Archived: 2026-08-31

## Goal

Deliver a curated, reproducible source-review package for “溯据” that is
recommended for macOS Apple Silicon and prepared for honest Windows 11 x64
verification.

## Scope

- Restore Harness task hygiene and deterministic repository checks.
- Add cross-platform setup, doctor, dev, test, verify, and packaging commands.
- Remove personal credentials and paths from shipped source and defaults.
- Document deployment, operation, architecture, originality, and validation.
- Generate a curated source archive with secret scanning, manifest, licenses,
  and SHA-256 evidence.

## Non-goals

- No new product features or agent workflow changes.
- No Tool, Artifact, IPC, SQL, Python-data-boundary, or report protocol changes.
- No signed desktop application, offline model replay, Windows ARM64, Windows
  10, or Intel macOS support.
- No claim of Windows compatibility before a real Windows validation run.

## Constraints

- macOS Apple Silicon is the primary and recommended judge environment.
- Windows 11 x64 uses the identical source archive and remains `pending` until
  independently verified on that platform.
- Reviewers provide their own model API key; no credential enters source,
  documentation, logs, manifests, or archives.
- Packaging starts from a clean committed `HEAD` and uses an explicit allowlist.

## Affected Areas

- Root package and pnpm workspace configuration
- Repository scripts and Python process launch sites
- Authentication defaults and privacy-sensitive fixtures
- `docs/review/`, root README, and release packaging output

## Invariants

- Renderer privileges remain behind preload IPC.
- SQL is read-only, permission-controlled, and audited.
- Python uses controlled datasets and never connects to business databases.
- Models receive schemas and summaries rather than complete source data.
- Tool and Artifact lineage is preserved and no result is fabricated.

## Implementation Plan

1. Restore active/completed work-record hygiene.
2. Implement cross-platform runtime and verification scripts.
3. Remove personal defaults, centralize provider configuration, and clear lint.
4. Add the judge-facing review-document set.
5. Add curated packaging, scanning, licensing, and release evidence.
6. Run mechanical checks, macOS smoke verification, and independent review.

## Acceptance Criteria

- Harness, lint, typecheck, tests, and build pass on the primary environment.
- Setup, doctor, dev, test, verify, and package commands have deterministic
  cross-platform behavior and actionable failures.
- The source archive is below 20 MB and passes allowlist, traversal, symlink,
  secret, personal-path, manifest, and SHA-256 checks.
- Documentation recommends macOS Apple Silicon and labels Windows truthfully.
- Golden Path instructions cover data import through report exports and evidence.

## Verification

- `pnpm install --frozen-lockfile`: passed with explicit pnpm 11 build allowlist.
- `pnpm run setup`: passed on macOS Apple Silicon; Electron 33.4.11 installed
  and `better-sqlite3` rebuilt for the Electron ABI.
- `pnpm verify`: passed Harness, packaging tests, zero-warning lint,
  typecheck, 79 server tests, 396 desktop tests, production build, and doctor.
- `pnpm dev`: waited for the local health endpoint, launched the standard
  Electron runtime, and accepted the generic `analyst` demo login.
- Missing-key gate: opened model settings without crashing or fabricating an
  analysis; the workbench remained usable after closing the gate.
- Shutdown: `Ctrl+C` stopped the health endpoint and all project child
  processes.
- Worktree package scan: 308 intended source-review files, zero secret,
  personal-path, symlink, or traversal findings.
- Windows 11 x64 remains explicitly pending an independent machine run.

## Design Review

- [x] The design is understandable without relying on tests.
- [x] Module boundaries remain clear.
- [x] The implementation is simpler than plausible alternatives.
- [x] No accidental coupling was introduced.
- [x] Error and recovery paths are explicit.
- [x] Generated code was reviewed for unnecessary abstraction.
- [x] Technical debt and follow-up work are recorded.

## Outcome

The review release now has deterministic setup, environment diagnosis,
health-gated startup, ABI-safe tests, zero-warning lint, platform-neutral
packaging, privacy-safe demo defaults, judge-facing documents, and truthful
platform evidence. macOS Apple Silicon is verified and recommended. Windows 11
x64 support code and instructions are present, while the release metadata keeps
that platform pending until a real clean-machine run is recorded.

## Independent Design Review

- Problem fit: a reviewer can find the entrypoint, install the exact supported
  runtime, inspect boundaries, run the product, and reproduce the demo path.
- Architecture: release orchestration remains under root scripts; desktop and
  server Python selection stays inside their existing process boundaries. No
  renderer privilege, IPC, Tool, Artifact, SQL, or report protocol changed.
- Simplicity: the small platform selectors are intentionally duplicated across
  build/runtime package boundaries instead of introducing a new shared package.
  The ZIP writer is isolated and tested, avoiding a platform-specific binary or
  a new runtime dependency.
- Data and safety: packaging is allowlist-based, rejects dirty HEADs, symlinks,
  traversal, high-confidence credentials and personal paths, and includes only
  the authorized de-identified CSV.
- Recovery: test ABI restoration runs in `finally`; startup owns and cleans its
  child process trees; doctor reports actionable platform and native-module
  failures.
- Refactor checkpoint: no broad runtime refactor is justified for this release.
  The remaining Windows evidence is operational validation, not hidden code.

## Follow-up

- Execute the documented Windows 11 x64 clean-environment verification and
  update the manifest only from recorded evidence.
