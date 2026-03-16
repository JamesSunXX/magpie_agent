# Planning Context Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pull remote planning context into `loop` and `issue-fix` planner inputs without changing the existing artifact sync and operations evidence contracts.

**Architecture:** Extend planning providers so `createPlanContext()` can return a prompt-ready remote summary instead of URL metadata only. Then thread optional planning target inputs through CLI/capability prepare layers and inject the returned context into the planner prompt builders for `loop` and `issue-fix`.

**Tech Stack:** TypeScript, Commander, Vitest, YAML config, Magpie capability runtime

---

### Task 1: Add failing tests for remote planning context retrieval

**Files:**
- Modify: `tests/platform/planning/jira.test.ts`
- Modify: `tests/platform/planning/feishu-project.test.ts`
- Test: `tests/platform/planning/router.test.ts`

**Step 1: Write the failing tests**

- Add provider tests that call `createPlanContext()` and expect a fetched remote summary.
- Add a router test that confirms `createPlanContext()` is routed through the configured default provider.

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/platform/planning/router.test.ts tests/platform/planning/jira.test.ts tests/platform/planning/feishu-project.test.ts`

Expected: FAIL because providers currently return static metadata without remote summary fetching.

### Task 2: Add failing tests for prompt injection and explicit planning target input

**Files:**
- Modify: `tests/capabilities/loop/loop.test.ts`
- Modify: `tests/capabilities/workflows/issue-fix.test.ts`
- Modify: `tests/cli/program.test.ts`

**Step 1: Write the failing tests**

- Add a `loop` test that expects the planner prompt to include fetched planning context.
- Add an `issue-fix` test that expects the planner prompt to include fetched planning context from the linked item.
- Add CLI tests for optional `--planning-item` and `--planning-project` flags.

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/issue-fix.test.ts tests/cli/program.test.ts`

Expected: FAIL because the capabilities do not yet fetch or inject planning context, and the CLI flags do not exist yet.

### Task 3: Implement planning context retrieval and prompt integration

**Files:**
- Modify: `src/platform/integrations/planning/types.ts`
- Modify: `src/platform/integrations/planning/providers/jira.ts`
- Modify: `src/platform/integrations/planning/providers/feishu-project.ts`
- Modify: `src/capabilities/loop/types.ts`
- Modify: `src/capabilities/loop/application/prepare.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/capabilities/loop/domain/planner.ts`
- Modify: `src/capabilities/workflows/issue-fix/types.ts`
- Modify: `src/capabilities/workflows/issue-fix/application/prepare.ts`
- Modify: `src/capabilities/workflows/issue-fix/application/execute.ts`
- Modify: `src/cli/commands/loop.ts`
- Modify: `src/cli/commands/workflow.ts`

**Step 1: Write minimal implementation**

- Extend `PlanningContext` with a prompt-ready summary field.
- Update providers to fetch remote planning data and normalize it into prompt-safe text.
- Thread `planningProjectKey` / `planningItemKey` through CLI and capability inputs.
- Add fallback key inference from issue text, goal text, and PRD path.
- Inject the fetched planning context into the planner prompt only when available.

**Step 2: Run the affected tests**

Run: `npm run test:run -- tests/platform/planning/router.test.ts tests/platform/planning/jira.test.ts tests/platform/planning/feishu-project.test.ts tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/issue-fix.test.ts tests/cli/program.test.ts`

Expected: PASS

### Task 4: Run full verification

**Step 1: Run the verification contract**

Run:

```bash
npm run lint
npm run test:run
npm run test:coverage
npm run build
npm run check:boundaries
npm run dev -- --help
```

Expected: all commands exit `0`.
