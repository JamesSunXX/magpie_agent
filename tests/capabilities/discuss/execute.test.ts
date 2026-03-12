import { describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { executeDiscuss } from '../../../src/capabilities/discuss/application/execute.js'
import { runCapabilitySubprocess } from '../../../src/core/capability/subprocess.js'

vi.mock('../../../src/core/capability/subprocess.js', () => ({
  runCapabilitySubprocess: vi.fn(),
}))

describe('discuss capability execute', () => {
  it('runs discuss through the capability subprocess bridge', async () => {
    vi.mocked(runCapabilitySubprocess).mockResolvedValue({
      exitCode: 0,
      stdout: 'discussion complete',
      stderr: '',
    })

    const result = await executeDiscuss({
      topic: 'Should we adopt a monorepo?',
      options: {
        rounds: '2',
        reviewers: 'claude',
      },
      preparedAt: new Date(),
    }, createCapabilityContext())

    expect(result.status).toBe('completed')
    expect(vi.mocked(runCapabilitySubprocess)).toHaveBeenCalledWith(
      'discuss',
      expect.arrayContaining(['Should we adopt a monorepo?', '--rounds', '2', '--reviewers', 'claude']),
      expect.any(Object)
    )
  })
})
