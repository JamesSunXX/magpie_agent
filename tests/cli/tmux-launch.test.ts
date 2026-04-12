import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const randomBytesMock = vi.hoisted(() => vi.fn(() => Buffer.from('01020304', 'hex')))
const loadConfigMock = vi.hoisted(() => vi.fn())
const createOperationsProvidersMock = vi.hoisted(() => vi.fn())
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>()
  return {
    ...actual,
    randomBytes: randomBytesMock,
  }
})

vi.mock('../../src/platform/config/loader.js', () => ({
  loadConfig: loadConfigMock,
}))

vi.mock('../../src/platform/integrations/operations/factory.js', () => ({
  createOperationsProviders: createOperationsProvidersMock,
}))

import { launchMagpieInTmux } from '../../src/cli/commands/tmux-launch.js'
import { TmuxOperationsProvider } from '../../src/platform/integrations/operations/providers/tmux.js'

describe('launchMagpieInTmux', () => {
  let homeDir: string
  let cwd: string
  let originalArgv: string[]
  let originalExecArgv: string[]

  beforeEach(() => {
    vi.clearAllMocks()
    homeDir = mkdtempSync(join(tmpdir(), 'magpie-home-'))
    cwd = mkdtempSync(join(tmpdir(), 'magpie-cwd-'))
    originalArgv = [...process.argv]
    originalExecArgv = [...process.execArgv]
    loadConfigMock.mockReturnValue({
      integrations: {
        operations: {
          enabled: true,
        },
      },
    })
  })

  it('uses the built CLI when present and patches loop session tmux metadata', async () => {
    process.argv = [process.execPath, join(process.cwd(), 'dist', 'cli.js')]
    process.execArgv = []

    mkdirSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304'), { recursive: true })
    writeFileSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304', 'session.json'), JSON.stringify({
      artifacts: {
        existing: 'yes',
      },
    }, null, 2), 'utf-8')

    const provider = new TmuxOperationsProvider('tmux_main', { type: 'tmux', session_prefix: 'magpie' })
    const launchSpy = vi.spyOn(provider, 'launchCommand').mockResolvedValue({
      providerId: 'tmux_main',
      executionHost: 'tmux',
      sessionName: 'magpie-loop-01020304',
      windowId: '@1',
      paneId: '%1',
    })
    createOperationsProvidersMock.mockReturnValue({ tmux_main: provider })

    const result = await launchMagpieInTmux({
      capability: 'loop',
      cwd,
      argv: ['loop', 'run', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
    })

    expect(result).toEqual({
      sessionId: 'loop-01020304',
      tmuxSession: 'magpie-loop-01020304',
      tmuxWindow: '@1',
      tmuxPane: '%1',
    })
    expect(launchSpy).toHaveBeenCalledWith(expect.objectContaining({
      cwd,
      sessionName: 'magpie-loop-01020304',
      command: expect.stringContaining(`${process.execPath}`),
    }))
    expect(launchSpy.mock.calls[0]?.[0].command).toMatch(new RegExp(`${process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(dist/cli\\.js|src/cli\\.ts)`))
    expect(launchSpy.mock.calls[0]?.[0].command).not.toContain(join(cwd, 'dist', 'cli.js'))
    expect(launchSpy.mock.calls[0]?.[0].command).toContain("MAGPIE_SESSION_ID='loop-01020304'")
    expect(launchSpy.mock.calls[0]?.[0].command).toContain("MAGPIE_EXECUTION_HOST='tmux'")

    const patched = JSON.parse(readFileSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304', 'session.json'), 'utf-8')) as {
      artifacts: Record<string, string>
    }
    expect(patched.artifacts).toMatchObject({
      existing: 'yes',
      executionHost: 'tmux',
      tmuxSession: 'magpie-loop-01020304',
      tmuxWindow: '@1',
      tmuxPane: '%1',
    })
  })

  it('uses the source CLI when the current process is running in dev mode', async () => {
    process.argv = [process.execPath, join(process.cwd(), 'src', 'cli.ts')]
    process.execArgv = ['--import', 'tsx']

    mkdirSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304'), { recursive: true })
    writeFileSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304', 'session.json'), JSON.stringify({
      artifacts: {},
    }, null, 2), 'utf-8')

    const provider = new TmuxOperationsProvider('tmux_main', { type: 'tmux', session_prefix: 'magpie' })
    const launchSpy = vi.spyOn(provider, 'launchCommand').mockResolvedValue({
      providerId: 'tmux_main',
      executionHost: 'tmux',
      sessionName: 'magpie-loop-01020304',
      windowId: '@1',
      paneId: '%1',
    })
    createOperationsProvidersMock.mockReturnValue({ tmux_main: provider })

    await launchMagpieInTmux({
      capability: 'loop',
      cwd,
      argv: ['loop', 'run', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
    })

    expect(launchSpy.mock.calls[0]?.[0].command).toContain(join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs'))
    expect(launchSpy.mock.calls[0]?.[0].command).toContain(join(process.cwd(), 'src', 'cli.ts'))
    expect(launchSpy.mock.calls[0]?.[0].command).not.toContain(join(process.cwd(), 'dist', 'cli.js'))
  })

  it('keeps using the tsx loader when other imports appear first', async () => {
    process.argv = [process.execPath, join(process.cwd(), 'src', 'cli.ts')]
    process.execArgv = [
      '--import',
      'data:text/javascript,globalThis.extraImport=true',
      '--import',
      'tsx',
    ]

    mkdirSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304'), { recursive: true })
    writeFileSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304', 'session.json'), JSON.stringify({
      artifacts: {},
    }, null, 2), 'utf-8')

    const provider = new TmuxOperationsProvider('tmux_main', { type: 'tmux', session_prefix: 'magpie' })
    const launchSpy = vi.spyOn(provider, 'launchCommand').mockResolvedValue({
      providerId: 'tmux_main',
      executionHost: 'tmux',
      sessionName: 'magpie-loop-01020304',
      windowId: '@1',
      paneId: '%1',
    })
    createOperationsProvidersMock.mockReturnValue({ tmux_main: provider })

    await launchMagpieInTmux({
      capability: 'loop',
      cwd,
      argv: ['loop', 'run', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
    })

    expect(launchSpy.mock.calls[0]?.[0].command).toContain(join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs'))
    expect(launchSpy.mock.calls[0]?.[0].command).not.toContain('data:text/javascript,globalThis.extraImport=true')
  })

  it('prefers the configured default tmux provider when multiple are enabled', async () => {
    mkdirSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304'), { recursive: true })
    writeFileSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304', 'session.json'), JSON.stringify({
      artifacts: {},
    }, null, 2), 'utf-8')

    const primary = new TmuxOperationsProvider('tmux_main', { type: 'tmux', session_prefix: 'magpie' })
    const secondary = new TmuxOperationsProvider('tmux_secondary', { type: 'tmux', session_prefix: 'magpie' })
    const primarySpy = vi.spyOn(primary, 'launchCommand').mockResolvedValue({
      providerId: 'tmux_main',
      executionHost: 'tmux',
      sessionName: 'magpie-loop-01020304-main',
    })
    const secondarySpy = vi.spyOn(secondary, 'launchCommand').mockResolvedValue({
      providerId: 'tmux_secondary',
      executionHost: 'tmux',
      sessionName: 'magpie-loop-01020304-secondary',
    })
    loadConfigMock.mockReturnValue({
      integrations: {
        operations: {
          enabled: true,
          default_provider: 'tmux_secondary',
        },
      },
    })
    createOperationsProvidersMock.mockReturnValue({
      tmux_main: primary,
      tmux_secondary: secondary,
    })

    const result = await launchMagpieInTmux({
      capability: 'loop',
      cwd,
      argv: ['loop', 'run', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
    })

    expect(primarySpy).not.toHaveBeenCalled()
    expect(secondarySpy).toHaveBeenCalled()
    expect(result.tmuxSession).toBe('magpie-loop-01020304-secondary')
  })

  it('patches harness session metadata after tmux launch', async () => {
    mkdirSync(join(cwd, '.magpie', 'sessions', 'harness', 'harness-01020304'), { recursive: true })
    writeFileSync(join(cwd, '.magpie', 'sessions', 'harness', 'harness-01020304', 'session.json'), JSON.stringify({
      artifacts: {},
    }, null, 2), 'utf-8')

    const provider = new TmuxOperationsProvider('tmux_main', { type: 'tmux' })
    const launchSpy = vi.spyOn(provider, 'launchCommand').mockResolvedValue({
      providerId: 'tmux_main',
      executionHost: 'tmux',
      sessionName: 'magpie-harness-01020304',
    })
    createOperationsProvidersMock.mockReturnValue({ tmux_main: provider })

    const result = await launchMagpieInTmux({
      capability: 'harness',
      cwd,
      configPath: '/tmp/config.yaml',
      argv: ['harness', 'submit', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
    })

    expect(result).toEqual({
      sessionId: 'harness-01020304',
      tmuxSession: 'magpie-harness-01020304',
      tmuxWindow: undefined,
      tmuxPane: undefined,
    })
    expect(loadConfigMock).toHaveBeenCalledWith('/tmp/config.yaml')
    expect(launchSpy.mock.calls[0]?.[0].command).toMatch(new RegExp(`${process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(dist/cli\\.js|src/cli\\.ts)`))

    const patched = JSON.parse(readFileSync(join(cwd, '.magpie', 'sessions', 'harness', 'harness-01020304', 'session.json'), 'utf-8')) as {
      artifacts: Record<string, string>
    }
    expect(patched.artifacts).toMatchObject({
      executionHost: 'tmux',
      tmuxSession: 'magpie-harness-01020304',
    })
    expect(patched.artifacts.tmuxWindow).toBeUndefined()
    expect(patched.artifacts.tmuxPane).toBeUndefined()
  })

  it('keeps polling until a delayed loop session file appears', async () => {
    vi.useFakeTimers()

    const provider = new TmuxOperationsProvider('tmux_main', { type: 'tmux', session_prefix: 'magpie' })
    vi.spyOn(provider, 'launchCommand').mockResolvedValue({
      providerId: 'tmux_main',
      executionHost: 'tmux',
      sessionName: 'magpie-loop-01020304',
      windowId: '@9',
      paneId: '%9',
    })
    createOperationsProvidersMock.mockReturnValue({ tmux_main: provider })

    const launchPromise = launchMagpieInTmux({
      capability: 'loop',
      cwd,
      argv: ['loop', 'run', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
    })

    setTimeout(() => {
      mkdirSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304'), { recursive: true })
      writeFileSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304', 'session.json'), JSON.stringify({
        artifacts: {
          existing: 'late',
        },
      }, null, 2), 'utf-8')
    }, 3500)

    await vi.advanceTimersByTimeAsync(3600)
    const result = await launchPromise

    expect(result.tmuxWindow).toBe('@9')
    const patched = JSON.parse(readFileSync(join(cwd, '.magpie', 'sessions', 'loop', 'loop-01020304', 'session.json'), 'utf-8')) as {
      artifacts: Record<string, string>
    }
    expect(patched.artifacts).toMatchObject({
      existing: 'late',
      executionHost: 'tmux',
      tmuxSession: 'magpie-loop-01020304',
      tmuxWindow: '@9',
      tmuxPane: '%9',
    })

    vi.useRealTimers()
  })

  it('fails fast when no enabled tmux provider is configured', async () => {
    createOperationsProvidersMock.mockReturnValue({})

    await expect(launchMagpieInTmux({
      capability: 'loop',
      cwd,
      argv: ['loop', 'run', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
    })).rejects.toThrow('tmux host requested but no enabled tmux operations provider is configured')
  })

  afterEach(() => {
    vi.useRealTimers()
    process.argv = originalArgv
    process.execArgv = originalExecArgv
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })
})
