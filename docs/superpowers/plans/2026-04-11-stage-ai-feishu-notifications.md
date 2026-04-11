# Stage AI Feishu Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Magpie-built-in stage-level Feishu notifications for all `loop` and `harness` runs, with AI-generated summaries, AI roster/responsibility details, repeated-stage delivery, and safe fallback behavior.

**Architecture:** Extend the notification domain with stage-aware event types and a normalized stage context payload, then add an AI-backed summary builder that capabilities call whenever stages enter, complete, fail, pause, or resume. `loop` and `harness` emit stage-aware notifications through the existing notification router, and Feishu continues to act as a delivery provider only.

**Tech Stack:** TypeScript, Vitest, YAML config, existing notification router/provider system

---

### File Map

**Create**
- `src/platform/integrations/notifications/stage-summary.ts`
- `src/platform/integrations/notifications/stage-ai.ts`
- `tests/platform/notifications/stage-summary.test.ts`
- `tests/platform/notifications/stage-ai.test.ts`
- `docs/superpowers/specs/2026-04-11-stage-ai-feishu-notifications-design.md`

**Modify**
- `src/platform/config/types.ts`
- `src/platform/integrations/notifications/types.ts`
- `src/platform/integrations/notifications/factory.ts`
- `src/platform/integrations/notifications/providers/feishu-webhook.ts`
- `src/capabilities/loop/application/execute.ts`
- `src/capabilities/workflows/harness/application/execute.ts`
- `src/platform/config/init.ts`
- `tests/platform/notifications/providers/feishu-webhook.test.ts`
- `tests/platform/notifications/factory.test.ts`
- `tests/config/init.test.ts`
- `tests/capabilities/loop/loop.test.ts`
- `tests/capabilities/workflows/harness.test.ts`

### Task 1: Add failing tests for stage-aware notification config and event typing

**Files:**
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/integrations/notifications/types.ts`
- Modify: `tests/platform/notifications/factory.test.ts`
- Modify: `tests/config/init.test.ts`

- [ ] **Step 1: Add a failing factory test for new stage event routes**

Add to `tests/platform/notifications/factory.test.ts` a case that constructs notification config with:

```ts
routes: {
  stage_entered: ['feishu_team'],
  stage_completed: ['feishu_team'],
  stage_failed: ['feishu_team'],
  stage_paused: ['feishu_team'],
  stage_resumed: ['feishu_team'],
}
```

and asserts:

```ts
expect(router).toBeDefined()
```

- [ ] **Step 2: Add a failing config-init test for generated YAML**

Extend `tests/config/init.test.ts` to assert generated notification config includes:

```yaml
stage_ai:
  enabled: false
  provider: codex
  max_summary_chars: 900
  include_loop: true
  include_harness: true
```

- [ ] **Step 3: Add type-level test coverage through runtime config parsing**

Add a config snippet in `tests/config/init.test.ts` or `tests/platform/config/loader.test.ts` that loads:

```yaml
integrations:
  notifications:
    enabled: true
    stage_ai:
      enabled: true
      provider: codex
      max_summary_chars: 700
      include_loop: true
      include_harness: false
    routes:
      stage_entered: [feishu_team]
```

and asserts the parsed object preserves the stage AI settings.

- [ ] **Step 4: Run the targeted tests and confirm they fail**

Run:

```bash
npm run test:run -- tests/platform/notifications/factory.test.ts tests/config/init.test.ts
```

Expected: FAIL because stage-aware event types and `stage_ai` config are not defined yet.

### Task 2: Implement notification type and config support

**Files:**
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/integrations/notifications/types.ts`
- Modify: `src/platform/config/init.ts`
- Modify: `tests/platform/notifications/factory.test.ts`
- Modify: `tests/config/init.test.ts`

- [ ] **Step 1: Extend notification event types**

Add these event types to both config and runtime notification types:

```ts
  | 'stage_entered'
  | 'stage_completed'
  | 'stage_failed'
  | 'stage_paused'
  | 'stage_resumed'
```

- [ ] **Step 2: Add stage-aware notification config shape**

In `src/platform/config/types.ts`, add:

```ts
export interface StageAiNotificationConfig {
  enabled?: boolean
  provider?: string
  max_summary_chars?: number
  include_loop?: boolean
  include_harness?: boolean
}
```

and wire it into:

```ts
export interface NotificationsIntegrationConfig {
  enabled?: boolean
  default_timeout_ms?: number
  stage_ai?: StageAiNotificationConfig
  routes?: Partial<Record<NotificationEventType, string[]>>
  providers?: Record<string, NotificationProviderConfig>
}
```

- [ ] **Step 3: Extend init-generated config defaults**

Update `src/platform/config/init.ts` so generated YAML includes a disabled default block:

```yaml
stage_ai:
  enabled: false
  provider: codex
  max_summary_chars: 900
  include_loop: true
  include_harness: true
```

- [ ] **Step 4: Re-run tests and confirm they pass**

Run:

```bash
npm run test:run -- tests/platform/notifications/factory.test.ts tests/config/init.test.ts
```

