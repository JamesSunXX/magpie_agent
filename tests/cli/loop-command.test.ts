import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StateManager } from '../../src/state/state-manager.js'
import type { LoopSession } from '../../src/state/types.js'

describe('loop CLI command', () => {
  let magpieHome: string | undefined

  afterEach(() => {
    vi.restoreAllMocks()
    if (magpieHome) {
      rmSync(magpieHome, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
      magpieHome = undefined
    }
  })

  it('prints a knowledge-focused inspect view for a persisted loop session', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-loop-cli-home-'))
    process.env.MAGPIE_HOME = magpieHome
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-loop-cli-cwd-'))
    const state = new StateManager(cwd)
    await state.initLoopSessions()

    const knowledgeDir = join(cwd, '.magpie', 'sessions', 'loop', 'loop-123', 'knowledge')
    const summaryDir = join(knowledgeDir, 'summaries')
    mkdirSync(summaryDir, { recursive: true })
    writeFileSync(join(knowledgeDir, 'SCHEMA.md'), '# schema', 'utf-8')
    writeFileSync(join(knowledgeDir, 'index.md'), '# index', 'utf-8')
    writeFileSync(join(knowledgeDir, 'log.md'), '# log', 'utf-8')
    writeFileSync(join(knowledgeDir, 'state.json'), JSON.stringify({
      currentStage: 'prd_review',
      lastReliableResult: 'Plan synced.',
      nextAction: 'Run PRD review stage.',
      currentBlocker: 'Waiting for PRD review output.',
      updatedAt: '2026-04-11T00:05:00.000Z',
    }, null, 2), 'utf-8')
    writeFileSync(join(summaryDir, 'goal.md'), '# Goal\n\nShip checkout v2 safely', 'utf-8')
    writeFileSync(join(summaryDir, 'open-issues.md'), '- Waiting for canary verification', 'utf-8')
    writeFileSync(join(summaryDir, 'evidence.md'), '- /tmp/evidence.log', 'utf-8')
    writeFileSync(join(summaryDir, 'stage-prd-review.md'), 'Latest stage summary', 'utf-8')
    const documentPlanPath = join(cwd, '.magpie', 'sessions', 'loop', 'loop-123', 'document-plan.json')
    writeFileSync(documentPlanPath, JSON.stringify({
      mode: 'fallback',
      formalDocsRoot: join(cwd, '.magpie', 'project-docs', 'loop-123'),
      formalDocTargets: {
        trd: join(cwd, '.magpie', 'project-docs', 'loop-123', 'trd.md'),
      },
      artifactPolicy: {
        processArtifactsRoot: join(cwd, '.magpie', 'sessions', 'loop', 'loop-123'),
        fallbackFormalDocsRoot: join(cwd, '.magpie', 'project-docs', 'loop-123'),
      },
      confidence: 0.4,
      fallbackReason: 'Model confidence too low.',
      reasoningSources: [join(cwd, 'AGENTS.md')],
    }, null, 2), 'utf-8')
    writeFileSync(join(knowledgeDir, 'candidates.json'), JSON.stringify([
      {
        type: 'decision',
        title: 'Prefer staged rollout',
        summary: 'Use canary rollout before full deploy.',
        sourceSessionId: 'loop-123',
        evidencePath: '/tmp/evidence.log',
        status: 'candidate',
      },
    ], null, 2), 'utf-8')

    const session: LoopSession = {
      id: 'loop-123',
      title: 'Checkout delivery',
      goal: 'Ship checkout v2 safely',
      prdPath: '/tmp/prd.md',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:10:00.000Z'),
      status: 'paused_for_human',
      currentStageIndex: 0,
      stages: ['prd_review'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir: join(cwd, '.magpie', 'sessions', 'loop', 'loop-123'),
        eventsPath: '/tmp/events.jsonl',
        planPath: '/tmp/plan.json',
        humanConfirmationPath: '/tmp/human_confirmation.md',
        knowledgeSchemaPath: join(knowledgeDir, 'SCHEMA.md'),
        knowledgeIndexPath: join(knowledgeDir, 'index.md'),
        knowledgeLogPath: join(knowledgeDir, 'log.md'),
        knowledgeStatePath: join(knowledgeDir, 'state.json'),
        knowledgeSummaryDir: summaryDir,
        knowledgeCandidatesPath: join(knowledgeDir, 'candidates.json'),
        documentPlanPath,
      },
    }
    await state.saveLoopSession(session)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.resetModules()
    const { loopCommand } = await import('../../src/cli/commands/loop.js')
    const previousCwd = process.cwd()

    try {
      process.chdir(cwd)
      await loopCommand.parseAsync(['node', 'loop', 'inspect', 'loop-123'], { from: 'node' })
    } finally {
      process.chdir(previousCwd)
    }

    expect(logSpy).toHaveBeenCalledWith('Goal: Ship checkout v2 safely')
    expect(logSpy).toHaveBeenCalledWith('State: prd_review | next: Run PRD review stage. | blocker: Waiting for PRD review output.')
    expect(logSpy).toHaveBeenCalledWith('Document mode: fallback')
    expect(logSpy).toHaveBeenCalledWith(`Formal docs root: ${join(cwd, '.magpie', 'project-docs', 'loop-123')}`)
    expect(logSpy).toHaveBeenCalledWith('Latest summary: Latest stage summary')
    expect(logSpy).toHaveBeenCalledWith('Open issues: Waiting for canary verification')
    expect(logSpy).toHaveBeenCalledWith(`Knowledge: ${knowledgeDir}`)
    logSpy.mockRestore()
  }, 20_000)

  it('falls back to persisted session status when a legacy session has no state card', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-loop-cli-legacy-home-'))
    process.env.MAGPIE_HOME = magpieHome
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-loop-cli-legacy-cwd-'))
    const state = new StateManager(cwd)
    await state.initLoopSessions()

    const knowledgeDir = join(cwd, '.magpie', 'sessions', 'loop', 'loop-legacy', 'knowledge')
    const summaryDir = join(knowledgeDir, 'summaries')
    mkdirSync(summaryDir, { recursive: true })
    writeFileSync(join(knowledgeDir, 'SCHEMA.md'), '# schema', 'utf-8')
    writeFileSync(join(knowledgeDir, 'index.md'), '# index', 'utf-8')
    writeFileSync(join(knowledgeDir, 'log.md'), '# log', 'utf-8')
    writeFileSync(join(summaryDir, 'goal.md'), '# Goal\n\nAlready finished task', 'utf-8')
    writeFileSync(join(summaryDir, 'stage-prd-review.md'), 'Done', 'utf-8')
    writeFileSync(join(knowledgeDir, 'candidates.json'), '[]', 'utf-8')

    const session: LoopSession = {
      id: 'loop-legacy',
      title: 'Legacy task',
      goal: 'Already finished task',
      prdPath: '/tmp/prd.md',
      createdAt: new Date('2026-04-10T00:00:00.000Z'),
      updatedAt: new Date('2026-04-10T00:10:00.000Z'),
      status: 'completed',
      currentStageIndex: 1,
      stages: ['prd_review'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir: join(cwd, '.magpie', 'sessions', 'loop', 'loop-legacy'),
        eventsPath: '/tmp/events.jsonl',
        planPath: '/tmp/plan.json',
        humanConfirmationPath: '/tmp/human_confirmation.md',
        knowledgeSchemaPath: join(knowledgeDir, 'SCHEMA.md'),
        knowledgeIndexPath: join(knowledgeDir, 'index.md'),
        knowledgeLogPath: join(knowledgeDir, 'log.md'),
        knowledgeSummaryDir: summaryDir,
        knowledgeCandidatesPath: join(knowledgeDir, 'candidates.json'),
      },
    }
    await state.saveLoopSession(session)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.resetModules()
    const { loopCommand } = await import('../../src/cli/commands/loop.js')
    const previousCwd = process.cwd()

    try {
      process.chdir(cwd)
      await loopCommand.parseAsync(['node', 'loop', 'inspect', 'loop-legacy'], { from: 'node' })
    } finally {
      process.chdir(previousCwd)
    }

    expect(logSpy).toHaveBeenCalledWith('State: completed | next: No further action. | blocker: None.')
    logSpy.mockRestore()
  })
})
