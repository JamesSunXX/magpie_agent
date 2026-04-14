# Harness / Loop Failure Recovery Plan

**Goal:** Let `harness` and `loop` continue from a failed-but-usable workspace instead of forcing operators to restart from scratch.

**Default decisions locked for this plan:**

- Recoverable development failures should surface as `blocked`, not terminal `failed`.
- `harness resume` should continue the same workflow session whenever a usable failure checkpoint exists.
- Re-running `harness submit` with the same goal and PRD should automatically attach to the most recent recoverable session in the same repo.
- Provider conversation continuity should be persisted per role, not as one shared thread for the whole workflow.
- Failed workspaces, documents, and generated artifacts should be kept in place and treated as the next round's starting point.

## Why This Plan Exists

The current workflow distinguishes cleanly between `paused` and `failed`, but that boundary is too strict for real development:

- `paused` sessions can resume safely.
- `failed` sessions stop the workflow even when they already produced useful code, docs, tests, and recovery notes.
- `harness` then treats the inner `loop` failure as a workflow failure, which makes the operator feel like the whole run must restart.
- Provider-native conversation continuity exists in several providers, but workflow state does not persist or restore those provider sessions.

The result is wasted work and ambiguous repo state. Operators keep the failed artifacts, but the system does not know how to continue from them.

## Target Behavior

### 1. Recoverable failures become workflow checkpoints

When `loop` fails after producing a usable workspace and a clear next step, it should no longer be treated as a terminal stop. Instead:

- `loop` records the failure as a recoverable checkpoint.
- `loop` status becomes equivalent to "blocked and awaiting continuation".
- `harness` mirrors that state and remains recoverable from the same development stage.
- `resume` continues from the persisted checkpoint rather than starting a fresh development pass.

Terminal failure remains only for cases where no trustworthy continuation point exists, such as:

- configuration or provider setup failures before development begins
- invalid or missing resume checkpoint data
- broken worktree/bootstrap conditions with no usable workspace
- corrupted session state that cannot safely map back to the last reliable point

### 2. Existing artifacts remain the source of truth

Failed code and documents should not be cleaned up automatically.

The system should preserve:

- current workspace path and mode
- current branch or worktree branch
- generated formal documents and process artifacts
- latest test outputs
- repair evidence and open issue artifacts
- next-round input summaries

The resumed workflow should consume those persisted artifacts directly instead of regenerating them unless regeneration is explicitly required by the recovery step.

### 3. `harness submit` can reconnect to unfinished work

If an operator runs `harness submit` again in the same repo and the system finds a recoverable harness session whose:

- goal matches exactly
- PRD path matches exactly

then `submit` should automatically continue the most recently updated recoverable session instead of creating a new one.

If no matching recoverable session exists, `submit` should behave as it does today and create a new workflow session.

### 4. Provider conversations continue with the same role

Providers that support session continuation should resume the original conversation for the same role:

- `loop` planner continues the planner thread
- `loop` executor continues the executor thread
- `harness` reviewers continue their own reviewer threads
- adjudication continues its own adjudicator thread

Provider sessions must never be shared across roles or across unrelated workflow sessions.

## Implementation Shape

### Key files

- `src/capabilities/loop/application/execute.ts`
- `src/capabilities/workflows/harness/application/execute.ts`
- `src/capabilities/workflows/shared/runtime.ts`
- `src/cli/commands/harness.ts`
- `src/providers/types.ts`
- provider implementations under `src/providers/`

## Task 1: Reclassify recoverable loop failures

Update loop failure handling so recoverable development failures do not collapse into terminal `failed`.

Implementation intent:

- keep true terminal failures as `failed`
- reclassify usable development-stage failures as blocked/recoverable
- preserve `lastReliablePoint`, `lastFailureReason`, workspace metadata, and artifact pointers
- allow `loop resume` to continue from recoverable checkpoints even when the old session would previously have been treated as failed

The recovery decision should depend on persisted evidence, not on string matching. A recoverable failure must have:

- a known current stage
- a usable workspace path
- persisted artifact references for the latest failure or repair step
- a next-round instruction or equivalent continuation hint

