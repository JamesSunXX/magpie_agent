# Feishu Task Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Feishu group members create new Magpie development tasks from a structured message, with automatic routing to `loop` or `harness` and one task bound to one Feishu thread.

**Architecture:** Extend the existing Feishu IM bridge so it can parse inbound task-creation messages in addition to confirmation card callbacks. Normalize the message into one internal task request shape, launch the correct existing Magpie workflow surface (`loop` or `harness`), create a dedicated Feishu task thread, persist the thread/session mapping under `.magpie/im/`, and reply lifecycle updates into that same thread.

**Tech Stack:** TypeScript, Node HTTP server, Commander, existing loop/harness command helpers, existing Feishu IM client, Vitest

---

This plan intentionally covers **Milestone 2 only** from the approved design. It keeps task creation in **command-style message entry**. Feishu form entry belongs to Milestone 3 and should be planned separately after Milestone 2 ships and is verified.

## File Structure

Planned responsibilities before implementation:

- `src/platform/integrations/im/types.ts`
  Add a second inbound event type for Feishu task-creation messages and a normalized request type used after parsing.
- `src/platform/integrations/im/feishu/events.ts`
  Parse both confirmation card actions and structured task messages from Feishu callback payloads.
- `src/platform/integrations/im/feishu/task-command.ts`
  Validate and normalize the supported Feishu message format into one `TaskCreationRequest`.
- `src/platform/integrations/im/feishu/task-launch.ts`
  Launch or queue the correct Magpie workflow, create the Feishu task root message, persist thread mapping, and post the accepted summary.
- `src/cli/commands/im-server.ts`
  Dispatch inbound task-creation events in the existing callback loop.
- `src/platform/integrations/im/thread-mapping.ts`
  Extend persisted mapping status values if needed for queued/running/completed states.
- `src/capabilities/loop/application/execute.ts`
  Best-effort reply task status updates into the mapped Feishu thread for loop-created tasks.
- `src/capabilities/workflows/harness/application/execute.ts`
  Best-effort reply task status updates into the mapped Feishu thread for harness-created tasks.
- `docs/channels/feishu-im.md`
  Document the message format, routing rules, and thread behavior for task creation.
- `README.md`
  Mention that Feishu can now create tasks, not only confirm paused work.

### Supported Feishu command format in Milestone 2

The bridge only accepts this structured message shape:

```text
/magpie task
type: formal
goal: Deliver payment retry flow
prd: docs/plans/payment-retry.md
priority: high
```

Or:

```text
/magpie task
type: small
goal: Fix login timeout regression
prd: docs/plans/login-timeout.md
```

Rules locked for this milestone:

- `type: formal` routes to `harness`
- `type: small` routes to `loop`
- `goal` is required
- `prd` is required
- `priority` is optional and only used for `harness`
- free-form natural-language understanding is out of scope

### Task 1: Parse Feishu task-creation messages

**Files:**
- Modify: `src/platform/integrations/im/types.ts`
- Modify: `src/platform/integrations/im/feishu/events.ts`
- Test: `tests/platform/im/feishu-events.test.ts`

- [ ] **Step 1: Write the failing parser tests**

