# Milestone 4: Graph Execution and Panoramic Workbench

## Summary

Milestone 4 turns Magpie from a strong single-task loop plus background host into a graph-aware engineering workspace.

The goal is not to rebuild `harness-server`, `loop`, or the Milestone 3 role kernel. The goal is to let one larger requirement be decomposed into multiple dependent tasks, dispatch the ready tasks safely, and give operators one place to understand what is running, what is blocked, and what needs human approval.

This milestone must build on the current baseline:

- Milestone 2 already owns single-task quality gates, TDD checkpoints, and next-round briefs
- Milestone 3 already owns role roster artifacts, per-round summaries, and operator-facing inspection
- `harness-server` already owns daemon lifecycle, queue persistence, retries, and repo-local recovery

Milestone 4 owns graph structure, dependency-aware dispatch policy, operator visibility across many tasks, and explicit human gates for risky transitions.

## Boundaries

### In Scope

- graph-shaped task decomposition for one larger requirement or epic
- persisted graph artifacts as the single source of truth for node state and dependencies
- dependency-aware dispatch into the existing `harness-server`
- safe parallel progress when nodes are independent and resource rules allow it
- graph-level summaries in CLI and TUI
- explicit human approval gates for risky or high-impact transitions
- workspace-level monitoring that links graph state, active sessions, and recent round outcomes

### Out of Scope

- replacing the `harness-server` daemon, queue store, or lease implementation
- rewriting the inner execution loop of `loop` or `harness`
- new model families, new validator engines, or new review philosophies
- distributed scheduling across multiple machines
- a separate web console; terminal-first surfaces stay the default

## Product Requirements

### 1. Graph Artifact as the New SSOT

Architect output for a larger requirement must no longer stop at a flat task list. It must produce a persisted graph artifact that can describe:

- graph identity, source requirement, and creation time
- nodes with stable IDs, titles, and short goals
- dependency edges between nodes
- node type such as feature, integration, migration, validation, or approval
- target repo or worktree scope
- risk markers such as high-risk files, schema changes, or external interface changes
- required approval gates before dispatch or before final completion

The graph artifact must live inside the repo-local `.magpie/` tree and remain readable after restart or resume.

### 2. Dependency-Aware Dispatch

`harness-server` should stay the execution host, but it must be able to consume graph nodes instead of only independent tasks.

Dispatch rules must support:

- a node becomes runnable only when all required predecessors are completed
- nodes that share a conflict scope must not run in parallel even if the graph says they are otherwise independent
- nodes that are truly independent may run in parallel when concurrency limits allow it
- failed or blocked nodes must prevent downstream nodes from starting until the graph state changes
- a paused or approval-waiting node must remain visible as a first-class graph state, not a hidden session detail

Milestone 4 does not invent a second scheduler. It extends the existing background host with graph-aware readiness and dispatch decisions.

### 3. Parallel Safety Model

Parallelism must be explicit and explainable.

The system must be able to answer:

- why a node is runnable now
- why a node is waiting
- which other node or resource is blocking it
- whether the block is caused by dependency, approval, retry, repo lease, or risk policy

At minimum, each node should expose one of these states:

- `pending`
- `ready`
- `running`
- `waiting_retry`
- `waiting_approval`
- `blocked`
- `completed`
- `failed`

Graph-level rollups should show:

- total nodes
- ready nodes
- active nodes
- blocked nodes
- completed nodes
- failed nodes

### 4. Panoramic Workbench

Operators need one terminal workspace that answers three questions immediately:

- what is the overall graph doing
- what is happening inside the currently selected node
- what needs attention next

The workbench should build on the current TUI instead of inventing a separate UI stack.

At minimum it should expose:

- a graph tree or list with node states and dependency status
- the currently selected node's latest role summary, open issues, and next step
- active node logs or quick attach shortcuts
- a compact recent-events area that highlights retries, approvals, failures, and completions
- graph-wide progress summaries such as “3 ready / 2 running / 1 waiting approval”

If tmux integration is used, it should serve the same operator story: one pane for graph status, one for selected-node detail, and one for live session output.

### 5. Human-in-the-Loop Gates

Milestone 4 must make human intervention intentional instead of accidental.

The system should support explicit approval points for cases such as:

- graph creation or graph confirmation after decomposition
- nodes that touch high-risk file classes or schema boundaries
- nodes whose final round still ends in `blocked`
- graph completion when critical nodes remain unresolved or downgraded

Approvals must be persisted as graph events so a later operator can tell:

- what was waiting
- who approved or rejected it
- when the decision happened
- what the decision unlocked or blocked

### 6. Graph-Level Summaries and Rollups

One larger requirement should not require manually opening every child session to understand progress.

The system must produce graph-level summaries that roll up:

- per-node latest result
- unresolved issues by node
- nodes that are safe to start next
- nodes waiting on human action
- nodes repeatedly failing or retrying
- overall completion status for the requirement

These summaries should be consumable from both CLI and TUI.

## Interface Expectations

### CLI

Milestone 4 should extend existing entrypoints instead of introducing an unrelated command family.

At minimum, operators should be able to:

- submit or resume a graph-backed requirement
- list graph sessions and see graph-level state
- inspect a graph and then drill into a specific node
- attach to the active node from the graph context
- approve or reject a waiting node through an explicit CLI action if TUI is unavailable

Exact command spelling may evolve, but the operator workflow must be supported end to end.

### TUI

The TUI should become the default workbench for graph-backed runs.

It should be possible to:

- see the graph overview without opening raw files
- move between nodes quickly
- understand why a node is blocked
- see the latest round summary for the selected node
- spot approvals or failures that need immediate attention

### Artifacts

Graph artifacts should remain repo-local and should reference the existing node/session artifacts instead of duplicating them.

At minimum, the graph layer should persist:

- graph definition
- node state snapshots
- approval events
- graph-wide summaries
- links to underlying `loop` or `harness` session IDs

## Test Plan

- a decomposed graph with two independent nodes can dispatch both once prerequisites are met
- two nodes that target the same conflict scope do not run in parallel even when both are otherwise ready
- downstream nodes do not start while an upstream node is `blocked`, `failed`, or `waiting_approval`
- graph restart rebuilds node readiness and progress from persisted graph and session artifacts
- approval-gated nodes stay paused until a persisted approval event is recorded
- CLI inspection can show graph overview plus node drill-down without reading raw files
- TUI shows graph state, selected-node summary, and attention-worthy events from persisted artifacts
- graph summaries correctly report repeated retries, unresolved issues, and next safe nodes

## Acceptance

- one larger requirement can be decomposed into a persisted task graph and progressed safely
- independent nodes can advance in parallel without violating repo/resource safety rules
- operators can understand graph progress, blockers, and next actions from CLI or TUI alone
- human approval gates are explicit, durable, and visible in the graph history
- the milestone stops after graph-aware dispatch and workbench visibility are stable; it does not spill into a new UI platform or a second scheduler architecture

## Follow-On Notes

Milestone 4 should be followed by a concrete implementation plan before code changes start. That plan should split work into at least three tracks:

- graph artifact and readiness model
- graph-aware harness-server dispatch
- TUI and CLI workbench surfaces

Further display-detail work after that plan should continue following the current project rule: document first, then implement.
