# Loop 自动提 MR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `loop` 在整条开发和验证成功结束后，按配置自动创建 1 个 GitLab MR，并在失败时保留“开发完成、MR 待人工补做”的结果与通知。

**Architecture:** 在 `loop` 完成点后追加一个可选的 MR 收尾动作。配置、会话产物、通知和最终摘要全部围绕这一步展开，但 MR 结果不反向改变 `loop` 的成功/失败判定。MR 执行器独立成小模块，`loop` 只负责判断是否触发和消费结果。

**Tech Stack:** TypeScript, Vitest, YAML config, existing notification router, local git/GitLab workflow

---

### Task 1: 补配置与会话产物骨架

**Files:**
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/config/init.ts`
- Modify: `src/state/types.ts`
- Modify: `README.md`
- Modify: `docs/references/capabilities.md`
- Test: `tests/config/init.test.ts`

- [ ] **Step 1: 先写配置默认项和会话产物的失败测试**

```ts
it('includes disabled loop mr config in generated init config', () => {
  const content = readFileSync(configPath, 'utf-8')
  expect(content).toContain('mr:')
  expect(content).toContain('enabled: false')
})
```

```ts
it('persists loop mr result artifact fields when present', () => {
  const session: LoopSession = {
    // minimal valid session fixture
    artifacts: {
      sessionDir: '/tmp/session',
      eventsPath: '/tmp/events.jsonl',
      planPath: '/tmp/plan.json',
      humanConfirmationPath: '/tmp/human_confirmation.md',
      mrResultPath: '/tmp/mr-result.json',
    },
  } as LoopSession

  expect(session.artifacts.mrResultPath).toBe('/tmp/mr-result.json')
})
```

- [ ] **Step 2: 跑最小测试确认先红**

Run: `npm run test:run -- tests/config/init.test.ts`
Expected: FAIL because `loop.mr.enabled` and `mrResultPath` do not exist yet.

- [ ] **Step 3: 补最小配置和类型实现**

```ts
export interface LoopMrConfig {
  enabled?: boolean
}

export interface LoopConfig {
  // existing fields...
  mr?: LoopMrConfig
}
```

```ts
  loop:
    enabled: true
    // ...
    mr:
      enabled: false
```

```ts
export interface LoopSession {
  // existing fields...
  artifacts: {
    // existing fields...
    mrResultPath?: string
  }
}
```

- [ ] **Step 4: 重跑测试确认转绿**

Run: `npm run test:run -- tests/config/init.test.ts`
Expected: PASS with the new `mr.enabled` default visible.

- [ ] **Step 5: 提交这一步**

```bash
git add src/platform/config/types.ts src/platform/config/init.ts src/state/types.ts README.md docs/references/capabilities.md tests/config/init.test.ts
git commit -m "feat(loop):补充自动提MR配置骨架"
```

### Task 2: 新增 MR 执行器并覆盖成功/失败结果

**Files:**
- Create: `src/capabilities/loop/domain/auto-mr.ts`
- Test: `tests/capabilities/loop/loop-auto-mr.test.ts`

- [ ] **Step 1: 写 MR 执行器的失败测试**

```ts
it('returns success with mr url when git push output contains a merge request link', async () => {
  const result = await createLoopMr({
    cwd: repoDir,
    branchName: 'sch/demo',
    goal: 'Deliver auto mr',
  })

  expect(result.status).toBe('created')
  expect(result.url).toBe('https://gitlab.example.com/group/project/-/merge_requests/123')
  expect(result.needsHuman).toBe(false)
})
```

```ts
it('returns manual follow-up when mr creation fails', async () => {
  const result = await createLoopMr({
    cwd: repoDir,
    branchName: 'sch/demo',
    goal: 'Deliver auto mr',
  })

  expect(result.status).toBe('manual_follow_up')
  expect(result.needsHuman).toBe(true)
  expect(result.reason).toContain('git push failed')
})
```

- [ ] **Step 2: 跑新测试确认先红**

Run: `npm run test:run -- tests/capabilities/loop/loop-auto-mr.test.ts`
Expected: FAIL because `createLoopMr()` does not exist yet.

- [ ] **Step 3: 实现最小 MR 执行器**

```ts
export interface LoopMrAttemptResult {
  status: 'created' | 'manual_follow_up' | 'skipped'
  branchName?: string
  url?: string
  reason?: string
  needsHuman: boolean
  rawOutput?: string
}

export async function createLoopMr(input: {
  cwd: string
  branchName: string
  goal: string
}): Promise<LoopMrAttemptResult> {
  try {
    const output = execFileSync('git', [
      'push',
      '-u',
      'origin',
      input.branchName,
      '-o',
      'merge_request.create',
    ], { cwd: input.cwd, encoding: 'utf-8' })

    const url = extractMergeRequestUrl(output)
    if (url) {
      return { status: 'created', branchName: input.branchName, url, needsHuman: false, rawOutput: output }
    }

    return { status: 'manual_follow_up', branchName: input.branchName, reason: 'MR url not found in push output', needsHuman: true, rawOutput: output }
  } catch (error) {
    return {
      status: 'manual_follow_up',
      branchName: input.branchName,
      reason: error instanceof Error ? error.message : String(error),
      needsHuman: true,
    }
  }
}
```

- [ ] **Step 4: 重跑测试确认转绿**

Run: `npm run test:run -- tests/capabilities/loop/loop-auto-mr.test.ts`
Expected: PASS for both success and failure result cases.

- [ ] **Step 5: 提交这一步**

```bash
git add src/capabilities/loop/domain/auto-mr.ts tests/capabilities/loop/loop-auto-mr.test.ts
git commit -m "feat(loop):补充自动提MR执行器"
```

### Task 3: 把 MR 收尾动作接进 loop 完成路径

**Files:**
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/integrations/notifications/types.ts`
- Modify: `src/platform/config/init.ts`
- Test: `tests/capabilities/loop/loop-auto-mr.test.ts`

