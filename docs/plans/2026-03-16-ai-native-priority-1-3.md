# AI-Native Priority 1 and 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the `discuss` regression, restore a trustworthy verification loop, finish the Capability V2 migration, and add planning/operations integration foundations that make Magpie closer to an AI-native engineering runtime.

**Architecture:** First, normalize the `discuss` capability contract so CLI input, capability `prepare`, and runtime `execute` all use one shape. Then add missing verification guardrails (`lint`, coverage) before removing V2 bridge exports and introducing explicit planning/operations integration modules under `src/platform/integrations/`.

**Tech Stack:** TypeScript, Commander, Vitest, GitHub Actions, YAML config, Magpie capability runtime

---

## Assumptions

- Planning integration starts with a provider-neutral abstraction and lands two concrete project-system providers: `feishu-project` and `jira`.
- Planning integration is about syncing plan context and artifacts with external project systems; it is independent from existing GitHub review/comment capabilities.
- Operations integration starts with command/CI/regression evidence ingestion, not Sentry/Datadog. Those can be follow-up providers after the abstraction exists.
- The migration target is: `src/cli` + `src/capabilities` depend on `src/core` and `src/platform`, not on legacy `src/state`, `src/providers`, `src/repo-scanner`, `src/context-gatherer`, `src/reporter`, or `src/orchestrator` paths.

### Task 1: Normalize `discuss` capability input contract

**Files:**
- Modify: `src/capabilities/discuss/types.ts`
- Modify: `src/capabilities/discuss/application/prepare.ts`
- Modify: `src/capabilities/discuss/application/execute.ts`
- Test: `tests/capabilities/discuss/prepare.test.ts`
- Test: `tests/capabilities/discuss/execute.test.ts`
- Test: `tests/cli/capability-runtime-commands.test.ts`

**Step 1: Write the failing tests**

```ts
it('normalizes top-level discuss flags into options', async () => {
  const prepared = await prepareDiscussInput({
    topic: 'Should we adopt a monorepo?',
    rounds: '2',
    reviewers: 'claude',
  } as never, ctx)

  expect(prepared.options).toEqual(
    expect.objectContaining({
      rounds: '2',
      reviewers: 'claude',
    })
  )
})
```

```ts
it('passes normalized options into runDiscussFlow', async () => {
  await executeDiscuss(prepared, createCapabilityContext())

  expect(runDiscussFlow).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({ rounds: '2', reviewers: 'claude' }),
    })
  )
})
```

**Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/capabilities/discuss/prepare.test.ts tests/capabilities/discuss/execute.test.ts tests/cli/capability-runtime-commands.test.ts`

Expected: `tests/capabilities/discuss/execute.test.ts` fails because `runDiscussFlow` receives `{}` for `options`.

**Step 3: Write minimal implementation**

```ts
function normalizeDiscussOptions(input: DiscussCapabilityInput): DiscussOptions {
  if (input.options) return input.options

  return {
    rounds: input.rounds ?? '5',
    format: input.format ?? 'markdown',
    reviewers: input.reviewers,
    interactive: input.interactive,
    output: input.output,
    converge: input.converge,
    all: input.all,
    devilAdvocate: input.devilAdvocate,
    list: input.list,
    resume: input.resume,
    config: input.config,
  }
}
```

Update `prepareDiscussInput` to always set `options: normalizeDiscussOptions(input)` and update the input type so both CLI-style top-level flags and nested `options` are supported during the migration window.

**Step 4: Run tests to verify they pass**

Run: `npm run test:run -- tests/capabilities/discuss/prepare.test.ts tests/capabilities/discuss/execute.test.ts tests/cli/capability-runtime-commands.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/capabilities/discuss/types.ts src/capabilities/discuss/application/prepare.ts src/capabilities/discuss/application/execute.ts tests/capabilities/discuss/prepare.test.ts tests/capabilities/discuss/execute.test.ts tests/cli/capability-runtime-commands.test.ts
git commit -m "fix(discuss):统一能力输入参数"
```

### Task 2: Restore a trustworthy local verification loop

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Step 1: Write the failing workflow expectation**

Document the desired local/CI contract in `README.md`:

```md
Before submitting changes, run:

