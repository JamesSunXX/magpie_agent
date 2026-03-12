import { describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { prepareDiscussInput } from '../../../src/capabilities/discuss/application/prepare.js'
import { loadConfigV2 } from '../../../src/platform/config/loader.js'

vi.mock('../../../src/platform/config/loader.js', () => ({
  loadConfigV2: vi.fn(),
}))

describe('discuss capability prepare', () => {
  it('loads v2 config into prepared input', async () => {
    const config = {
      capabilities: {
        discuss: {
          enabled: true,
        },
      },
    }
    vi.mocked(loadConfigV2).mockReturnValue(config as never)

    const prepared = await prepareDiscussInput({
      topic: 'Should we adopt monorepo?',
      options: {
        reviewers: 'claude',
      },
    }, createCapabilityContext({ configPath: '/tmp/magpie.yaml' }))

    expect(loadConfigV2).toHaveBeenCalledWith('/tmp/magpie.yaml')
    expect(prepared.config).toBe(config)
    expect(prepared.topic).toBe('Should we adopt monorepo?')
    expect(prepared.options).toEqual({ reviewers: 'claude' })
  })
})