```ts
// tests/platform/im/feishu-events.test.ts
it('normalizes a Feishu text message into a task command event', () => {
  const normalized = parseFeishuEvent({
    header: {
      event_id: 'evt-task-1',
      event_type: 'im.message.receive_v1',
    },
    event: {
      sender: {
        sender_id: {
          open_id: 'ou_requester',
        },
      },
      message: {
        message_id: 'om_source',
        chat_id: 'oc_chat',
        message_type: 'text',
        content: JSON.stringify({
          text: '/magpie task\\ntype: small\\ngoal: Fix login timeout\\nprd: docs/plans/login-timeout.md',
        }),
      },
    },
  })

  expect(normalized).toEqual({
    kind: 'task_command',
    eventId: 'evt-task-1',
    actorOpenId: 'ou_requester',
    sourceMessageId: 'om_source',
    chatId: 'oc_chat',
    text: '/magpie task\\ntype: small\\ngoal: Fix login timeout\\nprd: docs/plans/login-timeout.md',
  })
})

it('rejects unsupported Feishu message payloads', () => {
  expect(() => parseFeishuEvent({
    header: {
      event_type: 'im.message.receive_v1',
    },
    event: {
      sender: {
        sender_id: {
          open_id: 'ou_requester',
        },
      },
      message: {
        message_id: 'om_source',
        chat_id: 'oc_chat',
        message_type: 'image',
        content: JSON.stringify({ image_key: 'img_1' }),
      },
    },
  })).toThrow('unsupported message_type image')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/platform/im/feishu-events.test.ts`

Expected: FAIL because `parseFeishuEvent` only supports confirmation actions.

- [ ] **Step 3: Extend the shared IM event types**

```ts
// src/platform/integrations/im/types.ts
export interface TaskCommandEvent {
  kind: 'task_command'
  eventId?: string
  actorOpenId: string
  sourceMessageId: string
  chatId: string
  text: string
}

export type ImInboundEvent =
  | ConfirmationActionEvent
  | TaskCommandEvent
```

- [ ] **Step 4: Parse task-command callbacks in the Feishu event normalizer**

```ts
// src/platform/integrations/im/feishu/events.ts
function parseTaskCommandEvent(payload: {
  header?: { event_id?: unknown }
  event?: {
    sender?: { sender_id?: { open_id?: unknown } }
    message?: {
      message_id?: unknown
      chat_id?: unknown
      message_type?: unknown
      content?: unknown
    }
  }
}): TaskCommandEvent {
  const messageType = requireString(payload.event?.message?.message_type, 'event.message.message_type')
  if (messageType !== 'text') {
    throw new Error(`Invalid Feishu callback payload: unsupported message_type ${messageType}`)
  }

  const rawContent = requireString(payload.event?.message?.content, 'event.message.content')
  const content = JSON.parse(rawContent) as { text?: unknown }

  return {
    kind: 'task_command',
    eventId: typeof payload.header?.event_id === 'string' ? payload.header.event_id : undefined,
    actorOpenId: requireString(payload.event?.sender?.sender_id?.open_id, 'event.sender.sender_id.open_id'),
    sourceMessageId: requireString(payload.event?.message?.message_id, 'event.message.message_id'),
    chatId: requireString(payload.event?.message?.chat_id, 'event.message.chat_id'),
    text: requireString(content.text, 'event.message.content.text'),
  }
}
```

```ts
// src/platform/integrations/im/feishu/events.ts
export function parseFeishuEvent(payload: unknown): ImInboundEvent {
  const eventType = (payload as { header?: { event_type?: unknown } })?.header?.event_type
  if (eventType === 'im.message.receive_v1') {
    return parseTaskCommandEvent(payload as never)
  }

  return parseConfirmationActionEvent(payload as never)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- tests/platform/im/feishu-events.test.ts`

Expected: PASS for both confirmation and task-command normalization cases.

- [ ] **Step 6: Commit**

```bash
git add src/platform/integrations/im/types.ts src/platform/integrations/im/feishu/events.ts tests/platform/im/feishu-events.test.ts
git commit -m "feat(im):解析飞书任务消息"
```

### Task 2: Normalize the supported command format into one task request

**Files:**
- Create: `src/platform/integrations/im/feishu/task-command.ts`
- Test: `tests/platform/im/feishu-task-command.test.ts`

- [ ] **Step 1: Write the failing normalization tests**

