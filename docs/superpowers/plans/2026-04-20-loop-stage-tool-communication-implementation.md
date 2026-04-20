# Loop 阶段与工具沟通改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `loop` 从当前 6 段流程改造成 9 段正式阶段、按正式阶段配置 `primary/reviewer/rescue` 工具、并让每段通过结构化交接卡在工具之间接力。

**Architecture:** 先把配置和阶段词表扩成新模型，再在 `loop` 运行时引入按阶段解析绑定的薄适配层，最后把 `execute.ts` 的阶段执行流改成 9 段并补上交接卡、返工语义和文档。保留当前会话、失败恢复、多模型确认和 provider session 复用主路径，避免一次把 loop 改成全新的编排系统。

**Tech Stack:** TypeScript、Commander、Vitest、repo-local `.magpie/` 会话产物、当前 loop runtime

---

## File Map

### Existing files to modify

- `src/platform/config/types.ts`
  Purpose: 把 `LoopStageName` 从 6 段扩成 9 段，并定义按阶段配置的 `primary/reviewer/rescue` 结构。
- `src/platform/config/loader.ts`
  Purpose: 校验新阶段名、阶段配置和阶段级超时覆盖。
- `src/platform/config/init.ts`
  Purpose: 初始化默认配置，输出新的 9 段阶段和阶段级工具配置样例。
- `src/state/types.ts`
  Purpose: 扩展 loop 会话与阶段结果，补上交接卡和返工语义需要的字段。
- `src/capabilities/loop/application/execute.ts`
  Purpose: 把默认阶段、阶段执行流、阶段工具解析、返工回流和交接卡写入全部改成新模型。
- `src/capabilities/loop/domain/planner.ts`
  Purpose: 让 planner 输出覆盖新阶段词表和交接卡导向的任务描述。
- `src/capabilities/loop/domain/auto-commit-message.ts`
  Purpose: 支持新的阶段名，保证默认提交文案不会引用已删除的 `code_development`。
- `docs/references/capabilities.md`
  Purpose: 更新 loop 阶段定义、阶段级工具配置和返工语义说明。
- `README.md`
  Purpose: 更新 loop 的能力说明、配置示例和用户理解路径。

### New files to create

- `src/capabilities/loop/domain/stage-bindings.ts`
  Purpose: 统一解析阶段级 `primary/reviewer/rescue` 绑定，并提供正式阶段到异常轮次的继承规则。
- `tests/capabilities/loop/stage-bindings.test.ts`
  Purpose: 验证阶段级绑定解析、继承和默认回退。

### Existing test files to modify

- `tests/config/loader-validation.test.ts`
  Purpose: 验证新阶段名、阶段绑定结构和错误提示。
- `tests/platform/config/loader.test.ts`
  Purpose: 验证加载后默认配置带出新的阶段与绑定结构。
- `tests/cli/init-command.test.ts`
  Purpose: 验证 `magpie init` 输出新默认 loop 配置。
- `tests/capabilities/loop/loop.test.ts`
  Purpose: 覆盖 9 段阶段流、交接卡写入、返工语义和阶段工具解析。
- `tests/cli/loop-command.test.ts`
  Purpose: 覆盖 inspect/list 输出能读到新阶段名和新状态。
- `tests/cli/loop-runtime-command.test.ts`
  Purpose: 覆盖 CLI 层对新阶段配置与恢复路径的兼容。
- `tests/capabilities/workflows/shared/runtime.test.ts`
  Purpose: 验证后置验证返工在共享恢复路径里仍保持阶段身份。
- `tests/capabilities/workflows/document-plan.test.ts`
  Purpose: 验证 `document-plan` 仍按新的阶段列表工作。

## Task 1: Expand The Loop Config Schema To 9 Stages And Stage-Level Bindings

