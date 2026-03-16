import { describe, expect, it, vi } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { prepareDiscussInput } from '../../../src/capabilities/discuss/application/prepare.js'
import { loadConfig } from '../../../src/platform/config/loader.js'

vi.mock('../../../src/platform/config/loader.js', () => ({
  loadConfig: vi.fn(),
}))

describe('discuss capability prepare', () => {
  it('normalizes top-level discuss flags into options', async () => {
    const config = {
      capabilities: {
        discuss: {
          enabled: true,
        },
      },
    }
    vi.mocked(loadConfig).mockReturnValue(config as never)

    const prepared = await prepareDiscussInput({
      topic: 'Should we adopt monorepo?',
      rounds: '2',
      reviewers: 'claude',
    }, createCapabilityContext({ configPath: '/tmp/magpie.yaml' }))

    expect(prepared.options).toEqual(expect.objectContaining({
      rounds: '2',
      reviewers: 'claude',
    }))
  })

  it('loads config into prepared input', async () => {
    const config = {
      capabilities: {
        discuss: {
          enabled: true,
        },
      },
    }
    vi.mocked(loadConfig).mockReturnValue(config as never)

    const prepared = await prepareDiscussInput({
      topic: 'Should we adopt monorepo?',
      options: {
        reviewers: 'claude',
      },
    }, createCapabilityContext({ configPath: '/tmp/magpie.yaml' }))

    expect(loadConfig).toHaveBeenCalledWith('/tmp/magpie.yaml')
    expect(prepared.config).toBe(config)
    expect(prepared.topic).toBe('Should we adopt monorepo?')
    expect(prepared.options).toEqual(expect.objectContaining({
      reviewers: 'claude',
      rounds: '5',
      format: 'markdown',
    }))
  })
})
