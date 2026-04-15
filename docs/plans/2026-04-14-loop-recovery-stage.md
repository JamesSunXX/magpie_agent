# Loop Recovery Stage

## Goal

Make `loop` keep a failed-but-usable development run as a resumable checkpoint instead of forcing a full restart.

## Scope

This stage only covers the inner `loop` runtime.

It must define:

- what counts as a recoverable development failure
- what evidence must be persisted for resume
- how `loop resume` decides whether to continue or stop
- how old failed sessions are reinterpreted when enough evidence already exists

It must not yet change outer `harness` recovery behavior, submit reconnect behavior, or provider role session reuse.

## Source Requirement

Primary source:

- `docs/plans/2026-04-14-harness-loop-failure-recovery.md`

This stage implements the intent described in:

- Task 1: Reclassify recoverable loop failures

## Target Behavior

When development has already produced a usable workspace and a concrete next action, `loop` should stop in a recoverable state rather than a terminal failure.

Recoverable means all of the following are available:

- a known current stage
- a usable workspace path
- persisted failure or repair artifacts
- a next-step instruction that lets the next round continue safely

If any of those are missing, the session should remain terminal.

## Files Expected To Change

- `src/capabilities/loop/application/execute.ts`
- loop-related runtime types if the persisted session shape needs to carry more recovery evidence
- loop tests under `tests/capabilities/loop/`
- loop CLI tests if visible status wording changes

## Implementation Notes

The recovery decision should not rely on brittle text matching.

Use structured persisted evidence instead:

- current stage
- workspace mode and path
- failure reason
- last reliable point
- artifact references
- next action

For older sessions:

- if they already contain enough evidence, treat them as resumable
- if they do not, preserve current failure behavior

## Acceptance Checks

- a usable development failure is stored as recoverable rather than terminal
- `loop resume` continues from the existing workspace
- unusable failures still stop cleanly
- old failed sessions with good evidence can resume
- old failed sessions without good evidence still require manual intervention

## Verification

Automated checks for this stage should include:

- a new or updated `loop` test for recoverable failure classification
- a new or updated `loop resume` test for continuing from the saved checkpoint
- a regression test that keeps terminal failures terminal

Recommended commands once implementation starts:

```bash
npm run test:run -- tests/capabilities/loop/loop.test.ts
npm run build
```

## Non-Goals

- changing `harness` stage transitions
- reconnecting `harness submit` to older sessions
- persisting provider role sessions
- building the final graph view for all stages

## Exit Criteria

This stage is done only when the inner `loop` can reliably tell the difference between:

- a failed run that must stop
- a failed run that should be resumed later from the same workspace

## Outcome Notes

- Runtime support for recoverable `loop` failures and legacy resume compatibility is already in place and remains the implementation for this stage.
- This pass wired the harness graph and TUI node detail back to this stage document so operators can open the right document before continuing.
- No new loop-runtime behavior was deferred in this pass.

Verification completed in this pass:

- `npm run test:run -- tests/capabilities/loop/loop.test.ts`
- `npm run test:run -- tests/cli/harness-command.test.ts tests/tui/graph-workbench-loader.test.ts tests/tui/components.test.tsx`
