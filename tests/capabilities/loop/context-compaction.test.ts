import { describe, expect, it } from 'vitest'
import { shouldPreferCompactedKnowledgeContext } from '../../../src/capabilities/loop/application/execute.js'

describe('loop context compaction', () => {
  it('does not prefer compacted summary for fresh running sessions', () => {
    expect(shouldPreferCompactedKnowledgeContext({
      status: 'running',
      stageResults: [],
    })).toBe(false)
  })

  it('prefers compacted summary once stage history exists', () => {
    expect(shouldPreferCompactedKnowledgeContext({
      status: 'running',
      stageResults: [{
        stage: 'prd_review',
        success: true,
        confidence: 0.92,
        summary: 'PRD review completed.',
        risks: [],
        retryCount: 0,
        artifacts: ['/tmp/prd-review.md'],
        timestamp: new Date('2026-04-21T00:00:00.000Z'),
      }],
    })).toBe(true)
  })

  it('prefers compacted summary while paused for human confirmation', () => {
    expect(shouldPreferCompactedKnowledgeContext({
      status: 'paused_for_human',
      stageResults: [],
    })).toBe(true)
  })
})