Expected: PASS.

### Task 3: Add failing tests for AI-backed stage summary generation

**Files:**
- Create: `src/platform/integrations/notifications/stage-summary.ts`
- Create: `tests/platform/notifications/stage-summary.test.ts`

- [ ] **Step 1: Add a failing test for entry-message summary shape**

Create `tests/platform/notifications/stage-summary.test.ts` with a case that calls a not-yet-existing builder:

```ts
const result = await buildStageNotificationMessage({
  eventType: 'stage_entered',
  sessionId: 'loop-1',
  capability: 'loop',
  title: 'Deliver feature',
  stage: 'code_development',
  occurrence: 2,
  summary: 'Running code changes.',
  nextAction: 'Edit controller and tests.',
  aiRoster: [
    { id: 'codex', role: 'main execution' },
    { id: 'kiro:architect', role: 'risk review' },
  ],
})

expect(result.title).toContain('loop-1')
expect(result.body).toContain('第 2 次')
expect(result.body).toContain('codex')
expect(result.body).toContain('main execution')
```

- [ ] **Step 2: Add a failing fallback test**

Add a case that forces summarization failure and expects deterministic fallback content containing:

```ts
expect(result.body).toContain('当前阶段')
expect(result.body).toContain('下一步')
```

- [ ] **Step 3: Run targeted tests and confirm failure**

Run:

```bash
npm run test:run -- tests/platform/notifications/stage-summary.test.ts
```

Expected: FAIL because the builder module does not exist yet.

### Task 4: Implement AI-backed stage summary builder with fallback

**Files:**
- Create: `src/platform/integrations/notifications/stage-summary.ts`
- Create: `src/platform/integrations/notifications/stage-ai.ts`
- Modify: `tests/platform/notifications/stage-summary.test.ts`

- [ ] **Step 1: Add normalized stage notification input/output types**

Implement exports like:

```ts
export interface StageAiActor {
  id: string
  role: string
}

export interface StageNotificationSummaryInput {
  eventType: 'stage_entered' | 'stage_completed' | 'stage_failed' | 'stage_paused' | 'stage_resumed'
  sessionId: string
  capability: 'loop' | 'harness'
  runTitle: string
  stage: string
  occurrence: number
  summary: string
  nextAction?: string
  blocker?: string
  aiRoster: StageAiActor[]
}
```

- [ ] **Step 2: Implement fallback summary rendering**

Add a deterministic renderer that always produces:

```ts
[
  `任务: ${input.runTitle}`,
  `状态: ${input.eventType}`,
  `阶段: ${input.stage}`,
  `次数: 第 ${input.occurrence} 次`,
  `摘要: ${input.summary}`,
  `AI: ${input.aiRoster.map((item) => item.id).join(' / ') || 'unknown'}`,
  `分工: ${input.aiRoster.map((item) => `${item.id}: ${item.role}`).join('；') || 'unknown'}`,
  `下一步: ${input.nextAction || '待定'}`,
]
```

- [ ] **Step 3: Add AI summarizer wrapper**

In `stage-ai.ts`, implement a helper that:

- accepts notification config + summary input
- tries to resolve the configured model/tool provider
- falls back when provider resolution or generation fails

Keep the first implementation simple: if a real provider is not explicitly plumbed yet, call fallback immediately and structure the helper so capability code can still call a single entrypoint.

- [ ] **Step 4: Re-run summary tests and confirm pass**

Run:

```bash
npm run test:run -- tests/platform/notifications/stage-summary.test.ts
```

Expected: PASS.

### Task 5: Add failing loop capability tests for stage notifications

**Files:**
- Modify: `tests/capabilities/loop/loop.test.ts`

- [ ] **Step 1: Add a failing loop test for stage-entered and stage-completed dispatch**

Add a test with notifications enabled and stage AI enabled, then assert the resulting event log contains:

```ts
expect(readFileSync(eventsPath, 'utf-8')).toContain('"event":"stage_entered"')
expect(readFileSync(eventsPath, 'utf-8')).toContain('"event":"stage_completed"')
```

Also verify notification dispatch results through a mocked Feishu provider or mocked global `fetch`.

- [ ] **Step 2: Add a failing repeated-entry test**

Create a scenario where the same stage is revisited and assert two stage-entered messages are sent with different occurrence counts:

```ts
expect(messages[0].body).toContain('第 1 次')
expect(messages[1].body).toContain('第 2 次')
```

- [ ] **Step 3: Add failing pause/failure tests**

Assert:

```ts
expect(events).toContain('"event":"stage_paused"')
expect(events).toContain('"event":"stage_failed"')
```

- [ ] **Step 4: Run loop tests and confirm failure**

Run:

```bash
npm run test:run -- tests/capabilities/loop/loop.test.ts
```

Expected: FAIL because loop does not emit or dispatch stage-aware notifications yet.

### Task 6: Implement loop stage-aware notifications

