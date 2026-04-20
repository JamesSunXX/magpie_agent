# Feishu Form Task Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Feishu group members send `/magpie form`, submit a message card, and create a task through the same launch path already used by `/magpie task`.

**Architecture:** Add a lightweight form-open command and a new card-submit callback type inside the Feishu IM bridge. Normalize both command entry and form entry into the same `TaskCreationRequest`, then reuse the current task launch, mapping, and status-update flow.

**Tech Stack:** TypeScript, Node HTTP server, existing Feishu IM client, existing loop and harness launch helpers, Vitest

---

## Current Baseline

This branch already contains a partial implementation in the exact files listed below. Do not restart from scratch. First, align the existing diff with the design requirements, then fill the remaining gaps and verify the whole flow end-to-end.

## File Structure

- Modify: `src/platform/integrations/im/types.ts`
  Keeps the normalized inbound event union for Feishu callbacks.
- Modify: `src/platform/integrations/im/feishu/events.ts`
  Parses raw Feishu callback payloads into `task_command`, `confirmation_action`, or `task_form_submission`.
- Modify: `src/platform/integrations/im/feishu/task-command.ts`
  Owns `/magpie task` parsing, `/magpie form` detection, and shared task-request validation.
- Create: `src/platform/integrations/im/feishu/task-form.ts`
  Builds the interactive Feishu card used by `/magpie form`.
- Modify: `src/cli/commands/im-server.ts`
  Dispatches inbound IM events, replies with the card, validates form submissions, and launches tasks.
- Modify: `tests/platform/im/feishu-events.test.ts`
  Covers callback normalization, including form submissions.
- Modify: `tests/platform/im/feishu-task-command.test.ts`
  Covers shared task-request validation for both entry modes.
- Create: `tests/platform/im/feishu-task-form.test.ts`
  Covers the card payload shape and submit action marker.
- Modify: `tests/cli/im-server-command.test.ts`
  Covers the IM server open-form, valid submit, invalid submit, and duplicate-event paths.
- Modify: `README.md`
  Advertises both task-entry modes from the top-level usage docs.
- Modify: `docs/channels/feishu-im.md`
  Documents setup and the new `/magpie form` workflow.
- Modify: `docs/references/capabilities.md`
  Keeps the IM capability reference accurate.

## Task 1: Stabilize dual-entry request parsing

**Files:**
- Modify: `src/platform/integrations/im/types.ts`
- Modify: `src/platform/integrations/im/feishu/events.ts`
- Modify: `src/platform/integrations/im/feishu/task-command.ts`
- Test: `tests/platform/im/feishu-events.test.ts`
- Test: `tests/platform/im/feishu-task-command.test.ts`

- [ ] **Step 1: Add the failing event-parser and request-parser tests**

```ts
it('normalizes a task form submission callback into a task form event', () => {
  const normalized = parseFeishuEvent({
    header: {
      event_id: 'evt-form-1',
      event_type: 'im.message.action.trigger',
    },
    event: {
      operator: { open_id: 'ou_requester' },
      action: {
        value: { action: 'submit_task_form' },
        form_value: {
          task_type: 'formal',
          goal: 'Deliver payment retry flow',
          prd: 'docs/plans/payment-retry.md',
          priority: 'high',
        },
      },
      context: {
        open_message_id: 'om_form_root',
        open_chat_id: 'oc_chat',
      },
    },
  })

  expect(normalized).toEqual({
    kind: 'task_form_submission',
    eventId: 'evt-form-1',
    actorOpenId: 'ou_requester',
    threadKey: 'om_form_root',
    chatId: 'oc_chat',
    formValues: {
      taskType: 'formal',
      goal: 'Deliver payment retry flow',
      prdPath: 'docs/plans/payment-retry.md',
      priority: 'high',
    },
  })
})

it('normalizes a form submission into a harness request', () => {
  expect(parseFeishuTaskForm({
    taskType: 'formal',
    goal: 'Deliver payment retry flow',
    prdPath: 'docs/plans/payment-retry.md',
    priority: 'high',
  })).toEqual({
    entryMode: 'form',
    taskType: 'formal',
    capability: 'harness',
    goal: 'Deliver payment retry flow',
    prdPath: 'docs/plans/payment-retry.md',
    priority: 'high',
  })
})
```

- [ ] **Step 2: Run the focused parser tests**

Run: `npm run test:run -- tests/platform/im/feishu-events.test.ts tests/platform/im/feishu-task-command.test.ts`
Expected: the new form-submission cases fail before the parser work is complete, or pass if the current branch already contains the implementation.

- [ ] **Step 3: Finish the shared normalization and callback parsing**

