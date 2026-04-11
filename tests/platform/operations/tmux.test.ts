import { describe, expect, it, vi } from 'vitest'

const execFileSyncMock = vi.hoisted(() => vi.fn())

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  }
})

import { TmuxOperationsProvider } from '../../../src/platform/integrations/operations/providers/tmux.js'

describe('TmuxOperationsProvider', () => {
  it('collects evidence through the local commands fallback', async () => {
    execFileSyncMock.mockReturnValueOnce('v20.0.0\n')
    const provider = new TmuxOperationsProvider('tmux_main', {
      type: 'tmux',
      timeout_ms: 1000,
    })

    const result = await provider.collectEvidence({
      cwd: '/tmp/project',
      commands: ['node --version'],
    })

    expect(execFileSyncMock).toHaveBeenCalledWith('node', ['--version'], expect.objectContaining({
      cwd: '/tmp/project',
      timeout: 1000,
    }))
    expect(result.providerId).toBe('tmux_main')
    expect(result.runs[0]).toMatchObject({
      command: 'node --version',
      passed: true,
      output: 'v20.0.0\n',
    })
  })

  it('launches a detached tmux command and returns pane metadata', async () => {
    execFileSyncMock.mockReturnValue('magpie-loop-1\t@1\t%1\n')
    const provider = new TmuxOperationsProvider('tmux_main', {
      type: 'tmux',
      session_prefix: 'magpie',
    })

    const result = await provider.launchCommand({
      cwd: '/tmp/project',
      command: 'node dist/cli.js loop run Goal --prd /tmp/prd.md',
      sessionName: 'magpie-loop-1',
    })

    expect(execFileSyncMock).toHaveBeenCalledWith('tmux', expect.arrayContaining([
      'new-session',
      '-d',
      '-P',
      '-s',
      'magpie-loop-1',
      '-c',
      '/tmp/project',
    ]), expect.any(Object))
    expect(result.executionHost).toBe('tmux')
    expect(result.sessionName).toBe('magpie-loop-1')
    expect(result.windowId).toBe('@1')
    expect(result.paneId).toBe('%1')
  })

  it('applies the configured session prefix when the requested session name is bare', async () => {
    execFileSyncMock.mockReturnValue('magpie-loop-2\t@2\t%2\n')
    const provider = new TmuxOperationsProvider('tmux_main', {
      type: 'tmux',
      session_prefix: 'magpie',
    })

    const result = await provider.launchCommand({
      cwd: '/tmp/project',
      command: 'node dist/cli.js loop run Goal --prd /tmp/prd.md',
      sessionName: 'loop-2',
    })

    expect(execFileSyncMock).toHaveBeenCalledWith('tmux', expect.arrayContaining([
      '-s',
      'magpie-loop-2',
    ]), expect.any(Object))
    expect(result.sessionName).toBe('magpie-loop-2')
    expect(result.windowId).toBe('@2')
    expect(result.paneId).toBe('%2')
  })
})
