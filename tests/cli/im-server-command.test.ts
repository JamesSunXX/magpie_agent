import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
const loadConfigMock = vi.hoisted(() => vi.fn())
const loadImServerStatusMock = vi.hoisted(() => vi.fn())
const saveImServerStatusMock = vi.hoisted(() => vi.fn())
const hasProcessedEventMock = vi.hoisted(() => vi.fn().mockResolvedValue(false))
const markEventProcessedMock = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const createImRuntimeMock = vi.hoisted(() => vi.fn(() => ({
  hasProcessedEvent: hasProcessedEventMock,
  markEventProcessed: markEventProcessedMock,
})))
const createFeishuCallbackServerMock = vi.hoisted(() => vi.fn())
const handleConfirmationActionMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  status: 'applied',
  decision: 'approved',
}))
const isFeishuTaskCommandTextMock = vi.hoisted(() => vi.fn())
const isFeishuTaskFormTextMock = vi.hoisted(() => vi.fn())
const isFeishuTaskStatusTextMock = vi.hoisted(() => vi.fn())
const parseFeishuTaskCommandMock = vi.hoisted(() => vi.fn())
const parseFeishuTaskFormMock = vi.hoisted(() => vi.fn())
const launchFeishuTaskMock = vi.hoisted(() => vi.fn())
const replyFeishuTaskStatusForThreadMock = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const replyTextMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue({ messageId: 'reply-1' }))
const replyInteractiveCardMock = vi.hoisted(() => vi.fn().mockResolvedValue({ messageId: 'reply-card-1' }))
const buildFeishuTaskFormCardMock = vi.hoisted(() => vi.fn(() => ({ type: 'card' })))
const FeishuImClientMock = vi.hoisted(() => vi.fn(function FeishuImClient() {
  return {
    replyTextMessage: replyTextMessageMock,
    replyInteractiveCard: replyInteractiveCardMock,
  }
}))
const getRepoRootMock = vi.hoisted(() => vi.fn())
const killMock = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('../../src/platform/config/loader.js', () => ({
  loadConfig: loadConfigMock,
}))

vi.mock('../../src/platform/integrations/im/runtime.js', () => ({
  createImRuntime: createImRuntimeMock,
  loadImServerStatus: loadImServerStatusMock,
  saveImServerStatus: saveImServerStatusMock,
}))

vi.mock('../../src/platform/integrations/im/feishu/server.js', () => ({
  createFeishuCallbackServer: createFeishuCallbackServerMock,
}))

vi.mock('../../src/platform/integrations/im/feishu/confirmation-bridge.js', () => ({
  handleConfirmationAction: handleConfirmationActionMock,
}))

vi.mock('../../src/platform/integrations/im/feishu/task-command.js', () => ({
  isFeishuTaskCommandText: isFeishuTaskCommandTextMock,
  isFeishuTaskFormText: isFeishuTaskFormTextMock,
  isFeishuTaskStatusText: isFeishuTaskStatusTextMock,
  parseFeishuTaskCommand: parseFeishuTaskCommandMock,
  parseFeishuTaskForm: parseFeishuTaskFormMock,
}))

vi.mock('../../src/platform/integrations/im/feishu/task-form.js', () => ({
  buildFeishuTaskFormCard: buildFeishuTaskFormCardMock,
}))

vi.mock('../../src/platform/integrations/im/feishu/task-launch.js', () => ({
  launchFeishuTask: launchFeishuTaskMock,
}))

vi.mock('../../src/platform/integrations/im/feishu/task-status.js', () => ({
  replyFeishuTaskStatusForThread: replyFeishuTaskStatusForThreadMock,
}))

vi.mock('../../src/platform/integrations/im/feishu/client.js', () => ({
  FeishuImClient: FeishuImClientMock,
}))

vi.mock('../../src/platform/paths.js', () => ({
  getRepoRoot: getRepoRootMock,
}))

