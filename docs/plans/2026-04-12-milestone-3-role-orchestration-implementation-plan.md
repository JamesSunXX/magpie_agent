# Milestone 3 Implementation Plan

## Summary

This plan turns Milestone 3 into a concrete sequence that can be implemented without crossing into `harness-server` scheduler work.

## Workstreams

### 1. Shared Role Foundation

- add shared role types, message types, round result types, and persistence helpers under `src/core/roles/`
- export the shared role helpers from `src/core/index.ts`
- extend persisted session types so role roster and reliable checkpoints can be stored safely

Acceptance:

- both `loop` and `harness` can import the same role types
- role artifacts can be serialized without capability-specific adapters

### 2. Loop Integration

- wire role bindings into actual loop provider selection
- persist role roster and architect-to-developer handoff
- refresh persisted role roster on resume when effective bindings change
- write next-round brief when a task stops short of completion

Acceptance:

- `loop` session artifacts show the same providers that really ran
- resume does not leave stale role metadata
- blocked or unfinished runs leave a reusable next-round brief

### 3. Harness Integration

- build harness role roster from configured reviewers, validators, and arbitrator
- persist per-cycle role round artifacts
- keep configured reviewer identities in persisted results
- preserve pending review checkpoints until the cycle is fully recorded

Acceptance:

- multi-reviewer runs keep reviewer identity in role artifacts
- validator findings map to the correct reviewer role
- crash recovery can resume from a persisted review checkpoint

### 4. Inspection Surfaces

- `status` and `inspect` show round index plus latest or selected round details
- `attach` prints round context before live events and emits round conclusion summaries
- TUI cards show stage, round history, a short reason, and next step
- selected harness sessions show a supplementary summary area with participants, reviewer notes, decision, and next step

Acceptance:

- `status`, `inspect`, `attach`, and TUI describe the same round outcome
- `--cycle` errors clearly when the requested round does not exist
- users can understand a session without opening raw files

### 5. Documentation and Closeout

- add Milestone 3 planning docs
- reflect finished display behavior back into the implementation plan
- record the closeout checklist and requirement audit
- require future display-detail work to land in docs before code

Acceptance:

- the plan documents match implemented behavior
- closeout documents identify Milestone 3 as complete

## Explicit Acceptance Items

- `harness status <session-id> --cycle 2` works for existing rounds and fails clearly for missing ones
- `harness inspect` and `attach` surface reviewer notes and arbitration summary
- TUI harness cards show round history and a short why/next summary
- selected harness sessions show a richer supplementary summary
- all role-related output keeps configured reviewer identity where available

## Stop Line

Stop Milestone 3 once role artifacts, inspection surfaces, and documentation are aligned.

Do not continue into queueing, background orchestration, or service recovery policy in this milestone.
