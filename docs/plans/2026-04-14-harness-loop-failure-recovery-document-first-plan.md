# Harness / Loop Failure Recovery Document-First Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the harness / loop failure recovery work in a document-first flow, so each implementation step starts from a written mini-spec and the harness graph shows real task nodes instead of a placeholder.

**Architecture:** Keep the existing recovery target in `docs/plans/2026-04-14-harness-loop-failure-recovery.md` as the top-level requirement. Add one execution plan that breaks the work into graph-friendly stages, then require a short step document before each stage starts. The harness graph should mirror those stages directly so operators can inspect real progress in CLI and TUI.

**Tech Stack:** Markdown planning docs, TypeScript, Commander, Vitest, repo-local `.magpie/` workflow artifacts, harness graph artifact

---

## Why This Plan Exists

The current requirement document is clear about the target behavior, but it is still too large to show as a useful operator graph by itself. If Magpie submits the whole requirement as one task, the workbench can only show a placeholder or one coarse node.

This plan fixes that by introducing a document-first execution rhythm:

1. write one top-level implementation plan
2. break the work into a small set of real stages
3. write a short step document before each stage starts
4. update the graph to reflect those stages
5. implement and verify one stage at a time

The result should be a graph that answers a real operator question:

> "Which recovery stage is running now, which stage is blocked, and which document should I read before continuing?"

## Definition Of Done

This work is only complete when all of the following are true:

- the failure recovery requirement is represented by multiple real graph nodes instead of one placeholder node
- each graph node maps to a documented implementation stage
- every stage starts from a written step document committed under `docs/plans/`
- operators can inspect the graph in `magpie tui` and understand stage order and current status
- implementation still follows the original recovery acceptance criteria from `docs/plans/2026-04-14-harness-loop-failure-recovery.md`

## Real Task Graph

The requirement should be shown as these five execution nodes:

1. `loop-recovery`
   Make `loop` persist recoverable failures as resumable checkpoints.
2. `harness-recovery`
   Make `harness` treat recoverable inner loop failures as resumable workflow state.
3. `submit-reconnect`
   Make `harness submit` reconnect to the latest recoverable matching session.
4. `provider-session-reuse`
   Persist and restore provider session continuity by role.
5. `verification-and-compat`
   Cover old sessions, artifact preservation, and regression verification.

Dependencies:

- `harness-recovery` depends on `loop-recovery`
- `submit-reconnect` depends on `harness-recovery`
- `provider-session-reuse` depends on `harness-recovery`
- `verification-and-compat` depends on `submit-reconnect` and `provider-session-reuse`

This graph is intentionally narrow. It matches the existing requirement document and stays small enough to be read in the TUI.

## Document-First Rules

These rules apply to every stage:

- before implementation starts, write a stage document in `docs/plans/`
- the stage document must state scope, touched files, acceptance checks, and explicit non-goals
- implementation for that stage must not begin until the stage document exists
- after the stage is implemented and verified, update the stage document with final outcome notes
- if a stage needs to split further, create child planning docs before changing code

## File Map

### Top-level docs

- Existing: `docs/plans/2026-04-14-harness-loop-failure-recovery.md`
  The source requirement and acceptance target.
- Create: `docs/plans/2026-04-14-harness-loop-failure-recovery-document-first-plan.md`
  This execution plan.

### Stage docs to create during execution

- Create: `docs/plans/2026-04-14-loop-recovery-stage.md`
- Create: `docs/plans/2026-04-14-harness-recovery-stage.md`
- Create: `docs/plans/2026-04-14-submit-reconnect-stage.md`
- Create: `docs/plans/2026-04-14-provider-session-reuse-stage.md`
- Create: `docs/plans/2026-04-14-verification-and-compat-stage.md`

### Runtime and UI files expected to change later

- `src/cli/commands/harness.ts`
- `src/capabilities/loop/application/execute.ts`
- `src/capabilities/workflows/harness/application/execute.ts`
- `src/capabilities/workflows/shared/runtime.ts`
- `src/providers/types.ts`
- provider implementations under `src/providers/`
- graph creation / queue entry files that decide what the harness graph contains
- related tests under `tests/cli/`, `tests/capabilities/`, and `tests/tui/`

## Task 1: Write The Top-Level Execution Plan

**Files:**
- Create: `docs/plans/2026-04-14-harness-loop-failure-recovery-document-first-plan.md`
- Modify: `docs/README.md`
- Verify: `npm run check:docs`

- [ ] **Step 1: Write the top-level execution plan**

The plan must define:

- the five real graph nodes
- dependency order between nodes
- the rule that every node starts from a stage document
- which source files are expected to change later
- what counts as done

- [ ] **Step 2: Add the plan to the docs map**

Update `docs/README.md` so the new plan is discoverable from the main docs index.

- [ ] **Step 3: Verify the docs structure**

Run: `npm run check:docs`
Expected: PASS

**Task 1 exit:** The requirement has a committed execution plan and a documented graph shape.

