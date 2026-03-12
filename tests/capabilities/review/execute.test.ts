import { describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { executeReview } from '../../../src/capabilities/review/application/execute.js'
import { runCapabilitySubprocess } from '../../../src/core/capability/subprocess.js'

vi.mock('../../../src/core/capability/subprocess.js', () => ({
  runCapabilitySubprocess: vi.fn(),
}))

describe('review capability execute', () => {
  it('runs review through the capability subprocess bridge', async () => {
    vi.mocked(runCapabilitySubprocess).mockResolvedValue({
      exitCode: 0,
      stdout: 'review complete',
      stderr: '',
    })

    const result = await executeReview({
      target: '123',
      options: {
        format: 'markdown',
        reviewers: 'claude',
      },
      preparedAt: new Date(),
    }, createCapabilityContext())

    expect(result.status).toBe('completed')
    expect(vi.mocked(runCapabilitySubprocess)).toHaveBeenCalledWith(
      'review',
      expect.arrayContaining(['123', '--format', 'markdown', '--reviewers', 'claude']),
      expect.any(Object)
    )
  })
})
