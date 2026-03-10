import { describe, expect, it } from 'vitest'
import type { MagpieConfig } from '../../src/config/types.js'
import { listConfiguredReviewers } from '../../src/commands/reviewers.js'

function buildConfig(reviewers: MagpieConfig['reviewers']): MagpieConfig {
  return {
    providers: {
      'claude-code': { enabled: true },
      'codex-cli': { enabled: true },
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
  }
}

describe('reviewers command helpers', () => {
  it('lists all configured reviewers', () => {
    const config = buildConfig({
      backend: { model: 'kiro', prompt: 'backend review' },
      frontend: { model: 'codex-cli', prompt: 'frontend review' },
    })

    const result = listConfiguredReviewers(config)

    expect(result).toEqual([
      { id: 'backend', model: 'kiro' },
      { id: 'frontend', model: 'codex-cli' },
    ])
  })

  it('filters by model with case-insensitive exact match', () => {
    const config = buildConfig({
      security: { model: 'kiro', prompt: 'security review' },
      perf: { model: 'KiRo', prompt: 'performance review' },
      quality: { model: 'codex-cli', prompt: 'quality review' },
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
