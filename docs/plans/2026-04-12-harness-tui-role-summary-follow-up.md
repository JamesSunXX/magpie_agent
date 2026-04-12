# Harness TUI Role Summary Follow-Up

## Summary

This follow-up narrows the TUI work to short, high-signal summaries on the harness card instead of turning the card into a full detail page.

## Phase 1

Show a compact summary on each harness card:

- current stage
- round history
- short reason for the current result
- next step

Result templates should differ for:

- approved
- revise
- blocked

## Phase 2

Add a short participant hint so the operator can tell at a glance who was involved in the latest round.

This hint should reuse persisted role artifacts and must not invent a separate ad hoc state source.

## Deferred Work

The card should not grow into a full transcript view.

Anything beyond short card summaries should move into a selected-session detail area with its own plan.

## Rule

Any further TUI summary refinement must update planning docs before implementation.