```ts
// tests/platform/im/feishu-task-command.test.ts
it('normalizes a small-task command into a loop request', () => {
  const request = parseFeishuTaskCommand('/magpie task\\ntype: small\\ngoal: Fix login timeout\\nprd: docs/plans/login-timeout.md')

  expect(request).toEqual({
    entryMode: 'command',
    taskType: 'small',
    capability: 'loop',
    goal: 'Fix login timeout',
    prdPath: 'docs/plans/login-timeout.md',
    priority: undefined,
  })
})

it('normalizes a formal task command into a harness request', () => {
  const request = parseFeishuTaskCommand('/magpie task\\ntype: formal\\ngoal: Deliver payment retry flow\\nprd: docs/plans/payment-retry.md\\npriority: high')

  expect(request).toEqual({
    entryMode: 'command',
    taskType: 'formal',
    capability: 'harness',
    goal: 'Deliver payment retry flow',
    prdPath: 'docs/plans/payment-retry.md',
    priority: 'high',
  })
})

it('fails when required fields are missing', () => {
  expect(() => parseFeishuTaskCommand('/magpie task\\ngoal: Missing type')).toThrow('missing required field: type')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/platform/im/feishu-task-command.test.ts`

Expected: FAIL because the parser module does not exist yet.

- [ ] **Step 3: Add the normalized request type and parser**

```ts
// src/platform/integrations/im/feishu/task-command.ts
export interface TaskCreationRequest {
  entryMode: 'command'
  taskType: 'formal' | 'small'
  capability: 'loop' | 'harness'
  goal: string
  prdPath: string
  priority?: 'interactive' | 'high' | 'normal' | 'background'
}

export function parseFeishuTaskCommand(text: string): TaskCreationRequest {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines[0] !== '/magpie task') {
    throw new Error('unsupported command header')
  }

  const fields = Object.fromEntries(lines.slice(1).map((line) => {
    const separator = line.indexOf(':')
    if (separator <= 0) {
      throw new Error(`invalid command line: ${line}`)
    }
    return [
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    ]
  }))

  const type = fields.type
  const goal = fields.goal
  const prdPath = fields.prd

  if (!type) throw new Error('missing required field: type')
  if (!goal) throw new Error('missing required field: goal')
  if (!prdPath) throw new Error('missing required field: prd')

  if (type !== 'formal' && type !== 'small') {
    throw new Error(`unsupported task type: ${type}`)
  }

  const priority = fields.priority
  if (priority && !['interactive', 'high', 'normal', 'background'].includes(priority)) {
    throw new Error(`unsupported priority: ${priority}`)
  }

  return {
    entryMode: 'command',
    taskType: type,
    capability: type === 'formal' ? 'harness' : 'loop',
    goal,
    prdPath,
    ...(priority ? { priority: priority as TaskCreationRequest['priority'] } : {}),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- tests/platform/im/feishu-task-command.test.ts`

Expected: PASS for `small`, `formal`, and validation failures.

- [ ] **Step 5: Commit**

```bash
git add src/platform/integrations/im/feishu/task-command.ts tests/platform/im/feishu-task-command.test.ts
git commit -m "feat(im):归一飞书任务命令"
```

### Task 3: Launch or queue the correct Magpie workflow and bind one Feishu thread

**Files:**
- Create: `src/platform/integrations/im/feishu/task-launch.ts`
- Modify: `src/platform/integrations/im/thread-mapping.ts`
- Test: `tests/platform/im/feishu-task-launch.test.ts`

- [ ] **Step 1: Write the failing launch tests**

```ts
// tests/platform/im/feishu-task-launch.test.ts
it('launches a loop task in tmux and binds a Feishu thread', async () => {
  const result = await launchFeishuTask(cwd, {
    appId: 'app-id',
    appSecret: 'app-secret',
    request: {
      entryMode: 'command',
      taskType: 'small',
      capability: 'loop',
      goal: 'Fix login timeout',
      prdPath: 'docs/plans/login-timeout.md',
    },
    chatId: 'oc_chat',
  })

  expect(result).toEqual({
    capability: 'loop',
    sessionId: 'loop-1234',
    threadId: 'om_task_root',
    status: 'running',
  })
})

it('queues a harness task when harness-server is running', async () => {
  const result = await launchFeishuTask(cwd, {
    appId: 'app-id',
    appSecret: 'app-secret',
    request: {
      entryMode: 'command',
      taskType: 'formal',
      capability: 'harness',
      goal: 'Deliver payment retry flow',
      prdPath: 'docs/plans/payment-retry.md',
      priority: 'high',
    },
    chatId: 'oc_chat',
  })

  expect(result.status).toBe('queued')
  expect(result.capability).toBe('harness')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/platform/im/feishu-task-launch.test.ts`

