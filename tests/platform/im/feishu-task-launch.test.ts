import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendRootTextMessageMock = vi.hoisted(() => vi.fn())
const isHarnessServerRunningMock = vi.hoisted(() => vi.fn())
const enqueueHarnessSessionMock = vi.hoisted(() => vi.fn())
const launchMagpieInTmuxMock = vi.hoisted(() => vi.fn())
const canLaunchMagpieInTmuxMock = vi.hoisted(() => vi.fn())

vi.mock('../../../src/platform/integrations/im/feishu/client.js', () => ({
  FeishuImClient: vi.fn(function FeishuImClient() {
    return {
      sendRootTextMessage: sendRootTextMessageMock,
    }
  }),
}))

vi.mock('../../../src/capabilities/workflows/harness-server/runtime.js', () => ({
  isHarnessServerRunning: isHarnessServerRunningMock,
  enqueueHarnessSession: enqueueHarnessSessionMock,
}))

vi.mock('../../../src/cli/commands/tmux-launch.js', () => ({
  launchMagpieInTmux: launchMagpieInTmuxMock,
  canLaunchMagpieInTmux: canLaunchMagpieInTmuxMock,
}))

describe('launchFeishuTask', () => {
  const dirs: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    sendRootTextMessageMock.mockResolvedValue({ messageId: 'om_task_root' })
    isHarnessServerRunningMock.mockResolvedValue(false)
    canLaunchMagpieInTmuxMock.mockReturnValue(true)
    launchMagpieInTmuxMock.mockResolvedValue({
      sessionId: 'loop-1234',
      tmuxSession: 'magpie-loop-1234',
      tmuxWindow: '@1',
      tmuxPane: '%1',
    })
    enqueueHarnessSessionMock.mockResolvedValue({
      id: 'harness-queued-1',
      status: 'queued',
    })
  })

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('launches a loop task in tmux and binds a Feishu thread', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-feishu-launch-'))
    dirs.push(cwd)

    const { launchFeishuTask } = await import('../../../src/platform/integrations/im/feishu/task-launch.js')
    const { loadThreadMappingBySession } = await import('../../../src/platform/integrations/im/thread-mapping.js')

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
    expect(launchMagpieInTmuxMock).toHaveBeenCalledWith({
      capability: 'loop',
      cwd,
      configPath: undefined,
      argv: [
        'loop',
        'run',
        'Fix login timeout',
        '--prd',
        'docs/plans/login-timeout.md',
        '--host',
        'foreground',
        '--no-wait-human',
      ],
    })

    expect(await loadThreadMappingBySession(cwd, 'loop', 'loop-1234')).toEqual(
      expect.objectContaining({
        threadId: 'om_task_root',
        rootMessageId: 'om_task_root',
        chatId: 'oc_chat',
        capability: 'loop',
        sessionId: 'loop-1234',
        status: 'running',
      })
    )
  })

  it('queues a harness task when harness-server is running', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-feishu-launch-'))
    dirs.push(cwd)
    isHarnessServerRunningMock.mockResolvedValue(true)

    const { launchFeishuTask } = await import('../../../src/platform/integrations/im/feishu/task-launch.js')
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
    expect(enqueueHarnessSessionMock).toHaveBeenCalledWith(
      cwd,
      expect.objectContaining({
        goal: 'Deliver payment retry flow',
        prdPath: 'docs/plans/payment-retry.md',
        priority: 'high',
      }),
      expect.any(Object)
    )
  })

  it('fails before sending a thread when tmux launch is unavailable', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-feishu-launch-'))
    dirs.push(cwd)
    canLaunchMagpieInTmuxMock.mockReturnValue(false)

    const { launchFeishuTask } = await import('../../../src/platform/integrations/im/feishu/task-launch.js')

    await expect(launchFeishuTask(cwd, {
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
    })).rejects.toThrow('tmux host requested but no enabled tmux operations provider is configured')

    expect(sendRootTextMessageMock).not.toHaveBeenCalled()
    expect(launchMagpieInTmuxMock).not.toHaveBeenCalled()
  })
})