**Files:**
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/config/loader.ts`
- Modify: `src/platform/config/init.ts`
- Test: `tests/config/loader-validation.test.ts`
- Test: `tests/platform/config/loader.test.ts`
- Test: `tests/cli/init-command.test.ts`

- [ ] **Step 1: Write the failing config validation tests for new stage names and stage bindings**

Add a validation case that accepts the new 9-stage list and rejects an unknown stage binding key:

```ts
expect(() => loadConfigFromString(`
capabilities:
  loop:
    stages: [prd_review, domain_partition, trd_generation, dev_preparation, red_test_confirmation, implementation, green_fixup, unit_mock_test, integration_test]
    stage_bindings:
      implementation:
        primary:
          tool: codex
        reviewer:
          tool: gemini-cli
        rescue:
          tool: kiro
`)).not.toThrow()

expect(() => loadConfigFromString(`
capabilities:
  loop:
    stage_bindings:
      code_development:
        primary:
          tool: codex
`)).toThrow('Config error: capabilities.loop.stage_bindings.code_development is not a valid loop stage')
```

Run: `npm run test:run -- tests/config/loader-validation.test.ts`
Expected: FAIL because `stage_bindings` is not defined and `code_development` is still treated as valid.

- [ ] **Step 2: Replace the loop stage union in config types**

Update `src/platform/config/types.ts` to remove `code_development` and add the 4 new middle stages plus stage-binding config types:

```ts
export type LoopStageName =
  | 'prd_review'
  | 'domain_partition'
  | 'trd_generation'
  | 'dev_preparation'
  | 'red_test_confirmation'
  | 'implementation'
  | 'green_fixup'
  | 'unit_mock_test'
  | 'integration_test'

export interface LoopStageBindingConfig {
  primary?: RoleBinding
  reviewer?: RoleBinding
  rescue?: RoleBinding
}

export type LoopStageBindingsConfig = Partial<Record<LoopStageName, LoopStageBindingConfig>>
```

- [ ] **Step 3: Add `stage_bindings` to `LoopConfig`**

Extend the loop config shape so the runtime can read per-stage overrides:

```ts
export interface LoopConfig {
  enabled?: boolean
  planner_tool?: string
  planner_model?: string
  planner_agent?: string
  executor_tool?: string
  executor_model?: string
  executor_agent?: string
  role_bindings?: {
    architect?: RoleBinding
    developer?: RoleBinding
  }
  stage_bindings?: LoopStageBindingsConfig
  // existing fields continue unchanged
}
```

- [ ] **Step 4: Validate the new stage list and stage binding keys**

Add a shared stage allowlist in `src/platform/config/loader.ts` and validate both `stages` and `stage_bindings` against it:

```ts
const loopStages: LoopStageName[] = [
  'prd_review',
  'domain_partition',
  'trd_generation',
  'dev_preparation',
  'red_test_confirmation',
  'implementation',
  'green_fixup',
  'unit_mock_test',
  'integration_test',
]

for (const stageName of Object.keys(loop.stage_bindings || {})) {
  if (!loopStages.includes(stageName as LoopStageName)) {
    throw new Error(`Config error: capabilities.loop.stage_bindings.${stageName} is not a valid loop stage`)
  }
}
```

- [ ] **Step 5: Validate `primary/reviewer/rescue` bindings**

Reuse the existing binding validator for each configured role:

```ts
for (const [stageName, binding] of Object.entries(loop.stage_bindings || {})) {
  validateBinding(`capabilities.loop.stage_bindings.${stageName}.primary`, binding.primary)
  validateBinding(`capabilities.loop.stage_bindings.${stageName}.reviewer`, binding.reviewer)
  validateBinding(`capabilities.loop.stage_bindings.${stageName}.rescue`, binding.rescue)
}
```

- [ ] **Step 6: Update stage timeout validation to the new 9-stage list**

Replace the old stage array used by `validateLoopExecutionTimeout()`:

```ts
const stages: LoopStageName[] = [
  'prd_review',
  'domain_partition',
  'trd_generation',
  'dev_preparation',
  'red_test_confirmation',
  'implementation',
  'green_fixup',
  'unit_mock_test',
  'integration_test',
]
```

- [ ] **Step 7: Update `magpie init` defaults**

Change `src/platform/config/init.ts` so the generated config uses the new stage list and shows one concrete stage-binding example:

```yaml
loop:
  enabled: true
  planner_model: ${analyzerModel}
  executor_model: codex
  stages: [prd_review, domain_partition, trd_generation, dev_preparation, red_test_confirmation, implementation, green_fixup, unit_mock_test, integration_test]
  stage_bindings:
    implementation:
      primary:
        tool: codex
      reviewer:
        tool: gemini-cli
      rescue:
        tool: kiro
