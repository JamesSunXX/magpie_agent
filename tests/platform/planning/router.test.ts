import { describe, expect, it, vi } from 'vitest'
import { PlanningRouter } from '../../../src/platform/integrations/planning/router.js'
import type { PlanningProvider } from '../../../src/platform/integrations/planning/types.js'

describe('PlanningRouter', () => {
  it('routes planning requests to the configured default provider', async () => {
    const provider: PlanningProvider = {
      id: 'jira_main',
      createPlanContext: vi.fn().mockResolvedValue({
        providerId: 'jira_main',
        projectKey: 'ENG',
        itemKey: 'ENG-12',
      }),
      syncPlanArtifact: vi.fn().mockResolvedValue({
        providerId: 'jira_main',
        synced: true,
      }),
    }

    const router = new PlanningRouter({
      enabled: true,
      defaultProvider: 'jira_main',
      providers: {
        jira_main: provider,
      },
    })

    await router.createPlanContext({
      projectKey: 'ENG',
      itemKey: 'ENG-12',
    })

    expect(provider.createPlanContext).toHaveBeenCalledWith({
      projectKey: 'ENG',
      itemKey: 'ENG-12',
    })
  })

  it('returns a skipped sync result when disabled', async () => {
    const router = new PlanningRouter({
      enabled: false,
      defaultProvider: 'jira_main',
      providers: {},
    })

    const result = await router.syncPlanArtifact({
      projectKey: 'ENG',
      itemKey: 'ENG-12',
      body: '# plan',
    })

    expect(result.synced).toBe(false)
  })
})