## Task 2: Make harness treat recoverable loop failure as resumable

Update harness recovery logic so inner loop failures with usable checkpoints become outer workflow `blocked`, not outer workflow `failed`.

Implementation intent:

- when inner `loop` returns a recoverable failure, persist harness as `blocked` in `developing`
- keep loop session id, loop events path, workspace path, workspace mode, and branch metadata in harness artifacts
- make `harness resume` continue `developing` from that loop session instead of skipping development or opening a new loop run
- keep true terminal loop failures mapped to terminal harness failure

This change must also work for older sessions that were previously written as `failed` but still carry enough evidence to resume safely.

## Task 3: Add automatic reconnect on `harness submit`

Teach `harness submit` to search existing harness sessions before starting a new one.

Match rule for auto-reconnect:

- same repository
- same goal text
- same PRD path
- recoverable session only
- choose the most recently updated match

Behavior:

- if a match exists, `submit` resumes that session
- if no match exists, `submit` creates a new one
- CLI output should clearly say whether the command resumed an existing session or started a fresh one

This is meant to reduce accidental duplicate sessions and make "try again" do the useful thing by default.

## Task 4: Persist provider sessions by role

Formalize provider session persistence in workflow state.

Persisted record per role should include:

- provider identity
- session id
- workflow session id
- role id
- updated time
- whether the provider supports session resume

Suggested role keys:

- `loop.planner`
- `loop.executor`
- `harness.reviewer.<id>`
- `harness.arbitrator`
- validator-specific keys if validators support resume

Implementation intent:

- extend provider-facing interfaces so a session id can be restored into a provider instance
- save provider session ids after each successful provider call that exposes one
- on resume, rehydrate the matching provider session for the same workflow session and role
- if a provider does not support remote session continuation, fall back to current single-call behavior without failing the workflow

## Task 5: Preserve artifact semantics

No automatic cleanup should be introduced in this plan.

Rules:

- do not roll back code
- do not delete generated docs
- do not reset branches or worktrees
- do not discard uncommitted changes created before the recoverable failure
- continue to use existing document-plan routing rules for formal docs and process artifacts

This keeps recovery deterministic: the next run starts from the same concrete workspace the last run left behind.

## Documentation Follow-up

This plan only defines the implementation target.

- update `docs/references/capabilities.md` only after the runtime behavior actually changes
- keep `docs/README.md` in sync immediately so this plan remains discoverable during implementation

## Compatibility Rules

The implementation must handle both new and old sessions.

### New sessions

- always write enough recovery evidence for resume
- always write provider role session metadata when available

### Existing sessions

- if an old failed session has enough recovery evidence, treat it as resumable
- if not, keep current failure behavior and require manual intervention

This avoids breaking older persisted workflows while still making previous useful work recoverable when the data is already there.

## Verification Plan

Automated coverage should include:

- `loop` marks recoverable development failure as resumable instead of terminal failure
- `loop resume` continues from a recoverable checkpoint
- terminal loop failures still remain terminal
- `harness` maps recoverable inner loop failure to outer `blocked`
- `harness resume` continues the original development stage from the original loop session
- `harness submit` auto-reconnects only on exact goal + PRD match
- `harness submit` still creates a new session when no recoverable match exists
- provider session ids persist and restore per role without cross-role leakage
- unsupported-session providers degrade gracefully
- older failed sessions with good evidence can resume
- older failed sessions without good evidence stay failed

Manual checks should confirm:

- current-workspace failure leaves changes in place and resume continues from them
- worktree failure path preserves the worktree and resume continues inside it
- generated docs remain discoverable through persisted artifact paths

## Acceptance Criteria

The work is complete when all of the following are true:

- a failed-but-usable development run no longer forces restart from scratch
- operators can use `harness resume` to continue from the existing failed workspace
- re-running `harness submit` on the same task reconnects to the existing recoverable session by default
- provider conversations continue with the same role-specific session where the provider supports it
- no automatic cleanup removes code, docs, or branches created before the recoverable failure
- true non-recoverable failures still stop cleanly and visibly