```

- [ ] **Step 8: Run focused config tests**

Run: `npm run test:run -- tests/config/loader-validation.test.ts tests/platform/config/loader.test.ts tests/cli/init-command.test.ts`
Expected: PASS

**Task 1 exit:** The config layer can express the new 9 stages and per-stage `primary/reviewer/rescue` bindings.

## Task 2: Add A Stage-Binding Resolver That Applies Defaults And Rescue Inheritance

**Files:**
- Create: `src/capabilities/loop/domain/stage-bindings.ts`
- Modify: `src/platform/config/types.ts`
- Test: `tests/capabilities/loop/stage-bindings.test.ts`

- [ ] **Step 1: Write failing tests for stage-binding resolution**

Create `tests/capabilities/loop/stage-bindings.test.ts` with cases for default binding resolution, stage override, and rescue inheritance:

```ts
expect(resolveLoopStageBinding('implementation', runtime)).toMatchObject({
  primary: { tool: 'codex' },
  reviewer: { tool: 'gemini-cli' },
  rescue: { tool: 'kiro' },
})

expect(resolveRescueBinding('implementation', runtime)).toEqual({ tool: 'kiro' })
expect(resolveRescueBinding('integration_test', runtime)).toEqual({ tool: 'kiro' })
```

Run: `npm run test:run -- tests/capabilities/loop/stage-bindings.test.ts`
Expected: FAIL because the resolver module does not exist yet.

- [ ] **Step 2: Define the runtime-facing resolved binding shape**

Create the domain module with a compact resolved type:

```ts
export interface ResolvedLoopStageBinding {
  primary: RoleBinding
  reviewer?: RoleBinding
  rescue?: RoleBinding
}
```

- [ ] **Step 3: Implement default binding derivation**

Map the current global planner/executor defaults into stage-specific defaults:

```ts
function createDefaultStageBinding(stage: LoopStageName, runtime: LoopRuntimeConfig): ResolvedLoopStageBinding {
  if (stage === 'prd_review' || stage === 'domain_partition' || stage === 'trd_generation') {
    return {
      primary: { tool: runtime.plannerTool, model: runtime.plannerModel, agent: runtime.plannerAgent },
      reviewer: { tool: 'gemini-cli', model: 'gemini-cli' },
      rescue: { tool: 'kiro', model: 'kiro', agent: 'architect' },
    }
  }

  return {
    primary: { tool: runtime.executorTool, model: runtime.executorModel, agent: runtime.executorAgent },
    reviewer: stage === 'implementation' || stage === 'unit_mock_test' || stage === 'integration_test'
      ? { tool: 'gemini-cli', model: 'gemini-cli' }
      : { tool: runtime.plannerTool, model: runtime.plannerModel, agent: runtime.plannerAgent },
    rescue: { tool: 'kiro', model: 'kiro', agent: 'dev' },
  }
}
```

- [ ] **Step 4: Merge config overrides over the defaults**

Implement stage override merging with minimal replacement semantics:

```ts
export function resolveLoopStageBinding(
  stage: LoopStageName,
  runtime: LoopRuntimeConfig,
  configured: LoopStageBindingsConfig | undefined
): ResolvedLoopStageBinding {
  const base = createDefaultStageBinding(stage, runtime)
  const override = configured?.[stage]
  return {
    primary: override?.primary || base.primary,
    reviewer: override?.reviewer || base.reviewer,
    rescue: override?.rescue || base.rescue,
  }
}
```

- [ ] **Step 5: Add the rescue helper used by abnormal paths**

Expose a dedicated helper the runtime can call without re-deriving the whole stage object:

```ts
export function resolveRescueBinding(
  stage: LoopStageName,
  runtime: LoopRuntimeConfig,
  configured: LoopStageBindingsConfig | undefined
): RoleBinding | undefined {
  return resolveLoopStageBinding(stage, runtime, configured).rescue
}
```

- [ ] **Step 6: Run the focused resolver test**

Run: `npm run test:run -- tests/capabilities/loop/stage-bindings.test.ts`
Expected: PASS

**Task 2 exit:** The runtime has one place that decides the `primary/reviewer/rescue` binding for every formal stage.

## Task 3: Replace The Old 6-Stage Loop Pipeline With The New 9-Stage Skeleton

**Files:**
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/capabilities/loop/domain/planner.ts`
- Modify: `src/capabilities/loop/domain/auto-commit-message.ts`
- Test: `tests/capabilities/loop/loop.test.ts`
- Test: `tests/cli/loop-runtime-command.test.ts`

