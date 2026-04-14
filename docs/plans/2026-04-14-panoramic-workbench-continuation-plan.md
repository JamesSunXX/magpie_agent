# Panoramic Workbench Continuation Plan

## Summary

The current panoramic workbench is partially implemented, but it is not finished.

Magpie already has:

- a repo-local TUI entrypoint
- graph-aware harness summaries in CLI and TUI
- graph approval and rejection actions through CLI
- selected-session hints for approvals, blockers, ready nodes, and a recommended next action

Magpie does not yet have a true operator-grade panoramic workbench for one larger requirement.

Today the TUI behaves like a graph-aware reminder surface. It does not yet behave like a full control plane that lets an operator understand overall progress, inspect any node deeply, and act on the graph without dropping back into scattered commands or raw files.

This document defines the gap clearly, sets a completion bar, and proposes the next delivery order. It is a continuation plan for Milestone 4 rather than a replacement for the original graph execution design.

## Current Reality

### What Exists Now

The current TUI already exposes the first useful slice of graph visibility:

- graph rollup text for the selected harness session
- pending approval prompts
- blocker reasons for blocked nodes
- a short "ready now" summary
- a recommended approval target and suggested CLI command
- latest harness round summary for the selected session

This means the workbench can already answer a narrow question:

> "What should I look at next for this selected graph session?"

That is real progress and should be preserved.

### What Is Still Missing

The workbench still cannot answer the broader operator questions that motivated Milestone 4:

- what is happening across the whole requirement at a glance
- which nodes are completed, running, ready, blocked, failed, or waiting approval
- which blocked nodes are blocked by dependency, approval, retry, or repeated failure
- which node should be opened next, and why
- what changed recently across the graph without opening each child artifact
- how to take the common next actions directly from the workbench

In short, the current surface highlights trouble, but it does not yet provide full graph comprehension or fast graph-level control.

## Gap Breakdown

### Gap 1: No True Graph Overview Surface

The TUI shows graph information only as selected-session summary text.

It does not yet provide a dedicated graph overview panel or mode with:

- all nodes in one visible structure
- per-node state visibility
- dependency or downstream context
- graph-wide progress distribution
- quick navigation between nodes

Without this, the workbench is still session-centric instead of graph-centric.

### Gap 2: Selected Detail Stops Too Early

The selected harness detail already shows round summaries, graph hints, and recommendation text, but it still stops short of a full selected-node detail surface.

The missing pieces are:

- explicit node-level latest status instead of only graph-level hint lines
- unresolved issues grouped by node
- clear node ownership and linked child session identity when available
- easy handoff from graph view to the active node output

Without this, operators still have to reconstruct node state indirectly.

### Gap 3: No Workbench-Native Action Path

The system can approve or reject through CLI, but the workbench currently only suggests commands.

That leaves a gap between:

- seeing the next action
- taking the next action

A real panoramic workbench should let operators trigger the most common graph actions from the same place they diagnose the graph.

### Gap 4: No Compact Event Feed

Recent retries, approvals, completions, failures, and newly unblocked nodes are some of the highest-signal events in a graph-backed workflow.

The current workbench does not provide a compact event area for those changes. That forces operators to infer what changed by re-reading summaries or inspecting files manually.

### Gap 5: Completion Bar Is Not Yet Explicit in the Product

The project docs already describe what the workbench should become, but the product surface itself still lacks a visible, testable completion bar:

- graph overview
- selected-node detail
- event attention area
- direct action path
- graph-wide progress clarity

This is why the current state should be described as "first usable slice" rather than "completed panoramic workbench."

## Definition of Done

The panoramic workbench should only be considered complete for this milestone when an operator can do all of the following from CLI or TUI without reading raw session files:

1. Understand the overall requirement status at a glance.
2. See every node's current state and identify the blocking cause.
3. Move quickly from graph overview to selected-node detail.
4. See the latest high-signal graph events in one compact place.
5. Identify the next safe node or required approval without guessing.
6. Take the most common next actions without leaving the workbench flow.