```ts
export interface TaskFormSubmissionEvent {
  kind: 'task_form_submission'
  eventId?: string
  actorOpenId: string
  threadKey: string
  chatId: string
  formValues: {
    taskType?: string
    goal?: string
    prdPath?: string
    priority?: string
  }
}

export function parseFeishuTaskForm(fields: {
  taskType?: string
  goal?: string
  prdPath?: string
  priority?: string
}): TaskCreationRequest {
  return normalizeTaskCreationRequest({
    entryMode: 'form',
    taskType: fields.taskType,
    goal: fields.goal,
    prdPath: fields.prdPath,
    priority: fields.priority,
  })
}
```

- [ ] **Step 4: Re-run the parser tests**

Run: `npm run test:run -- tests/platform/im/feishu-events.test.ts tests/platform/im/feishu-task-command.test.ts`
Expected: PASS for all parser-focused cases.

## Task 2: Add the form card payload

**Files:**
- Create: `src/platform/integrations/im/feishu/task-form.ts`
- Test: `tests/platform/im/feishu-task-form.test.ts`

- [ ] **Step 1: Add the failing card-builder test**

```ts
it('builds the task creation card with the expected fields and submit action', () => {
  const card = buildFeishuTaskFormCard()

  expect(card).toEqual({
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: 'Create Magpie task',
      },
      template: 'blue',
    },
    elements: expect.arrayContaining([
      expect.objectContaining({ tag: 'input', name: 'task_type' }),
      expect.objectContaining({ tag: 'input', name: 'goal' }),
      expect.objectContaining({ tag: 'input', name: 'prd' }),
      expect.objectContaining({ tag: 'input', name: 'priority' }),
      expect.objectContaining({
        tag: 'action',
        actions: [
          expect.objectContaining({
            value: { action: FEISHU_TASK_FORM_SUBMIT_ACTION },
          }),
        ],
      }),
    ]),
  })
})
```

- [ ] **Step 2: Run the new card test**

Run: `npm run test:run -- tests/platform/im/feishu-task-form.test.ts`
Expected: FAIL with missing module or missing exported card builder until `task-form.ts` exists.

- [ ] **Step 3: Implement the minimal card builder**

```ts
export const FEISHU_TASK_FORM_SUBMIT_ACTION = 'submit_task_form'

export function buildFeishuTaskFormCard(): Record<string, unknown> {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: 'Create Magpie task',
      },
      template: 'blue',
    },
    elements: [
      {
        tag: 'markdown',
        content: [
          'Fill the fields below to create a new Magpie task.',
          '- `type`: `small` or `formal`',
          '- `priority` only matters for `formal` tasks',
        ].join('\n'),
      },
      { tag: 'input', name: 'task_type', placeholder: { tag: 'plain_text', content: 'small or formal' } },
      { tag: 'input', name: 'goal', placeholder: { tag: 'plain_text', content: 'Task goal' } },
      { tag: 'input', name: 'prd', placeholder: { tag: 'plain_text', content: 'docs/plans/example.md' } },
      { tag: 'input', name: 'priority', placeholder: { tag: 'plain_text', content: 'interactive, high, normal, or background' } },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: 'Submit task' },
            type: 'primary',
            value: { action: FEISHU_TASK_FORM_SUBMIT_ACTION },
          },
        ],
      },
    ],
  }
}
```

- [ ] **Step 4: Re-run the card test**

Run: `npm run test:run -- tests/platform/im/feishu-task-form.test.ts`
Expected: PASS.

## Task 3: Wire the IM server open-form and submit flow

**Files:**
- Modify: `src/cli/commands/im-server.ts`
- Test: `tests/cli/im-server-command.test.ts`

- [ ] **Step 1: Add the failing IM server regression tests**

```ts
it('replies with an interactive card when the task form command is received', async () => {
  createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
    once: vi.fn(),
    off: vi.fn(),
    listen: vi.fn((_port: number, callback: () => void) => {
      callback()
      void Promise.resolve()
        .then(() => onEvent({
          kind: 'task_command',
          eventId: 'evt-form-open',
          actorOpenId: 'ou_requester',
          sourceMessageId: 'om_source',
          chatId: 'oc_chat',
          text: '/magpie form',
        }))
        .then(() => signalHandlers.get('SIGTERM')?.())
    }),
    close: vi.fn((callback: () => void) => callback()),
  }))

  await runImServerLoop({ cwd: process.cwd() })

  expect(replyInteractiveCardMock).toHaveBeenCalledWith('om_source', { type: 'card' })
})

it('rejects invalid task form submissions with a clear reply', async () => {
  parseFeishuTaskFormMock.mockImplementation(() => {
    throw new Error('missing required field: goal')
  })

  expect(replyTextMessageMock).toHaveBeenCalledWith(
    'om_form_root',
    'Task rejected: missing required field: goal'
  )
})
```