- [ ] **Step 1: Write a failing dry-run loop test for the 9-stage default order**

Add a case in `tests/capabilities/loop/loop.test.ts` that expects the session to use the new default stage list:

```ts
expect(result.result.session?.stages).toEqual([
  'prd_review',
  'domain_partition',
  'trd_generation',
  'dev_preparation',
  'red_test_confirmation',
  'implementation',
  'green_fixup',
  'unit_mock_test',
  'integration_test',
])
```

Run: `npm run test:run -- tests/capabilities/loop/loop.test.ts`
Expected: FAIL because the runtime still emits `code_development`.

- [ ] **Step 2: Replace `DEFAULT_STAGES` in `execute.ts`**

Update the stage constant:

```ts
const DEFAULT_STAGES: LoopStageName[] = [
  'prd_review',
  'domain_partition',
  'trd_generation',
  'dev_preparation',
  'red_test_confirmation',
  'implementation',
  'green_fixup',
  'unit_mock_test',
  'integration_test',
]
```

- [ ] **Step 3: Update planner prompts and task generation to reference the new stage names**

Adjust stage prompt text in `src/capabilities/loop/domain/planner.ts` so task generation can target the new stages:

```ts
const stageDescriptions: Record<LoopStageName, string> = {
  prd_review: 'Clarify the requirement, acceptance line, and unresolved questions.',
  domain_partition: 'Split the work into bounded technical slices and dependencies.',
  trd_generation: 'Turn the accepted split into an execution card with validation and rollback.',
  dev_preparation: 'Lock the change scope, target files, and development entry point.',
  red_test_confirmation: 'Prove the failing baseline and capture the failing evidence.',
  implementation: 'Make the code changes for the chosen slice.',
  green_fixup: 'Clean up, self-check, and prepare the handoff to formal verification.',
  unit_mock_test: 'Run close-range verification and record any verification rework.',
  integration_test: 'Run higher-level verification and record any integration rework.',
}
```

- [ ] **Step 4: Replace `code_development` checks with the new middle-stage predicates**

Anywhere `execute.ts` currently branches on `code_development`, split the behavior:

```ts
const isDevelopmentPreparation = stage === 'dev_preparation'
const isRedTestStage = stage === 'red_test_confirmation'
const isImplementationStage = stage === 'implementation'
const isGreenFixupStage = stage === 'green_fixup'
const isVerificationStage = stage === 'unit_mock_test' || stage === 'integration_test'
```

- [ ] **Step 5: Preserve the current TDD hooks but move them to the correct stages**

