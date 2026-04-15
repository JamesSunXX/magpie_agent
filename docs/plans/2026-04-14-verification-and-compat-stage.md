# Verification And Compatibility Stage

## Goal

Finish the recovery work with a clean verification pass, explicit compatibility rules, and artifact-preservation proof.

## Scope

This is the final consolidation stage.

It must cover:

- older session compatibility
- artifact preservation rules
- regression coverage across the earlier stages
- manual checks for current-workspace and worktree recovery paths

It must not introduce new recovery behavior beyond what the earlier stages already defined.

## Source Requirement

Primary source:

- `docs/plans/2026-04-14-harness-loop-failure-recovery.md`

This stage implements the intent described in:

- Task 5: Preserve artifact semantics
- Compatibility Rules
- Verification Plan
- Acceptance Criteria

## Compatibility Rules

For new sessions:

- always persist enough recovery evidence to resume
- always persist provider role session metadata when available

For older sessions:

- resume if enough trustworthy recovery evidence already exists
- remain terminal if the evidence is incomplete or unsafe

## Artifact Preservation Rules

The implementation must not automatically:

- roll back code
- delete generated documents
- reset branches or worktrees
- discard uncommitted changes created before the recoverable failure

## Files Expected To Change

- regression tests across `tests/capabilities/`, `tests/cli/`, and possibly `tests/tui/`
- user-facing docs if real behavior changed
- no broad runtime changes should be introduced here unless verification exposes a concrete gap

## Acceptance Checks

- recoverable current-workspace failure leaves changes in place and resumes from them
- recoverable worktree failure preserves the worktree and resumes inside it
- generated docs remain reachable through persisted artifact paths
- older resumable sessions continue successfully
- older non-resumable sessions still stop cleanly

## Verification

Required final commands:

```bash
npm run test:run
npm run build
npm run test:coverage
npm run check:docs
```

Manual verification should confirm:

- the operator can use `harness resume` instead of restarting from scratch
- re-running `harness submit` reconnects to the right recoverable session
- graph-backed sessions still remain inspectable in CLI and TUI

## Non-Goals

- adding new runtime features outside the recovery requirement
- redesigning the graph model
- broad cleanup or refactoring unrelated to recovery and compatibility

## Exit Criteria

This stage is done only when the recovery work is proven end to end and older persisted sessions behave safely under the new rules.

## Outcome Notes

- This pass closed the remaining compatibility gap in `harness resume`: older failed harness sessions now resume only when their linked recovery checkpoint is still trustworthy, and they stop cleanly with a clear operator-facing error when it is not.
- Existing artifact-preservation runtime behavior remains the source of truth for this stage: recovery still leaves workspaces, worktrees, generated documents, and pre-existing edits in place instead of rolling them back automatically.
- No new compatibility gaps were deferred in this pass.

Verification completed in this pass:

- `npm run test:run -- tests/cli/harness-command.test.ts`
- `npm run test:run`
- `npm run build`
- `npm run test:coverage`
- `npm run check:docs`
- `npm run test:run -- tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/harness.test.ts tests/providers/session-persistence.test.ts`
- `npm run test:run -- tests/cli/harness-command.test.ts tests/tui/graph-workbench-loader.test.ts tests/tui/components.test.tsx`