- `npm run lint`
- `npm run test:run`
- `npm run test:coverage`
- `npm run build`
- `npm run check:boundaries`
```

**Step 2: Run current verification commands**

Run:

```bash
npm run test:run
npm run build
npm run check:boundaries
```

Expected: `test:run` fails before Task 1 is merged; after Task 1, all three pass.

**Step 3: Add the missing scripts contract**

```json
{
  "scripts": {
    "lint": "eslint .",
    "test:coverage": "vitest run --coverage"
  }
}
```

Update CI to run:

```yml
- run: npm run lint
- run: npm run test:run
- run: npm run test:coverage
- run: npx tsc --noEmit
- run: npm run check:boundaries
```

**Step 4: Re-run the verification set**

Run:

```bash
npm run lint
npm run test:run
npm run test:coverage
npm run build
npm run check:boundaries
```

Expected: all commands exit `0`.

**Step 5: Commit**

```bash
git add package.json .github/workflows/ci.yml README.md
git commit -m "chore(ci):补齐本地与持续验证回路"
```

### Task 3: Add ESLint with a minimal repo-safe ruleset

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json`
- Test: `README.md`

**Step 1: Write the failing command**

Run: `npm run lint`

Expected: FAIL with `Missing script: "lint"` or missing ESLint dependency/config.

**Step 2: Add minimal lint config**

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
)
```

Add dev dependencies:

```json
{
  "devDependencies": {
    "eslint": "...",
    "@eslint/js": "...",
    "typescript-eslint": "..."
  }
}
```

**Step 3: Run lint and fix only concrete errors**

Run: `npm run lint`

Expected: FAIL with a finite set of real lint errors; fix the repo or scope the config to avoid legacy false positives.

**Step 4: Re-run lint**

Run: `npm run lint`

Expected: PASS

**Step 5: Commit**

```bash
git add eslint.config.js package.json README.md
git commit -m "chore(tooling):加入最小 lint 守卫"
```

### Task 4: Add coverage reporting as a first-class feedback loop

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Step 1: Write the failing command**

Run: `npm run test:coverage`

Expected: FAIL because the script and/or coverage provider is missing.

**Step 2: Add coverage configuration**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
})
```

Add dev dependency:

```json
{
  "devDependencies": {
    "@vitest/coverage-v8": "..."
  }
}
```

**Step 3: Run coverage**

Run: `npm run test:coverage`

Expected: PASS and generate `coverage/`.

**Step 4: Decide the initial quality gate**

Start without a hard threshold in CI. Record the baseline in the PR, then add thresholds only after noisy files are understood.

**Step 5: Commit**

```bash
git add vitest.config.ts package.json .github/workflows/ci.yml README.md
git commit -m "test(coverage):加入覆盖率反馈回路"
```

### Task 5: Finish Capability V2 import migration and remove bridge exports

