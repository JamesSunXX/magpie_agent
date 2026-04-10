import { describe, expect, it } from 'vitest'
import type { MagpieConfigV2 } from '../../src/platform/config/types.js'
import { listConfiguredReviewers } from '../../src/cli/commands/reviewers.js'

function buildConfig(reviewers: MagpieConfigV2['reviewers']): MagpieConfigV2 {
  return {
    providers: {
      'claude-code': { enabled: true },
      'codex': { enabled: true },
      'kiro': { enabled: true },
    },
    defaults: {
      max_rounds: 3,
      output_format: 'markdown',
      check_convergence: true,
    },
    reviewers,
    summarizer: { model: 'claude-code', prompt: 'summary' },
    analyzer: { model: 'claude-code', prompt: 'analysis' },
    capabilities: {
      review: { enabled: true },
    },
    integrations: {
      notifications: { enabled: false },
    },
  }
}

describe('reviewers command helpers', () => {
  it('lists all configured reviewers', () => {
    const config = buildConfig({
      backend: { tool: 'kiro', agent: 'go-reviewer', prompt: 'backend review' },
      frontend: { tool: 'codex', prompt: 'frontend review' },
    })

    const result = listConfiguredReviewers(config)

    expect(result).toEqual([
      { id: 'backend', tool: 'kiro', model: undefined, binding: 'kiro', agent: 'go-reviewer' },
      { id: 'frontend', tool: 'codex', model: undefined, binding: 'codex', agent: undefined },
    ])
  })

  it('filters by tool or model with case-insensitive exact match', () => {
    const config = buildConfig({
      security: { tool: 'kiro', prompt: 'security review' },
      perf: { tool: 'kiro', model: 'claude-sonnet-4-6', prompt: 'performance review' },
      quality: { tool: 'codex', prompt: 'quality review' },
    })

    const result = listConfiguredReviewers(config, 'kiro')

    expect(result).toEqual([
      { id: 'security', tool: 'kiro', model: undefined, binding: 'kiro', agent: undefined },
      { id: 'perf', tool: 'kiro', model: 'claude-sonnet-4-6', binding: 'kiro:claude-sonnet-4-6', agent: undefined },
    ])
  })

  it('returns empty when no reviewers match the requested model', () => {
    const config = buildConfig({
      reviewer: { model: 'claude-code', prompt: 'review' },
    })

    const result = listConfiguredReviewers(config, 'kiro')

    expect(result).toEqual([])
  })
})
