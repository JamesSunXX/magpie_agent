import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { runCapability } from '../../../src/core/capability/runner.js'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { statsCapability } from '../../../src/capabilities/stats/index.js'

function writeReviewRecord(
  dir: string,
  repoName: string,
  target: string,
  filename: string,
  payload: unknown
): void {
  const targetDir = join(dir, '.magpie', 'history', repoName, target)
  mkdirSync(targetDir, { recursive: true })
  writeFileSync(join(targetDir, filename), JSON.stringify(payload, null, 2))
}

describe('stats capability', () => {
  it('returns an empty but valid summary when no review history exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-stats-empty-'))
    const ctx = createCapabilityContext({
      cwd: dir,
      metadata: { format: 'json' },
    })

    const res = await runCapability(statsCapability, { since: 30, format: 'json' }, ctx)

    expect(res.output.format).toBe('json')
    expect(res.output.json.repoName).toBe(dir.split('/').pop())
    expect(res.output.json.windowDays).toBe(30)
    expect(res.output.json.totals.reviewCount).toBe(0)
    expect(res.output.json.totals.targetCount).toBe(0)
    expect(res.output.json.totals.issueCount).toBe(0)
    expect(res.output.json.severityBreakdown).toEqual([])
    expect(res.output.json.topFiles).toEqual([])
    expect(res.output.json.topCategories).toEqual([])
    expect(res.output.json.topTargets).toEqual([])
    expect(res.output.json.recentReviews).toEqual([])
    expect(res.output.text).toContain('No review history found')
  })

  it('aggregates multiple review records across targets and applies the since window', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-stats-agg-'))
    const repoName = dir.split('/').pop() || 'repo'

    writeReviewRecord(dir, repoName, 'PR #12', 'review-2026-03-10T01-00-00-000Z-a.json', {
      timestamp: '2026-03-10T01:00:00.000Z',
      issues: [
        {
          severity: 'high',
          category: 'security',
          file: 'src/auth.ts',
          title: 'Validate auth token',
          description: 'desc',
          raisedBy: ['claude'],
          descriptions: ['desc'],
        },
        {
          severity: 'medium',
          category: 'performance',
          file: 'src/cache.ts',
          title: 'Reduce cache churn',
          description: 'desc',
          raisedBy: ['codex'],
          descriptions: ['desc'],
        },
      ],
    })

    writeReviewRecord(dir, repoName, 'PR #12', 'review-2026-03-12T02-00-00-000Z-b.json', {
      timestamp: '2026-03-12T02:00:00.000Z',
      issues: [
        {
          severity: 'high',
          category: 'security',
          file: 'src/auth.ts',
          title: 'Validate auth token',
          description: 'desc',
          raisedBy: ['claude'],
          descriptions: ['desc'],
        },
      ],
    })

    writeReviewRecord(dir, repoName, 'Local Changes', 'review-2026-03-11T03-00-00-000Z-c.json', {
      timestamp: '2026-03-11T03:00:00.000Z',
      issues: [
        {
          severity: 'low',
          category: 'style',
          file: 'src/ui.ts',
          title: 'Rename helper',
          description: 'desc',
          raisedBy: ['claude'],
          descriptions: ['desc'],
        },
      ],
    })

    writeReviewRecord(dir, repoName, 'PR #99', 'review-2026-01-01T00-00-00-000Z-old.json', {
      timestamp: '2026-01-01T00:00:00.000Z',
      issues: [
        {
          severity: 'critical',
          category: 'security',
          file: 'src/legacy.ts',
          title: 'Old issue',
          description: 'desc',
          raisedBy: ['claude'],
          descriptions: ['desc'],
        },
      ],
    })

    const ctx = createCapabilityContext({
      cwd: dir,
      sessionId: 'stats-test',
      metadata: { format: 'json' },
    })

    const res = await runCapability(statsCapability, { since: 30, format: 'json' }, ctx)

    expect(res.output.json.totals.reviewCount).toBe(3)
    expect(res.output.json.totals.targetCount).toBe(2)
    expect(res.output.json.totals.issueCount).toBe(4)
    expect(res.output.json.severityBreakdown).toEqual([
      { severity: 'high', count: 2 },
      { severity: 'medium', count: 1 },
      { severity: 'low', count: 1 },
    ])
    expect(res.output.json.topFiles[0]).toEqual({ file: 'src/auth.ts', count: 2 })
    expect(res.output.json.topCategories[0]).toEqual({ category: 'security', count: 2 })
    expect(res.output.json.topTargets).toEqual([
      { target: 'PR #12', reviewCount: 2, issueCount: 3 },
      { target: 'Local Changes', reviewCount: 1, issueCount: 1 },
    ])
    expect(res.output.json.recentReviews.map((item) => item.target)).toEqual([
      'PR #12',
      'Local Changes',
      'PR #12',
    ])
    expect(res.output.text).toContain('Review Stats')
    expect(res.output.text).toContain('Severity Breakdown')
    expect(res.output.text).toContain('Top Files')
    expect(res.output.text).toContain('Recent Review Trend')
  })
})
