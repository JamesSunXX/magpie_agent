# Panoramic Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the TUI panoramic workbench so one operator can understand graph status, inspect any node, act on common approvals, and track recent graph changes without reading raw session files.

**Architecture:** Keep the existing repo-local graph artifact as the single source of truth. Extend the current TUI route, loader, and tests in place instead of introducing a second state path or a new UI surface. Reuse persisted harness and loop session artifacts for selected-node detail rather than inventing duplicate summaries.

**Tech Stack:** TypeScript, Ink, Vitest, Commander, repo-local `.magpie/` workflow artifacts

---

## Current Delta

The current codebase already has the dedicated graph workbench route, basic node browsing, direct approve/reject actions, jump actions, a compact attention list, and a recent-events list.

The remaining gap is narrower:

- graph overview is still too shallow for at-a-glance understanding
- selected-node detail still misses reviewer and arbitration context
- direct actions need clearer parity and outcome behavior for the common workbench flow
- attention and event coverage still misses some of the highest-signal graph changes
- docs and verification do not yet state a clear completion bar for the current implementation

## File Map

### Existing files to modify

- `src/tui/types.ts`
  Purpose: expand the workbench data contract without creating a second UI model.
- `src/tui/graph-workbench-loader.ts`
  Purpose: read richer overview, detail, action, and event data from persisted artifacts.
- `src/tui/components/graph-workbench.tsx`
  Purpose: render the deeper overview and selected-node detail contract.
- `src/tui/app.tsx`
  Purpose: keep direct workbench actions inside the same flow and refresh state after action outcomes.
- `src/tui/app-input.ts`
  Purpose: preserve predictable workbench navigation and confirmation behavior.
- `tests/tui/graph-workbench-loader.test.ts`
  Purpose: verify persisted artifacts are mapped into the richer workbench contract.
- `tests/tui/components.test.tsx`
  Purpose: verify rendered workbench copy for overview, detail, actions, and events.
- `tests/tui/app.test.tsx`
  Purpose: verify action execution, refresh, and failure handling stay inside workbench flow.
- `tests/tui/app-input.test.ts`
  Purpose: verify keyboard behavior for the finished workbench interaction model.
- `docs/references/capabilities.md`
  Purpose: describe the finished workbench behavior in user-facing docs.
- `docs/README.md`
  Purpose: keep the document map current.

### Files to avoid unless implementation proves they are required

- `src/cli/commands/harness.ts`
  Only touch if a missing inspect, attach, approve, or reject entrypoint blocks workbench parity.
- `src/capabilities/workflows/harness-server/graph.ts`
  Only touch if a required graph field is not persisted today and cannot be derived safely from existing artifacts.

## Task 1: Complete The Graph Overview Contract

**Files:**
- Modify: `src/tui/types.ts`
- Modify: `src/tui/graph-workbench-loader.ts`
- Modify: `src/tui/components/graph-workbench.tsx`
- Test: `tests/tui/graph-workbench-loader.test.ts`
- Test: `tests/tui/components.test.tsx`

- [ ] **Step 1: Write failing loader tests for full rollup visibility**

Add expectations that the workbench overview exposes the complete graph rollup needed for at-a-glance reading:

```ts
expect(workbench.graph.rollup).toEqual({
  total: 3,
  ready: 0,
  running: 0,
  waitingApproval: 1,
  waitingRetry: 0,
  blocked: 1,
  completed: 1,
  failed: 0,
})
```

Run: `npm run test:run -- tests/tui/graph-workbench-loader.test.ts`
Expected: FAIL because `GraphWorkbenchData.graph.rollup` only exposes `ready`, `waitingApproval`, and `blocked`.

- [ ] **Step 2: Extend the overview types**

Update the graph rollup type in `src/tui/types.ts` to match the persisted graph artifact instead of keeping the reduced three-field shape:

```ts
rollup: {
  total: number
  ready: number
  running: number
  waitingApproval: number
  waitingRetry: number
  blocked: number
  completed: number
  failed: number
}
```

