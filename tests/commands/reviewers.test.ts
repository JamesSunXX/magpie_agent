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
      backend: { model: 'kiro', prompt: 'backend review' },
      frontend: { model: 'codex', prompt: 'frontend review' },
    })

    const result = listConfiguredReviewers(config)

    expect(result).toEqual([
      { id: 'backend', model: 'kiro' },
      { id: 'frontend', model: 'codex' },
    ])
  })

  it('filters by model with case-insensitive exact match', () => {
    const config = buildConfig({
      security: { model: 'kiro', prompt: 'security review' },
      perf: { model: 'KiRo', prompt: 'performance review' },
      quality: { model: 'codex', prompt: 'quality review' },
    })

    const result = listConfiguredReviewers(config, 'kiro')

    expect(result).toEqual([
      { id: 'security', model: 'kiro' },
      { id: 'perf', model: 'KiRo' },
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
