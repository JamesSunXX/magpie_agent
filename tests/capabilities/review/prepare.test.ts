import { describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { prepareReviewInput } from '../../../src/capabilities/review/application/prepare.js'
import { loadConfigV2 } from '../../../src/platform/config/loader.js'

vi.mock('../../../src/platform/config/loader.js', () => ({
  loadConfigV2: vi.fn(),
}))

describe('review capability prepare', () => {
  it('loads v2 config into prepared input', async () => {
    const config = {
      capabilities: {
        review: {
          enabled: true,
        },
      },
    }
    vi.mocked(loadConfigV2).mockReturnValue(config as never)

    const prepared = await prepareReviewInput({
      target: '123',
      options: {
        format: 'markdown',
      },
    }, createCapabilityContext({ configPath: '/tmp/magpie.yaml' }))

    expect(loadConfigV2).toHaveBeenCalledWith('/tmp/magpie.yaml')
    expect(prepared.config).toBe(config)
    expect(prepared.target).toBe('123')
    expect(prepared.options).toEqual({ format: 'markdown' })
  })
})