- [ ] **Step 3: Populate the richer rollup in the loader**

Update `loadGraphWorkbench()` so the returned workbench data carries the complete rollup from the graph artifact:

```ts
rollup: {
  total: graph.rollup.total,
  ready: graph.rollup.ready,
  running: graph.rollup.running,
  waitingApproval: graph.rollup.waitingApproval,
  waitingRetry: graph.rollup.waitingRetry,
  blocked: graph.rollup.blocked,
  completed: graph.rollup.completed,
  failed: graph.rollup.failed,
}
```

- [ ] **Step 4: Render the richer overview**

Replace the current one-line rollup copy in `src/tui/components/graph-workbench.tsx` with a fuller summary that still fits comfortably in the terminal:

```tsx
<Text color="gray">
  total {props.workbench.graph.rollup.total}
  {' · '}ready {props.workbench.graph.rollup.ready}
  {' · '}running {props.workbench.graph.rollup.running}
  {' · '}waiting approval {props.workbench.graph.rollup.waitingApproval}
  {' · '}retry {props.workbench.graph.rollup.waitingRetry}
  {' · '}blocked {props.workbench.graph.rollup.blocked}
  {' · '}completed {props.workbench.graph.rollup.completed}
  {' · '}failed {props.workbench.graph.rollup.failed}
</Text>
```

- [ ] **Step 5: Write a rendering test for the new overview copy**

Add a component test that looks for `total`, `running`, `completed`, and `failed` in the rendered overview.

Run: `npm run test:run -- tests/tui/components.test.tsx`
Expected: FAIL before implementation, PASS after implementation.

- [ ] **Step 6: Run the focused tests**

Run: `npm run test:run -- tests/tui/graph-workbench-loader.test.ts tests/tui/components.test.tsx`
Expected: PASS

**Task 1 exit:** An operator can see graph-wide distribution at a glance instead of reconstructing it from a narrow summary.

## Task 2: Deepen Selected-Node Detail With Review Context

**Files:**
- Modify: `src/tui/types.ts`
- Modify: `src/tui/graph-workbench-loader.ts`
- Modify: `src/tui/components/graph-workbench.tsx`
- Test: `tests/tui/graph-workbench-loader.test.ts`
- Test: `tests/tui/components.test.tsx`

- [ ] **Step 1: Write failing loader tests for reviewer and arbitration detail**

Extend the linked harness role-round fixture so the selected node exposes reviewer summaries and an arbitration summary:

```ts
expect(workbench.selectedNode).toMatchObject({
  reviewerSummaries: [
    'security: revise - Missing rollback handling.',
    'qa: pass - No additional risks.',
  ],
  arbitrationSummary: 'Decision: revise - Need another cycle after rollback fixes.',
})
```

Run: `npm run test:run -- tests/tui/graph-workbench-loader.test.ts`
Expected: FAIL because the selected-node detail currently only exposes unresolved issues.

- [ ] **Step 2: Extend the selected-node detail type**

Add the missing fields to `GraphWorkbenchNodeDetail`:

```ts
reviewerSummaries: string[]
arbitrationSummary?: string
```

- [ ] **Step 3: Read the latest linked harness round more completely**

Replace the narrow latest-round loader with one that returns:

```ts
interface HarnessRoleRoundSummary {
  reviewResults?: Array<{
    reviewerRoleId: string
    summary: string
  }>
  arbitrationResult?: {
    summary?: string
  }
  openIssues?: Array<{
    title?: string
    severity?: 'critical' | 'high' | 'medium' | 'low'
    sourceRole?: string
  }>
}
```

Then map the persisted data into workbench detail:

```ts
reviewerSummaries: (latestRound?.reviewResults || []).map((item) => item.summary).filter(Boolean),
...(latestRound?.arbitrationResult?.summary
  ? { arbitrationSummary: latestRound.arbitrationResult.summary }
  : {}),
```

