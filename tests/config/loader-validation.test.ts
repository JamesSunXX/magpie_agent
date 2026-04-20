import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MagpieConfigV2 } from '../../src/platform/config/types.js'

// Mock fs and yaml
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn()
}))
vi.mock('yaml', () => ({
  parse: vi.fn()
}))

// Mock logger to suppress output
vi.mock('../../src/shared/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

import { loadConfig } from '../../src/platform/config/loader.js'
import { existsSync, readFileSync } from 'fs'
import { parse } from 'yaml'
import { logger } from '../../src/shared/utils/logger.js'

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

const newLoopStages = [
  'prd_review',
  'domain_partition',
  'trd_generation',
  'dev_preparation',
  'red_test_confirmation',
  'implementation',
  'green_fixup',
  'unit_mock_test',
  'integration_test',
] as const

describe('loadConfig - validation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('yaml content')
  })

  it('loads valid config without error', () => {
    vi.mocked(parse).mockReturnValue(structuredClone(validConfig))
    expect(() => loadConfig('/path/to/config.yaml')).not.toThrow()
  })

  it('throws when max_rounds <= 0', () => {
    const bad = structuredClone(validConfig)
    bad.defaults.max_rounds = 0
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('max_rounds must be > 0')
  })

  it('throws when no reviewers defined', () => {
    const bad = structuredClone(validConfig)
    bad.reviewers = {}
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('at least one reviewer')
  })

  it('throws when reviewer missing model', () => {
    const bad = structuredClone(validConfig)
    bad.reviewers = { claude: { model: '', prompt: 'test' } }
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('must include a non-empty tool or model')
  })

  it('throws when reviewer missing prompt', () => {
    const bad = structuredClone(validConfig)
    bad.reviewers = { claude: { model: 'test:model', prompt: '' } }
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('missing a "prompt" field')
  })

  it('throws when summarizer missing model', () => {
    const bad = structuredClone(validConfig)
    bad.summarizer = { model: '', prompt: 'summarize' }
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('summarizer must include a non-empty tool or model')
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

  it('does not warn when API key is set', () => {
    vi.mocked(parse).mockReturnValue(structuredClone(validConfig))
    loadConfig('/path/to/config.yaml')
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled()
  })

  it('throws when config file not found', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(() => loadConfig('/path/to/missing.yaml')).toThrow('Config file not found')
  })

  it('throws when trd.default_reviewers includes unknown reviewer', () => {
    const bad = structuredClone(validConfig)
    bad.trd = { default_reviewers: ['unknown-reviewer'] }
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('unknown reviewer')
  })

  it('throws when trd.max_rounds <= 0', () => {
    const bad = structuredClone(validConfig)
    bad.trd = { max_rounds: 0 }
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('trd.max_rounds must be > 0')
  })

  it('ignores legacy trd.preprocess.image_reader config', () => {
    const legacy = structuredClone(validConfig) as Record<string, any>
    legacy.trd = {
      preprocess: {
        chunk_chars: 6000,
        max_chars: 120000,
        image_reader: {
          enabled: true,
          command: 'tesseract {image} stdout',
        },
      },
    }
    vi.mocked(parse).mockReturnValue(legacy as MagpieConfigV2)
    expect(() => loadConfig('/path/to/config.yaml')).not.toThrow()
  })

  it('throws when capabilities.harness.default_reviewers includes unknown reviewer', () => {
    const bad = structuredClone(validConfig)
    bad.capabilities.harness = { default_reviewers: ['unknown-reviewer'] }
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('capabilities.harness.default_reviewers includes unknown reviewer')
  })

  it('throws when capabilities.harness.validator_checks contains an empty binding', () => {
    const bad = structuredClone(validConfig)
    bad.capabilities.harness = { validator_checks: [{} as never] }
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow('capabilities.harness.validator_checks entries must include a non-empty tool or model')
  })

  it('throws when integrations.notifications.stage_ai.timeout_ms is not positive', () => {
    const bad = structuredClone(validConfig)
    bad.integrations.notifications = {
      enabled: true,
      stage_ai: {
        enabled: true,
        provider: 'codex',
        timeout_ms: 0,
      },
    }
    vi.mocked(parse).mockReturnValue(bad)
    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'integrations.notifications.stage_ai.timeout_ms must be a positive number'
    )
  })

  it('accepts the new loop stages and stage bindings', () => {
    const config = structuredClone(validConfig) as Record<string, any>
    config.capabilities.loop = {
      enabled: true,
      stages: [...newLoopStages],
      stage_bindings: {
        implementation: {
          primary: { tool: 'codex' },
          reviewer: { model: 'gemini-cli' },
          rescue: { tool: 'kiro' },
        },
      },
    }
    vi.mocked(parse).mockReturnValue(config as MagpieConfigV2)

    expect(() => loadConfig('/path/to/config.yaml')).not.toThrow()
  })

  it('throws when loop execution timeout overrides use an unknown stage key', () => {
    const bad = structuredClone(validConfig) as Record<string, any>
    bad.capabilities.loop = {
      enabled: true,
      execution_timeout: {
        stage_overrides_ms: {
          code_development: 1000,
        },
      },
    }
    vi.mocked(parse).mockReturnValue(bad as MagpieConfigV2)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.loop.execution_timeout.stage_overrides_ms has unknown stage "code_development"'
    )
  })

  it('throws when loop stages include an unknown stage name', () => {
    const bad = structuredClone(validConfig) as Record<string, any>
    bad.capabilities.loop = {
      enabled: true,
      stages: [...newLoopStages, 'code_development'],
    }
    vi.mocked(parse).mockReturnValue(bad as MagpieConfigV2)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.loop.stages[9] must be one of prd_review, domain_partition, trd_generation, dev_preparation, red_test_confirmation, implementation, green_fixup, unit_mock_test, integration_test'
    )
  })

  it('throws when loop stage bindings use an unknown key', () => {
    const bad = structuredClone(validConfig) as Record<string, any>
    bad.capabilities.loop = {
      enabled: true,
      stage_bindings: {
        implementation: {
          primary: { tool: 'codex' },
          reviewer: { model: 'gemini-cli' },
          rescue: { tool: 'kiro' },
          fallback: { tool: 'claude' },
        },
      },
    }
    vi.mocked(parse).mockReturnValue(bad as MagpieConfigV2)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.loop.stage_bindings.implementation has unknown binding key "fallback"'
    )
  })
})