describe('im-server command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hasProcessedEventMock.mockResolvedValue(false)
    markEventProcessedMock.mockResolvedValue(true)
    loadConfigMock.mockReturnValue({
      integrations: {
        im: {
          enabled: true,
          default_provider: 'feishu_main',
          providers: {
            feishu_main: {
              type: 'feishu-app',
              app_id: 'app-id',
              app_secret: 'app-secret',
              verification_token: 'verify-token',
              default_chat_id: 'oc_chat',
              approval_whitelist_open_ids: ['ou_operator'],
              callback_port: 9321,
              callback_path: '/callbacks/feishu',
            },
          },
        },
      },
    })
    getRepoRootMock.mockReturnValue(process.cwd())
    spawnMock.mockReturnValue({
      pid: 4242,
      unref: vi.fn(),
    })
    createFeishuCallbackServerMock.mockReturnValue({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => callback()),
      close: vi.fn((callback: () => void) => callback()),
    })
    isFeishuTaskCommandTextMock.mockImplementation((text: string) => text.startsWith('/magpie task'))
    isFeishuTaskFormTextMock.mockImplementation((text: string) => text.startsWith('/magpie form'))
    isFeishuTaskStatusTextMock.mockImplementation((text: string) => text.startsWith('/magpie status'))
    replyFeishuTaskStatusForThreadMock.mockResolvedValue(true)
    parseFeishuTaskCommandMock.mockReturnValue({
      entryMode: 'command',
      taskType: 'small',
      capability: 'loop',
      goal: 'Fix login timeout',
      prdPath: 'docs/plans/login-timeout.md',
    })
    parseFeishuTaskFormMock.mockReturnValue({
      entryMode: 'form',
      taskType: 'small',
      capability: 'loop',
      goal: 'Fix login timeout',
      prdPath: 'docs/plans/login-timeout.md',
    })
    launchFeishuTaskMock.mockResolvedValue({
      capability: 'loop',
      sessionId: 'loop-999',
      threadId: 'om_task_root',
      status: 'running',
    })
    vi.spyOn(process, 'kill').mockImplementation(killMock as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts the detached im server and saves server state', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { imServerCommand } = await import('../../src/cli/commands/im-server.js')

    await imServerCommand.parseAsync(
      ['node', 'im-server', 'start'],
      { from: 'node' }
    )

    expect(spawnMock).toHaveBeenCalled()
    expect(saveImServerStatusMock).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        providerId: 'feishu_main',
        status: 'running',
        processId: 4242,
      })
    )
    expect(logSpy).toHaveBeenCalledWith('IM server started (pid=4242).')
    logSpy.mockRestore()
  })

  it('blocks im server start when the im tool category is denied', async () => {
    loadConfigMock.mockReturnValue({
      capabilities: {
        safety: {
          permission_policy: {
            tool_categories: {
              im: 'deny',
            },
          },
        },
      },
      integrations: {
        im: {
          enabled: true,
          default_provider: 'feishu_main',
          providers: {
            feishu_main: {
              type: 'feishu-app',
              app_id: 'app-id',
              app_secret: 'app-secret',
              verification_token: 'verify-token',
              default_chat_id: 'oc_chat',
              approval_whitelist_open_ids: ['ou_operator'],
              callback_port: 9321,
              callback_path: '/callbacks/feishu',
            },
          },
        },
      },
    })
    const { imServerCommand } = await import('../../src/cli/commands/im-server.js')

    await expect(imServerCommand.parseAsync(
      ['node', 'im-server', 'start'],
      { from: 'node' }
    )).rejects.toThrow('Tool blocked by permission policy')
    expect(spawnMock).not.toHaveBeenCalled()
    expect(saveImServerStatusMock).not.toHaveBeenCalled()
  })

  it('prints stopped status when no server state exists', async () => {
    loadImServerStatusMock.mockResolvedValue(null)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { imServerCommand } = await import('../../src/cli/commands/im-server.js')

    await imServerCommand.parseAsync(
      ['node', 'im-server', 'status'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('IM server status: stopped')
    logSpy.mockRestore()
  })

  it('stops the running im server and marks it stopped', async () => {
    loadImServerStatusMock.mockResolvedValue({
      providerId: 'feishu_main',
      status: 'running',
      port: 9321,
      path: '/callbacks/feishu',
      processId: 4242,
      updatedAt: '2026-04-15T00:00:00.000Z',
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { imServerCommand } = await import('../../src/cli/commands/im-server.js')

    await imServerCommand.parseAsync(
      ['node', 'im-server', 'stop'],
      { from: 'node' }
    )

    expect(killMock).toHaveBeenCalledWith(4242)
    expect(saveImServerStatusMock).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        status: 'stopped',
      })
    )
    expect(logSpy).toHaveBeenCalledWith('IM server stopped.')
    logSpy.mockRestore()
  })

  it('prints full running status when the saved process is alive', async () => {
    loadImServerStatusMock.mockResolvedValue({
      providerId: 'feishu_main',
      status: 'running',
      port: 9321,
      path: '/callbacks/feishu',
      processId: 4242,
      updatedAt: '2026-04-15T00:00:00.000Z',
    })
    killMock.mockImplementation(() => undefined)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { imServerCommand } = await import('../../src/cli/commands/im-server.js')

    await imServerCommand.parseAsync(
      ['node', 'im-server', 'status'],
      { from: 'node' }
    )

    expect(logSpy.mock.calls).toEqual([
      ['IM server status: running'],
      ['Provider: feishu_main'],
      ['Port: 9321'],
      ['Path: /callbacks/feishu'],
      ['PID: 4242'],
    ])
    logSpy.mockRestore()
  })

  it('prints a friendly message when stop is requested without a pid', async () => {
    loadImServerStatusMock.mockResolvedValue({
      providerId: 'feishu_main',
      status: 'stopped',
      port: 9321,
      path: '/callbacks/feishu',
      updatedAt: '2026-04-15T00:00:00.000Z',
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { imServerCommand } = await import('../../src/cli/commands/im-server.js')

    await imServerCommand.parseAsync(
      ['node', 'im-server', 'stop'],
      { from: 'node' }
    )

    expect(saveImServerStatusMock).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('IM server is not running.')
    logSpy.mockRestore()
  })

  it('runs the foreground server loop and replies to confirmation callbacks', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'confirmation_action',
            eventId: 'evt-1',
            action: 'approve_confirmation',
            actorOpenId: 'ou_operator',
            sessionId: 'loop-123',
            confirmationId: 'confirm-1',
            threadKey: 'om_root',
            chatId: 'oc_chat',
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')

    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(hasProcessedEventMock).toHaveBeenCalledWith('evt-1')
    expect(markEventProcessedMock).toHaveBeenCalledWith('evt-1')
    expect(handleConfirmationActionMock).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        actorOpenId: 'ou_operator',
        action: 'approve_confirmation',
        whitelist: ['ou_operator'],
      })
    )
    expect(replyTextMessageMock).toHaveBeenCalledWith('om_root', 'Confirmation applied: approved.')
    expect(saveImServerStatusMock).toHaveBeenNthCalledWith(
      1,
      process.cwd(),
      expect.objectContaining({
        status: 'running',
        processId: process.pid,
      })
    )
    expect(saveImServerStatusMock).toHaveBeenNthCalledWith(
      2,
      process.cwd(),
      expect.objectContaining({
        status: 'stopped',
      })
    )
    expect(logSpy).toHaveBeenCalledWith('IM server listening on http://127.0.0.1:9321/callbacks/feishu')
    logSpy.mockRestore()
  })

  it('replies with the permission rejection reason for unauthorized confirmation actions', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)
    handleConfirmationActionMock.mockResolvedValueOnce({
      status: 'rejected',
      reason: 'Actor ou_guest is not allowed to approve confirmations.',
    })

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'confirmation_action',
            eventId: 'evt-denied-1',
            action: 'approve_confirmation',
            actorOpenId: 'ou_guest',
            sessionId: 'loop-123',
            confirmationId: 'confirm-1',
            threadKey: 'om_root',
            chatId: 'oc_chat',
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')

    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(replyTextMessageMock).toHaveBeenCalledWith(
      'om_root',
      'Confirmation rejected: Actor ou_guest is not allowed to approve confirmations.'
    )
    expect(markEventProcessedMock).toHaveBeenCalledWith('evt-denied-1')
    logSpy.mockRestore()
  })

  it('skips duplicate callbacks that were already processed', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)
    hasProcessedEventMock.mockResolvedValue(true)

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'confirmation_action',
            eventId: 'evt-1',
            action: 'approve_confirmation',
            actorOpenId: 'ou_operator',
            sessionId: 'loop-123',
            confirmationId: 'confirm-1',
            threadKey: 'om_root',
            chatId: 'oc_chat',
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')

    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(handleConfirmationActionMock).not.toHaveBeenCalled()
    expect(markEventProcessedMock).not.toHaveBeenCalled()
    expect(replyTextMessageMock).not.toHaveBeenCalled()
  })

  it('routes a task-command callback into the task launcher and replies in the task thread', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'task_command',
            eventId: 'evt-task-1',
            actorOpenId: 'ou_requester',
            sourceMessageId: 'om_source',
            threadKey: 'om_source',
            chatId: 'oc_chat',
            text: '/magpie task\ntype: small\ngoal: Fix login timeout\nprd: docs/plans/login-timeout.md',
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')
    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(parseFeishuTaskCommandMock).toHaveBeenCalledWith('/magpie task\ntype: small\ngoal: Fix login timeout\nprd: docs/plans/login-timeout.md')
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
    expect(markEventProcessedMock).toHaveBeenCalledWith('evt-task-1')
  })

  it('routes a thread status command into the task status responder', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'task_command',
            eventId: 'evt-status-1',
            actorOpenId: 'ou_requester',
            sourceMessageId: 'om_status_reply',
            threadKey: 'om_task_root',
            chatId: 'oc_chat',
            text: '/magpie status',
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')
    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(replyFeishuTaskStatusForThreadMock).toHaveBeenCalledWith(
      process.cwd(),
      expect.any(Object),
      'om_task_root'
    )
    expect(parseFeishuTaskCommandMock).not.toHaveBeenCalled()
    expect(launchFeishuTaskMock).not.toHaveBeenCalled()
    expect(markEventProcessedMock).toHaveBeenCalledWith('evt-status-1')
  })

  it('opens a task form card when the form command is received', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'task_command',
            eventId: 'evt-form-open-1',
            actorOpenId: 'ou_requester',
            sourceMessageId: 'om_source',
            threadKey: 'om_source',
            chatId: 'oc_chat',
            text: '/magpie form',
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')
    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(buildFeishuTaskFormCardMock).toHaveBeenCalled()
    expect(replyInteractiveCardMock).toHaveBeenCalledWith('om_source', { type: 'card' })
    expect(parseFeishuTaskCommandMock).not.toHaveBeenCalled()
    expect(launchFeishuTaskMock).not.toHaveBeenCalled()
    expect(markEventProcessedMock).toHaveBeenCalledWith('evt-form-open-1')
  })

  it('ignores plain text messages that are not magpie task commands', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'task_command',
            eventId: 'evt-chat-1',
            actorOpenId: 'ou_requester',
            sourceMessageId: 'om_source',
            threadKey: 'om_source',
            chatId: 'oc_chat',
            text: 'hello team',
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')
    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(parseFeishuTaskCommandMock).not.toHaveBeenCalled()
    expect(launchFeishuTaskMock).not.toHaveBeenCalled()
    expect(replyTextMessageMock).not.toHaveBeenCalled()
    expect(markEventProcessedMock).toHaveBeenCalledWith('evt-chat-1')
  })

  it('does not mark an event processed when task launch fails before completion', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)
    launchFeishuTaskMock.mockRejectedValue(new Error('unexpected launch failure'))

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'task_command',
            eventId: 'evt-task-fail-1',
            actorOpenId: 'ou_requester',
            sourceMessageId: 'om_source',
            threadKey: 'om_source',
            chatId: 'oc_chat',
            text: '/magpie task\ntype: small\ngoal: Fix login timeout\nprd: docs/plans/login-timeout.md',
          }).catch(() => {}))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')
    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(markEventProcessedMock).not.toHaveBeenCalledWith('evt-task-fail-1')
  })

  it('replies with a clear error when task launch is blocked by missing tmux support', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)
    launchFeishuTaskMock.mockRejectedValue(new Error('tmux host requested but no enabled tmux operations provider is configured'))

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'task_command',
            eventId: 'evt-task-blocked-1',
            actorOpenId: 'ou_requester',
            sourceMessageId: 'om_source',
            threadKey: 'om_source',
            chatId: 'oc_chat',
            text: '/magpie task\ntype: small\ngoal: Fix login timeout\nprd: docs/plans/login-timeout.md',
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')
    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(replyTextMessageMock).toHaveBeenCalledWith(
      'om_source',
      expect.stringContaining('Task rejected')
    )
    expect(markEventProcessedMock).toHaveBeenCalledWith('evt-task-blocked-1')
  })

  it('routes a task form submission into the task launcher and replies in the task thread', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)
    const parsedRequest = {
      entryMode: 'form',
      taskType: 'small',
      capability: 'loop',
      goal: 'Fix login timeout',
      prdPath: 'docs/plans/login-timeout.md',
    }
    parseFeishuTaskFormMock.mockReturnValue(parsedRequest)

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'task_form_submission',
            eventId: 'evt-form-submit-1',
            actorOpenId: 'ou_requester',
            threadKey: 'om_form_root',
            chatId: 'oc_chat',
            formValues: {
              taskType: 'small',
              goal: 'Fix login timeout',
              prdPath: 'docs/plans/login-timeout.md',
            },
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')
    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(parseFeishuTaskFormMock).toHaveBeenCalledWith({
      taskType: 'small',
      goal: 'Fix login timeout',
      prdPath: 'docs/plans/login-timeout.md',
    })
    expect(launchFeishuTaskMock).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        request: parsedRequest,
        chatId: 'oc_chat',
      })
    )
    expect(launchFeishuTaskMock.mock.calls[0][1].request).toBe(parsedRequest)
    expect(replyTextMessageMock).toHaveBeenCalledWith(
      'om_task_root',
      expect.stringContaining('Task accepted')
    )
    expect(markEventProcessedMock).toHaveBeenCalledWith('evt-form-submit-1')
  })

  it('skips duplicate task form submissions that were already processed', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)
    hasProcessedEventMock.mockResolvedValueOnce(true)

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'task_form_submission',
            eventId: 'evt-form-submit-dup-1',
            actorOpenId: 'ou_requester',
            threadKey: 'om_form_root',
            chatId: 'oc_chat',
            formValues: {
              taskType: 'small',
              goal: 'Fix login timeout',
              prdPath: 'docs/plans/login-timeout.md',
            },
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')
    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(hasProcessedEventMock).toHaveBeenCalledWith('evt-form-submit-dup-1')
    expect(parseFeishuTaskFormMock).not.toHaveBeenCalled()
    expect(launchFeishuTaskMock).not.toHaveBeenCalled()
    expect(replyTextMessageMock).not.toHaveBeenCalled()
    expect(markEventProcessedMock).not.toHaveBeenCalledWith('evt-form-submit-dup-1')
  })

  it('reuses the clear rejection path when task form submission cannot launch', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)
    launchFeishuTaskMock.mockRejectedValue(new Error('tmux host requested but no enabled tmux operations provider is configured'))

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'task_form_submission',
            eventId: 'evt-form-submit-blocked-1',
            actorOpenId: 'ou_requester',
            threadKey: 'om_form_root',
            chatId: 'oc_chat',
            formValues: {
              taskType: 'small',
              goal: 'Fix login timeout',
              prdPath: 'docs/plans/login-timeout.md',
            },
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')
    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(parseFeishuTaskFormMock).toHaveBeenCalledWith({
      taskType: 'small',
      goal: 'Fix login timeout',
      prdPath: 'docs/plans/login-timeout.md',
    })
    expect(launchFeishuTaskMock).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        request: expect.objectContaining({
          entryMode: 'form',
          taskType: 'small',
        }),
        chatId: 'oc_chat',
      })
    )
    expect(replyTextMessageMock).toHaveBeenCalledWith(
      'om_form_root',
      expect.stringContaining('Task rejected')
    )
    expect(markEventProcessedMock).toHaveBeenCalledWith('evt-form-submit-blocked-1')
  })

  it('rejects an invalid task form submission with a clear message', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)
    parseFeishuTaskFormMock.mockImplementation(() => {
      throw new Error('taskType is required')
    })

    createFeishuCallbackServerMock.mockImplementation(({ onEvent }) => ({
      once: vi.fn(),
      off: vi.fn(),
      listen: vi.fn((_port: number, callback: () => void) => {
        callback()
        void Promise.resolve()
          .then(() => onEvent({
            kind: 'task_form_submission',
            eventId: 'evt-form-submit-bad-1',
            actorOpenId: 'ou_requester',
            threadKey: 'om_form_root',
            chatId: 'oc_chat',
            formValues: {
              goal: 'Fix login timeout',
            },
          }))
          .then(() => signalHandlers.get('SIGTERM')?.())
      }),
      close: vi.fn((callback: () => void) => callback()),
    }))

    const { runImServerLoop } = await import('../../src/cli/commands/im-server.js')
    await runImServerLoop({
      cwd: process.cwd(),
    })

    expect(replyTextMessageMock).toHaveBeenCalledWith(
      'om_form_root',
      expect.stringContaining('Task rejected: taskType is required')
    )
    expect(launchFeishuTaskMock).not.toHaveBeenCalled()
    expect(markEventProcessedMock).toHaveBeenCalledWith('evt-form-submit-bad-1')
  })
})
