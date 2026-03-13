import { describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { executeDiscuss } from '../../../src/capabilities/discuss/application/execute.js'
import { runDiscussFlow } from '../../../src/capabilities/discuss/runtime/flow.js'

vi.mock('../../../src/capabilities/discuss/runtime/flow.js', () => ({
  runDiscussFlow: vi.fn(),
}))

describe('discuss capability execute', () => {
  it('runs discuss through the in-process discuss flow', async () => {
    vi.mocked(runDiscussFlow).mockResolvedValue({
      exitCode: 0,
      summary: 'discussion complete',
    })

    const result = await executeDiscuss({
      topic: 'Should we adopt a monorepo?',
      options: {
        rounds: '2',
        reviewers: 'claude',
      },
      preparedAt: new Date(),
      config: {
        providers: {},
        defaults: {},
        reviewers: {},
        summarizer: {},
        analyzer: {},
        capabilities: {},
        integrations: {},
      } as never,
    }, createCapabilityContext())

    expect(result.status).toBe('completed')
    expect(vi.mocked(runDiscussFlow)).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: process.cwd(),
        topic: 'Should we adopt a monorepo?',
        options: expect.objectContaining({
          rounds: '2',
          reviewers: 'claude',
        }),
      })
    )
  })
})
