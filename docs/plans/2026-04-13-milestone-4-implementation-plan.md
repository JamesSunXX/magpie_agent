# Milestone 4 Implementation Plan

## Summary

This plan turns Milestone 4 into a concrete delivery sequence without re-opening work that already belongs to Milestone 2, Milestone 3, or the existing `harness-server` baseline.

The implementation should be staged so that each step leaves the repository in a usable state:

- first define and persist the graph model
- then teach `harness-server` how to decide which nodes are ready
- then expose graph-level inspection and approvals
- finally make the TUI the default panoramic workbench

## Ground Rules

- reuse the current repo-local `.magpie/` session tree instead of inventing a second persistence root
- extend the current `harness-server` queue and recovery behavior instead of adding a parallel scheduler
- reuse Milestone 3 role round artifacts as the per-node detail source
- document any new display detail before implementation if it changes what operators see

## Workstreams

### 1. Graph Artifact Foundation

- add graph types for graph metadata, node definitions, dependency edges, conflict scopes, and approval gates
- persist graph sessions inside repo-local `.magpie/` with links to child `loop` or `harness` sessions
- define graph state transitions and graph-level rollup helpers
- ensure graph artifacts survive restart and are readable without replaying raw logs

Acceptance:

- one requirement can be represented as a persisted graph with stable node IDs
- graph state can be rebuilt from persisted artifacts alone
- node state and graph rollups do not require ad hoc in-memory reconstruction

### 2. Graph Construction and Decomposition

- extend the architect-side decomposition path so larger requirements can emit graph nodes instead of only a flat task list
- persist dependency edges, conflict scopes, risk markers, and approval requirements at creation time
- reject malformed graphs early, such as cycles, missing node IDs, or dependencies on unknown nodes
- keep the initial graph creation path explicit so operators can inspect or confirm the graph before execution begins

Acceptance:

- graph creation fails clearly for cyclic or malformed dependency data
- valid graphs can be inspected before any child node starts
- the graph artifact includes enough metadata to explain future dispatch decisions

### 3. Graph-Aware Harness Dispatch

- extend `harness-server` readiness logic so only dependency-satisfied nodes become runnable
- block parallel dispatch for nodes that share a conflict scope even if both are otherwise ready
- link each runnable node to an underlying execution session without duplicating role artifacts
- persist graph-level events for dispatch, retry, completion, block, and failure transitions
- rebuild graph readiness correctly after daemon restart or session recovery

Acceptance:

- two independent nodes can run in parallel when limits allow it
- two nodes with the same conflict scope never run together
- downstream nodes stay waiting while upstream nodes are blocked, failed, or approval-gated
- restart preserves graph progress and does not re-run already completed nodes

### 4. Human Approval Gates

- add persisted approval events for graph confirmation, risky node dispatch, and graph completion gates
- expose explicit approve or reject actions in CLI so the graph can progress without TUI-only affordances
- make waiting approvals visible in graph state, list output, and workbench summaries
- ensure approval decisions change node readiness in a durable and auditable way

Acceptance:

- a waiting approval node remains paused across restart until a persisted decision is recorded
- approval history shows what was waiting, what decision was made, and what changed next
- operators can unblock a graph from CLI alone

### 5. CLI Graph Surfaces

- extend existing command surfaces so operators can list graph-backed runs, inspect graph health, and drill into a node
- keep node detail sourced from existing role round artifacts rather than reformatting a second copy
- expose graph rollups such as ready, running, blocked, waiting approval, completed, and failed
- make attach flows graph-aware so operators can move from graph overview to the active node quickly

Acceptance:

- operators can understand overall graph progress without opening raw files
- graph inspection can identify which node is blocking downstream work and why
- graph drill-down can jump to the underlying node session cleanly

### 6. TUI Panoramic Workbench

- add a graph overview panel or mode that shows node states, dependency status, and global progress
- show selected-node detail using the current Milestone 3 summary style: participants, latest conclusion, open issues, and next step
- add an attention area for retries, approvals, failures, and recently completed nodes
- keep the card/list view compact while making the selected detail area richer
- align tmux-oriented operator flow with the same story: graph overview, selected detail, live output

Acceptance:

- the TUI can answer “what is running”, “what is blocked”, and “what needs attention” without raw file inspection
- selected node detail stays consistent with CLI inspection for the same node
- operators can identify the next safe node or required approval from the workbench alone

### 7. Documentation and Closeout

- update the relevant command and capability docs once graph-backed flows have real CLI surface changes
- add follow-up plan docs before any extra display-detail work beyond this implementation plan
- write a Milestone 4 closeout checklist once the core graph, dispatch, approval, and workbench behaviors are in place
- verify that Milestone 4 stops before broader distributed scheduling or a separate UI platform begins

Acceptance:

- user-facing docs describe the real graph workflow and approval behavior
- closeout artifacts clearly identify what Milestone 4 completed and what still belongs to later work

## Explicit Acceptance Items

- a graph with dependency edges can be created, persisted, inspected, and resumed
- graph readiness and block reasons are visible from persisted state
- graph-aware `harness-server` dispatch respects both dependencies and conflict scopes
- approval-gated nodes remain visible and durable until explicitly approved or rejected
- CLI and TUI can both show graph-level progress plus selected-node detail
- graph summaries reuse existing per-node role artifacts instead of creating a second summary pipeline

## Suggested Delivery Order

1. graph types, persistence, and validation
2. graph creation and inspection without execution
3. graph-aware readiness and dispatch in `harness-server`
4. approval events and CLI actions
5. CLI graph rollups and drill-down
6. TUI panoramic workbench
7. doc sync and closeout audit

## Stop Line

Stop Milestone 4 once graph-backed execution, approval gates, and workbench visibility are stable for one repository and one terminal workspace.

Do not continue this milestone into:

- cross-machine orchestration
- a new web UI
- generalized distributed resource scheduling
- a second execution engine outside the current `harness-server` and session model
