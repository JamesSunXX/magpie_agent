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

  it('normalizes the legacy integration test command for outdated configs', () => {
    const config = structuredClone(validConfig)
    config.config_version = CURRENT_CONFIG_VERSION - 1
    config.capabilities.loop = {
      commands: {
        integration_test: 'npm run test:run -- tests/integration',
      },
    }
    vi.mocked(parse).mockReturnValue(config)

    const loaded = loadConfig('/path/to/config.yaml')

    expect(loaded.capabilities.loop?.commands?.integration_test).toBe('npm run test:run -- tests/e2e')
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('normalized to "npm run test:run -- tests/e2e"')
    )
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

  it('rejects non-boolean capabilities.trd.enabled values', () => {
    const config = structuredClone(validConfig) as Record<string, any>
    config.capabilities.trd = {
      enabled: 'true',
    }
    vi.mocked(parse).mockReturnValue(config as MagpieConfigV2)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.trd.enabled must be a boolean'
    )
  })

  it('rejects non-boolean capabilities.harness.enabled values', () => {
    const config = structuredClone(validConfig) as Record<string, any>
    config.capabilities.harness = {
      enabled: 'yes',
    }
    vi.mocked(parse).mockReturnValue(config as MagpieConfigV2)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.harness.enabled must be a boolean'
    )
  })

  it('accepts explicit safety config with dangerous commands disabled by default', () => {
    const config = structuredClone(validConfig)
    config.capabilities.safety = {
      allow_dangerous_commands: false,
      require_confirmation_for_dangerous: true,
      dangerous_patterns: ['terraform destroy'],
    }
    vi.mocked(parse).mockReturnValue(config)

    expect(() => loadConfig('/path/to/config.yaml')).not.toThrow()
  })

  it('rejects non-boolean allow_dangerous_commands values', () => {
    const config = structuredClone(validConfig) as Record<string, any>
    config.capabilities.safety = {
      allow_dangerous_commands: 'yes',
    }
    vi.mocked(parse).mockReturnValue(config as MagpieConfigV2)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.safety.allow_dangerous_commands must be a boolean'
    )
  })

  it('rejects invalid dangerous_patterns entries', () => {
    const config = structuredClone(validConfig) as Record<string, any>
    config.capabilities.safety = {
      dangerous_patterns: ['git reset --hard', '   '],
    }
    vi.mocked(parse).mockReturnValue(config as MagpieConfigV2)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.safety.dangerous_patterns[1] must be a non-empty string'
    )
  })

  it('accepts the new loop stage timeout overrides and stage bindings', () => {
    const config = structuredClone(validConfig) as Record<string, any>
    config.capabilities.loop = {
      enabled: true,
      stages: [...newLoopStages],
      execution_timeout: {
        stage_overrides_ms: {
          prd_review: 1000,
          domain_partition: 1000,
          trd_generation: 1000,
          dev_preparation: 1000,
          red_test_confirmation: 1000,
          implementation: 1000,
          green_fixup: 1000,
          unit_mock_test: 1000,
          integration_test: 1000,
        },
      },
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

  it('rejects multi-model loop confirmation when fewer than two reviewers are available', () => {
    const config = structuredClone(validConfig)
    config.capabilities.discuss = {
      enabled: true,
      reviewers: ['claude'],
    }
    config.capabilities.loop = {
      enabled: true,
      human_confirmation: {
        gate_policy: 'multi_model',
      },
    }
    vi.mocked(parse).mockReturnValue(config)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.loop.human_confirmation requires at least 2 distinct reviewers for multi_model gate policy'
    )
  })

  it('rejects multi-model loop confirmation when reviewer ids are duplicated', () => {
    const config = structuredClone(validConfig)
    config.capabilities.discuss = {
      enabled: true,
      reviewers: ['claude', 'claude'],
    }
    config.capabilities.loop = {
      enabled: true,
      human_confirmation: {
        gate_policy: 'multi_model',
      },
    }
    vi.mocked(parse).mockReturnValue(config)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.loop.human_confirmation requires at least 2 distinct reviewers for multi_model gate policy'
    )
  })

  it('accepts trd convergence config when at least two reviewers are available', () => {
    const config = structuredClone(validConfig)
    config.capabilities.discuss = {
      enabled: true,
      reviewers: ['claude', 'route-codex'],
    }
    config.capabilities.loop = {
      enabled: true,
      trd_convergence: {
        enabled: true,
        max_cycles: 5,
        discuss_rounds: 2,
      },
    }
    vi.mocked(parse).mockReturnValue(config)

    expect(() => loadConfig('/path/to/config.yaml')).not.toThrow()
  })

  it('rejects trd convergence when enabled with fewer than two reviewers', () => {
    const config = structuredClone(validConfig)
    config.capabilities.discuss = {
      enabled: true,
      reviewers: ['claude'],
    }
    config.capabilities.loop = {
      enabled: true,
      trd_convergence: {
        enabled: true,
      },
    }
    vi.mocked(parse).mockReturnValue(config)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.loop.trd_convergence requires at least 2 distinct reviewers when enabled'
    )
  })

  it('rejects invalid trd convergence max cycles', () => {
    const config = structuredClone(validConfig)
    config.capabilities.discuss = {
      enabled: true,
      reviewers: ['claude', 'route-codex'],
    }
    config.capabilities.loop = {
      enabled: true,
      trd_convergence: {
        enabled: true,
        max_cycles: 0,
      },
    }
    vi.mocked(parse).mockReturnValue(config)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.loop.trd_convergence.max_cycles must be a positive integer'
    )
  })

  it('rejects trd convergence reviewer_ids when they include unknown reviewers', () => {
    const config = structuredClone(validConfig)
    config.capabilities.discuss = {
      enabled: true,
      reviewers: ['claude', 'route-codex'],
    }
    config.capabilities.loop = {
      enabled: true,
      trd_convergence: {
        enabled: true,
        reviewer_ids: ['claude', 'unknown-reviewer'],
      },
    }
    vi.mocked(parse).mockReturnValue(config)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.loop.trd_convergence.reviewer_ids includes unknown reviewer "unknown-reviewer"'
    )
  })

  it('rejects empty custom unit mock verification commands', () => {
    const config = structuredClone(validConfig)
    config.capabilities.loop = {
      enabled: true,
      commands: {
        unit_mock_test_steps: [
          {
            label: 'Java tests',
            command: '   ',
          },
        ],
      },
    }
    vi.mocked(parse).mockReturnValue(config)

    expect(() => loadConfig('/path/to/config.yaml')).toThrow(
      'Config error: capabilities.loop.commands.unit_mock_test_steps[0].command must be a non-empty string'
    )
  })
})
