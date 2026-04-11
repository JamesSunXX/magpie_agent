import { describe, expect, it, vi } from 'vitest'
import { OperationsRouter } from '../../../src/platform/integrations/operations/router.js'
import type { OperationsProvider } from '../../../src/platform/integrations/operations/types.js'

describe('OperationsRouter', () => {
  it('routes evidence collection to the configured default provider', async () => {
    const provider: OperationsProvider = {
      id: 'local_main',
      collectEvidence: vi.fn().mockResolvedValue({
        providerId: 'local_main',
        runs: [],
        summary: 'no runs',
      }),
    }

    const router = new OperationsRouter({
      enabled: true,
      defaultProvider: 'local_main',
      providers: {
        local_main: provider,
      },
    })

    await router.collectEvidence({
      cwd: process.cwd(),
      commands: ['node --version'],
    })

    expect(provider.collectEvidence).toHaveBeenCalledWith({
      cwd: process.cwd(),
      commands: ['node --version'],
    })
  })

  it('launches commands with a named provider when it supports detached execution', async () => {
    const provider: OperationsProvider = {
      id: 'tmux_main',
      collectEvidence: vi.fn().mockResolvedValue({
        providerId: 'tmux_main',
        runs: [],
        summary: 'no runs',
      }),
      launchCommand: vi.fn().mockResolvedValue({
        providerId: 'tmux_main',
        executionHost: 'tmux',
        sessionName: 'magpie-loop-1',
        windowId: '@1',
        paneId: '%1',
      }),
    }

    const router = new OperationsRouter({
      enabled: true,
      providers: {
        tmux_main: provider,
      },
    })

    const result = await router.launchCommand('tmux_main', {
      cwd: process.cwd(),
      command: 'node --version',
      sessionName: 'magpie-loop-1',
    })

    expect(provider.launchCommand).toHaveBeenCalledWith({
      cwd: process.cwd(),
      command: 'node --version',
      sessionName: 'magpie-loop-1',
    })
    expect(result.executionHost).toBe('tmux')
    expect(result.paneId).toBe('%1')
  })

  it('returns a disabled summary when operations integration is off', async () => {
    const router = new OperationsRouter({
      enabled: false,
      defaultProvider: 'local_main',
      providers: {},
    })

    await expect(router.collectEvidence({
      cwd: process.cwd(),
      commands: ['node --version'],
    })).resolves.toEqual({
      runs: [],
      summary: 'Operations integration disabled.',
    })
  })

  it('returns a provider-not-configured summary when the default provider is missing', async () => {
    const router = new OperationsRouter({
      enabled: true,
      defaultProvider: 'missing',
      providers: {},
    })

    await expect(router.collectEvidence({
      cwd: process.cwd(),
      commands: ['node --version'],
    })).resolves.toEqual({
      runs: [],
      summary: 'Operations provider not configured.',
    })
  })

  it('throws when launching with an unknown provider', async () => {
    const router = new OperationsRouter({
      enabled: true,
      providers: {},
    })

    await expect(router.launchCommand('missing', {
      cwd: process.cwd(),
      command: 'node --version',
      sessionName: 'missing',
    })).rejects.toThrow('Operations provider not configured: missing')
  })

  it('throws when launching with a provider that does not support detached execution', async () => {
    const provider: OperationsProvider = {
      id: 'local_main',
      collectEvidence: vi.fn().mockResolvedValue({
        providerId: 'local_main',
        runs: [],
        summary: 'no runs',
      }),
    }
    const router = new OperationsRouter({
      enabled: true,
      providers: {
        local_main: provider,
      },
    })

    await expect(router.launchCommand('local_main', {
      cwd: process.cwd(),
      command: 'node --version',
      sessionName: 'local-main',
    })).rejects.toThrow('Operations provider does not support detached launch: local_main')
  })
})
