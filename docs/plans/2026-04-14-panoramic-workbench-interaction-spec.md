# Panoramic Workbench Interaction Spec

## Summary

This document defines the interaction contract for the panoramic workbench continuation.

It is intentionally narrower than `2026-04-14-panoramic-workbench-continuation-plan.md`.

The continuation plan explains:

- current reality
- missing capability
- completion bar
- recommended delivery order

This interaction spec defines the decisions that must be fixed before writing an implementation plan:

- how operators move through the workbench
- what the selected node detail must show
- which actions can be taken directly inside the workbench
- what the attention and event area should display

This document exists so implementation planning can proceed without reopening interaction design during coding.

## Scope

This spec covers only the TUI-facing panoramic workbench interaction model for graph-backed harness sessions.

It is in scope to define:

- workbench navigation flow
- visible panels and their responsibilities
- node-detail display contract
- workbench-native action handling
- attention and event feed rules
- the state and data needed to support the above

It is out of scope to redesign:

- graph artifact foundation
- harness-server scheduling policy
- approval persistence semantics
- inner loop or harness execution behavior
- non-terminal UI platforms

If implementation reveals missing data required by this spec, the smallest possible data addition should be made in support of the TUI rather than reopening broader Milestone 4 scope.

## Workbench Navigation Model

### Primary Operator Story

The panoramic workbench should let an operator move through one graph-backed requirement in this order:

1. find the graph-backed harness session from the dashboard
2. open a graph-focused workbench view for that session
3. scan overall graph state
4. move between nodes
5. inspect the selected node
6. take the common next action if needed
7. return to the session list without losing the broader operator context

The existing dashboard should remain the entry surface, but the graph-backed workbench should become a dedicated view rather than an overloaded extension of the current selected-session summary area.

### View Model Decision

The TUI should add a dedicated graph workbench route for graph-backed harness sessions.

It should not attempt to express panoramic behavior by stretching the current single dashboard selection model further.

Reason:

- the current dashboard is session-oriented
- panoramic workbench behavior is graph-oriented
- node-level navigation needs its own selection state
- direct actions need a scoped interaction model that does not conflict with task-launch navigation

### Panels

The graph workbench view should have four conceptual panels.

#### 1. Graph Overview

Purpose:
Show the overall requirement state immediately.

Must display:

- graph title or graph ID
- graph status
- graph-wide rollup counts
- all nodes in one list or tree
- per-node state
- enough context to explain why a non-ready node is not advancing

The graph overview is the default focus target when the graph workbench opens.

#### 2. Selected Node Detail

Purpose:
Explain the currently selected node without opening raw files.

Must display:

- node title and ID
- node type
- current state
- status reason when present
- latest node-level result summary
- unresolved issues when available
- next-step summary when available
- linked execution session when available

#### 3. Actions

Purpose:
Show and trigger the most relevant operator actions for the selected graph or node.

This should remain compact and action-focused, not a general command console.

#### 4. Attention and Events

Purpose:
Show the latest high-signal changes that affect operator decisions.

This panel should remain compact and recent-first.

### Navigation Rules

The graph workbench should maintain separate focus concepts:

- active session
- selected node
- selected action

The operator should not lose the selected node when moving between overview, detail, and action areas.

### Keyboard Behavior

The first implementation should stay conservative and predictable:

- `Enter` on a graph-backed harness session from the dashboard opens the graph workbench view
- `Up` / `Down` move within the currently focused list
- `Left` / `Right` switch focus between overview, actions, and event areas when applicable
- `Enter` on a selectable action triggers that action
- `Escape` returns to the prior surface without destroying current dashboard session data
- `r` refreshes the current workbench data

If a graph session has no persisted graph artifact, `Enter` should keep the current behavior and open the ordinary preview or resume path instead of forcing graph workbench entry.

## Node Detail Contract

### Detail Source Priority

Selected-node detail should use the following priority order:

1. graph artifact node state for node identity, type, status, dependencies, approval gates, and status reason
2. linked execution session from `node.execution` when present
3. linked session artifacts for the latest available session-level summary
4. role round artifacts from the linked session when available

The UI should not invent node detail by parsing unrelated free-form text when a structured source exists.

### Required Fields

Every selected node must show:

- `title`
- `id`
- `type`
- `state`
- `statusReason` when present
- dependency list
- whether approval is pending

### Session-Linked Fields

If the node has a linked execution session, the detail area should additionally show:

- linked capability
- linked session ID
- latest known session status
- latest available summary line
- next-step summary if one exists

### Review and Issue Detail

If role-round or review artifacts are available for the linked session, the detail area should show:

- reviewer summaries
- arbitration conclusion when present
- unresolved issues with severity when present

This display should reuse existing persisted summaries where possible instead of creating a second parallel summary system.

### Degraded Display Rules

If the selected node has no linked execution session yet, the detail area should still show:

- node identity
- node state
- dependency context
- approval status
- status reason

If the node has a linked session but no role-round detail yet, the detail area should show the session identity and latest session status with a plain “No round summary yet.” fallback.

If the graph artifact is present but malformed or unreadable, the workbench should fail gracefully with a compact error state instead of collapsing the entire TUI.

## Workbench Actions