- [ ] **Step 4: Render the richer selected-node detail**

Render reviewer and arbitration sections only when data exists, and keep the current fallback when it does not:

```tsx
{selectedNode.reviewerSummaries.length > 0
  ? selectedNode.reviewerSummaries.map((summary) => <Text key={summary}>Review: {summary}</Text>)
  : <Text color="gray">No review summary yet.</Text>}
{selectedNode.arbitrationSummary ? <Text>Arbitration: {selectedNode.arbitrationSummary}</Text> : null}
```

- [ ] **Step 5: Add component assertions for the new detail lines**

Extend `tests/tui/components.test.tsx` so the rendered workbench must contain:

```ts
expect(normalizedText(element)).toContain('Review: security: revise - Missing rollback handling.')
expect(normalizedText(element)).toContain('Arbitration: Decision: revise - Need another cycle after rollback fixes.')
```

- [ ] **Step 6: Run the focused tests**

Run: `npm run test:run -- tests/tui/graph-workbench-loader.test.ts tests/tui/components.test.tsx`
Expected: PASS

**Task 2 exit:** An operator can inspect one node deeply enough to understand review state, unresolved issues, and next-step guidance without opening raw artifacts.

## Task 3: Harden The Direct-Action Workbench Flow

**Files:**
- Modify: `src/tui/app.tsx`
- Modify: `src/tui/app-input.ts`
- Modify: `src/tui/components/graph-workbench.tsx`
- Test: `tests/tui/app.test.tsx`
- Test: `tests/tui/app-input.test.ts`

- [ ] **Step 1: Write failing tests for action messaging and confirmation reset**

Add or extend tests that verify:

```ts
expect(messageUpdate?.graphWorkbench?.message).toBe('Reject release failed.')
expect(next.graphWorkbench?.pendingConfirmationActionId).toBeUndefined()
```

Cover these flows:

- reject requires one extra `Enter`
- moving away from the selected action clears pending confirmation
- successful approve or reject refreshes the workbench and keeps the operator in place

Run: `npm run test:run -- tests/tui/app.test.tsx tests/tui/app-input.test.ts`
Expected: at least one new assertion FAILS before the implementation changes.

- [ ] **Step 2: Centralize action outcome copy**

Keep workbench outcome messages explicit and scoped to the selected action:

```ts
message: `${action.label} completed.`
message: `${action.label} failed.`
message: `Press Enter again to confirm ${action.label.toLowerCase()}.`
```

Make sure all branches in `runWorkbenchAction()` and `handleGraphWorkbenchInput()` converge on the same message style.

- [ ] **Step 3: Preserve workbench position after action refresh**

After a successful action refresh, keep:

- the same session
- the same selected node when it still exists
- the same focused panel when it is still valid

The current `refreshWorkbench()` path already keeps most of this state. Tighten it so a direct action cannot silently kick the operator back into an ambiguous selection state.

- [ ] **Step 4: Surface confirmation state in the action list**

Render a visible confirmation hint on the selected action when a reject action is armed:

```tsx
const confirmationHint = action.id === props.pendingConfirmationActionId ? ' [press Enter again]' : ''
```

Update the component signature as needed so `GraphWorkbench` can render the pending confirmation state.

- [ ] **Step 5: Run the focused tests**

Run: `npm run test:run -- tests/tui/app.test.tsx tests/tui/app-input.test.ts`
Expected: PASS

**Task 3 exit:** The operator can take the common next action in place, with predictable confirmation and refresh behavior.

## Task 4: Expand Attention And Event Coverage

**Files:**
- Modify: `src/tui/graph-workbench-loader.ts`
- Modify: `src/tui/components/graph-workbench.tsx`
- Test: `tests/tui/graph-workbench-loader.test.ts`
- Test: `tests/tui/components.test.tsx`

- [ ] **Step 1: Write failing tests for newly ready, retry, completion, and failure event coverage**

