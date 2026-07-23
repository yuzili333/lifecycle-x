# Refactor Checkpoint

Run this after a substantial batch of generated code, repeated changes to the
same module, a third instance of similar logic, a new important abstraction, a
cross-module fix, or before an important release.

## The Ugliness Question

> Is this code ugly, confusing, duplicated, or harder than necessary?

## Inspect

- Duplicate logic
- Oversized files and functions
- Thin wrappers with no real value
- Unnecessary interfaces or factories
- Leaky module boundaries
- Repeated prompt or schema definitions
- Inconsistent error models
- Dead code and stale feature flags
- Stale documentation
- Tests coupled to implementation details
- Temporary code that became permanent

## Decide

For each issue, choose one:

- Refactor now
- Record as follow-up
- Accept deliberately
- Delete

## Verify

After refactoring, rerun the relevant mechanical checks, repeat the
[design review](design-review.md), and update the task Outcome. This is a human
checkpoint, not a background Agent or automated quality score.
