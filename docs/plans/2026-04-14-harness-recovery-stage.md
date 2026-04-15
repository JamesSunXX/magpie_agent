# Harness Recovery Stage

## Goal

Make `harness` keep recoverable inner `loop` failures as resumable workflow state instead of collapsing them into terminal workflow failure.

## Scope

This stage starts after the inner `loop` can classify and persist recoverable checkpoints.

It must define:

- how recoverable inner `loop` failure maps to outer `harness` state
- which `loop` artifacts must be copied onto the `harness` session
- how `harness resume` returns to the same development stage
- how older failed `harness` sessions should behave if their linked `loop` session already contains resumable evidence

It must not yet implement submit reconnect or provider conversation reuse.

## Source Requirement

Primary source:

- `docs/plans/2026-04-14-harness-loop-failure-recovery.md`

This stage implements the intent described in:

- Task 2: Make harness treat recoverable loop failure as resumable

## Target Behavior

When the inner `loop` stops with a recoverable development failure:

- outer `harness` should become `blocked` in the `developing` stage
- the session should keep pointing at the same inner `loop` session
- resume should continue from that same development checkpoint

True terminal inner failure should still produce terminal outer failure.

## Files Expected To Change

- `src/capabilities/workflows/harness/application/execute.ts`
- shared workflow runtime files if resume evidence needs to be read differently
- harness tests under `tests/capabilities/workflows/`
- harness CLI tests if visible status output changes

## Required Persisted Data

The `harness` session should preserve at least:

- linked `loop` session id
- `loop` events path
- workspace path
- workspace mode
- branch or worktree branch metadata
- the last reliable recovery point summary

## Acceptance Checks

- recoverable inner `loop` failure becomes outer `blocked`
- `harness resume` continues `developing` from the same `loop` session
- terminal inner failure still becomes terminal outer failure
- older failed `harness` sessions resume only when their linked evidence is trustworthy

## Verification

Automated checks for this stage should include:

- `harness` execution tests that cover recoverable inner failure
- `harness resume` tests that prove development restarts from the same linked session
- regression tests that keep terminal mapping intact

Recommended commands once implementation starts:

```bash
npm run test:run -- tests/capabilities/workflows/harness.test.ts
npm run build
```

## Non-Goals

- submit auto-reconnect
- provider role session persistence
- final verification sweep across all stages

## Exit Criteria

This stage is done only when an operator can treat recoverable inner failure as a pause in progress rather than a discarded run.

## Outcome Notes

- Runtime support for mapping recoverable inner `loop` failures to resumable `harness` state is already in place and remains the implementation for this stage.
- This pass also made `harness` persist the inner loop's current branch name and last reliable recovery point alongside the existing workspace metadata, so a recoverable checkpoint keeps the full continuation context.
- The operator graph still points directly to this stage document from CLI and TUI inspection views.
- No new harness-recovery runtime gaps are currently deferred in this stage.

Verification completed in this pass:

- `npm run test:run -- tests/capabilities/workflows/harness.test.ts`
- `npm run test:run -- tests/cli/harness-command.test.ts tests/tui/graph-workbench-loader.test.ts tests/tui/components.test.tsx`
- `npm run build`
