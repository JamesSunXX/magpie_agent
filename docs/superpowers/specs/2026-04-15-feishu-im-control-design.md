# Feishu IM Control Design

## Summary

Magpie will gain a lightweight Feishu IM control layer that sits in front of existing `loop`, `harness`, and `harness-server` flows instead of replacing them.

The rollout is milestone-based:

1. First, unblock human confirmation from Feishu threads.
2. Then, allow Feishu users to launch development tasks.
3. Finally, support both command-style and form-style task creation.

The chosen approach is to keep Magpie's core workflow engine unchanged and add a Feishu-facing bridge that translates Feishu messages and card actions into existing Magpie commands and state transitions.

## Goals

- Let operators handle paused human-confirmation gates from Feishu instead of editing local files.
- Let Feishu users create development tasks without moving to the CLI.
- Keep one Feishu thread as the single conversation surface for one task.
- Reuse existing Magpie workflow execution, persistence, queueing, and notification behavior.
- Keep approval actions restricted to a configured whitelist while allowing any group member to start a task.

## Non-Goals

- Rewriting `loop` or `harness` into Feishu-native workflow engines.
- Making Feishu the only control surface; CLI flows remain valid.
- Building a general-purpose chat agent that understands arbitrary natural-language requests on day one.
- Introducing a separate workflow state store that competes with `.magpie/`.

## Current State

Magpie already has the following pieces:

- Feishu outbound notifications through the notifications integration layer.
- Existing human-confirmation pause/resume behavior in `loop`.
- Existing CLI approval and rejection commands for paused confirmations.
- Existing long-running execution paths through `harness-server`.

The missing piece is inbound IM control: receiving Feishu events, mapping them to Magpie sessions, checking permissions, applying decisions, and writing results back into the originating thread.

## Chosen Approach

### Option A: Lightweight bridge on top of existing workflows

Add a Feishu entry service that:

- receives Feishu message and card callbacks
- authenticates and authorizes the actor
- resolves the target task thread and Magpie session
- invokes the existing Magpie actions
- posts status updates back to the same Feishu thread

This is the recommended approach because it ships incrementally, preserves the current workflow engine, and keeps CLI and Feishu behavior aligned.

### Option B: Separate Feishu-specific workflow path

Build a parallel Feishu-native flow and reuse only some Magpie internals.

This is rejected because it would split behavior between CLI and Feishu, increase maintenance cost, and make future behavior drift likely.

### Option C: Full Feishu-first rewrite

Treat Feishu as the primary runtime and demote the CLI to an implementation detail.

This is rejected because the scope is too large, rollout risk is too high, and it would duplicate stable workflow logic that already exists.

## System Design

### Control Layer Placement

The Feishu control layer should live in `src/platform/` because it is an external integration boundary. It should not embed workflow logic in CLI entrypoints or directly in capability internals.

Suggested shape:

- `src/platform/integrations/im/`
- `src/platform/integrations/im/feishu/`
- a small inbound service or runner that handles Feishu events
- a translator that maps Feishu actions to Magpie actions
- a thread/session mapping store persisted under `.magpie/`

### Execution Model

Feishu does not execute workflows itself. Instead, it drives existing runtime surfaces:

- human confirmation uses the existing loop confirmation decision flow
- task creation launches either `harness` or `loop`
- long-running work uses `harness-server` or the existing foreground path

This keeps one source of truth for workflow state and avoids introducing Feishu-only workflow behavior.

### Thread Mapping

One task maps to one Feishu thread.

Each mapping record stores at least:

- Feishu chat identifier
- Feishu root message identifier
- Feishu thread identifier
- Magpie capability (`loop` or `harness`)
- Magpie session identifier
- current task status
- last processed Feishu event identifier

This mapping is used for both outbound updates and inbound action resolution.

### Permission Model

Permissions are intentionally asymmetric:

- any group member may create a task
- only configured whitelist users may approve, reject, or continue a paused task

Rejected or unauthorized actions do not mutate workflow state. They receive a visible response in the same thread.

### Source of Truth

Persistent workflow state remains inside Magpie session artifacts under `.magpie/`.

Feishu thread messages are a presentation and control surface only. If Feishu content and Magpie state disagree, Magpie state wins and Feishu should be corrected by a follow-up thread update.

## Milestones

### Milestone 1: Feishu Human Confirmation

Scope:

- When `loop` or `harness` pauses for human confirmation, Magpie posts a confirmation card into the mapped Feishu thread.
- The thread supports:
  - approve
  - reject
  - rejection reason
  - additional continuation instruction
- Approval resumes the paused workflow.
- Rejection records the reason and triggers the current follow-up behavior.
- Additional continuation instruction is persisted as operator guidance for the resumed run.
- Only whitelist users may perform these actions.

