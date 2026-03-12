import { describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { executeTrd } from '../../../src/capabilities/trd/application/execute.js'
import { runTrdFlow } from '../../../src/commands/trd.js'

vi.mock('../../../src/commands/trd.js', () => ({
  runTrdFlow: vi.fn(),
}))

describe('trd capability execute', () => {
  it('runs trd through the in-process trd flow', async () => {
    vi.mocked(runTrdFlow).mockResolvedValue({
      exitCode: 0,
      summary: 'trd complete',
    })

    const result = await executeTrd({
      prdPath: '/tmp/sample-prd.md',
      options: {
        reviewers: 'claude',
        autoAcceptDomains: true,
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
    expect(vi.mocked(runTrdFlow)).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: process.cwd(),
        prdPath: '/tmp/sample-prd.md',
        options: expect.objectContaining({
          reviewers: 'claude',
          autoAcceptDomains: true,
        }),
      })
    )
  })
})
