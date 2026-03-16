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
})
