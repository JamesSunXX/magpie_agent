import { describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { prepareTrdInput } from '../../../src/capabilities/trd/application/prepare.js'
import { loadConfigV2 } from '../../../src/platform/config/loader.js'

vi.mock('../../../src/platform/config/loader.js', () => ({
  loadConfigV2: vi.fn(),
}))

describe('trd capability prepare', () => {
  it('loads v2 config into prepared input', async () => {
    const config = {
      capabilities: {
        trd: {
          enabled: true,
        },
      },
    }
    vi.mocked(loadConfigV2).mockReturnValue(config as never)

    const prepared = await prepareTrdInput({
      prdPath: '/tmp/prd.md',
      options: {
        reviewers: 'claude',
      },
    }, createCapabilityContext({ configPath: '/tmp/magpie.yaml' }))

    expect(loadConfigV2).toHaveBeenCalledWith('/tmp/magpie.yaml')
    expect(prepared.config).toBe(config)
    expect(prepared.prdPath).toBe('/tmp/prd.md')
    expect(prepared.options).toEqual({ reviewers: 'claude' })
  })
})
