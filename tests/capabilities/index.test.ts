import { describe, expect, it } from 'vitest'
import { createDefaultCapabilityRegistry } from '../../src/capabilities/index.js'
import type { MagpieConfigV2 } from '../../src/platform/config/types.js'

function createConfig(): MagpieConfigV2 {
  return {
    defaults: { max_rounds: 3, output_format: 'markdown', check_convergence: true },
    providers: {
      codex: { enabled: true },
    },
    reviewers: {
      reviewer: { tool: 'codex', prompt: 'review' },
    },
    summarizer: { tool: 'codex', prompt: 'summarize' },
    analyzer: { tool: 'codex', prompt: 'analyze' },
    capabilities: {},
    integrations: {
      notifications: { enabled: false },
    },
  }
}

describe('createDefaultCapabilityRegistry', () => {
  it('registers all runtime capabilities by default', () => {
    const registry = createDefaultCapabilityRegistry()

    expect(registry.list().sort()).toEqual([
      'discuss',
      'docs-sync',
      'harness',
      'issue-fix',
      'loop',
      'post-merge-regression',
      'quality/unit-test-eval',
      'review',
      'stats',
      'trd',
    ])
  })

  it('filters out capabilities explicitly disabled in config', () => {
    const config = createConfig()
    config.capabilities.docs_sync = { enabled: false }
    config.capabilities.harness = { enabled: false }
    config.capabilities.trd = { enabled: false }

    const registry = createDefaultCapabilityRegistry({ config })
    const names = registry.list()

    expect(names).not.toContain('docs-sync')
    expect(names).not.toContain('harness')
    expect(names).not.toContain('trd')
    expect(names).toContain('review')
    expect(names).toContain('stats')
  })
})
