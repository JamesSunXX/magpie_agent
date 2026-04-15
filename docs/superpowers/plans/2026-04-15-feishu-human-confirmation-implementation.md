# Feishu Human Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let paused `loop` and `harness` human-confirmation gates be approved or rejected from a Feishu thread without editing local files.

**Architecture:** Add a small Feishu IM control bridge under `src/platform/integrations/im/` and a new `im-server` CLI entry that receives Feishu callbacks, verifies actor permissions, maps one Magpie task to one Feishu thread, and reuses the existing loop confirmation action helper. Keep `.magpie/` as the only source of truth, and treat Feishu as an inbound control surface plus thread-local status view.

**Tech Stack:** TypeScript, Node built-in HTTP server, Commander, existing Magpie config/runtime/state helpers, Vitest

---

This plan intentionally covers **Milestone 1 only** from the approved design. Milestone 2 and Milestone 3 should be planned separately after Milestone 1 ships and is verified.

### Task 1: Add IM Config and CLI Surface

**Files:**
- Create: `src/cli/commands/im-server.ts`
- Modify: `src/cli/program.ts`
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/config/init.ts`
- Test: `tests/cli/program.test.ts`
- Test: `tests/config/init.test.ts`

- [ ] **Step 1: Write failing CLI registration and config-template tests**

```ts
// tests/cli/program.test.ts
it('registers top-level im-server command with start, status, and stop subcommands', () => {
  const program = createProgram()
  const imServer = program.commands.find((command) => command.name() === 'im-server')

  expect(imServer).toBeTruthy()
  expect(imServer?.commands.map((subcommand) => subcommand.name())).toEqual([
    'start',
    'status',
    'stop',
    'run',
  ])
})
```

```ts
// tests/config/init.test.ts
it('includes feishu im control defaults when generating config', () => {
  const configPath = join(testDir, '.magpie', 'config.yaml')
  initConfig(testDir)

  const content = readFileSync(configPath, 'utf-8')
  expect(content).toContain('im:')
  expect(content).toContain('type: "feishu-app"')
  expect(content).toContain('app_id: "${FEISHU_APP_ID}"')
  expect(content).toContain('app_secret: "${FEISHU_APP_SECRET}"')
  expect(content).toContain('verification_token: "${FEISHU_VERIFICATION_TOKEN}"')
  expect(content).toContain('default_chat_id: "${FEISHU_DEFAULT_CHAT_ID}"')
  expect(content).toContain('approval_whitelist_open_ids:')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/cli/program.test.ts tests/config/init.test.ts`

Expected: FAIL because `im-server` is not registered and the generated config does not yet contain an `integrations.im` section.

- [ ] **Step 3: Add config types for the Feishu IM bridge**

```ts
// src/platform/config/types.ts
export interface FeishuAppImProviderConfig {
  type: 'feishu-app'
  enabled?: boolean
  app_id: string
  app_secret: string
  verification_token: string
  encrypt_key?: string
  default_chat_id: string
  approval_whitelist_open_ids: string[]
  callback_port?: number
  callback_path?: string
}

export type ImProviderConfig = FeishuAppImProviderConfig

export interface ImIntegrationConfig {
  enabled?: boolean
  default_provider?: string
  providers?: Record<string, ImProviderConfig>
}

export interface IntegrationsConfig {
  notifications?: NotificationsIntegrationConfig
  planning?: PlanningIntegrationConfig
  operations?: OperationsIntegrationConfig
  im?: ImIntegrationConfig
}
```

- [ ] **Step 4: Add default config template rendering for `integrations.im`**

```ts
// src/platform/config/init.ts
function buildDefaultImConfig() {
  return {
    enabled: false,
    default_provider: 'feishu_main',
  }
}
```

```ts
// src/platform/config/init.ts
  im:
    enabled: false
    default_provider: "feishu_main"
    providers:
      feishu_main:
        type: "feishu-app"
        app_id: "${FEISHU_APP_ID}"
        app_secret: "${FEISHU_APP_SECRET}"
        verification_token: "${FEISHU_VERIFICATION_TOKEN}"
        encrypt_key: "${FEISHU_ENCRYPT_KEY}"
        default_chat_id: "${FEISHU_DEFAULT_CHAT_ID}"
        approval_whitelist_open_ids:
          - "ou_xxx_operator"
        callback_port: 9321
        callback_path: "/callbacks/feishu"
```

- [ ] **Step 5: Register the new top-level command**

```ts
// src/cli/program.ts
import { imServerCommand } from './commands/im-server.js'

program.addCommand(imServerCommand)
```

```ts
// src/cli/commands/im-server.ts
export const imServerCommand = new Command('im-server')
  .description('Run the inbound IM control server')

imServerCommand
  .command('start')
  .option('-c, --config <path>', 'Path to config file')
  .description('Start the IM callback server')

imServerCommand
  .command('status')
  .description('Show IM callback server status')

imServerCommand
  .command('stop')
  .description('Stop the IM callback server')

imServerCommand
  .command('run')
  .option('-c, --config <path>', 'Path to config file')
  .description('Internal foreground callback loop')
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:run -- tests/cli/program.test.ts tests/config/init.test.ts`

Expected: PASS for the new command registration and config rendering assertions.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/im-server.ts src/cli/program.ts src/platform/config/types.ts src/platform/config/init.ts tests/cli/program.test.ts tests/config/init.test.ts
git commit -m "feat(im):补齐飞书入口配置与命令"
```

### Task 2: Add Feishu Callback Verification and Event Parsing

**Files:**
- Create: `src/platform/integrations/im/types.ts`
- Create: `src/platform/integrations/im/feishu/signature.ts`
- Create: `src/platform/integrations/im/feishu/events.ts`
- Create: `src/platform/integrations/im/feishu/server.ts`
- Test: `tests/platform/im/feishu-signature.test.ts`
- Test: `tests/platform/im/feishu-events.test.ts`

- [ ] **Step 1: Write failing tests for callback verification and event normalization**

```ts
// tests/platform/im/feishu-signature.test.ts
it('accepts a valid verification token challenge request', async () => {
  const result = verifyFeishuChallenge({
    token: 'demo-token',
    challenge: 'challenge-123',
  }, {
    verificationToken: 'demo-token',
  })

  expect(result.accepted).toBe(true)
  expect(result.challenge).toBe('challenge-123')
})
```

```ts
// tests/platform/im/feishu-events.test.ts
it('normalizes a card action callback into a confirmation action event', () => {
  const normalized = parseFeishuEvent({
    header: { event_type: 'im.message.action.trigger' },
    event: {
      operator: { open_id: 'ou_operator' },
      action: {
        value: {
          action: 'approve_confirmation',
          session_id: 'loop-123',
          confirmation_id: 'confirm-1',
        },
      },
      context: {
        open_message_id: 'om_root',
        open_chat_id: 'oc_chat',
      },
    },
  })

  expect(normalized).toEqual({
    kind: 'confirmation_action',
    action: 'approve_confirmation',
    actorOpenId: 'ou_operator',
    sessionId: 'loop-123',
    confirmationId: 'confirm-1',
    threadKey: 'om_root',
    chatId: 'oc_chat',
    extraInstruction: undefined,
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/platform/im/feishu-signature.test.ts tests/platform/im/feishu-events.test.ts`

Expected: FAIL because the IM integration files do not exist yet.

- [ ] **Step 3: Add the shared IM event types**

```ts
// src/platform/integrations/im/types.ts
export type ImInboundEvent =
  | {
      kind: 'confirmation_action'
      action: 'approve_confirmation' | 'reject_confirmation'
      actorOpenId: string
      sessionId: string
      confirmationId: string
      threadKey: string
      chatId: string
      rejectionReason?: string
      extraInstruction?: string
    }

export interface ImServerStatus {
  providerId: string
  status: 'running' | 'stopped'
  port: number
  path: string
  updatedAt: string
}
```

- [ ] **Step 4: Implement verification-token challenge handling and event parsing**

```ts
// src/platform/integrations/im/feishu/signature.ts
export function verifyFeishuChallenge(
  body: { token?: string; challenge?: string },
  options: { verificationToken: string }
): { accepted: boolean; challenge?: string } {
  if (body.token !== options.verificationToken || !body.challenge) {
    return { accepted: false }
  }
  return {
    accepted: true,
    challenge: body.challenge,
  }
}
```

```ts
// src/platform/integrations/im/feishu/events.ts
export function parseFeishuEvent(payload: any): ImInboundEvent {
  const action = payload?.event?.action?.value || {}
  return {
    kind: 'confirmation_action',
    action: action.action,
    actorOpenId: payload?.event?.operator?.open_id,
    sessionId: action.session_id,
    confirmationId: action.confirmation_id,
    threadKey: payload?.event?.context?.open_message_id,
    chatId: payload?.event?.context?.open_chat_id,
    rejectionReason: action.rejection_reason,
    extraInstruction: action.extra_instruction,
  }
}
```

- [ ] **Step 5: Add a minimal Node HTTP callback server**

```ts
// src/platform/integrations/im/feishu/server.ts
import { createServer } from 'http'

export function createFeishuCallbackServer(options: {
  port: number
  path: string
  verificationToken: string
  onEvent: (event: ImInboundEvent) => Promise<void>
}) {
  return createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== options.path) {
      res.statusCode = 404
      res.end('not found')
      return
    }

    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
    const challenge = verifyFeishuChallenge(payload, {
      verificationToken: options.verificationToken,
    })

    if (challenge.accepted) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ challenge: challenge.challenge }))
      return
    }

    await options.onEvent(parseFeishuEvent(payload))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:run -- tests/platform/im/feishu-signature.test.ts tests/platform/im/feishu-events.test.ts`

Expected: PASS for challenge verification and action parsing.

- [ ] **Step 7: Commit**

```bash
git add src/platform/integrations/im/types.ts src/platform/integrations/im/feishu/signature.ts src/platform/integrations/im/feishu/events.ts src/platform/integrations/im/feishu/server.ts tests/platform/im/feishu-signature.test.ts tests/platform/im/feishu-events.test.ts
git commit -m "feat(im):新增飞书回调解析基础"
```

### Task 3: Persist Task-to-Thread Mapping and Server Status

**Files:**
- Create: `src/platform/integrations/im/thread-mapping.ts`
- Create: `src/platform/integrations/im/runtime.ts`
- Test: `tests/platform/im/thread-mapping.test.ts`
- Test: `tests/platform/im/runtime.test.ts`

- [ ] **Step 1: Write failing tests for thread mapping persistence and callback dedupe**

```ts
// tests/platform/im/thread-mapping.test.ts
it('saves and reloads one thread mapping per task', async () => {
  await saveThreadMapping(tmpRepo, {
    threadId: 'om_root',
    rootMessageId: 'om_root',
    chatId: 'oc_chat',
    capability: 'loop',
    sessionId: 'loop-123',
    status: 'paused_for_human',
    lastEventId: 'evt-1',
  })

  const record = await loadThreadMappingBySession(tmpRepo, 'loop', 'loop-123')
  expect(record?.threadId).toBe('om_root')
})
```

```ts
// tests/platform/im/runtime.test.ts
it('ignores duplicate callback event ids', async () => {
  const tracker = createImRuntime(tmpRepo)
  expect(await tracker.markEventProcessed('evt-1')).toBe(true)
  expect(await tracker.markEventProcessed('evt-1')).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/platform/im/thread-mapping.test.ts tests/platform/im/runtime.test.ts`

Expected: FAIL because the mapping store and runtime helpers do not exist yet.

- [ ] **Step 3: Implement repository-local thread mapping storage**

```ts
// src/platform/integrations/im/thread-mapping.ts
export interface ThreadMappingRecord {
  threadId: string
  rootMessageId: string
  chatId: string
  capability: 'loop' | 'harness'
  sessionId: string
  status: string
  lastEventId?: string
  createdAt: string
  updatedAt: string
}
```

```ts
// src/platform/integrations/im/thread-mapping.ts
function mappingPath(cwd: string): string {
  return join(getRepoMagpieDir(cwd), 'im', 'thread-mappings.json')
}
```

- [ ] **Step 4: Implement processed-event tracking and server status storage**

```ts
// src/platform/integrations/im/runtime.ts
export function createImRuntime(cwd: string) {
  return {
    async markEventProcessed(eventId: string): Promise<boolean> {
      const seen = await loadProcessedEventIds(cwd)
      if (seen.includes(eventId)) return false
      seen.push(eventId)
      await saveProcessedEventIds(cwd, seen.slice(-200))
      return true
    },
  }
}
```

```ts
// src/platform/integrations/im/runtime.ts
export async function saveImServerStatus(cwd: string, status: ImServerStatus): Promise<void> {
  const path = join(getRepoMagpieDir(cwd), 'im', 'server-state.json')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(status, null, 2), 'utf-8')
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- tests/platform/im/thread-mapping.test.ts tests/platform/im/runtime.test.ts`

Expected: PASS for mapping persistence and duplicate-event protection.

- [ ] **Step 6: Commit**

```bash
git add src/platform/integrations/im/thread-mapping.ts src/platform/integrations/im/runtime.ts tests/platform/im/thread-mapping.test.ts tests/platform/im/runtime.test.ts
git commit -m "feat(im):保存线程映射与去重状态"
```

### Task 4: Reuse Existing Confirmation Actions from Feishu

**Files:**
- Create: `src/platform/integrations/im/feishu/confirmation-bridge.ts`
- Modify: `src/cli/commands/im-server.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Test: `tests/platform/im/confirmation-bridge.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`

- [ ] **Step 1: Write failing tests for approval, rejection, and extra instruction application**

```ts
// tests/platform/im/confirmation-bridge.test.ts
it('approves a pending confirmation when the actor is whitelisted', async () => {
  const result = await handleConfirmationAction(tmpRepo, {
    actorOpenId: 'ou_approved_user',
    whitelist: ['ou_approved_user'],
    action: 'approve_confirmation',
    sessionId: loopSession.id,
    confirmationId: pending.id,
    threadKey: 'om_root',
    chatId: 'oc_chat',
  })

  expect(result.status).toBe('applied')
  expect(result.decision).toBe('approved')
})
```

```ts
// tests/platform/im/confirmation-bridge.test.ts
it('rejects unauthorized confirmation actions without mutating session state', async () => {
  const result = await handleConfirmationAction(tmpRepo, {
    actorOpenId: 'ou_guest',
    whitelist: ['ou_operator'],
    action: 'approve_confirmation',
    sessionId: loopSession.id,
    confirmationId: pending.id,
    threadKey: 'om_root',
    chatId: 'oc_chat',
  })

  expect(result.status).toBe('rejected')
  expect(result.reason).toContain('not allowed')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/platform/im/confirmation-bridge.test.ts tests/capabilities/loop/loop.test.ts`

Expected: FAIL because no Feishu confirmation bridge exists and loop does not yet emit a Feishu task thread binding.

- [ ] **Step 3: Implement the confirmation bridge on top of the existing CLI helper**

```ts
// src/platform/integrations/im/feishu/confirmation-bridge.ts
import { applyLoopConfirmationDecision } from '../../../cli/commands/human-confirmation-actions.js'

export async function handleConfirmationAction(
  cwd: string,
  input: {
    actorOpenId: string
    whitelist: string[]
    action: 'approve_confirmation' | 'reject_confirmation'
    sessionId: string
    confirmationId: string
    rejectionReason?: string
    extraInstruction?: string
  }
) {
  if (!input.whitelist.includes(input.actorOpenId)) {
    return {
      status: 'rejected' as const,
      reason: `Actor ${input.actorOpenId} is not allowed to approve confirmations.`,
    }
  }

  const stateManager = new StateManager(cwd)
  await stateManager.initLoopSessions()
  const session = await stateManager.getLoopSession(input.sessionId)
  if (!session) {
    return { status: 'rejected' as const, reason: `Loop session ${input.sessionId} not found.` }
  }

  if (input.extraInstruction?.trim()) {
    session.notes = [...(session.notes || []), `Feishu operator note: ${input.extraInstruction.trim()}`]
  }

  const decision = input.action === 'approve_confirmation'
    ? { approve: true }
    : { reject: true, reason: input.rejectionReason || 'Rejected from Feishu.' }

  const applied = await applyLoopConfirmationDecision(cwd, session, decision)
  return {
    status: 'applied' as const,
    decision: applied.resolvedItem.decision,
  }
}
```

- [ ] **Step 4: Publish or create the Feishu thread mapping when human confirmation is raised**

```ts
// src/capabilities/loop/application/execute.ts
await imRouter.ensureHumanConfirmationThread({
  capability: 'loop',
  sessionId: input.session.id,
  summary: confirmationItem.reason,
  actionUrl,
  confirmationId: confirmationItem.id,
})
```

Add this as a best-effort side effect immediately after the confirmation item is persisted and before the function returns a paused result. Keep the existing notification router behavior in place.

- [ ] **Step 5: Wire the callback server to the confirmation bridge**

```ts
// src/cli/commands/im-server.ts
const server = createFeishuCallbackServer({
  port,
  path,
  verificationToken: provider.verification_token,
  onEvent: async (event) => {
    if (event.kind !== 'confirmation_action') return
    await handleConfirmationAction(cwd, {
      actorOpenId: event.actorOpenId,
      whitelist: provider.approval_whitelist_open_ids,
      action: event.action,
      sessionId: event.sessionId,
      confirmationId: event.confirmationId,
      rejectionReason: event.rejectionReason,
      extraInstruction: event.extraInstruction,
    })
  },
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:run -- tests/platform/im/confirmation-bridge.test.ts tests/capabilities/loop/loop.test.ts`

Expected: PASS for whitelist enforcement, reused approval logic, and loop-side Feishu thread publish hook.

- [ ] **Step 7: Commit**

```bash
git add src/platform/integrations/im/feishu/confirmation-bridge.ts src/cli/commands/im-server.ts src/capabilities/loop/application/execute.ts tests/platform/im/confirmation-bridge.test.ts tests/capabilities/loop/loop.test.ts
git commit -m "feat(im):接通飞书确认驱动"
```

### Task 5: Document, Verify, and Ship the New Flow

**Files:**
- Create: `docs/channels/feishu-im.md`
- Modify: `README.md`
- Modify: `docs/references/capabilities.md`
- Modify: `tests/platform/notifications/providers/feishu-webhook.test.ts`

- [ ] **Step 1: Write failing doc-oriented and smoke-oriented checks**

```ts
// tests/platform/notifications/providers/feishu-webhook.test.ts
it('keeps human confirmation message content structured enough for thread handoff', async () => {
  // extend the existing card assertion with session id and operator-action fields
})
```

Document updates must describe:

- how to start `magpie im-server`
- what Feishu app credentials are required
- how whitelist approval works
- that README must be updated because startup/config/command behavior changed

- [ ] **Step 2: Run tests to verify the current docs and assertions are incomplete**

Run: `npm run test:run -- tests/platform/notifications/providers/feishu-webhook.test.ts`

Expected: FAIL or require updated assertions because the Feishu thread handoff fields are not yet covered.

- [ ] **Step 3: Update user-facing docs**

```md
<!-- README.md -->
## Feishu IM 控制

1. 在 `~/.magpie/config.yaml` 打开 `integrations.im`
2. 配置飞书应用的 `app_id`、`app_secret`、`verification_token`
3. 启动回调服务：`magpie im-server start`
4. 当任务进入人工确认时，在飞书线程内批准或拒绝
```

```md
<!-- docs/references/capabilities.md -->
| IM 回调服务 | `magpie im-server start|status|stop` | `src/cli/commands/im-server.ts`、`src/platform/integrations/im/` | 负责接收飞书回调、线程映射、权限校验和确认动作转发 |
```

```md
<!-- docs/channels/feishu-im.md -->
- 需要的飞书应用字段
- 回调地址配置
- 白名单审批规则
- 线程与 Magpie 会话如何对应
- 常见失败与重试方法
```

- [ ] **Step 4: Run the full verification set**

Run: `npm run test:run -- tests/platform/im/feishu-signature.test.ts tests/platform/im/feishu-events.test.ts tests/platform/im/thread-mapping.test.ts tests/platform/im/runtime.test.ts tests/platform/im/confirmation-bridge.test.ts tests/cli/program.test.ts tests/config/init.test.ts tests/platform/notifications/providers/feishu-webhook.test.ts tests/capabilities/loop/loop.test.ts`

Expected: PASS for the new IM server, callback parsing, mapping, confirmation bridge, and updated Feishu notification behavior.

- [ ] **Step 5: Run repository checks**

Run: `npm run build`
Expected: PASS and `dist/cli.js` is rebuilt with the new `im-server` command.

Run: `npm run check:docs`
Expected: PASS because README, capability reference, and channel docs all point to the new flow.

Run: `npm run test:coverage`
Expected: PASS and the touched files remain at or above 80% line coverage.

- [ ] **Step 6: Commit**

```bash
git add docs/channels/feishu-im.md README.md docs/references/capabilities.md tests/platform/notifications/providers/feishu-webhook.test.ts
git commit -m "docs(im):补齐飞书确认接入说明"
```

## Self-Review

Spec coverage:

- inbound Feishu control surface: covered by Tasks 1-4
- one task per thread: covered by Tasks 3-4
- whitelist-only approvals: covered by Task 4
- README and capability-doc updates: covered by Task 5

Placeholder scan:

- no `TODO`, `TBD`, or “implement later” placeholders remain
- every task lists exact files and commands

Type consistency:

- config names use `integrations.im`
- provider type uses `feishu-app`
- thread/session persistence lives under `.magpie/im`

## Notes Before Execution

- README **does need to be updated** during implementation because this feature adds a new startup command, new required config, and a new operator-facing workflow.
- `docs/references/capabilities.md` also needs an update because `im-server` becomes a new top-level command surface.
- Keep Milestone 2 and Milestone 3 out of scope until this Milestone 1 plan is complete and verified.
