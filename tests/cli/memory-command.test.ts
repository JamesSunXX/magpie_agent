import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProjectMemoryPath, getUserMemoryPath } from '../../src/memory/runtime.js'
import { StateManager } from '../../src/state/state-manager.js'
import type { LoopSession } from '../../src/state/types.js'

describe('memory CLI command', () => {
  let magpieHome: string | undefined

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.EDITOR
    delete process.env.VISUAL
    if (magpieHome) {
      rmSync(magpieHome, { recursive: true, force: true })
      delete process.env.MAGPIE_HOME
      magpieHome = undefined
    }
  })

  it('shows both memory files and falls back to printing the edit path when no editor is configured', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-memory-cli-home-'))
    process.env.MAGPIE_HOME = magpieHome
    delete process.env.EDITOR
    delete process.env.VISUAL
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-memory-cli-cwd-'))

    mkdirSync(join(magpieHome, 'memories'), { recursive: true })
    writeFileSync(getUserMemoryPath(), '# User Memory\n\n- Prefer concise updates.\n', 'utf-8')
    const projectPath = getProjectMemoryPath(cwd)
    mkdirSync(join(projectPath, '..'), { recursive: true })
    writeFileSync(projectPath, '# Project Memory\n\n- Run tests before final reply.\n', 'utf-8')

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.resetModules()
    const { runMemoryEdit, runMemoryShow } = await import('../../src/cli/commands/memory.js')

    await runMemoryShow({}, cwd)
    await runMemoryEdit({ project: true }, cwd)

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('User memory:'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Project memory:'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Memory file ready:'))
  })

  it('rejects editing both scopes at once', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-memory-edit-both-home-'))
    process.env.MAGPIE_HOME = magpieHome
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-memory-edit-both-cwd-'))

    vi.resetModules()
    const { runMemoryEdit } = await import('../../src/cli/commands/memory.js')

    await expect(runMemoryEdit({ user: true, project: true }, cwd))
      .rejects
      .toThrow('Choose either --user or --project when editing memory')
  })

  it('defaults memory edit to the project scope', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-memory-edit-default-home-'))
    process.env.MAGPIE_HOME = magpieHome
    delete process.env.EDITOR
    delete process.env.VISUAL
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-memory-edit-default-cwd-'))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.resetModules()
    const { runMemoryEdit } = await import('../../src/cli/commands/memory.js')

    await runMemoryEdit({}, cwd)

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(getProjectMemoryPath(cwd)))
  })

  it('promotes loop knowledge candidates into repository knowledge and project memory', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-memory-promote-cli-home-'))
    process.env.MAGPIE_HOME = magpieHome
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-memory-promote-cli-cwd-'))
    const state = new StateManager(cwd)
    await state.initLoopSessions()

    const sessionDir = join(cwd, '.magpie', 'sessions', 'loop', 'loop-123')
    const knowledgeDir = join(sessionDir, 'knowledge')
    const summaryDir = join(knowledgeDir, 'summaries')
    mkdirSync(summaryDir, { recursive: true })
    writeFileSync(join(knowledgeDir, 'candidates.json'), JSON.stringify([
      {
        type: 'decision',
        title: 'Prefer staged rollout',
        summary: 'Roll out to canary before full release.',
        sourceSessionId: 'loop-123',
        status: 'candidate',
      },
    ], null, 2), 'utf-8')

    const session: LoopSession = {
      id: 'loop-123',
      title: 'Checkout delivery',
      goal: 'Ship checkout safely',
      prdPath: '/tmp/prd.md',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:10:00.000Z'),
      status: 'completed',
      currentStageIndex: 1,
      stages: ['prd_review'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir,
        eventsPath: '/tmp/events.jsonl',
        planPath: '/tmp/plan.json',
        humanConfirmationPath: '/tmp/human_confirmation.md',
        knowledgeSummaryDir: summaryDir,
        knowledgeCandidatesPath: join(knowledgeDir, 'candidates.json'),
      },
    }
    await state.saveLoopSession(session)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.resetModules()
    const { runMemoryPromote } = await import('../../src/cli/commands/memory.js')
    await runMemoryPromote('loop-123', cwd)

    expect(logSpy).toHaveBeenCalledWith('Promoted: 1')
    expect(readFileSync(getProjectMemoryPath(cwd), 'utf-8')).toContain('Prefer staged rollout')
  })

  it('promotes into the session repo instead of the current cwd', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-memory-promote-cross-home-'))
    process.env.MAGPIE_HOME = magpieHome
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-memory-promote-cross-cwd-'))
    const sessionRepo = mkdtempSync(join(tmpdir(), 'magpie-memory-promote-session-repo-'))
    const state = new StateManager(cwd)
    await state.initLoopSessions()

    const sessionDir = join(cwd, '.magpie', 'sessions', 'loop', 'loop-cross')
    const knowledgeDir = join(sessionDir, 'knowledge')
    const summaryDir = join(knowledgeDir, 'summaries')
    mkdirSync(summaryDir, { recursive: true })
    writeFileSync(join(knowledgeDir, 'candidates.json'), JSON.stringify([
      {
        type: 'decision',
        title: 'Prefer target repo memory',
        summary: 'Write promoted knowledge into the session repo.',
        sourceSessionId: 'loop-cross',
        status: 'candidate',
      },
    ], null, 2), 'utf-8')

    const session: LoopSession = {
      id: 'loop-cross',
      title: 'Cross repo promotion',
      goal: 'Keep promotion scoped to the original repo',
      prdPath: '/tmp/prd.md',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:10:00.000Z'),
      status: 'completed',
      currentStageIndex: 1,
      stages: ['prd_review'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir,
        repoRootPath: sessionRepo,
        eventsPath: '/tmp/events.jsonl',
        planPath: '/tmp/plan.json',
        humanConfirmationPath: '/tmp/human_confirmation.md',
        knowledgeSummaryDir: summaryDir,
        knowledgeCandidatesPath: join(knowledgeDir, 'candidates.json'),
      },
    }
    await state.saveLoopSession(session)

    vi.resetModules()
    const { runMemoryPromote } = await import('../../src/cli/commands/memory.js')
    await runMemoryPromote('loop-cross', cwd)

    expect(readFileSync(getProjectMemoryPath(sessionRepo), 'utf-8')).toContain('Prefer target repo memory')
    const cwdProjectPath = getProjectMemoryPath(cwd)
    expect(existsSync(cwdProjectPath) ? readFileSync(cwdProjectPath, 'utf-8') : '').not.toContain('Prefer target repo memory')
  })

  it('reports when a session has no promotable candidates', async () => {
    magpieHome = mkdtempSync(join(tmpdir(), 'magpie-memory-promote-empty-home-'))
    process.env.MAGPIE_HOME = magpieHome
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-memory-promote-empty-cwd-'))
    const state = new StateManager(cwd)
    await state.initLoopSessions()

    const sessionDir = join(cwd, '.magpie', 'sessions', 'loop', 'loop-empty')
    const knowledgeDir = join(sessionDir, 'knowledge')
    mkdirSync(knowledgeDir, { recursive: true })
    writeFileSync(join(knowledgeDir, 'candidates.json'), JSON.stringify([
      {
        type: 'note',
        title: 'Temporary observation',
        summary: 'Keep watching',
        sourceSessionId: 'loop-empty',
        status: 'candidate',
      },
    ], null, 2), 'utf-8')

    const session: LoopSession = {
      id: 'loop-empty',
      title: 'Empty promotion run',
      goal: 'Verify no-op handling',
      prdPath: '/tmp/prd.md',
      createdAt: new Date('2026-04-11T00:00:00.000Z'),
      updatedAt: new Date('2026-04-11T00:10:00.000Z'),
      status: 'completed',
      currentStageIndex: 1,
      stages: ['prd_review'],
      plan: [],
      stageResults: [],
      humanConfirmations: [],
      artifacts: {
        sessionDir,
        eventsPath: '/tmp/events.jsonl',
        planPath: '/tmp/plan.json',
        humanConfirmationPath: '/tmp/human_confirmation.md',
        knowledgeSummaryDir: join(knowledgeDir, 'summaries'),
        knowledgeCandidatesPath: join(knowledgeDir, 'candidates.json'),
      },
    }
    await state.saveLoopSession(session)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.resetModules()
    const { runMemoryPromote } = await import('../../src/cli/commands/memory.js')
    await runMemoryPromote('loop-empty', cwd)

    expect(logSpy).toHaveBeenCalledWith('No promotable knowledge candidates found in loop-empty.')
  })
})
