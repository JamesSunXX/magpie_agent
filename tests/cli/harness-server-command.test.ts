import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatExpectedLocalDateTime } from '../helpers/local-time.js'

const loadHarnessServerState = vi.fn()
const runHarnessServerLoop = vi.fn()
const stopHarnessServer = vi.fn()
const summarizeHarnessServer = vi.fn()
const launchHarnessServerInTmux = vi.fn()

vi.mock('../../src/capabilities/workflows/harness-server/runtime.js', () => ({
  loadHarnessServerState,
  runHarnessServerLoop,
  stopHarnessServer,
  summarizeHarnessServer,
  launchHarnessServerInTmux,
}))

describe('harness-server CLI command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
    summarizeHarnessServer.mockResolvedValue({
      state: null,
      queue: {
        queued: 0,
        running: 0,
        waitingRetry: 0,
        waitingNextCycle: 0,
        blocked: 0,
      },
    })
    stopHarnessServer.mockResolvedValue(false)
    runHarnessServerLoop.mockResolvedValue(undefined)
    launchHarnessServerInTmux.mockResolvedValue({
      tmuxSession: 'magpie-harness-server',
    })
  })

  it('starts the server in foreground when requested', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { harnessServerCommand } = await import('../../src/cli/commands/harness-server.js')

    await harnessServerCommand.parseAsync(
      ['node', 'harness-server', 'start', '--foreground'],
      { from: 'node' }
    )

    expect(runHarnessServerLoop).toHaveBeenCalledWith(expect.objectContaining({
      cwd: process.cwd(),
    }))
    expect(logSpy).toHaveBeenCalledWith('Harness server started in foreground mode.')
    logSpy.mockRestore()
  })

  it('starts the server in tmux by default', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { harnessServerCommand } = await import('../../src/cli/commands/harness-server.js')

    await harnessServerCommand.parseAsync(
      ['node', 'harness-server', 'start'],
      { from: 'node' }
    )

    expect(launchHarnessServerInTmux).toHaveBeenCalledWith({
      cwd: process.cwd(),
      configPath: undefined,
    })
    expect(logSpy).toHaveBeenCalledWith('Harness server started.')
    expect(logSpy).toHaveBeenCalledWith('Host: tmux')
    expect(logSpy).toHaveBeenCalledWith('Tmux: magpie-harness-server')
    logSpy.mockRestore()
  })

  it('prints queue-aware server status', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    summarizeHarnessServer.mockResolvedValue({
      state: {
        serverId: 'server-1',
        status: 'running',
        executionHost: 'tmux',
        tmuxSession: 'magpie-harness-server',
        updatedAt: '2026-04-12T00:00:00.000Z',
      },
      queue: {
        queued: 2,
        running: 1,
        waitingRetry: 1,
        waitingNextCycle: 1,
        blocked: 0,
      },
    })

    const { harnessServerCommand } = await import('../../src/cli/commands/harness-server.js')
    await harnessServerCommand.parseAsync(
      ['node', 'harness-server', 'status'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('Status: running')
    expect(logSpy).toHaveBeenCalledWith('Host: tmux')
    expect(logSpy).toHaveBeenCalledWith('Tmux: magpie-harness-server')
    expect(logSpy).toHaveBeenCalledWith(`Updated: ${formatExpectedLocalDateTime('2026-04-12T00:00:00.000Z')}`)
    expect(logSpy).toHaveBeenCalledWith('Queue: queued=2 running=1 waiting_retry=1 waiting_next_cycle=1 blocked=0')
    logSpy.mockRestore()
  })

  it('prints stopped status when no background server exists', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { harnessServerCommand } = await import('../../src/cli/commands/harness-server.js')

    await harnessServerCommand.parseAsync(
      ['node', 'harness-server', 'status'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('Status: stopped')
    expect(logSpy).toHaveBeenCalledWith('Queue: queued=0 running=0 waiting_retry=0 waiting_next_cycle=0 blocked=0')
    logSpy.mockRestore()
  })

  it('stops the running server', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    stopHarnessServer.mockResolvedValue(true)

    const { harnessServerCommand } = await import('../../src/cli/commands/harness-server.js')
    await harnessServerCommand.parseAsync(
      ['node', 'harness-server', 'stop'],
      { from: 'node' }
    )

    expect(stopHarnessServer).toHaveBeenCalledWith(process.cwd())
    expect(logSpy).toHaveBeenCalledWith('Harness server stopped.')
    logSpy.mockRestore()
  })

  it('reports when there is no running server to stop', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { harnessServerCommand } = await import('../../src/cli/commands/harness-server.js')

    await harnessServerCommand.parseAsync(
      ['node', 'harness-server', 'stop'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('Harness server is not running.')
    logSpy.mockRestore()
  })

  it('surfaces startup failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    launchHarnessServerInTmux.mockRejectedValue(new Error('tmux unavailable'))
    const { harnessServerCommand } = await import('../../src/cli/commands/harness-server.js')

    await harnessServerCommand.parseAsync(
      ['node', 'harness-server', 'start'],
      { from: 'node' }
    )

    expect(errorSpy).toHaveBeenCalledWith('harness-server start failed: tmux unavailable')
    expect(process.exitCode).toBe(1)
    errorSpy.mockRestore()
  })
})
