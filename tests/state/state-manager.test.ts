// tests/state/state-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StateManager } from '../../src/state/state-manager.js'
import type { ReviewSession, FeatureAnalysis, LoopSession } from '../../src/state/types.js'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

describe('StateManager', () => {
  let tempDir: string
  let manager: StateManager

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'magpie-test-'))
    manager = new StateManager(tempDir)
  })

  afterEach(async () => {
    delete process.env.MAGPIE_HOME
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should create .magpie directory on init', async () => {
    await manager.init()
    const { existsSync } = await import('fs')
    expect(existsSync(join(tempDir, '.magpie', 'sessions'))).toBe(true)
    expect(existsSync(join(tempDir, '.magpie', 'cache'))).toBe(true)
  })

  it('should save and load session', async () => {
    await manager.init()

    const session: ReviewSession = {
      id: 'test-123',
      startedAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      status: 'in_progress',
      config: { focusAreas: ['security'], selectedFeatures: ['write'] },
      plan: { features: [], totalFeatures: 3, selectedCount: 1 },
      progress: { currentFeatureIndex: 0, completedFeatures: [], featureResults: {} }
    }

    await manager.saveSession(session)
    const loaded = await manager.loadSession('test-123')

    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe('test-123')
    expect(loaded!.status).toBe('in_progress')
  })

  it('should return null for non-existent session', async () => {
    await manager.init()
    const loaded = await manager.loadSession('non-existent')
    expect(loaded).toBeNull()
  })

  it('should find incomplete sessions', async () => {
    await manager.init()

    const session1: ReviewSession = {
      id: 'complete-1',
      startedAt: new Date(),
      updatedAt: new Date(),
      status: 'completed',
      config: { focusAreas: [], selectedFeatures: [] },
      plan: { features: [], totalFeatures: 0, selectedCount: 0 },
      progress: { currentFeatureIndex: 0, completedFeatures: [], featureResults: {} }
    }

    const session2: ReviewSession = {
      id: 'incomplete-1',
      startedAt: new Date(),
      updatedAt: new Date(),
      status: 'in_progress',
      config: { focusAreas: [], selectedFeatures: [] },
      plan: { features: [], totalFeatures: 0, selectedCount: 0 },
      progress: { currentFeatureIndex: 0, completedFeatures: [], featureResults: {} }
    }

    await manager.saveSession(session1)
    await manager.saveSession(session2)

    const incomplete = await manager.findIncompleteSessions()
    expect(incomplete).toHaveLength(1)
    expect(incomplete[0].id).toBe('incomplete-1')
  })

  it('should save and load feature analysis cache', async () => {
    await manager.init()

    const analysis: FeatureAnalysis = {
      features: [
        { id: 'write', name: 'Write', description: 'Write operations', entryPoints: ['insert.ts'], files: [], estimatedTokens: 1000 }
      ],
      uncategorized: [],
      analyzedAt: new Date('2024-01-01'),
      codebaseHash: 'abc123'
    }

    await manager.saveFeatureAnalysis(analysis)
    const loaded = await manager.loadFeatureAnalysis()

    expect(loaded).not.toBeNull()
    expect(loaded!.features).toHaveLength(1)
    expect(loaded!.codebaseHash).toBe('abc123')
  })

  it('should return null when no cache exists', async () => {
    await manager.init()
    const loaded = await manager.loadFeatureAnalysis()
    expect(loaded).toBeNull()
  })

  it('should list all sessions regardless of status', async () => {
    await manager.init()

    const sessions: ReviewSession[] = [
      {
        id: 'complete-1',
        startedAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        status: 'completed',
        config: { focusAreas: [], selectedFeatures: ['f1'] },
        plan: { features: [], totalFeatures: 1, selectedCount: 1 },
        progress: { currentFeatureIndex: 1, completedFeatures: ['f1'], featureResults: {} }
      },
      {
        id: 'in-progress-1',
        startedAt: new Date('2024-01-02'),
        updatedAt: new Date('2024-01-03'),
        status: 'in_progress',
        config: { focusAreas: [], selectedFeatures: ['f1', 'f2'] },
        plan: { features: [], totalFeatures: 2, selectedCount: 2 },
        progress: { currentFeatureIndex: 0, completedFeatures: [], featureResults: {} }
      },
      {
        id: 'paused-1',
        startedAt: new Date('2024-01-03'),
        updatedAt: new Date('2024-01-04'),
        status: 'paused',
        config: { focusAreas: [], selectedFeatures: ['f1'] },
        plan: { features: [], totalFeatures: 1, selectedCount: 1 },
        progress: { currentFeatureIndex: 0, completedFeatures: [], featureResults: {} }
      }
    ]

    for (const session of sessions) {
      await manager.saveSession(session)
    }

    const allSessions = await manager.listAllSessions()
    expect(allSessions).toHaveLength(3)

    // Should be sorted by updatedAt descending
    expect(allSessions[0].id).toBe('paused-1')
    expect(allSessions[1].id).toBe('in-progress-1')
    expect(allSessions[2].id).toBe('complete-1')
  })

  it('should preserve existing loop artifacts when later saves omit tmux details', async () => {
    await manager.initLoopSessions()
    process.env.MAGPIE_HOME = tempDir

    const initialSession: LoopSession = {
      id: 'loop-123',
      title: 'Loop session',
      goal: 'Ship checkout safely',
      prdPath: '/tmp/prd.md',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:00:00.000Z'),
      status: 'running',
      currentStageIndex: 0,
      stages: ['plan'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir: '/tmp/loop-123',
        eventsPath: '/tmp/events.jsonl',
        planPath: '/tmp/plan.json',
        humanConfirmationPath: '/tmp/human_confirmation.md',
        failureLogDir: '/tmp/loop-123/failures',
        failureIndexPath: '/tmp/repo/.magpie/failure-index.json',
        tmuxSession: 'magpie-loop-123',
        tmuxWindow: '@1',
        tmuxPane: '%1',
      },
    }

    await manager.saveLoopSession(initialSession)

    const laterSession: LoopSession = {
      ...initialSession,
      updatedAt: new Date('2026-04-11T00:05:00.000Z'),
      artifacts: {
        sessionDir: '/tmp/loop-123',
        eventsPath: '/tmp/events.jsonl',
        planPath: '/tmp/plan.json',
        humanConfirmationPath: '/tmp/human_confirmation.md',
      },
    }

    await manager.saveLoopSession(laterSession)

    const raw = await readFile(join(tempDir, '.magpie', 'sessions', 'loop', 'loop-123', 'session.json'), 'utf-8')
    const persisted = JSON.parse(raw) as { artifacts: Record<string, string> }
    expect(persisted.artifacts.tmuxSession).toBe('magpie-loop-123')
    expect(persisted.artifacts.tmuxWindow).toBe('@1')
    expect(persisted.artifacts.tmuxPane).toBe('%1')
    expect(persisted.artifacts.failureLogDir).toBe('/tmp/loop-123/failures')
    expect(persisted.artifacts.failureIndexPath).toBe('/tmp/repo/.magpie/failure-index.json')
  })

  it('should save, load, and list discuss sessions', async () => {
    process.env.MAGPIE_HOME = tempDir
    await manager.initDiscussions()

    await manager.saveDiscussSession({
      id: 'discuss-1',
      title: 'Should complex runs use worktrees?',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:10:00.000Z'),
      status: 'completed',
      reviewerIds: ['claude'],
      rounds: [
        {
          roundNumber: 1,
          topic: 'Complex worktree routing',
          analysis: 'Evaluate isolation tradeoffs.',
          timestamp: new Date('2026-04-11T00:05:00.000Z'),
          messages: [
            {
              reviewerId: 'claude',
              content: 'Prefer isolation for complex runs.',
              timestamp: new Date('2026-04-11T00:05:00.000Z'),
            },
          ],
          summaries: [
            {
              reviewerId: 'claude',
              summary: 'Prefer isolated worktrees.',
            },
          ],
          conclusion: 'Prefer isolated worktrees.',
          tokenUsage: [],
        },
      ],
    })

    await manager.saveDiscussSession({
      id: 'discuss-2',
      title: 'Status rendering',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:20:00.000Z'),
      status: 'active',
      reviewerIds: ['claude'],
      rounds: [],
    })

    const loaded = await manager.loadDiscussSession('discuss-1')
    const listed = await manager.listDiscussSessions()

    expect(loaded?.createdAt).toBeInstanceOf(Date)
    expect(loaded?.rounds[0]?.timestamp).toBeInstanceOf(Date)
    expect(loaded?.rounds[0]?.messages[0]?.timestamp).toBeInstanceOf(Date)
    expect(listed.map((session) => session.id)).toEqual(['discuss-2', 'discuss-1'])
  })

  it('should save, load, and list trd sessions', async () => {
    process.env.MAGPIE_HOME = tempDir
    await manager.initTrdSessions()

    await manager.saveTrdSession({
      id: 'trd-1',
      title: 'Control plane TRD',
      prdPath: '/tmp/prd.md',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:15:00.000Z'),
      stage: 'completed',
      reviewerIds: ['claude'],
      domains: [],
      artifacts: {
        domainOverviewPath: '/tmp/domain-overview.md',
        draftDomainsPath: '/tmp/draft-domains.md',
        confirmedDomainsPath: '/tmp/confirmed-domains.md',
        trdPath: '/tmp/trd.md',
        openQuestionsPath: '/tmp/questions.md',
        partialDir: '/tmp/partials',
        constraintsPath: '/tmp/constraints.json',
      },
      rounds: [
        {
          roundNumber: 1,
          prompt: 'Freeze the API before parallel work starts.',
          summary: 'Freeze API contracts before parallel work.',
          timestamp: new Date('2026-04-11T00:05:00.000Z'),
        },
      ],
    })

    await manager.saveTrdSession({
      id: 'trd-2',
      title: 'Runtime TRD',
      prdPath: '/tmp/prd-2.md',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:30:00.000Z'),
      stage: 'overview_drafted',
      reviewerIds: ['claude'],
      domains: [],
      artifacts: {
        domainOverviewPath: '/tmp/domain-overview-2.md',
        draftDomainsPath: '/tmp/draft-domains-2.md',
        confirmedDomainsPath: '/tmp/confirmed-domains-2.md',
        trdPath: '/tmp/trd-2.md',
        openQuestionsPath: '/tmp/questions-2.md',
        partialDir: '/tmp/partials-2',
        constraintsPath: '/tmp/constraints-2.json',
      },
      rounds: [],
    })

    const loaded = await manager.loadTrdSession('trd-1')
    const listed = await manager.listTrdSessions()

    expect(loaded?.updatedAt).toBeInstanceOf(Date)
    expect(loaded?.rounds[0]?.timestamp).toBeInstanceOf(Date)
    expect(loaded?.artifacts.constraintsPath).toBe('/tmp/constraints.json')
    expect(listed.map((session) => session.id)).toEqual(['trd-2', 'trd-1'])
    expect(await readFile(join(tempDir, '.magpie', 'sessions', 'trd', 'trd-1', 'session.json'), 'utf-8')).toContain('"id": "trd-1"')
  })

  it('should save, load, and list loop sessions', async () => {
    process.env.MAGPIE_HOME = tempDir
    await manager.initLoopSessions()

    await manager.saveLoopSession({
      id: 'loop-a',
      title: 'First loop',
      goal: 'Ship feature A',
      prdPath: '/tmp/prd-a.md',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:10:00.000Z'),
      status: 'completed',
      currentStageIndex: 1,
      stages: ['prd_review'],
      plan: [],
      stageResults: [
        {
          stage: 'prd_review',
          success: true,
          confidence: 0.92,
          summary: 'Reviewed.',
          risks: [],
          retryCount: 0,
          artifacts: ['/tmp/review.md'],
          timestamp: new Date('2026-04-11T00:05:00.000Z'),
        },
      ],
      humanConfirmations: [
        {
          id: 'confirm-1',
          sessionId: 'loop-a',
          stage: 'prd_review',
          status: 'approved',
          decision: 'approved',
          reason: 'Looks good.',
          artifacts: ['/tmp/review.md'],
          nextAction: 'Continue.',
          createdAt: new Date('2026-04-11T00:06:00.000Z'),
          updatedAt: new Date('2026-04-11T00:07:00.000Z'),
        },
      ],
      artifacts: {
        sessionDir: '/tmp/loop-a',
        eventsPath: '/tmp/events-a.jsonl',
        planPath: '/tmp/plan-a.json',
        humanConfirmationPath: '/tmp/human-a.md',
      },
    })

    await manager.saveLoopSession({
      id: 'loop-b',
      title: 'Second loop',
      goal: 'Ship feature B',
      prdPath: '/tmp/prd-b.md',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:20:00.000Z'),
      status: 'running',
      currentStageIndex: 0,
      stages: ['prd_review'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir: '/tmp/loop-b',
        eventsPath: '/tmp/events-b.jsonl',
        planPath: '/tmp/plan-b.json',
        humanConfirmationPath: '/tmp/human-b.md',
      },
    })

    const loaded = await manager.loadLoopSession('loop-a')
    const listed = await manager.listLoopSessions()

    expect(loaded?.createdAt).toBeInstanceOf(Date)
    expect(loaded?.stageResults[0]?.timestamp).toBeInstanceOf(Date)
    expect(loaded?.humanConfirmations[0]?.createdAt).toBeInstanceOf(Date)
    expect(loaded?.humanConfirmations[0]?.updatedAt).toBeInstanceOf(Date)
    expect(listed.map((session) => session.id)).toEqual(['loop-b', 'loop-a'])
    expect(await readFile(join(tempDir, '.magpie', 'sessions', 'loop', 'loop-a', 'session.json'), 'utf-8')).toContain('"id": "loop-a"')
  })
})
