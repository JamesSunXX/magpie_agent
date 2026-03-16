import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraPlanningProvider } from '../../../src/platform/integrations/planning/providers/jira.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('JiraPlanningProvider', () => {
  it('fetches a prompt-ready issue context for planner input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      key: 'ENG-12',
      fields: {
        summary: 'Fix flaky planner sync',
        description: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'The planning sync loses item context during retries.' }],
            },
          ],
        },
        status: { name: 'In Progress' },
        issuetype: { name: 'Bug' },
        labels: ['planning', 'loop'],
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new JiraPlanningProvider('jira_main', {
      type: 'jira',
      base_url: 'https://example.atlassian.net',
      project_key: 'ENG',
      email: 'bot@example.com',
      api_token: 'jira-token',
    })

    const context = await provider.createPlanContext({
      itemKey: 'ENG-12',
      title: 'Loop planning refresh',
    })

    expect(context?.providerId).toBe('jira_main')
    expect(context?.itemKey).toBe('ENG-12')
    expect(context?.summary).toContain('Fix flaky planner sync')
    expect(context?.summary).toContain('The planning sync loses item context during retries.')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/rest/api/3/issue/ENG-12')
  })

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