**Files:**
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/platform/integrations/notifications/types.ts`
- Modify: `src/platform/integrations/notifications/factory.ts`
- Modify: `tests/capabilities/loop/loop.test.ts`

- [ ] **Step 1: Add occurrence tracking**

In loop execution state, add a local counter map:

```ts
const stageOccurrences = new Map<string, number>()
```

Increment when a stage begins and pass the count into summary generation.

- [ ] **Step 2: Emit stage-entered events**

Before calling `runSingleStage`, append:

```ts
await appendEvent(session.artifacts.eventsPath, {
  event: 'stage_entered',
  stage,
  occurrence,
})
```

and dispatch stage notification through the AI summary helper.

- [ ] **Step 3: Emit stage-completed / stage-failed / stage-paused / stage-resumed events**

Add dispatch points next to existing append/write logic so every stage change both records an event and sends a stage-aware notification. Preserve existing loop failure/completion notifications.

- [ ] **Step 4: Keep failures non-blocking**

Wrap stage-notification dispatch in a best-effort helper:

```ts
try {
  await dispatchStageNotification(...)
} catch {
  // swallow and continue
}
```

- [ ] **Step 5: Re-run loop tests and confirm pass**

Run:

```bash
npm run test:run -- tests/capabilities/loop/loop.test.ts
```

Expected: PASS.

### Task 7: Add failing harness tests for outer-stage notifications

**Files:**
- Modify: `tests/capabilities/workflows/harness.test.ts`

- [ ] **Step 1: Add failing harness stage-change test**

Assert that a harness run with notifications enabled emits outer events and dispatches notifications for:

```ts
'stage_entered' // mapped from harness outer stage transition
'stage_completed'
'stage_failed'
```

Use the stored `events.jsonl` plus mocked Feishu dispatch to verify behavior.

- [ ] **Step 2: Add failing cycle-summary test**

Assert a review cycle completion notification includes AI roster information from reviewer ids.

- [ ] **Step 3: Run harness tests and confirm failure**

Run:

```bash
npm run test:run -- tests/capabilities/workflows/harness.test.ts
```

Expected: FAIL because harness does not dispatch stage-aware notifications yet.

### Task 8: Implement harness stage-aware notifications

**Files:**
- Modify: `src/capabilities/workflows/harness/application/execute.ts`
- Modify: `tests/capabilities/workflows/harness.test.ts`

- [ ] **Step 1: Add a shared harness stage-dispatch helper**

Wrap `transitionStage` so it:

- persists the session
- appends the stage event
- builds AI roster context from provider selection / reviewer ids / loop session linkage
- sends a stage-aware notification

- [ ] **Step 2: Dispatch for review cycle completion and workflow end states**

For cycle completion and workflow completion/failure, generate stage-aware summaries with:

```ts
summary: cycleRun.approved ? `Cycle ${cycle} approved.` : `Cycle ${cycle} requested more changes.`
```

and include reviewer-based AI responsibilities.

- [ ] **Step 3: Re-run harness tests and confirm pass**

Run:

```bash
npm run test:run -- tests/capabilities/workflows/harness.test.ts
```

Expected: PASS.

### Task 9: Extend Feishu rendering tests for AI-rich message content

**Files:**
- Modify: `tests/platform/notifications/providers/feishu-webhook.test.ts`
- Modify: `src/platform/integrations/notifications/providers/feishu-webhook.ts`

- [ ] **Step 1: Add failing Feishu test for multiline AI-rich post body**

Extend the test to assert the rendered body contains:

```ts
expect(body.content.post.zh_cn.title).toContain('stage_entered')
expect(body.content.post.zh_cn.content[0][0].text).toContain('AI')
```

- [ ] **Step 2: Adjust Feishu provider only if needed**

If the current provider strips or collapses structured content awkwardly, minimally adapt payload construction so preformatted AI-rich text survives cleanly.

- [ ] **Step 3: Re-run provider tests**

Run:

```bash
npm run test:run -- tests/platform/notifications/providers/feishu-webhook.test.ts
```

Expected: PASS.

### Task 10: Run focused verification and then full regression

**Files:**
- Modify: none

- [ ] **Step 1: Run all focused tests**

Run:

```bash
npm run test:run -- \
  tests/platform/notifications/factory.test.ts \
  tests/platform/notifications/stage-summary.test.ts \
  tests/platform/notifications/providers/feishu-webhook.test.ts \
  tests/capabilities/loop/loop.test.ts \
  tests/capabilities/workflows/harness.test.ts \
  tests/config/init.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository-required verification**

Run:

```bash
npm run test:run
npm run build
npm run check:docs
```

Expected: all commands pass.

- [ ] **Step 3: Update docs if config/reference output changed**

If notification config or capability reference surface changed, update:

- `README.md`
- `docs/references/capabilities.md`

Then rerun:

```bash
npm run check:docs
```

### Self-Review Checklist

- [ ] The plan covers both `loop` and `harness`.
- [ ] The plan covers all five requested event kinds.
- [ ] The plan explicitly preserves non-blocking failure semantics.
- [ ] The plan includes AI roster and AI responsibility output.
- [ ] The plan includes repeated stage entry behavior.
- [ ] The plan includes config, provider, capability, and verification work.