Move constraint validation and red-test checks to the new stages instead of the deleted `code_development` branch:

```ts
if (stage === 'dev_preparation' && !session.constraintsValidated) {
  // existing constraint snapshot and validation path
}

if (stage === 'red_test_confirmation' && session.redTestConfirmed !== true) {
  // existing failing-test confirmation path
}
```

- [ ] **Step 6: Move the main code-writing path under `implementation`**

Restrict the current executor-driven code-change path to `implementation`:

```ts
if (stage === 'implementation') {
  const stageReport = await runStageExecutionAttempt({
    stage,
    planner,
    executor,
    session,
    runtime,
    // existing dependencies
  })
}
```

- [ ] **Step 7: Move post-implementation cleanup under `green_fixup`**

Introduce a distinct branch for the current “repair and re-run before verification” behavior:

```ts
if (stage === 'green_fixup') {
  const fixupPrompt = buildRepairPrompt(stage, session, 'Prepare the implementation for formal verification.')
  await executor.chat([{ role: 'user', content: fixupPrompt }], undefined)
}
```

- [ ] **Step 8: Update default auto-commit stage labels**

Replace the old `code_development` fallback in `src/capabilities/loop/domain/auto-commit-message.ts`:

```ts
const STAGE_DEFAULT_SCOPES: Record<LoopStageName, string> = {
  prd_review: 'loop',
  domain_partition: 'loop',
  trd_generation: 'loop',
  dev_preparation: 'loop',
  red_test_confirmation: 'test',
  implementation: 'loop',
  green_fixup: 'loop',
  unit_mock_test: 'test',
  integration_test: 'test',
}
```

- [ ] **Step 9: Run focused loop runtime tests**

Run: `npm run test:run -- tests/capabilities/loop/loop.test.ts tests/cli/loop-runtime-command.test.ts`
Expected: PASS

**Task 3 exit:** The loop runtime no longer depends on `code_development`; it executes the new 9-stage skeleton.

## Task 4: Write And Persist Stage Handoff Cards Instead Of Passing Raw Context

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/capabilities/loop/types.ts`
- Test: `tests/capabilities/loop/loop.test.ts`
- Test: `tests/cli/loop-command.test.ts`

- [ ] **Step 1: Write a failing loop test that expects a handoff card artifact**

Add an assertion that a stage writes a handoff artifact and points to it from the stage result:

```ts
expect(result.result.session?.stageResults[0].artifacts.some((artifact) => artifact.endsWith('handoff-prd_review.json'))).toBe(true)
```

Run: `npm run test:run -- tests/capabilities/loop/loop.test.ts`
Expected: FAIL because no handoff artifact exists yet.

- [ ] **Step 2: Extend the loop stage result shape**

Add explicit handoff metadata to `src/state/types.ts`:

```ts
export interface LoopStageResult {
  stage: LoopStageName
  success: boolean
  confidence: number
  summary: string
  risks: string[]
  retryCount: number
  artifacts: string[]
  handoffPath?: string
  resultType?: 'passed' | 'rework' | 'blocked'
  timestamp: Date
}
```

- [ ] **Step 3: Add a serializable handoff-card type**

Define a runtime-facing card shape in `src/capabilities/loop/types.ts`:

```ts
export interface LoopStageHandoffCard {
  stage: LoopStageName
  goal: string
  work_done: string
  result: 'passed' | 'rework' | 'blocked'
  next_stage?: LoopStageName
  next_input_minimum: string[]
  open_risks: string[]
  evidence_refs: string[]
}
```

- [ ] **Step 4: Add a helper that writes one card per stage**

Create a helper in `execute.ts` near the artifact utilities:

```ts
function buildStageHandoffPath(sessionDir: string, stage: LoopStageName): string {
  return join(sessionDir, `handoff-${stage}.json`)
}

