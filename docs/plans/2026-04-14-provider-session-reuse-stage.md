# Provider Session Reuse Stage

## Goal

Persist and restore provider conversation continuity by role so resumed work can continue the original thread when the provider supports it.

## Scope

This stage covers role-scoped provider session state for:

- `loop.planner`
- `loop.executor`
- `harness.reviewer.<id>`
- `harness.arbitrator`

It must define:

- what provider session data is saved
- when it is updated
- how it is restored on resume
- what happens for providers that do not support session continuation

It must not broaden into a shared thread for the full workflow.

## Source Requirement

Primary source:

- `docs/plans/2026-04-14-harness-loop-failure-recovery.md`

This stage implements the intent described in:

- Task 4: Persist provider sessions by role

## Required Persisted Data

Each saved provider-session record should include:

- provider identity
- provider session id
- workflow session id
- role id
- updated time
- whether the provider supports session resume

## Files Expected To Change

- `src/providers/types.ts`
- provider implementations under `src/providers/`
- shared workflow runtime persistence where role-scoped session state belongs
- `src/capabilities/loop/application/execute.ts`
- `src/capabilities/workflows/harness/application/execute.ts`
- provider-related tests

## Acceptance Checks

- role-scoped session ids are stored after successful provider calls
- resume restores the correct session to the correct role
- reviewer sessions never leak into arbitrator or loop roles
- unsupported providers fall back gracefully without breaking the run

## Verification

Automated checks for this stage should include:

- persistence test for saved role session state
- restore test for resumed loop roles
- restore test for resumed harness roles
- unsupported-provider fallback test

Recommended commands once implementation starts:

```bash
npm run test:run -- tests/providers
npm run test:run -- tests/capabilities/workflows
npm run build
```

## Non-Goals

- changing model selection policy
- inventing one shared provider thread across the whole workflow
- changing submit reconnect matching rules

## Exit Criteria

This stage is done only when resumed work can continue with the same role-specific conversation where the provider supports that behavior, and falls back safely where it does not.

## Outcome Notes

- Role-scoped provider session persistence and restore behavior is already in place and remains the implementation for this stage.
- This pass strengthened verification in two places: it now checks that persisted role-session records carry the required resume metadata, and it explicitly verifies that `harness` reviewer and arbitrator roles restore their own saved sessions rather than crossing roles.
- The `provider-session-reuse` stage remains visible as a first-class graph node and links back to this stage document for operator inspection.
- No additional provider-session behavior is currently deferred in this stage.

Verification completed in this pass:

- `npm run test:run -- tests/providers/session-persistence.test.ts`
- `npm run test:run -- tests/providers`
- `npm run test:run -- tests/capabilities/workflows`
- `npm run build`