Success criteria:

- operators no longer need to edit local confirmation files for supported sessions
- one confirmation acts once even if buttons are clicked repeatedly
- all decisions are attributable to a specific Feishu user

### Milestone 2: Feishu Task Creation

Scope:

- Any group member can create a new development task from Feishu.
- Magpie creates a new thread for the task if needed and binds it to the workflow session.
- Task routing is type-based:
  - formal requirement delivery goes to `harness`
  - small tasks, fixes, and lightweight development go to `loop`
- The thread receives status updates as the task proceeds.

Success criteria:

- a new task can be launched from Feishu without switching to the CLI
- the created task is visible and traceable as one Feishu thread plus one Magpie session
- routing is predictable and reviewable

### Milestone 3: Dual Entry Modes

Scope:

- support command-style task creation for fast input
- support form-style task creation for structured input
- normalize both entry modes into the same internal task-creation path

Success criteria:

- both entry modes create identical downstream behavior after normalization
- thread ownership, permission checks, and status updates stay consistent

## Interaction Rules

### Human Confirmation Flow

1. Magpie pauses and persists the pending confirmation in its normal session artifacts.
2. Magpie resolves the mapped Feishu thread for the task.
3. Magpie posts a confirmation card with summary, risk, and allowed actions.
4. A whitelist user approves, rejects, or rejects with updated instruction.
5. The Feishu bridge validates actor, deduplicates the action, resolves the session, and invokes the existing Magpie confirmation action.
6. Magpie resumes, stays paused, or creates follow-up work according to existing workflow rules.
7. The thread receives the result and next-step summary.

### Task Creation Flow

1. A group member creates a task from Feishu.
2. The Feishu bridge validates input and classifies the task.
3. The bridge creates or schedules the appropriate Magpie workflow.
4. Magpie persists the session and returns the session identifier.
5. The bridge posts the task summary into the new task thread and binds the mapping.
6. Subsequent updates and controls use the same thread.

## Failure Semantics

- Feishu outbound send failure does not cancel the workflow; the send failure is recorded and can be retried.
- Feishu callback handling failure does not partially mutate the workflow; the thread gets a retryable error response.
- Duplicate callback delivery must be ignored using Feishu event identifiers plus action dedupe keys.
- If Feishu state and Magpie state diverge, the bridge reloads Magpie state and posts a corrective thread update.
- Unauthorized approval attempts do not change workflow state and are visible in-thread.

## Data and Persistence

Suggested persisted record for thread mappings:

```json
{
  "threadId": "feishu-thread-id",
  "rootMessageId": "feishu-root-message-id",
  "chatId": "feishu-chat-id",
  "capability": "loop",
  "sessionId": "loop-123",
  "status": "paused_for_human",
  "lastEventId": "feishu-event-456",
  "createdAt": "2026-04-15T00:00:00.000Z",
  "updatedAt": "2026-04-15T00:00:00.000Z"
}
```

Storage should remain repository-local alongside other session artifacts so that task control remains inspectable and recoverable with the workflow state.

## Implementation Boundaries

- Feishu inbound event handling belongs in platform integrations, not capability business logic.
- Workflow decisions continue to live in existing `loop` and `harness` code paths.
- Existing CLI confirmation and resume actions should be reused rather than reimplemented.
- The Feishu bridge may call capability entrypoints directly or invoke the same internal action helpers already used by CLI commands.

## Verification Plan

Milestone 1 verification:

- simulate a paused confirmation and resolve it from Feishu callbacks
- verify approve, reject, reject-with-reason, and reject-with-extra-instruction
- verify duplicate clicks do not double-apply
- verify unauthorized users are blocked

Milestone 2 verification:

- create both a `loop` task and a `harness` task from Feishu input
- verify task-to-thread mapping is created
- verify status updates return to the same thread

Milestone 3 verification:

- create equivalent tasks from command-style and form-style entry
- verify both normalize to the same internal request shape

## Open Decisions Locked During Brainstorming

The following product decisions were explicitly chosen and should stay fixed for implementation unless changed by a later approved design revision:

- Start with milestone 1 before task creation.
- Milestone 1 includes approve, reject, rejection reason, and updated continuation instruction.
- Final product supports both command-style and form-style task creation.
- Task routing is type-based: formal requirement delivery to `harness`, smaller tasks to `loop`.
- Any group member can create a task.
- Only whitelist users can approve or reject confirmations.
- One task maps to one Feishu thread.

## Recommended Next Step

After this design is approved, write an implementation plan that splits milestone 1 into bounded tasks:

- Feishu inbound service skeleton
- thread/session mapping persistence
- confirmation-action translation
- permission and dedupe enforcement
- thread reply rendering
- end-to-end verification for paused confirmation handling