async function writeStageHandoffCard(path: string, card: LoopStageHandoffCard): Promise<void> {
  await writeFile(path, JSON.stringify(card, null, 2), 'utf-8')
}
```

- [ ] **Step 5: Write the handoff card before advancing the stage index**

When a stage is finalized, persist the card and attach it to the stage result:

```ts
const handoffPath = buildStageHandoffPath(session.artifacts.sessionDir, stage)
await writeStageHandoffCard(handoffPath, {
  stage,
  goal: session.goal,
  work_done: stageResult.summary,
  result: stageResult.success ? 'passed' : 'rework',
  next_stage: session.stages[stageIndex + 1],
  next_input_minimum: stageResult.artifacts,
  open_risks: stageResult.risks,
  evidence_refs: stageResult.artifacts,
})

stageResult.handoffPath = handoffPath
stageResult.artifacts.push(handoffPath)
```

- [ ] **Step 6: Show the handoff artifact in inspect output**

Update the loop inspect path so a persisted session can surface the handoff artifact when present:

```ts
if (latestStageResult?.handoffPath) {
  console.log(`Latest handoff: ${latestStageResult.handoffPath}`)
}
```

- [ ] **Step 7: Run focused handoff tests**

Run: `npm run test:run -- tests/capabilities/loop/loop.test.ts tests/cli/loop-command.test.ts`
Expected: PASS

**Task 4 exit:** Every completed stage leaves a structured handoff card the next tool can consume without replaying the whole conversation.

## Task 5: Preserve Explicit Rework Semantics For Development And Verification

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/capabilities/loop/domain/repair.ts`
- Test: `tests/capabilities/loop/repair.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`
- Test: `tests/capabilities/workflows/shared/runtime.test.ts`

- [ ] **Step 1: Write a failing test for verification rework identity**

Add a case that expects a failed `unit_mock_test` run to stay in `unit_mock_test` with a verification-specific result type:

```ts
expect(session.currentStageIndex).toBe(session.stages.indexOf('unit_mock_test'))
expect(session.stageResults.at(-1)).toMatchObject({
  stage: 'unit_mock_test',
  resultType: 'rework',
})
```

Run: `npm run test:run -- tests/capabilities/loop/repair.test.ts tests/capabilities/workflows/shared/runtime.test.ts`
Expected: FAIL because current repair flow still collapses rework semantics back into generic stage retry handling.

- [ ] **Step 2: Introduce explicit loop rework labels**

Extend loop session state to distinguish the rework source:

```ts
export interface LoopSession {
  // existing fields...
  currentLoopState?: 'revising' | 'retrying_execution' | 'blocked_for_human' | 'completed'
  reworkOrigin?: 'implementation' | 'verification' | 'integration'
}
```

- [ ] **Step 3: Tag the rework origin inside `execute.ts`**

When the runtime decides to continue after a failed stage, tag the correct origin:

```ts
session.reworkOrigin =
  stage === 'unit_mock_test' ? 'verification'
    : stage === 'integration_test' ? 'integration'
      : 'implementation'
```

- [ ] **Step 4: Keep verification retries on the same formal stage**

When `unit_mock_test` or `integration_test` fails but remains recoverable, do not redirect to `implementation`; rerun the current stage after rescue or fixup:

```ts
if (stage === 'unit_mock_test' || stage === 'integration_test') {
  session.currentStageIndex = stageIndex
  stageResult.resultType = 'rework'
}
```

- [ ] **Step 5: Keep development retries inside `implementation` or `green_fixup`**

Route development rework to the new formal stages instead of the removed `code_development` bucket:

```ts
if (stage === 'implementation' || stage === 'green_fixup') {
  session.currentStageIndex = stageIndex
  session.reworkOrigin = 'implementation'
}
```

- [ ] **Step 6: Reuse the stage `rescue` binding on abnormal retries**

Replace hard-coded fallback calls in the rework path with the resolver helper:

