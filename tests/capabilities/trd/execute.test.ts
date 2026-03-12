import { describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { executeTrd } from '../../../src/capabilities/trd/application/execute.js'
import { runCapabilitySubprocess } from '../../../src/core/capability/subprocess.js'

vi.mock('../../../src/core/capability/subprocess.js', () => ({
  runCapabilitySubprocess: vi.fn(),
}))

describe('trd capability execute', () => {
  it('runs trd through the capability subprocess bridge', async () => {
    vi.mocked(runCapabilitySubprocess).mockResolvedValue({
      exitCode: 0,
      stdout: 'trd complete',
      stderr: '',
    })

    const result = await executeTrd({
      prdPath: '/tmp/sample-prd.md',
      options: {
        reviewers: 'claude',
        autoAcceptDomains: true,
      },
      preparedAt: new Date(),
    }, createCapabilityContext())

    expect(result.status).toBe('completed')
    expect(vi.mocked(runCapabilitySubprocess)).toHaveBeenCalledWith(
      'trd',
      expect.arrayContaining(['/tmp/sample-prd.md', '--reviewers', 'claude', '--auto-accept-domains']),
      expect.any(Object)
    )
  })
})
