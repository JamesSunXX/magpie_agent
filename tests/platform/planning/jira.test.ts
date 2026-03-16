import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraPlanningProvider } from '../../../src/platform/integrations/planning/providers/jira.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('JiraPlanningProvider', () => {
  it('posts plan artifacts as Jira issue comments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '10000' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new JiraPlanningProvider('jira_main', {
      type: 'jira',
      base_url: 'https://example.atlassian.net',
      project_key: 'ENG',
      email: 'bot@example.com',
      api_token: 'jira-token',
    })

    const result = await provider.syncPlanArtifact({
      itemKey: 'ENG-12',
      body: '# plan',
    })

    expect(result.synced).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/rest/api/3/issue/ENG-12/comment')
    expect(String(fetchMock.mock.calls[0]?.[1]?.headers?.Authorization)).toContain('Basic ')
  })
})
