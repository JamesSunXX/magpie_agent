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
import { getConfigVersionStatus, CURRENT_CONFIG_VERSION } from '../../../src/platform/config/loader.js'

const validConfig: MagpieConfigV2 = {
  config_version: CURRENT_CONFIG_VERSION,
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

  it('reports config status as current when version matches', () => {
    vi.mocked(parse).mockReturnValue(structuredClone(validConfig))

    const status = getConfigVersionStatus('/path/to/config.yaml')

    expect(status).toEqual({
      path: '/path/to/config.yaml',
      configVersion: CURRENT_CONFIG_VERSION,
      expectedVersion: CURRENT_CONFIG_VERSION,
      state: 'current',
      message: undefined,
    })
  })

  it('reports config status as outdated when version is missing', () => {
    const config = structuredClone(validConfig)
    delete config.config_version
    vi.mocked(parse).mockReturnValue(config)

    const status = getConfigVersionStatus('/path/to/config.yaml')

    expect(status.state).toBe('outdated')
    expect(status.message).toContain('Run `magpie init --upgrade --config /path/to/config.yaml`')
  })

  it('injects built-in route reviewers into the loaded config', () => {
    vi.mocked(parse).mockReturnValue(structuredClone(validConfig))

    const config = loadConfig('/path/to/config.yaml')

    expect(config.reviewers['route-gemini']).toMatchObject({ tool: 'gemini' })
    expect(config.reviewers['route-codex']).toMatchObject({ tool: 'codex' })
    expect(config.reviewers['route-architect']).toMatchObject({ tool: 'kiro', agent: 'architect' })
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

  it('rejects malformed routing fallback bindings', () => {
    const config = structuredClone(validConfig)
    config.capabilities.routing = {
      enabled: true,
      fallback_chain: {
        planning: {
          simple: [{} as never],
        },
      },
    }
    vi.mocked(parse).mockReturnValue(config)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.routing.fallback_chain.planning.simple entries must include a non-empty tool or model'
    )
  })

  it('accepts harness defaults and validator checks when they use known reviewers and bindings', () => {
    const config = structuredClone(validConfig)
    config.reviewers['route-codex'] = { tool: 'codex', prompt: 'route codex' }
    config.capabilities.harness = {
      default_reviewers: ['claude', 'route-codex'],
      validator_checks: [{ tool: 'claw' }, { tool: 'kiro' }],
    }
    vi.mocked(parse).mockReturnValue(config)

    expect(() => loadConfig('/path/to/config.yaml')).not.toThrow()
  })

  it('rejects agent values on non-kiro tools', () => {
    const config = structuredClone(validConfig)
    config.reviewers.claude = {
      tool: 'codex',
      model: 'gpt-5.4',
      agent: 'architect',
      prompt: 'Review this code',
    }
    vi.mocked(parse).mockReturnValue(config)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: reviewers.claude.agent is only supported when tool/model resolves to kiro'
    )
  })
})