Expected: FAIL because the launch bridge does not exist yet.

- [ ] **Step 3: Add the launcher bridge with one-task-one-thread behavior**

```ts
// src/platform/integrations/im/feishu/task-launch.ts
export async function launchFeishuTask(cwd: string, input: {
  appId: string
  appSecret: string
  request: TaskCreationRequest
  chatId: string
  configPath?: string
}): Promise<{
  capability: 'loop' | 'harness'
  sessionId: string
  threadId: string
  status: 'queued' | 'running'
}> {
  const client = new FeishuImClient({
    appId: input.appId,
    appSecret: input.appSecret,
  })

  const root = await client.sendRootTextMessage(input.chatId, [
    `Magpie ${input.request.capability} task`,
    `Goal: ${input.request.goal}`,
    `PRD: ${input.request.prdPath}`,
  ].join('\n'))

  if (input.request.capability === 'harness') {
    if (await isHarnessServerRunning(cwd)) {
      const queued = await enqueueHarnessSession(cwd, {
        goal: input.request.goal,
        prdPath: input.request.prdPath,
        priority: input.request.priority,
      }, {
        configPath: input.configPath,
        graph: buildQueuedHarnessGraph(input.request.goal, input.request.prdPath),
      })

      await saveThreadMapping(cwd, {
        threadId: root.messageId,
        rootMessageId: root.messageId,
        chatId: input.chatId,
        capability: 'harness',
        sessionId: queued.id,
        status: 'queued',
      })

      return {
        capability: 'harness',
        sessionId: queued.id,
        threadId: root.messageId,
        status: 'queued',
      }
    }

    const launch = await launchMagpieInTmux({
      capability: 'harness',
      cwd,
      configPath: input.configPath,
      argv: [
        'harness',
        'submit',
        input.request.goal,
        '--prd',
        input.request.prdPath,
        '--host',
        'foreground',
        ...(input.request.priority ? ['--priority', input.request.priority] : []),
      ],
    })

    await saveThreadMapping(cwd, {
      threadId: root.messageId,
      rootMessageId: root.messageId,
      chatId: input.chatId,
      capability: 'harness',
      sessionId: launch.sessionId,
      status: 'running',
    })

    return {
      capability: 'harness',
      sessionId: launch.sessionId,
      threadId: root.messageId,
      status: 'running',
    }
  }

  const launch = await launchMagpieInTmux({
    capability: 'loop',
    cwd,
    configPath: input.configPath,
    argv: [
      'loop',
      'run',
      input.request.goal,
      '--prd',
      input.request.prdPath,
      '--host',
      'foreground',
      '--no-wait-human',
    ],
  })

  await saveThreadMapping(cwd, {
    threadId: root.messageId,
    rootMessageId: root.messageId,
    chatId: input.chatId,
    capability: 'loop',
    sessionId: launch.sessionId,
    status: 'running',
  })

  return {
    capability: 'loop',
    sessionId: launch.sessionId,
    threadId: root.messageId,
    status: 'running',
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- tests/platform/im/feishu-task-launch.test.ts`

Expected: PASS for loop launch, harness queue, and saved thread mapping behavior.

- [ ] **Step 5: Commit**

```bash
git add src/platform/integrations/im/feishu/task-launch.ts src/platform/integrations/im/thread-mapping.ts tests/platform/im/feishu-task-launch.test.ts
git commit -m "feat(im):打通飞书任务启动桥接"
```