## Task 2: Create Stage Documents Before Any Code Work

**Files:**
- Create: `docs/plans/2026-04-14-loop-recovery-stage.md`
- Create: `docs/plans/2026-04-14-harness-recovery-stage.md`
- Create: `docs/plans/2026-04-14-submit-reconnect-stage.md`
- Create: `docs/plans/2026-04-14-provider-session-reuse-stage.md`
- Create: `docs/plans/2026-04-14-verification-and-compat-stage.md`

- [ ] **Step 1: Write the loop recovery stage doc**

This document should cover:

- how to decide whether a loop failure is recoverable
- which persisted evidence must exist
- how `loop resume` should continue
- how old failed sessions should be treated if they contain enough evidence

- [ ] **Step 2: Write the harness recovery stage doc**

This document should cover:

- how inner loop recoverable failures map to outer harness state
- which artifacts must be preserved on the harness session
- how `harness resume` re-enters the same development stage

- [ ] **Step 3: Write the submit reconnect stage doc**

This document should cover:

- exact reconnect matching rules
- when a new session must still be created
- how CLI output should distinguish reconnect from fresh submit

- [ ] **Step 4: Write the provider session reuse stage doc**

This document should cover:

- role-scoped provider session keys
- restore behavior on resume
- fallback behavior when a provider does not support remote continuation

- [ ] **Step 5: Write the verification and compatibility stage doc**

This document should cover:

- old-session compatibility
- artifact preservation rules
- regression checks
- manual verification expectations

**Task 2 exit:** Every real task node has a corresponding stage document before implementation starts.

## Task 3: Make Harness Graph Creation Use The Real Task Graph

**Files:**
- Modify: graph creation path used by `harness submit` / queue entry
- Modify: related tests under `tests/cli/` and `tests/tui/`

- [ ] **Step 1: Replace the placeholder graph with the five-node graph**

Graph creation should emit:

- one node per documented stage
- the dependency order defined in this plan
- titles that match the stage documents
- source requirement path pointing back to `docs/plans/2026-04-14-harness-loop-failure-recovery.md`

- [ ] **Step 2: Add graph metadata that helps operators**

The graph should expose enough text to explain:

- which stage is currently runnable
- which stage is waiting on another stage
- which stage document should be read next

- [ ] **Step 3: Verify the graph is visible in CLI and TUI**

Checks:

- `magpie harness status <session-id>` shows a multi-node graph summary
- `magpie tui` can open the graph-backed harness session
- the workbench shows the five stage nodes instead of one placeholder node

**Task 3 exit:** Operators can see a real task graph for this requirement.

## Task 4: Execute The Stages In Order

**Files:**
- Use the stage docs from Task 2 as the implementation gates
- Touch runtime files only after the matching stage doc exists

- [ ] **Step 1: Implement `loop-recovery`**
- [ ] **Step 2: Verify `loop-recovery`**
- [ ] **Step 3: Implement `harness-recovery`**
- [ ] **Step 4: Verify `harness-recovery`**
- [ ] **Step 5: Implement `submit-reconnect`**
- [ ] **Step 6: Verify `submit-reconnect`**
- [ ] **Step 7: Implement `provider-session-reuse`**
- [ ] **Step 8: Verify `provider-session-reuse`**
- [ ] **Step 9: Implement `verification-and-compat`**
- [ ] **Step 10: Run full verification**

Required verification at the end of this task:

- `npm run test:run`
- `npm run build`
- `npm run check:docs`

If coverage enforcement applies to touched files, also run:

- `npm run test:coverage`

**Task 4 exit:** Implementation matches the original recovery requirement and the visible graph reflects real stage progress.

## Task 5: Close The Loop In Docs

**Files:**
- Modify: stage docs created in Task 2
- Modify: `docs/references/capabilities.md`
- Modify: `docs/README.md` if new follow-up docs are created

- [ ] **Step 1: Update each stage doc with outcome notes**

Each stage doc should record:

- what was actually changed
- what was deferred
- what verification proved the stage complete

- [ ] **Step 2: Update user-facing capability docs**

Only after runtime behavior truly changes, update:

- `docs/references/capabilities.md`

to explain the new recovery and reconnect behavior.

- [ ] **Step 3: Re-run docs verification**

Run: `npm run check:docs`
Expected: PASS

**Task 5 exit:** Documentation reflects both the plan and the delivered behavior.

## Operator Workflow

Once Task 3 is done, the intended operator flow becomes:

1. submit the requirement through `harness`
2. open `magpie tui`
3. select the harness session
4. enter the graph workbench
5. inspect which stage node is ready, running, or blocked
6. open the matching stage document before continuing implementation

This keeps the graph, the docs, and the code flow aligned.

## Stop Line

Stop once the failure recovery requirement:

- has a real graph with documented stages
- can be inspected in the graph workbench
- is implemented stage by stage with document-first discipline

Do not expand this effort into generic automatic PRD-to-graph decomposition beyond what is needed for this requirement.
