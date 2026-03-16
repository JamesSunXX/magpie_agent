import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeishuProjectPlanningProvider } from '../../../src/platform/integrations/planning/providers/feishu-project.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FeishuProjectPlanningProvider', () => {
  it('fetches a prompt-ready item context for planner input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        item: {
          item_key: 'TASK-12',
          title: 'Stabilize loop planning sync',
          status: 'In Progress',
          fields: {
            description: 'Loop planning should include the linked project item context.',
            owner: 'bot',
          },
        },
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new FeishuProjectPlanningProvider('feishu_main', {
      type: 'feishu-project',
      base_url: 'https://project.feishu.cn',
      project_key: 'checkout',
      app_id: 'app-id',
      app_secret: 'app-secret',
    })

    const context = await provider.createPlanContext({
      itemKey: 'TASK-12',
      title: 'Loop planning refresh',
    })

    expect(context?.providerId).toBe('feishu_main')
    expect(context?.itemKey).toBe('TASK-12')
    expect(context?.summary).toContain('Stabilize loop planning sync')
    expect(context?.summary).toContain('Loop planning should include the linked project item context.')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/open_api/project/checkout/items/TASK-12')
  })

  it('posts plan artifacts to the configured Feishu project item endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new FeishuProjectPlanningProvider('feishu_main', {
      type: 'feishu-project',
      base_url: 'https://project.feishu.cn',
      project_key: 'checkout',
      app_id: 'app-id',
      app_secret: 'app-secret',
    })

    const result = await provider.syncPlanArtifact({
      itemKey: 'TASK-12',
      title: 'Execution Plan',
      body: '# plan',
    })

    expect(result.synced).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/open_api/project/checkout/items/TASK-12/comments')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(expect.objectContaining({
      'X-App-Id': 'app-id',
      'X-App-Secret': 'app-secret',
    }))
  })
})