```ts
const rescueBinding = resolveRescueBinding(stage, runtime, runtime.stageBindings)
const rescueProvider = rescueBinding
  ? await createConfiguredProvider({ logicalName: `capabilities.loop.stage_rescue.${stage}`, ...rescueBinding }, config)
  : executor
```

- [ ] **Step 7: Run focused repair and recovery tests**

Run: `npm run test:run -- tests/capabilities/loop/repair.test.ts tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/shared/runtime.test.ts`
Expected: PASS

**Task 5 exit:** Development rework, verification rework, and integration rework remain explicit, and abnormal retries inherit the stage’s `rescue` binding.

## Task 6: Update User-Facing Docs And Run Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/references/capabilities.md`
- Modify: `docs/superpowers/specs/2026-04-20-loop-stage-tool-communication-design.md`
- Test: `tests/cli/loop-command.test.ts`
- Test: `tests/cli/loop-runtime-command.test.ts`

- [ ] **Step 1: Update `README.md` for the new loop model**

Replace the old 6-stage mental model with a concise explanation of the new 9-stage flow and stage-level binding config:

```md
`loop` 现在把开发主线拆成 9 个正式阶段。前三段分别产出需求决策卡、拆分卡和执行卡；开发中段拆成准备开发、确认失败基线、实施改动、实现后补修；后两段保留为正式验证阶段，失败时会明确标记成验证返工或联调返工。工具绑定支持按正式阶段配置 `primary / reviewer / rescue`。
```

- [ ] **Step 2: Update `docs/references/capabilities.md`**

Refresh the loop entry so it describes:

```md
- 默认 9 段阶段
- 每阶段产出结构化交接卡
- 按正式阶段配置 `primary/reviewer/rescue`
- 异常轮次先继承正式阶段 `rescue`
```

- [ ] **Step 3: Tighten the design doc with implementation status notes**

Append a short “Implementation Notes” section to the spec file summarizing the concrete runtime decisions that landed during implementation:

```md
## Implementation Notes

- Stage bindings are read from `capabilities.loop.stage_bindings`.
- Exceptions inherit the current stage `rescue` binding.
- Stage handoff cards are persisted in the loop session directory as `handoff-<stage>.json`.
```

- [ ] **Step 4: Run loop-focused tests**

Run: `npm run test:run -- tests/capabilities/loop tests/cli/loop-command.test.ts tests/cli/loop-runtime-command.test.ts`
Expected: PASS

- [ ] **Step 5: Run repository verification commands**

Run: `npm run test:coverage`
Expected: PASS with touched files at or above the project bar.

Run: `npm run build`
Expected: PASS

Run: `npm run check:docs`
Expected: PASS

**Task 6 exit:** The new loop model is documented, discoverable, and covered by the required verification commands.

## Self-Review

### Spec coverage

- New 9-stage skeleton: covered by Task 1 and Task 3.
- Stage-level `primary/reviewer/rescue` config: covered by Task 1 and Task 2.
- Structured stage handoff cards: covered by Task 4.
- Rescue inheritance for abnormal paths: covered by Task 2 and Task 5.
- Development / verification / integration rework semantics: covered by Task 5.
- Docs and user-facing capability explanation: covered by Task 6.

No spec section is left without a matching task.

### Placeholder scan

This plan intentionally avoids:

- `TODO` / `TBD`
- “handle appropriately” style vague steps
- unnamed files
- implicit test commands

Each task includes concrete files, example code, exact commands, and expected results.

### Type consistency

The plan uses one consistent vocabulary throughout:

- stages: `prd_review`, `domain_partition`, `trd_generation`, `dev_preparation`, `red_test_confirmation`, `implementation`, `green_fixup`, `unit_mock_test`, `integration_test`
- stage binding roles: `primary`, `reviewer`, `rescue`
- handoff card result: `passed`, `rework`, `blocked`
- rework origin: `implementation`, `verification`, `integration`

These names should be used verbatim during implementation.