### Task 4: Dispatch task-command events in the IM server loop

**Files:**
- Modify: `src/cli/commands/im-server.ts`
- Test: `tests/cli/im-server-command.test.ts`

- [ ] **Step 1: Write the failing IM server dispatch tests**

```ts
// tests/cli/im-server-command.test.ts
it('routes a task-command callback into the task launcher and replies in the task thread', async () => {
  await runImServerLoop({
    cwd: process.cwd(),
  })

  expect(launchFeishuTaskMock).toHaveBeenCalledWith(
    process.cwd(),
    expect.objectContaining({
      request: expect.objectContaining({
        capability: 'loop',
        goal: 'Fix login timeout',
      }),
      chatId: 'oc_chat',
    })
  )

  expect(replyTextMessageMock).toHaveBeenCalledWith(
    'om_task_root',
    expect.stringContaining('Task accepted')
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/cli/im-server-command.test.ts`

Expected: FAIL because `im-server` only dispatches confirmation actions.

- [ ] **Step 3: Dispatch both inbound event kinds**

```ts
// src/cli/commands/im-server.ts
if (event.kind === 'confirmation_action') {
  // keep existing confirmation path
  return
}

const request = parseFeishuTaskCommand(event.text)
const launched = await launchFeishuTask(options.cwd, {
  appId: provider.app_id,
  appSecret: provider.app_secret,
  request,
  chatId: event.chatId,
  configPath: options.configPath,
})

await client.replyTextMessage(launched.threadId, [
  'Task accepted.',
  `Capability: ${launched.capability}`,
  `Session: ${launched.sessionId}`,
  `Status: ${launched.status}`,
].join('\n')).catch(() => {})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- tests/cli/im-server-command.test.ts`