**Files:**
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/capabilities/loop/types.ts`
- Modify: `src/capabilities/discuss/runtime/flow.ts`
- Modify: `src/core/debate/runner.ts`
- Modify: `src/commands/review/repo-review.ts`
- Modify: `src/commands/review/session-cmds.ts`
- Modify: `src/commands/review/types.ts`
- Modify: `src/commands/stats.ts`
- Delete: `src/core/repo/scanner.ts`
- Delete: `src/core/repo/filter.ts`
- Delete: `src/core/repo/types.ts`
- Delete: `src/core/history/tracker.ts`
- Delete: `src/core/state/state-manager.ts`
- Delete: `src/core/state/types.ts`
- Delete: `src/core/context/gatherer.ts`
- Delete: `src/core/context/types.ts`
- Delete: `src/core/reporting/markdown.ts`
- Delete: `src/core/reporting/types.ts`
- Delete: `src/platform/providers/factory.ts`
- Delete: `src/platform/providers/types.ts`

**Step 1: Write the inventory command**

Run:

```bash
rg -n "from '../../(state|providers|repo-scanner|context-gatherer|reporter|history|orchestrator)|from '../(state|providers|repo-scanner|context-gatherer|reporter|history|orchestrator)" src
```

Expected: a concrete list of remaining legacy imports.

**Step 2: Switch runtime consumers to V2 paths**

Examples:

```ts
import { StateManager } from '../../../core/state/index.js'
import type { AIProvider, Message } from '../../../platform/providers/index.js'
import { runDebateSession } from '../../../core/debate/runner.js'
```

```ts
import { HistoryTracker } from '../../core/history/index.js'
```

**Step 3: Remove bridge exports only after consumers are gone**

Delete the one-line bridge files after `rg` returns no matches.

**Step 4: Run migration safety checks**

Run:

```bash
npm run test:run
npm run build
npm run check:boundaries
```

Expected: PASS, and `rg` shows no remaining direct imports from legacy roots in V2 modules.

**Step 5: Commit**

```bash
git add src/capabilities src/core src/platform src/commands
git commit -m "refactor(core):完成 v2 架构迁移收口"
```

### Task 6: Add planning integration abstraction and Feishu/Jira providers

**Files:**
- Create: `src/platform/integrations/planning/types.ts`
- Create: `src/platform/integrations/planning/router.ts`
- Create: `src/platform/integrations/planning/providers/feishu-project.ts`
- Create: `src/platform/integrations/planning/providers/jira.ts`
- Create: `src/platform/integrations/planning/factory.ts`
- Create: `src/platform/integrations/planning/index.ts`
- Modify: `src/platform/integrations/index.ts`
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/config/init.ts`
- Test: `tests/platform/planning/router.test.ts`
- Test: `tests/platform/planning/feishu-project.test.ts`
- Test: `tests/platform/planning/jira.test.ts`

**Step 1: Write the failing tests**

```ts
it('routes planning requests to the configured provider', async () => {
  const router = createPlanningRouter({
    providers: { jira_main: mockProvider },
    default_provider: 'jira_main',
  })

  await router.createPlanContext({ projectKey: 'ENG', itemKey: 'ENG-12' })

  expect(mockProvider.createPlanContext).toHaveBeenCalled()
})
```

```ts
it('builds a Feishu project provider from config', () => {
  const providers = createPlanningProviders({
    enabled: true,
    default_provider: 'feishu_main',
    providers: {
      feishu_main: {
        type: 'feishu-project',
        base_url: 'https://project.feishu.cn',
        project_key: 'checkout',
        app_id: '${FEISHU_PROJECT_APP_ID}',
        app_secret: '${FEISHU_PROJECT_APP_SECRET}',
      },
    },
  })

  expect(providers.feishu_main).toBeDefined()
})
```

**Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/platform/planning/router.test.ts tests/platform/planning/feishu-project.test.ts tests/platform/planning/jira.test.ts`

Expected: FAIL because the module does not exist yet.

**Step 3: Write minimal implementation**

```ts
export interface PlanningProvider {
  createPlanContext(input: { projectKey?: string; itemKey?: string; title?: string }): Promise<PlanningContext>
  syncPlanArtifact(input: { projectKey?: string; itemKey?: string; body: string }): Promise<void>
}
```

```ts
export function createPlanningRouter(config: PlanningIntegrationConfig): PlanningRouter {
  const providers = createPlanningProviders(config)
  return {
    createPlanContext(input) {
      return providers[config.default_provider].createPlanContext(input)
    },
    syncPlanArtifact(input) {
      return providers[config.default_provider].syncPlanArtifact(input)
    },
  }
}
```

Add provider config types:

```ts
export interface FeishuProjectPlanningProviderConfig {
  type: 'feishu-project'
  base_url: string
  project_key?: string
  app_id: string
  app_secret: string
}
```

```ts
export interface JiraPlanningProviderConfig {
  type: 'jira'
  base_url: string
  project_key?: string
  email: string
  api_token: string
}
```

**Step 4: Re-run tests**

Run: `npm run test:run -- tests/platform/planning/router.test.ts tests/platform/planning/feishu-project.test.ts tests/platform/planning/jira.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/platform/integrations/planning src/platform/integrations/index.ts src/platform/config/types.ts src/platform/config/init.ts tests/platform/planning
git commit -m "feat(planning):新增计划系统集成抽象"
```

### Task 7: Add operations integration abstraction for regression evidence

**Files:**
- Create: `src/platform/integrations/operations/types.ts`
- Create: `src/platform/integrations/operations/router.ts`
- Create: `src/platform/integrations/operations/providers/local-commands.ts`
- Create: `src/platform/integrations/operations/index.ts`
- Modify: `src/platform/integrations/index.ts`
- Modify: `src/platform/config/types.ts`
- Test: `tests/platform/operations/router.test.ts`
- Test: `tests/platform/operations/local-commands.test.ts`

**Step 1: Write the failing tests**

```ts
it('collects operation evidence from configured commands', async () => {
  const result = await provider.collectEvidence({
    cwd: fixtureDir,
    commands: ['npm run test:run', 'npm run build'],
  })

  expect(result.runs).toHaveLength(2)
  expect(result.summary).toContain('test:run')
})
```

**Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/platform/operations/router.test.ts tests/platform/operations/local-commands.test.ts`

