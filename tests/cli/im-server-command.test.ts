import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
const loadConfigMock = vi.hoisted(() => vi.fn())
const loadImServerStatusMock = vi.hoisted(() => vi.fn())
const saveImServerStatusMock = vi.hoisted(() => vi.fn())
const markEventProcessedMock = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const createImRuntimeMock = vi.hoisted(() => vi.fn(() => ({
  markEventProcessed: markEventProcessedMock,
})))
const createFeishuCallbackServerMock = vi.hoisted(() => vi.fn())
const handleConfirmationActionMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  status: 'applied',
  decision: 'approved',
}))
const replyTextMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue({ messageId: 'reply-1' }))
const FeishuImClientMock = vi.hoisted(() => vi.fn(function FeishuImClient() {
  return {
    replyTextMessage: replyTextMessageMock,
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

vi.mock('../../src/platform/integrations/im/feishu/client.js', () => ({
  FeishuImClient: FeishuImClientMock,
}))

vi.mock('../../src/platform/paths.js', () => ({
  getRepoRoot: getRepoRootMock,
}))

describe('im-server command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('skips duplicate callbacks that were already processed', async () => {
    const onceSpy = vi.spyOn(process, 'once')
    const signalHandlers = new Map<string, () => void>()
    onceSpy.mockImplementation(((event: NodeJS.Signals, handler: () => void) => {
      signalHandlers.set(event, handler)
      return process
    }) as typeof process.once)
    markEventProcessedMock.mockResolvedValue(false)

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
    expect(replyTextMessageMock).not.toHaveBeenCalled()
  })
})
