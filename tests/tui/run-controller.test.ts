import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseRunOutputLine, startCommandRun } from '../../src/tui/run-controller.js'
import type { BuiltCommand } from '../../src/tui/types.js'

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
}

describe('run controller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses session and artifact lines', () => {
    expect(parseRunOutputLine('Session: loop-1234')).toEqual({ type: 'session', key: 'id', value: 'loop-1234' })
    expect(parseRunOutputLine('Plan: /tmp/plan.md')).toEqual({ type: 'artifact', key: 'plan', value: '/tmp/plan.md' })
    expect(parseRunOutputLine('Human confirmation file: /tmp/human_confirmation.md')).toEqual({
      type: 'artifact',
      key: 'humanConfirmation',
      value: '/tmp/human_confirmation.md',
    })
  })

  it('spawns the current CLI entrypoint and streams logs into run state', () => {
    const child = new FakeChildProcess()
    const spawn = vi.fn(() => child)
    const states: Array<{ status: string; logs: string[]; sessionId?: string; artifacts: Record<string, string>; exitCode?: number }> = []
    const command: BuiltCommand = {
      argv: ['loop', 'run', 'Goal', '--prd', '/tmp/prd.md'],
      display: 'magpie loop run Goal --prd /tmp/prd.md',
      summary: 'Run a loop',
    }

    startCommandRun(
      command,
      {
        cwd: '/repo',
        cliArgv0: '/repo/src/cli.ts',
        execArgv: ['--loader', 'tsx'],
        execPath: '/usr/local/bin/node',
      },
      {
        onUpdate: (state) => {
          states.push({
            status: state.status,
            logs: [...state.logs],
            sessionId: state.sessionId,
            artifacts: { ...state.artifacts },
            exitCode: state.exitCode,
          })
        },
      },
      { spawn }
    )

    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/node',
      ['--loader', 'tsx', '/repo/src/cli.ts', 'loop', 'run', 'Goal', '--prd', '/tmp/prd.md'],
      expect.objectContaining({
        cwd: '/repo',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    )

    child.stdout.emit('data', Buffer.from('Session: loop-1234\nPlan: /tmp/plan.md\n'))
    child.stderr.emit('data', Buffer.from('warn line\n'))
    child.emit('close', 0)

    expect(states.at(-1)).toMatchObject({
      status: 'completed',
      sessionId: 'loop-1234',
      artifacts: {
        plan: '/tmp/plan.md',
      },
      exitCode: 0,
    })
    expect(states.some((state) => state.logs.includes('warn line\n'))).toBe(true)
  })

  it('appends --config to spawned args when configPath is provided', () => {
    const child = new FakeChildProcess()
    const spawn = vi.fn(() => child)
    const command: BuiltCommand = {
      argv: ['review', '--local'],
      display: 'magpie review --local',
      summary: 'Review local changes',
    }

    startCommandRun(
      command,
      {
        cwd: '/repo',
        cliArgv0: '/repo/src/cli.ts',
        configPath: '/tmp/alt.yaml',
        execArgv: [],
        execPath: '/usr/local/bin/node',
      },
      undefined,
      { spawn }
    )

    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/node',
      ['/repo/src/cli.ts', 'review', '--local', '--config', '/tmp/alt.yaml'],
      expect.objectContaining({ cwd: '/repo' })
    )
  })

  it('uses empty execArgv array without falling back to process.execArgv', () => {
    const child = new FakeChildProcess()
    const spawn = vi.fn(() => child)
    const command: BuiltCommand = {
      argv: ['review', '--local'],
      display: 'magpie review --local',
      summary: 'Review local changes',
    }

    startCommandRun(
      command,
      {
        cwd: '/repo',
        cliArgv0: '/repo/dist/cli.js',
        execArgv: [],
        execPath: '/usr/local/bin/node',
      },
      undefined,
      { spawn }
    )

    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/node',
      ['/repo/dist/cli.js', 'review', '--local'],
      expect.objectContaining({ cwd: '/repo' })
    )
  })

  it('marks non-zero exits as failed', () => {
    const child = new FakeChildProcess()
    const spawn = vi.fn(() => child)
    const command: BuiltCommand = {
      argv: ['review', '--local'],
      display: 'magpie review --local',
      summary: 'Review local changes',
    }
    let finalState: { status: string; exitCode?: number } | undefined

    startCommandRun(
      command,
      {
        cwd: '/repo',
        cliArgv0: '/repo/dist/cli.js',
        execArgv: [],
        execPath: '/usr/local/bin/node',
      },
      {
        onUpdate: (state) => {
          finalState = {
            status: state.status,
            exitCode: state.exitCode,
          }
        },
      },
      { spawn }
    )

    child.emit('close', 2)

    expect(finalState).toEqual({
      status: 'failed',
      exitCode: 2,
    })
  })
})
