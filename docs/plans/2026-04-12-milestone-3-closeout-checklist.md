# Milestone 3 Closeout Checklist

## Completed

- shared role artifacts added for `loop` and `harness`
- role bindings wired into runtime where actually supported
- role roster refreshed on resume
- harness per-cycle artifacts persisted with participants, review results, arbitration result, open issues, and next-round brief
- `status`, `inspect`, and `attach` show round summaries
- TUI shows card summaries and selected-session supplementary summary
- missing `--cycle` requests fail clearly
- display-oriented follow-up work documented before implementation

## Milestone 3 Stop Condition

Milestone 3 is complete when:

- role artifacts are stable
- inspection output is consistent across CLI and TUI
- documentation matches behavior
- no remaining work item requires scheduler, queue, or daemon ownership

## What Requires Doc Updates

- update `README.md` when user-facing commands or inspection behavior changes
- update `docs/references/capabilities.md` when capability behavior or command options change
- update `ARCHITECTURE.md` when shared runtime structure or module boundaries change
- update `AGENTS.md` only when the rule becomes a standing repository rule
- update `docs/plans/` before any further display refinement or new Milestone 3 follow-up

## Final Status

Milestone 3 can stop here.

Further work should move either to:

- `harness-server` background orchestration
- a new display-planning document