Expected: PASS for both confirmation-event and task-command dispatch paths.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/im-server.ts tests/cli/im-server-command.test.ts
git commit -m "feat(im):接入飞书任务消息分发"
```

### Task 5: Reply lifecycle updates into the mapped Feishu thread

**Files:**
- Create: `src/platform/integrations/im/feishu/task-status.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/capabilities/workflows/harness/application/execute.ts`
- Test: `tests/platform/im/feishu-task-status.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`
- Test: `tests/cli/harness-command.test.ts` or `tests/capabilities/workflows/harness/*.test.ts`

- [ ] **Step 1: Write the failing lifecycle update tests**

```ts
// tests/platform/im/feishu-task-status.test.ts
it('replies to the mapped thread when a loop task completes', async () => {
  await publishFeishuTaskStatusFromConfig(cwd, config, {
    capability: 'loop',
    sessionId: 'loop-123',
    status: 'completed',
    title: 'Fix login timeout',
    summary: 'Loop completed successfully.',
  })

  expect(replyTextMessageMock).toHaveBeenCalledWith(
    'om_task_root',
    expect.stringContaining('Loop completed successfully')
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/platform/im/feishu-task-status.test.ts tests/capabilities/loop/loop.test.ts`

Expected: FAIL because there is no task-status publisher yet.

- [ ] **Step 3: Add a shared thread-status publisher**

```ts
// src/platform/integrations/im/feishu/task-status.ts
export async function publishFeishuTaskStatusFromConfig(
  cwd: string,
  config: MagpieConfig,
  input: {
    capability: 'loop' | 'harness'
    sessionId: string
    status: 'queued' | 'running' | 'paused_for_human' | 'completed' | 'failed'
    title: string
    summary: string
  }
): Promise<boolean> {
  const integration = config.integrations.im
  if (!integration?.enabled || !integration.default_provider) {
    return false
  }

  const provider = integration.providers?.[integration.default_provider]
  if (!provider || provider.type !== 'feishu-app') {
    return false
  }

  const mapping = await loadThreadMappingBySession(cwd, input.capability, input.sessionId)
  if (!mapping) {
    return false
  }

  const client = new FeishuImClient({
    appId: provider.app_id,
    appSecret: provider.app_secret,
  })

  await client.replyTextMessage(mapping.rootMessageId, [
    `${input.capability} ${input.status}`,
    `Title: ${input.title}`,
    input.summary,
  ].join('\n'))

  await saveThreadMapping(cwd, {
    ...mapping,
    status: input.status,
  })

  return true
}
```

- [ ] **Step 4: Wire best-effort status replies into loop and harness**

```ts
// src/capabilities/loop/application/execute.ts
await publishFeishuTaskStatusFromConfig(ctx.cwd, ctx.config, {
  capability: 'loop',
  sessionId,
  status: 'completed',
  title: input.goal,
  summary: 'Loop completed successfully.',
}).catch(() => {})
```

```ts
// src/capabilities/workflows/harness/application/execute.ts
await publishFeishuTaskStatusFromConfig(ctx.cwd, config, {
  capability: 'harness',
  sessionId,
  status: 'failed',
  title: prepared.goal,
  summary: 'Harness failed during delivery.',
}).catch(() => {})
```

Minimum lifecycle replies required in this milestone:

- accepted / queued right after launch
- paused_for_human through the already-shipped confirmation bridge
- completed
- failed

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:run -- tests/platform/im/feishu-task-status.test.ts tests/capabilities/loop/loop.test.ts tests/cli/harness-command.test.ts`

Expected: PASS for loop and harness thread-update coverage.

- [ ] **Step 6: Commit**

```bash
git add src/platform/integrations/im/feishu/task-status.ts src/capabilities/loop/application/execute.ts src/capabilities/workflows/harness/application/execute.ts tests/platform/im/feishu-task-status.test.ts tests/capabilities/loop/loop.test.ts tests/cli/harness-command.test.ts
git commit -m "feat(im):回写飞书任务线程状态"
```

### Task 6: Update docs and verify the full Milestone 2 flow

**Files:**
- Modify: `README.md`
- Modify: `docs/channels/feishu-im.md`
- Modify: `docs/references/capabilities.md`

- [ ] **Step 1: Update the user-facing docs**

```md
## Feishu IM 控制

现在支持两类动作：

- 在线处理人工确认
- 用固定格式消息创建新任务

消息格式：

```text
/magpie task
type: small
goal: Fix login timeout
prd: docs/plans/login-timeout.md
```
```

- [ ] **Step 2: Run focused docs checks**

Run: `npm run check:docs`

Expected: PASS after the new task-creation guidance is linked from the docs index.

- [ ] **Step 3: Run full project verification**

Run:

```bash
npm run test:run
npm run test:coverage
npm run build
npm run lint
npm run check:docs
```

Expected:

- all tests PASS
- coverage for touched files stays at or above 80%
- build PASS
- lint PASS
- docs check PASS

- [ ] **Step 4: Commit**

```bash
git add README.md docs/channels/feishu-im.md docs/references/capabilities.md
git commit -m "docs(im):补充飞书任务创建说明"
```

## Self-Review

Spec coverage after writing this plan:

- inbound Feishu task creation: covered by Task 1 and Task 2
- route by task type: covered by Task 2 and Task 3
- one task to one Feishu thread: covered by Task 3
- thread-local status updates: covered by Task 5
- milestone stays command-only and defers forms: explicitly locked in this plan header and file-structure notes

Placeholder scan:

- no `TODO`, `TBD`, or “implement later”
- each task includes target files, concrete code shapes, commands, and commit points

Type consistency check:

- inbound event names stay `task_command` and `confirmation_action`
- normalized request fields stay `entryMode`, `taskType`, `capability`, `goal`, `prdPath`, `priority`
- persisted mapping continues using `threadId`, `rootMessageId`, `chatId`, `capability`, `sessionId`, `status`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-15-feishu-task-creation-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