Add JSONL fixture lines and loader expectations for:

- `waiting_retry`
- `workflow_failed`
- `workflow_completed`
- `stage_changed` summaries that reveal newly ready or newly unblocked nodes when persisted detail exists

Example expectation:

```ts
expect(workbench.events.map((event) => event.summary)).toContain('Workflow completed.')
expect(workbench.events.map((event) => event.summary)).toContain('Retry scheduled for review cycle 2.')
```

Run: `npm run test:run -- tests/tui/graph-workbench-loader.test.ts`
Expected: FAIL because the summarizer does not yet cover all target event language cleanly.

- [ ] **Step 2: Expand relevant event handling**

Keep the event whitelist explicit and map each supported event to concise operator-facing copy:

```ts
case 'workflow_completed':
  return 'Workflow completed.'
case 'workflow_failed':
  return event.summary || 'Workflow failed.'
case 'waiting_retry':
  return event.summary || 'Retry scheduled.'
```

Do not derive speculative event copy from unrelated summary text. Only use persisted event fields that already exist.

- [ ] **Step 3: Tighten attention item ordering**

Build the attention list so the most urgent items appear first:

1. waiting approvals
2. blocked nodes
3. retrying nodes when a persisted status reason exists

Keep the strings short and directly tied to the node ID and reason.

- [ ] **Step 4: Verify event and attention rendering**

Extend `tests/tui/components.test.tsx` to assert that the rendered workbench contains the newly supported event copy.

- [ ] **Step 5: Run the focused tests**

Run: `npm run test:run -- tests/tui/graph-workbench-loader.test.ts tests/tui/components.test.tsx`
Expected: PASS

**Task 4 exit:** The operator can see what changed recently and what needs attention next from one compact area.

## Task 5: Doc Sync And Completion Verification

**Files:**
- Modify: `docs/references/capabilities.md`
- Modify: `docs/README.md`
- Test: `tests/tui/graph-workbench-loader.test.ts`
- Test: `tests/tui/components.test.tsx`
- Test: `tests/tui/app.test.tsx`
- Test: `tests/tui/app-input.test.ts`

- [ ] **Step 1: Update the capability reference**

Refresh the `TUI` row in `docs/references/capabilities.md` so it describes the finished workbench in plain language:

- overview shows graph-wide state distribution
- selected node shows richer review detail
- direct actions can approve, reject, or jump to linked sessions
- attention and events surface recent high-signal changes

- [ ] **Step 2: Keep the docs index current**

Add this implementation plan to `docs/README.md` under the plan history table.

- [ ] **Step 3: Run the focused workbench tests**

Run:

```bash
npm run test:run -- tests/tui/graph-workbench-loader.test.ts tests/tui/components.test.tsx tests/tui/app.test.tsx tests/tui/app-input.test.ts
```

Expected: PASS

- [ ] **Step 4: Run the required repo checks**

Run:

```bash
npm run check:docs
npm run build
```

Expected:

- `check:docs` passes with the new plan and updated references
- `build` passes after the workbench type and component changes

- [ ] **Step 5: Optional final confidence run**

If the changed files drop below coverage expectations, run:

```bash
npm run test:coverage
```

Expected: the touched workbench files remain at or above the project coverage bar.

**Task 5 exit:** The finished workbench behavior is documented, verified, and ready to hand back without caveats.

## Spec Coverage Check

- graph-wide understanding at a glance: covered by Task 1
- fast movement from overview to selected-node detail: existing route retained, validated in Task 3
- deeper node inspection: covered by Task 2
- direct common actions from the workbench: hardened in Task 3
- compact recent attention and events: expanded in Task 4
- visible, testable completion bar: documented and verified in Task 5

No broader scheduler, web UI, or cross-machine work is included in this plan.

## Recommended Execution Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5

This keeps the implementation order aligned with operator value: understand first, inspect second, act third, monitor fourth, then lock documentation and verification.
