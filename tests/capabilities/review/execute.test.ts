import { describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { executeReview } from '../../../src/capabilities/review/application/execute.js'
import { runReviewFlow } from '../../../src/capabilities/review/runtime/flow.js'

vi.mock('../../../src/capabilities/review/runtime/flow.js', () => ({
  runReviewFlow: vi.fn(),
}))

describe('review capability execute', () => {
  it('runs review through the in-process review flow', async () => {
    vi.mocked(runReviewFlow).mockResolvedValue({
      exitCode: 0,
      summary: 'review complete',
    })

    const result = await executeReview({
      target: '123',
      options: {
        format: 'markdown',
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
    expect(vi.mocked(runReviewFlow)).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: process.cwd(),
        target: '123',
        options: expect.objectContaining({
          format: 'markdown',
          reviewers: 'claude',
        }),
      })
    )
  })
})
