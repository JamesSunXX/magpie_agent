# Submit Reconnect Stage

## Goal

Make `harness submit` reconnect to the latest recoverable matching session instead of creating duplicates when the same task is submitted again.

## Scope

This stage covers the submit path only.

It must define:

- exact matching rules
- the priority order when multiple matches exist
- when the command must still create a new session
- what the CLI should say when it reconnects versus when it starts fresh

It must not change provider session restoration or the inner recoverable failure rules.

## Source Requirement

Primary source:

- `docs/plans/2026-04-14-harness-loop-failure-recovery.md`

This stage implements the intent described in:

- Task 3: Add automatic reconnect on `harness submit`

## Matching Rules

Reconnect is allowed only when all of the following match:

- same repository
- same goal text
- same PRD path
- recoverable session only

If more than one recoverable match exists, choose the most recently updated one.

If no recoverable match exists, create a new session.

## Files Expected To Change

- `src/cli/commands/harness.ts`
- shared workflow runtime helpers used to list or filter existing sessions
- submit-related CLI tests
- possibly harness server queue tests if queued recovery sessions need explicit handling

## Acceptance Checks

- repeated submit with the same goal and PRD reconnects to the latest recoverable match
- repeated submit does not reconnect to a terminally failed session
- different goal text creates a new session
- different PRD path creates a new session
- CLI output tells the operator whether the command resumed or started fresh

## Verification

Automated checks for this stage should include:

- exact-match reconnect test
- mismatch-by-goal test
- mismatch-by-PRD test
- terminal-session exclusion test

Recommended commands once implementation starts:

```bash
npm run test:run -- tests/cli/harness-command.test.ts
npm run build
```

## Non-Goals

- changing graph execution order
- adding provider session reuse
- broad session deduplication beyond exact goal and PRD match

## Exit Criteria

This stage is done only when re-running the same request does the useful thing by default and avoids accidental duplicate workflow sessions.

## Outcome Notes

- Exact-match `harness submit` reconnect behavior is already in place and remains the implementation for this stage.
- This pass taught the queued graph template for the failure-recovery document-first plan to show the `submit-reconnect` node explicitly and link it back to this stage document.
- No new reconnect rules were deferred in this pass.

Verification completed in this pass:

- `npm run test:run -- tests/cli/harness-command.test.ts`