For the TUI specifically, that means the operator should be able to answer three questions immediately:

- what is running
- what is blocked
- what needs attention next

## Non-Goals for This Continuation

This continuation should not expand Milestone 4 into a larger platform project.

It should not include:

- a new web UI
- cross-machine orchestration
- a second scheduler outside the current harness-server model
- unrelated redesign of loop or harness inner execution
- speculative analytics or dashboard cosmetics that do not improve operator control

## Recommended Delivery Order

### Phase 1: Add a Real Graph Overview

Goal:
Make the TUI graph-first instead of summary-first.

This phase should add:

- a dedicated graph overview panel or mode
- a visible node list or tree with per-node state
- graph-wide rollups that stay visible while browsing
- selection movement across nodes instead of only across sessions

Exit for Phase 1:
An operator can open the workbench and immediately understand the shape and state distribution of one graph-backed requirement.

### Phase 2: Deepen Selected-Node Detail

Goal:
Make the selected area sufficient for node-level reasoning.

This phase should add:

- selected-node latest result
- unresolved issues and latest next-step summary
- clear reason for blocked or waiting state
- child session linkage or attach shortcut when a node is active

Exit for Phase 2:
An operator can choose any node and understand its latest state without opening raw artifacts first.

### Phase 3: Bring Common Actions into the Workbench

Goal:
Close the gap between diagnosis and action.

This phase should add workbench-native handling for the most common graph actions, starting with:

- approve waiting graph or node gates
- reject waiting graph or node gates
- jump to the active node output or attach path

Exit for Phase 3:
The workbench can both explain the next action and initiate the next action for the common approval-driven cases.

### Phase 4: Add an Attention and Event Surface

Goal:
Make important graph changes obvious without manual digging.

This phase should add:

- recent approvals
- recent failures
- recent retries
- recent completions
- newly unblocked or newly ready nodes

Exit for Phase 4:
An operator can understand what changed recently and what needs immediate attention from one compact surface.

## Why This Order

This delivery order is intentional:

- overview must come first because the workbench is not panoramic without it
- selected detail comes second because overview alone is too shallow for action
- direct actions come third because action without context would only speed up confusion
- event feed comes last because it is most valuable after overview and detail already exist

In other words, the workbench should first become understandable, then inspectable, then actionable, then easier to monitor continuously.

## Expected Code Areas

The continuation should stay within the existing architecture and primarily touch:

- `src/tui/` for workbench rendering, navigation, and interaction
- `src/cli/commands/harness.ts` only if a missing CLI helper blocks parity
- `src/capabilities/workflows/harness/` and adjacent graph artifact readers only if the current persisted data is insufficient for the TUI surface
- `tests/tui/` and related CLI tests for visible behavior
- `docs/references/capabilities.md` and `README.md` once user-visible behavior changes materially

This work should continue to treat repo-local graph artifacts as the single source of truth instead of inventing a second state path for the UI.

## Verification Expectations

Before implementation is considered complete, verification should show that:

- the TUI renders graph overview and selected-node detail from persisted artifacts
- node state changes after approval or rejection appear correctly in the workbench
- blocked reasons, ready nodes, and high-signal events remain visible after restart
- the workbench behavior stays consistent with CLI inspection for the same graph
- graph-backed dashboard behavior is covered by focused TUI tests rather than only snapshot-like happy paths

## Stop Line

Stop this continuation once the TUI is a reliable terminal workbench for one graph-backed requirement in one repository.

Do not continue this document's scope into broader orchestration, historical analytics, or a new user interface platform.

## Next Step After This Document

The next step should be a concrete implementation plan that turns the four phases above into small, testable tasks with explicit file targets and verification commands.

That implementation plan should stay focused on the panoramic workbench gap only. It should not reopen already-completed Milestone 4 graph foundation work unless implementation proves that one required artifact is still missing.
