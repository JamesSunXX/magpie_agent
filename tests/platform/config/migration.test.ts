import { describe, expect, it } from 'vitest'
import { migrateConfigToV2 } from '../../../src/platform/config/migration.js'
import type { MagpieConfig } from '../../../src/config/types.js'

function makeLegacyConfig(): MagpieConfig {
  return {
    providers: {
      'claude-code': { enabled: true },
    },
    defaults: {
      max_rounds: 3,
      output_format: 'markdown',
      check_convergence: true,
    },
    reviewers: {
      claude: {
        model: 'claude-code',
        prompt: 'review',
      },
    },
    summarizer: {
      model: 'claude-code',
      prompt: 'summarize',
    },
    analyzer: {
      model: 'claude-code',
      prompt: 'analyze',
    },
  }
}

describe('config migration', () => {
  it('adds capabilities from legacy config', () => {
    const migrated = migrateConfigToV2(makeLegacyConfig())

    expect(migrated.capabilities.review?.enabled).toBe(true)
    expect(migrated.capabilities.discuss?.enabled).toBe(true)
    expect(migrated.capabilities.quality?.unitTestEval?.enabled).toBe(true)
    expect(migrated.capabilities.loop?.enabled).toBe(true)
    expect(migrated.integrations.notifications?.enabled).toBe(false)
  })

  it('keeps provided capabilities', () => {
    const legacy = makeLegacyConfig()
    const migrated = migrateConfigToV2({
      ...legacy,
      capabilities: {
        review: { enabled: false },
      },
    } as ReturnType<typeof migrateConfigToV2>)

    expect(migrated.capabilities.review?.enabled).toBe(false)
    expect(migrated.integrations.notifications).toBeDefined()
  })
})