### First-Phase Direct Actions

The first implementation should support only the highest-value workbench-native actions:

- approve a pending graph gate
- reject a pending graph gate
- approve a pending node gate
- reject a pending node gate
- jump to the best existing linked-session entrypoint when possible

The first implementation should not attempt bulk approval, arbitrary command execution, or broad mutation controls.

### Action Sourcing

Actions should be derived from structured graph state, not hard-coded by node label text.

For approval actions, the workbench should use:

- graph-level pending approval gates
- selected-node pending approval gates

For jump actions, the workbench should use:

- the linked execution session from the selected node
- the best existing command surface for that linked capability

The first implementation should not assume that every linked capability supports the same live-output action.

Instead, it should route conservatively by capability using already-supported entrypoints such as:

- `attach` when a capability already has a stable attach flow
- `resume` when resume is the best existing operator path
- `inspect` when detail inspection is available but live attach is not

This keeps the first implementation aligned with current command reality instead of introducing a fake universal attach abstraction.

### Confirmation Rules

Confirmation should be intentionally lightweight:

- approval actions should not require an extra confirmation step when there is only one unambiguous pending target selected in the action area
- rejection actions should require a lightweight confirmation because they are more likely to halt progress

The workbench should prefer explicit target display over extra confirmation prompts.

### Post-Action Feedback

After an action succeeds, the workbench should:

- refresh graph state
- keep the user inside the graph workbench
- preserve selected node when still valid
- display a compact success message

If an action fails, the workbench should:

- keep the current view intact
- display a compact error message
- avoid hiding the action area

## Attention and Event Feed

### Purpose

The attention and event feed exists to answer one question:

> "What changed recently that I need to care about now?"

It is not a raw event log.

### Source Rules

The feed should prefer persisted workflow event data when available.

Primary source:

- harness session `events.jsonl`

Supporting source:

- graph artifact rollup and node states when the event stream does not provide enough context to explain current attention

The feed should not depend on reconstructing history only from current graph state when persisted events already exist.

For the first implementation, the event feed should be limited to event categories that are already emitted reliably in the persisted workflow event stream.

If a desired graph-workbench event category does not yet exist as a stable persisted event, the implementation plan should treat it as an explicit follow-up emit addition rather than silently deriving it from unrelated summaries.

### Included Event Types

The first implementation should include only the highest-signal event categories that are already available or can be added with minimal new emit work:

- approval recorded
- approval rejected
- workflow started or resumed
- stage changed or stage paused
- cycle completed
- workflow completed or workflow failed
- node or graph waiting retry when explicitly recorded

The following categories are desirable but should be treated as conditional follow-up work unless the audit confirms a stable existing emit path:

- node became ready
- node dispatch started
- node completed
- graph became blocked because of a specific node transition

If a useful event type is not currently emitted, implementation may add the smallest necessary event emission instead of widening the entire workflow event model.

### Display Rules

The feed should be:

- recent-first
- compact
- limited to a small fixed window

The initial display should show the latest 8 meaningful items.

Each item should include enough context to answer:

- what changed
- which graph or node it affected
- why it matters now

### Attention Rules

The workbench should still show persistent current attention items even if they are not recent events.

Examples:

- a node is currently blocked by dependency
- a node is currently waiting approval
- the graph has no ready nodes

In other words:

- event feed explains recent change
- attention area explains current risk or required intervention

## State and Data Dependencies

### Existing Data That Should Be Reused

The implementation should reuse existing persisted structures wherever possible:

- graph artifact state from `graph.json`
- graph rollups and node state
- node `execution` link when present
- harness workflow session artifacts
- role-round summaries
- persisted harness workflow events from `events.jsonl`

### TUI State Expansion Needed

The current TUI state model is too narrow for panoramic workbench behavior.

Implementation should expect to add dedicated state for at least:

- current graph workbench route
- selected graph session ID
- selected node ID
- focused panel
- selected action index
- transient workbench message state for success or failure feedback

### Reader and Mapping Expansion Needed

The current dashboard loader maps sessions into compact cards.

The panoramic workbench implementation will likely need a second, more detailed graph-session reader that can:

- load one graph session in full
- map graph nodes into selectable workbench items
- resolve linked session detail on demand
- read recent relevant events for the selected graph session

That detailed loader should complement the current dashboard card loader rather than overloading it further.

## Acceptance

This interaction spec should be considered satisfied only when an implementation plan can assign concrete tasks without reopening any of these decisions:

- how the operator enters and exits graph workbench mode
- which panels exist and what each panel is responsible for
- how node detail is sourced and degraded
- which direct actions are in scope first
- how recent events and current attention are distinguished
- what new TUI state is required

The implementation itself should later be accepted only when a graph-backed harness session lets an operator:

1. open a dedicated graph workbench view from the dashboard
2. understand graph-wide state from the overview panel
3. move between nodes without losing context
4. inspect selected-node detail without opening raw files
5. approve or reject the common waiting gates directly in the workbench
6. see recent high-signal changes and current attention separately

## Next Step

After this spec is reviewed and approved, the next document should be a concrete implementation plan with:

- exact files to touch
- phased tasks
- test additions
- verification commands

That plan should stay bounded to the interaction and TUI support work defined here.