Expected: FAIL because the module does not exist.

**Step 3: Write minimal implementation**

```ts
export interface OperationsProvider {
  collectEvidence(input: { cwd: string; commands: string[] }): Promise<OperationsEvidence>
}
```

```ts
export interface OperationsEvidence {
  runs: Array<{ command: string; passed: boolean; output: string }>
  summary: string
}
```

**Step 4: Re-run tests**

Run: `npm run test:run -- tests/platform/operations/router.test.ts tests/platform/operations/local-commands.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/platform/integrations/operations src/platform/integrations/index.ts src/platform/config/types.ts tests/platform/operations
git commit -m "feat(ops):新增运维证据集成抽象"
```

### Task 8: Wire planning and operations integrations into loop/workflows

**Files:**
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/capabilities/workflows/issue-fix/application/execute.ts`
- Modify: `src/capabilities/workflows/post-merge-regression/application/execute.ts`
- Modify: `src/platform/config/init.ts`
- Modify: `README.md`
- Test: `tests/capabilities/loop/loop.test.ts`
- Test: `tests/capabilities/workflows/issue-fix.test.ts`
- Test: `tests/capabilities/workflows/post-merge-regression.test.ts`

**Step 1: Write the failing integration tests**

```ts
it('syncs loop plan artifacts to the planning router when configured', async () => {
  expect(mockPlanningRouter.syncPlanArtifact).toHaveBeenCalledWith(
    expect.objectContaining({ body: expect.stringContaining('Goal:') })
  )
})
```

```ts
it('attaches operations evidence to post-merge regression summaries', async () => {
  expect(summary.details.evidence.runs[0].command).toBe('npm run test:run')
})
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:run -- tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/issue-fix.test.ts tests/capabilities/workflows/post-merge-regression.test.ts
```

Expected: FAIL because the routers are not invoked yet.

**Step 3: Write minimal integration code**

```ts
const planningRouter = createPlanningRouter(config.integrations.planning)
await planningRouter.syncPlanArtifact({
  projectKey: session.projectKey,
  itemKey: session.itemKey,
  body: renderLoopPlanMarkdown(session, tasks),
})
```

```ts
const operationsRouter = createOperationsRouter(config.integrations.operations)
const evidence = await operationsRouter.collectEvidence({
  cwd,
  commands: runtime.commands,
})
```

**Step 4: Re-run the affected test set and full verification**

Run:

```bash
npm run test:run -- tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/issue-fix.test.ts tests/capabilities/workflows/post-merge-regression.test.ts
npm run test:run
npm run lint
npm run test:coverage
npm run build
npm run check:boundaries
```

Expected: all commands exit `0`.

**Step 5: Commit**

```bash
git add src/capabilities/loop src/capabilities/workflows src/platform/config/init.ts README.md tests/capabilities
git commit -m "feat(workflow):接入计划与运维集成"
```

## Final Verification

Run:

```bash
npm run lint
npm run test:run
npm run test:coverage
npm run build
npm run check:boundaries
```

Expected:

- `lint` passes
- `test:run` passes
- `test:coverage` passes and writes `coverage/`
- `build` passes
- `check:boundaries` passes

## Delivery Notes

- Keep Task 1 and Task 5 separate commits; they fix different risk classes.
- Do not remove bridge files until import inventory is clean.
- Do not add hard coverage thresholds in the first pass.
- Keep Feishu Project and Jira providers behind config gates and fully mock their HTTP behavior in tests.