- [ ] **Step 1: 先写 loop 集成失败测试**

```ts
it('keeps loop completed and stores manual follow-up when auto mr fails', async () => {
  const result = await runCapability(loopCapability, {
    mode: 'run',
    goal: 'Complete delivery flow',
    prdPath,
    waitHuman: false,
    dryRun: false,
  }, ctx)

  expect(result.result.status).toBe('completed')
  expect(result.result.summary).toContain('MR 需要人工补做')
  expect(readFileSync(result.result.session!.artifacts.mrResultPath!, 'utf-8')).toContain('"needsHuman": true')
})
```

```ts
it('creates mr after loop completion when enabled', async () => {
  const result = await runCapability(loopCapability, {
    mode: 'run',
    goal: 'Complete delivery flow',
    prdPath,
    waitHuman: false,
    dryRun: false,
  }, ctx)

  expect(result.result.status).toBe('completed')
  expect(readFileSync(result.result.session!.artifacts.mrResultPath!, 'utf-8')).toContain('https://gitlab.example.com/group/project/-/merge_requests/123')
})
```

- [ ] **Step 2: 跑集成测试确认先红**

Run: `npm run test:run -- tests/capabilities/loop/loop-auto-mr.test.ts`
Expected: FAIL because `loop` does not invoke auto MR yet.

- [ ] **Step 3: 实现 loop 完成点接线**

```ts
if (runtime.mr.enabled && !prepared.dryRun) {
  const mrResult = await createLoopMr({
    cwd: runCwd,
    branchName: session.branchName!,
    goal: session.goal,
  })

  await writeFile(session.artifacts.mrResultPath!, JSON.stringify(mrResult, null, 2), 'utf-8')
  await appendObservedEvent(session.artifacts.eventsPath, session.id, {
    event: 'loop_auto_mr',
    status: mrResult.status,
    branch: mrResult.branchName,
    url: mrResult.url,
    reason: mrResult.reason,
  }, progressObserver)
}
```

```ts
const summary = mrResult?.status === 'created'
  ? `Loop completed successfully. MR created: ${mrResult.url}`
  : mrResult?.needsHuman
    ? 'Loop completed successfully. MR 需要人工补做。'
    : `Loop completed successfully. Session: ${session.id}`
```

- [ ] **Step 4: 补通知事件与文案**

```ts
export type NotificationEventType =
  // existing values...
  | 'loop_auto_mr_created'
  | 'loop_auto_mr_manual_follow_up'
```

```ts
await notificationRouter.dispatch({
  type: mrResult.status === 'created' ? 'loop_auto_mr_created' : 'loop_auto_mr_manual_follow_up',
  sessionId: session.id,
  title: mrResult.status === 'created' ? 'Magpie loop MR created' : 'Magpie loop MR needs manual follow-up',
  message: mrResult.status === 'created'
    ? `开发已完成，MR 已创建：${mrResult.url}`
    : `开发已完成，但 MR 需要人工补做。原因：${mrResult.reason}`,
  severity: mrResult.status === 'created' ? 'info' : 'warning',
  actionUrl: mrResult.url,
})
```

- [ ] **Step 5: 重跑集成测试确认转绿**

Run: `npm run test:run -- tests/capabilities/loop/loop-auto-mr.test.ts`
Expected: PASS for enabled, disabled, dry-run, and manual-follow-up cases.

- [ ] **Step 6: 提交这一步**

```bash
git add src/capabilities/loop/application/execute.ts src/platform/config/types.ts src/platform/integrations/notifications/types.ts src/platform/config/init.ts tests/capabilities/loop/loop-auto-mr.test.ts
git commit -m "feat(loop):完成自动提MR收尾流程"
```

### Task 4: 文档与最终验证

**Files:**
- Modify: `README.md`
- Modify: `docs/references/capabilities.md`
- Modify: `docs/superpowers/specs/2026-04-13-loop-auto-mr-design.md` (only if design wording needs sync)
- Test: `tests/capabilities/loop/loop-auto-mr.test.ts`

- [ ] **Step 1: 补用户可见说明**

```md
`loop` 可通过 `capabilities.loop.mr.enabled` 控制是否在全部开发和验证通过后自动创建 GitLab MR。创建失败不会把开发结果改成失败，但会记录并通知需要人工补做。
```

- [ ] **Step 2: 跑目标测试、构建和文档检查**

Run: `npm run test:run -- tests/config/init.test.ts tests/capabilities/loop/loop-auto-mr.test.ts`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `npm run check:docs`
Expected: PASS

- [ ] **Step 3: 记录全量测试现状**

Run: `npm run test:run`
Expected: May still FAIL only because of the existing unrelated parse-error suites already known in this repository; if so, capture exact files in the final report.

- [ ] **Step 4: 提交最终收尾**

```bash
git add README.md docs/references/capabilities.md docs/superpowers/specs/2026-04-13-loop-auto-mr-design.md docs/superpowers/plans/2026-04-13-loop-auto-mr.md
git commit -m "docs(loop):补充自动提MR说明"
```
