# Milestone 3: Role Orchestration Kernel

## Summary

Milestone 3 focuses on a shared role-orchestration kernel for single-task execution and harness review cycles.

The goal is not to build the long-running scheduler. The goal is to make role assignment, role handoff, per-round artifacts, and role-aware inspection stable enough that both `loop` and `harness` speak the same language.

This milestone must stay compatible with the long-running `harness-server` direction. The background host owns queueing, locking, retries, and service recovery. Milestone 3 owns role structure, round artifacts, and how operators inspect the result.

## Boundaries

### In Scope

- Shared role model and role artifact types
- Role bindings in config for supported entrypoints
- Role roster persistence for `loop` and `harness`
- Per-round role results, open issues, next-round brief, and reliable checkpoints
- Operator-facing summaries in `status`, `inspect`, `attach`, and TUI

### Out of Scope

- Background queueing and scheduler policy
- Repository lease locking
- Multi-task concurrency
- Daemon lifecycle and restart supervision
- New review engines or new validator tools

## Key Changes

### 1. Shared Role Model

Add a shared role model under `src/core/roles/` so `architect`, `developer`, `reviewer`, `tester`, and `arbitrator` can be expressed in one format.

The shared model must cover:

- role identity and bound model/tool
- per-round messages
- review results
- arbitration results
- open issues
- next-round brief
- reliable checkpoints for resume

### 2. Loop Role Integration

`loop` should persist the active role roster for each session and write the initial architect-to-developer handoff when planning is complete.

If a paused session is resumed with different effective bindings, the persisted role roster must be refreshed so inspection reflects reality.

### 3. Harness Role Integration

`harness` should use the same role model for:

- developer execution
- discuss reviewers
- validator checks
- arbitrator output

Every completed cycle must leave one stable role round artifact with:

- participants
- development summary
- test result
- reviewer results
- arbitration result
- open issues
- next-round brief

### 4. Operator-Facing Inspection

Operators should not need to read raw files to understand a session.

`status`, `inspect`, `attach`, and TUI should expose:

- round index
- latest or selected round result
- participants
- reviewer notes
- arbitration summary
- next-round brief

## Interface Expectations

### Config

Role bindings may be configured only where they are actually wired through runtime behavior. Unsupported config surface must not be documented or accepted.

### CLI

`harness status` and `harness inspect` may accept `--cycle <n>` for persisted round lookup. Missing cycles must fail clearly instead of silently printing empty output.

### Artifacts

Role artifacts should be written into the repo-local session tree and stay readable after resume.

## Test Plan

- `loop` persists role roster and refreshes it on resume when effective bindings change
- `harness` role roster keeps configured reviewer identities instead of replacing them with generic numbering
- validator findings are attributed to the correct reviewer role
- `status`, `inspect`, and `attach` show round summaries from persisted role artifacts
- `status --cycle` and `inspect --cycle` fail clearly when the requested round does not exist
- TUI shows round summaries without reading ad hoc state

## Acceptance

- `loop` and `harness` both produce stable role artifacts
- persisted role artifacts match the providers that actually ran
- round inspection output is consistent across CLI and TUI
- the milestone stops before scheduler, queue, or daemon ownership begins
