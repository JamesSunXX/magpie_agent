import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MagpieConfigV2 } from '../../../src/platform/config/types.js'

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}))

vi.mock('yaml', () => ({
  parse: vi.fn(),
}))

vi.mock('../../../src/shared/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

import { existsSync, readFileSync } from 'fs'
import { parse } from 'yaml'
import { loadConfig } from '../../../src/platform/config/loader.js'
import { logger } from '../../../src/shared/utils/logger.js'

const validConfig: MagpieConfigV2 = {
  defaults: { max_rounds: 3, output_format: 'markdown', check_convergence: true },
  providers: {
    anthropic: { api_key: 'test-key' },
  },
  reviewers: {
    claude: { model: 'anthropic:claude-3-5-sonnet', prompt: 'Review this code' },
  },
  summarizer: { model: 'anthropic:claude-3-5-sonnet', prompt: 'Summarize' },
  analyzer: { model: 'anthropic:claude-3-5-sonnet', prompt: 'Analyze' },
  capabilities: {
    review: { enabled: true },
  },
  integrations: {
    notifications: { enabled: false },
  },
}

describe('platform config loader', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('yaml content')
  })

  it('loads valid v2 config without error', () => {
    vi.mocked(parse).mockReturnValue(structuredClone(validConfig))
    expect(() => loadConfig('/path/to/config.yaml')).not.toThrow()
  })

  it('throws when config file not found', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(() => loadConfig('/path/to/missing.yaml')).toThrow('Config file not found')
  })

  it('throws when v2 sections are missing', () => {
    const bad = structuredClone(validConfig) as Record<string, unknown>
    delete bad.capabilities
    vi.mocked(parse).mockReturnValue(bad)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow('Config error: capabilities section is required')
  })

  it('throws for legacy config without v2 schema', () => {
    vi.mocked(parse).mockReturnValue({
      providers: {
        'claude-code': { enabled: true },
      },
      defaults: {
        max_rounds: 3,
        output_format: 'markdown',
        check_convergence: true,
      },
      reviewers: {
        claude: { model: 'claude-code', prompt: 'review' },
      },
      summarizer: { model: 'claude-code', prompt: 'summarize' },
      analyzer: { model: 'claude-code', prompt: 'analyze' },
    } satisfies Record<string, unknown>)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow('Legacy config schema is no longer supported')
  })

  it('warns on empty API key', () => {
    const config = structuredClone(validConfig)
    config.providers = { anthropic: { api_key: '' } }
    vi.mocked(parse).mockReturnValue(config)

    loadConfig('/path/to/config.yaml')

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('api_key is empty')
    )
  })
})
