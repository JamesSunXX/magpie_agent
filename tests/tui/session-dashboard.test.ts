import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { loadSessionDashboard } from '../../src/tui/session-dashboard.js'

describe('session dashboard', () => {
  it('aggregates review, discuss, trd, loop, and workflow sessions', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-tui-repo-'))
    const magpieHomeDir = mkdtempSync(join(tmpdir(), 'magpie-tui-home-'))

    mkdirSync(join(repoDir, '.magpie', 'sessions'), { recursive: true })
    mkdirSync(join(magpieHomeDir, 'discussions'), { recursive: true })
    mkdirSync(join(repoDir, '.magpie', 'sessions', 'trd', 'trd-1'), { recursive: true })
    mkdirSync(join(repoDir, '.magpie', 'sessions', 'loop', 'loop-1'), { recursive: true })
    mkdirSync(join(repoDir, '.magpie', 'sessions', 'issue-fix', 'wf-1'), { recursive: true })

    writeFileSync(join(repoDir, '.magpie', 'sessions', 'review-1.json'), JSON.stringify({
      id: 'review-1',
      startedAt: '2026-03-19T08:00:00.000Z',
      updatedAt: '2026-03-19T09:00:00.000Z',
      status: 'paused',
      config: {
        focusAreas: [],
        selectedFeatures: [],
      },
      plan: {
        features: [],
        totalFeatures: 0,
        selectedCount: 0,
      },
      progress: {
        currentFeatureIndex: 0,
        completedFeatures: [],
        featureResults: {},
      },
    }), 'utf-8')

    writeFileSync(join(magpieHomeDir, 'discussions', 'discussion-1.json'), JSON.stringify({
      id: 'discussion-1',
      title: 'Design tradeoffs',
      createdAt: '2026-03-19T08:00:00.000Z',
      updatedAt: '2026-03-19T08:30:00.000Z',
      status: 'active',
      reviewerIds: ['claude'],
      rounds: [],
    }), 'utf-8')

    writeFileSync(join(repoDir, '.magpie', 'sessions', 'trd', 'trd-1', 'session.json'), JSON.stringify({
      id: 'trd-1',
      title: 'Checkout PRD',
      prdPath: '/tmp/prd.md',
      createdAt: '2026-03-19T07:00:00.000Z',
      updatedAt: '2026-03-19T07:30:00.000Z',
      stage: 'completed',
      reviewerIds: ['claude'],
      domains: [],
      artifacts: {
        domainOverviewPath: '/tmp/domain-overview.md',
        draftDomainsPath: '/tmp/draft-domains.yaml',
        confirmedDomainsPath: '/tmp/confirmed-domains.yaml',
        trdPath: '/tmp/trd.md',
        openQuestionsPath: '/tmp/questions.md',
        partialDir: '/tmp/partial',
      },
      rounds: [],
    }), 'utf-8')

    writeFileSync(join(repoDir, '.magpie', 'sessions', 'loop', 'loop-1', 'session.json'), JSON.stringify({
      id: 'loop-1',
      title: 'Paused loop',
      goal: 'Fix dashboard',
      prdPath: '/tmp/prd.md',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T10:30:00.000Z',
      status: 'paused_for_human',
      currentStageIndex: 1,
      stages: ['prd_review'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir: '/tmp/loop-1',
        eventsPath: '/tmp/loop-1/events.jsonl',
        planPath: '/tmp/loop-1/plan.md',
        humanConfirmationPath: '/tmp/loop-1/human_confirmation.md',
      },
    }), 'utf-8')

    writeFileSync(join(repoDir, '.magpie', 'sessions', 'issue-fix', 'wf-1', 'session.json'), JSON.stringify({
      id: 'wf-1',
      capability: 'issue-fix',
      title: 'Fix dashboard crash',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T11:00:00.000Z',
      status: 'completed',
      summary: 'Fixed dashboard crash',
      artifacts: {
        planPath: '/tmp/workflow/plan.md',
        executionPath: '/tmp/workflow/execution.md',
      },
    }), 'utf-8')

    const result = await loadSessionDashboard({ cwd: repoDir, magpieHomeDir })

    expect(result.continue[0]).toMatchObject({ capability: 'loop', status: 'paused_for_human' })
    expect(result.continue[1]).toMatchObject({ capability: 'review', status: 'paused' })
    expect(result.recent[0]).toMatchObject({ capability: 'issue-fix', status: 'completed' })
    expect(result.recent[1]).toMatchObject({ capability: 'trd', status: 'completed' })
    expect(result.continue[2]?.title).toBe('Design tradeoffs')
    expect(result.continue[0]?.resumeCommand).toEqual(['loop', 'resume', 'loop-1'])
    expect(result.continue[1]?.resumeCommand).toEqual(['review', '--session', 'review-1'])
  })

  it('extracts readable titles from report-like session names', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-tui-repo-'))
    const magpieHomeDir = mkdtempSync(join(tmpdir(), 'magpie-tui-home-'))

    mkdirSync(join(magpieHomeDir, 'discussions'), { recursive: true })

    writeFileSync(join(magpieHomeDir, 'discussions', 'discussion-1.json'), JSON.stringify({
      id: 'discussion-1',
      title: '<report>\n# 混合在线圈包方案可行性深度研究报告\n\n## 执行摘要\n本报告围绕用户需求展开。',
      createdAt: '2026-03-19T08:00:00.000Z',
      updatedAt: '2026-03-19T08:30:00.000Z',
      status: 'completed',
      reviewerIds: ['claude'],
      rounds: [],
    }), 'utf-8')

    const result = await loadSessionDashboard({ cwd: repoDir, magpieHomeDir })

    expect(result.recent[0]?.title).toBe('混合在线圈包方案可行性深度研究报告')
  })

  it('keeps non-resumable harness sessions out of the Continue section', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-tui-repo-'))
    const magpieHomeDir = mkdtempSync(join(tmpdir(), 'magpie-tui-home-'))

    mkdirSync(join(repoDir, '.magpie', 'sessions', 'harness', 'harness-1'), { recursive: true })

    writeFileSync(join(repoDir, '.magpie', 'sessions', 'harness', 'harness-1', 'session.json'), JSON.stringify({
      id: 'harness-1',
      capability: 'harness',
      title: 'Deliver checkout v2',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T11:00:00.000Z',
      status: 'in_progress',
      currentStage: 'reviewing',
      summary: 'Running review cycle 1.',
      artifacts: {
        eventsPath: '/tmp/workflow/events.jsonl',
      },
    }), 'utf-8')

    const result = await loadSessionDashboard({ cwd: repoDir, magpieHomeDir })

    expect(result.continue).toEqual([])
    expect(result.recent[0]).toMatchObject({ capability: 'harness', status: 'in_progress' })
  })

  it('surfaces blocked harness sessions in the Continue section', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-tui-repo-'))
    const magpieHomeDir = mkdtempSync(join(tmpdir(), 'magpie-tui-home-'))

    mkdirSync(join(repoDir, '.magpie', 'sessions', 'harness', 'harness-1'), { recursive: true })

    writeFileSync(join(repoDir, '.magpie', 'sessions', 'harness', 'harness-1', 'session.json'), JSON.stringify({
      id: 'harness-1',
      capability: 'harness',
      title: 'Deliver checkout v2',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T11:00:00.000Z',
      status: 'blocked',
      currentStage: 'developing',
      summary: 'Waiting for human confirmation.',
      artifacts: {
        eventsPath: '/tmp/workflow/events.jsonl',
      },
    }), 'utf-8')

    const result = await loadSessionDashboard({ cwd: repoDir, magpieHomeDir })

    expect(result.continue[0]).toMatchObject({ capability: 'harness', status: 'blocked' })
    expect(result.continue[0]?.resumeCommand).toEqual(['harness', 'resume', 'harness-1'])
  })

  it('loads repo-local sessions when launched from a nested directory', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'magpie-tui-repo-'))
    const nestedDir = join(repoDir, 'packages', 'feature')
    const magpieHomeDir = mkdtempSync(join(tmpdir(), 'magpie-tui-home-'))

    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ name: 'magpie-test-repo' }), 'utf-8')
    mkdirSync(join(repoDir, '.magpie', 'sessions', 'loop', 'loop-nested'), { recursive: true })

    writeFileSync(join(repoDir, '.magpie', 'sessions', 'loop', 'loop-nested', 'session.json'), JSON.stringify({
      id: 'loop-nested',
      title: 'Nested loop',
      goal: 'Verify nested cwd',
      prdPath: '/tmp/prd.md',
      createdAt: '2026-03-19T09:00:00.000Z',
      updatedAt: '2026-03-19T10:30:00.000Z',
      status: 'paused_for_human',
      currentStageIndex: 1,
      stages: ['prd_review'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir: '/tmp/loop-nested',
        eventsPath: '/tmp/loop-nested/events.jsonl',
        planPath: '/tmp/loop-nested/plan.md',
        humanConfirmationPath: '/tmp/loop-nested/human_confirmation.md',
      },
    }), 'utf-8')

    const result = await loadSessionDashboard({ cwd: nestedDir, magpieHomeDir })

    expect(result.continue[0]).toMatchObject({ capability: 'loop', id: 'loop-nested' })
  })
})