- [ ] **Step 2: Run the IM server regression suite**

Run: `npm run test:run -- tests/cli/im-server-command.test.ts`
Expected: FAIL for the new form-open or form-submit assertions until the event dispatch path is complete.

- [ ] **Step 3: Reuse the existing launcher path for both entry modes**

```ts
if (event.kind === 'task_form_submission') {
  let request
  try {
    request = parseFeishuTaskForm(event.formValues)
  } catch (error) {
    await client.replyTextMessage(
      event.threadKey,
      `Task rejected: ${error instanceof Error ? error.message : String(error)}`
    ).catch(() => {})
    if (event.eventId) {
      await runtime.markEventProcessed(event.eventId)
    }
    return
  }

  const launched = await launchFeishuTask(options.cwd, {
    appId: provider.app_id,
    appSecret: provider.app_secret,
    request,
    chatId: event.chatId,
    configPath: options.configPath,
  })

  if (event.eventId) {
    await runtime.markEventProcessed(event.eventId)
  }
  await client.replyTextMessage(launched.threadId, [
    'Task accepted.',
    `Capability: ${launched.capability}`,
    `Session: ${launched.sessionId}`,
    `Status: ${launched.status}`,
  ].join('\n')).catch(() => {})
}

if (isFeishuTaskFormText(event.text)) {
  await client.replyInteractiveCard(event.sourceMessageId, buildFeishuTaskFormCard()).catch(() => {})
  if (event.eventId) {
    await runtime.markEventProcessed(event.eventId)
  }
  return
}
```

- [ ] **Step 4: Re-run the IM server regression suite**

Run: `npm run test:run -- tests/cli/im-server-command.test.ts`
Expected: PASS for open-form, invalid submit, valid submit, duplicate event, and confirmation regression cases.

## Task 4: Update user-facing docs

**Files:**
- Modify: `README.md`
- Modify: `docs/channels/feishu-im.md`
- Modify: `docs/references/capabilities.md`

- [ ] **Step 1: Update the top-level README entry**

```md
现在飞书线程支持三类动作：

- 批准或驳回人工确认
- 用固定格式消息创建任务
- 用 `/magpie form` 打开表单创建任务
```

- [ ] **Step 2: Update the channel guide with both entry modes**

~~~md
#### 方式 B：消息卡片表单

先在飞书群里发送：

```text
/magpie form
```

Magpie 会在当前对话里回一张表单卡片。填写后点击提交。
~~~

- [ ] **Step 3: Update the capability reference**

```md
| IM 回调服务 | `magpie im-server start|status|stop|run` | `src/cli/commands/im-server.ts`、`src/platform/integrations/im/` | 负责飞书回调入口；会读取 `integrations.im` 配置，验证飞书事件、按会话去重，并把人工确认动作转给现有 loop 确认逻辑，或把固定格式的 `/magpie task` 消息、`/magpie form` 表单入口和表单提交统一转成 `loop` / `harness` 新任务；线程映射、去重事件和服务状态保存在仓库 `.magpie/im/` |
```

- [ ] **Step 4: Run the docs check**

Run: `npm run check:docs`
Expected: `Documentation structure check passed.`

## Task 5: Final verification and handoff

**Files:**
- Verify: `src/platform/integrations/im/types.ts`
- Verify: `src/platform/integrations/im/feishu/events.ts`
- Verify: `src/platform/integrations/im/feishu/task-command.ts`
- Verify: `src/platform/integrations/im/feishu/task-form.ts`
- Verify: `src/cli/commands/im-server.ts`
- Verify: `tests/platform/im/feishu-events.test.ts`
- Verify: `tests/platform/im/feishu-task-command.test.ts`
- Verify: `tests/platform/im/feishu-task-form.test.ts`
- Verify: `tests/cli/im-server-command.test.ts`

- [ ] **Step 1: Run the focused IM suite**

Run: `npm run test:run -- tests/platform/im/feishu-events.test.ts tests/platform/im/feishu-task-command.test.ts tests/platform/im/feishu-task-form.test.ts tests/cli/im-server-command.test.ts`
Expected: PASS.

- [ ] **Step 2: Run full coverage**

Run: `npm run test:coverage`
Expected: overall suite passes and touched files stay at or above the repo coverage bar.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: TypeScript build succeeds and `dist/cli.js` is regenerated without type errors.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS with no new lint errors.

- [ ] **Step 5: Capture the handoff summary**

```md
Acceptance checklist:
- `/magpie task` still creates tasks
- `/magpie form` opens the card
- form submission creates the same normalized task request
- invalid submissions are rejected clearly
- duplicate callbacks are ignored
- thread status replies still land in the right task thread
```

Plan complete and saved to `docs/superpowers/plans/2026-04-16-feishu-form-task-creation-implementation.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
