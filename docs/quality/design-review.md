# Design Review Checklist

Use this after implementation and mechanical verification. A green test suite
proves only that encoded assertions passed; it does not prove that requirements,
architecture, data semantics, safety, or user experience are correct.

## Problem Fit

- Does the change solve the stated problem?
- Did implementation accidentally broaden or narrow the scope?
- Are important user paths or acceptance conditions still missing?

## Architecture

- Is the responsibility in the correct process and module?
- Were existing abstractions reused appropriately?
- Did the change introduce reverse dependencies or hidden coupling?
- Is the state model and ownership explicit?

## Simplicity

- Is there a smaller design that meets the same goal?
- Did generated code add unnecessary interfaces, factories, layers, or types?
- Are names and boundaries clearer after the change?

## Data and Safety

- Are inputs, outputs, and Artifact lineage traceable?
- Are failure and recovery paths deterministic?
- Does any fallback fabricate data, hide failure, or switch sources silently?
- Are permissions and process boundaries preserved?

## Maintainability

- Is logic duplicated?
- Are files or functions becoming too large?
- Does the implementation preserve repository conventions?
- Is deferred debt recorded in the task Follow-up?

## Independent Re-Read

After checks pass, stop and review the diff as another developer would. Record
the conclusion in the task file. The reviewer may be the same developer
returning with a fresh review pass.
