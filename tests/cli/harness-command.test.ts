import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const runCapability = vi.fn()
const getTypedCapability = vi.fn()
const createDefaultCapabilityRegistry = vi.fn()
const listWorkflowSessions = vi.fn()
const loadWorkflowSession = vi.fn()
const launchMagpieInTmux = vi.fn()
const enqueueHarnessSession = vi.fn()
const isHarnessServerRunning = vi.fn()
const progressReporterMocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('../../src/core/capability/runner.js', () => ({
  runCapability,
}))

vi.mock('../../src/core/capability/registry.js', () => ({
  getTypedCapability,
}))

vi.mock('../../src/capabilities/index.js', () => ({
  createDefaultCapabilityRegistry,
}))

vi.mock('../../src/capabilities/workflows/shared/runtime.js', () => ({
  listWorkflowSessions,
  loadWorkflowSession,
}))

vi.mock('../../src/cli/commands/tmux-launch.js', () => ({
  launchMagpieInTmux,
}))

vi.mock('../../src/capabilities/workflows/harness-server/runtime.js', () => ({
  enqueueHarnessSession,
  isHarnessServerRunning,
}))

vi.mock('../../src/cli/commands/harness-progress.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/cli/commands/harness-progress.js')>()
  return {
    ...actual,
    createHarnessProgressReporter: vi.fn((...args: Parameters<typeof actual.createHarnessProgressReporter>) => {
      const reporter = actual.createHarnessProgressReporter(...args)
      return {
        ...reporter,
        start: vi.fn(() => {
          progressReporterMocks.start()
          reporter.start()
        }),
        stop: vi.fn(() => {
          progressReporterMocks.stop()
          reporter.stop()
        }),
      }
    }),
  }
})

describe('top-level harness CLI command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
    createDefaultCapabilityRegistry.mockReturnValue({ registry: true })
    getTypedCapability.mockReturnValue({ name: 'harness' })
    launchMagpieInTmux.mockResolvedValue({
      sessionId: 'harness-tmux-1',
      tmuxSession: 'magpie-harness-tmux-1',
      tmuxWindow: '@1',
      tmuxPane: '%1',
    })
    isHarnessServerRunning.mockResolvedValue(false)
    enqueueHarnessSession.mockResolvedValue({
      id: 'harness-queued-1',
      status: 'queued',
      artifacts: {
        eventsPath: '/tmp/queued-events.jsonl',
      },
    })
    runCapability.mockResolvedValue({
      output: {
        summary: 'Harness approved after 1 cycle(s).',
        details: {
          id: 'harness-1',
          status: 'completed',
          currentStage: 'completed',
          artifacts: {
            harnessConfigPath: '/tmp/harness.config.yaml',
            roundsPath: '/tmp/rounds.json',
            providerSelectionPath: '/tmp/provider-selection.json',
            routingDecisionPath: '/tmp/routing-decision.json',
            eventsPath: '/tmp/events.jsonl',
            knowledgeSchemaPath: '/tmp/knowledge/SCHEMA.md',
            knowledgeIndexPath: '/tmp/knowledge/index.md',
            knowledgeLogPath: '/tmp/knowledge/log.md',
            knowledgeSummaryDir: '/tmp/knowledge/summaries',
            knowledgeCandidatesPath: '/tmp/knowledge/candidates.json',
            loopSessionId: 'loop-1',
          },
        },
      },
      result: { status: 'completed' },
    })
  })

  it('submits a harness run through the capability runtime', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { harnessCommand } = await import('../../src/cli/commands/harness.js')

    await harnessCommand.parseAsync(
      ['node', 'harness', 'submit', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
      { from: 'node' }
    )

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'harness')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'harness' },
      expect.objectContaining({
        goal: 'Ship checkout v2',
        prdPath: '/tmp/prd.md',
      }),
      expect.any(Object)
    )
    expect(logSpy).toHaveBeenCalledWith('Session: harness-1')
    expect(logSpy).toHaveBeenCalledWith('Events: /tmp/events.jsonl')
    logSpy.mockRestore()
  })

  it('queues submit through the harness server when the background service is running', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    isHarnessServerRunning.mockResolvedValue(true)
    const { harnessCommand } = await import('../../src/cli/commands/harness.js')

    await harnessCommand.parseAsync(
      ['node', 'harness', 'submit', 'Ship checkout v2', '--prd', '/tmp/prd.md', '--priority', 'high', '--config', '/tmp/custom.yaml'],
      { from: 'node' }
    )

    expect(enqueueHarnessSession).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        goal: 'Ship checkout v2',
        prdPath: '/tmp/prd.md',
        priority: 'high',
      }),
      { configPath: '/tmp/custom.yaml' }
    )
    expect(runCapability).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('Harness session queued.')
    expect(logSpy).toHaveBeenCalledWith('Session: harness-queued-1')
    expect(logSpy).toHaveBeenCalledWith('Status: queued')
    expect(logSpy).toHaveBeenCalledWith('Priority: high')
    logSpy.mockRestore()
  })

  it('forwards host overrides and prints workspace metadata', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    runCapability.mockResolvedValue({
      output: {
        summary: 'Harness approved after 1 cycle(s).',
        details: {
          id: 'harness-1',
          status: 'completed',
          currentStage: 'completed',
          artifacts: {
            harnessConfigPath: '/tmp/harness.config.yaml',
            roundsPath: '/tmp/rounds.json',
            providerSelectionPath: '/tmp/provider-selection.json',
            routingDecisionPath: '/tmp/routing-decision.json',
            eventsPath: '/tmp/events.jsonl',
            workspaceMode: 'worktree',
            workspacePath: '/tmp/.worktrees/sch/harness-1',
            worktreeBranch: 'sch/harness-1',
            executionHost: 'tmux',
            tmuxSession: 'magpie-harness-1',
            tmuxWindow: '@1',
            tmuxPane: '%1',
          },
        },
      },
      result: { status: 'completed' },
    })

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')
    await harnessCommand.parseAsync(
      ['node', 'harness', 'submit', 'Ship checkout v2', '--prd', '/tmp/prd.md', '--host', 'tmux'],
      { from: 'node' }
    )

    expect(runCapability).toHaveBeenCalledWith(
      { name: 'harness' },
      expect.objectContaining({
        host: 'tmux',
      }),
      expect.any(Object)
    )
    expect(logSpy).toHaveBeenCalledWith('Workspace: /tmp/.worktrees/sch/harness-1 (worktree)')
    expect(logSpy).toHaveBeenCalledWith('Host: tmux')
    expect(logSpy).toHaveBeenCalledWith('Tmux: session=magpie-harness-1 window=@1 pane=%1')
    logSpy.mockRestore()
  })

  it('launches submit in tmux when requested outside the test host', async () => {
    const previousVitest = process.env.VITEST
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.VITEST = ''

    try {
      const { harnessCommand } = await import('../../src/cli/commands/harness.js')
      await harnessCommand.parseAsync(
        ['node', 'harness', 'submit', 'Ship checkout v2', '--prd', '/tmp/prd.md', '--host', 'tmux', '--max-cycles', '2'],
        { from: 'node' }
      )

      expect(launchMagpieInTmux).toHaveBeenCalledWith({
        capability: 'harness',
        cwd: process.cwd(),
        configPath: undefined,
        argv: [
          'harness',
          'submit',
          'Ship checkout v2',
          '--prd',
          '/tmp/prd.md',
          '--host',
          'foreground',
          '--max-cycles',
          '2',
        ],
      })
      expect(runCapability).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith('Session: harness-tmux-1')
      expect(logSpy).toHaveBeenCalledWith('Host: tmux')
      expect(logSpy).toHaveBeenCalledWith('Tmux: session=magpie-harness-tmux-1 window=@1 pane=%1')
    } finally {
      process.env.VITEST = previousVitest
      logSpy.mockRestore()
    }
  })

  it('streams harness progress updates before completion', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    runCapability.mockImplementation(async (_capability, _input, ctx) => {
      const reporter = ctx.metadata?.harnessProgress as {
        onSessionUpdate?: (session: Record<string, unknown>) => void
        onEvent?: (event: Record<string, unknown>) => void
      }
      reporter.onSessionUpdate?.({
        id: 'harness-live',
        status: 'in_progress',
        currentStage: 'queued',
        artifacts: {
          eventsPath: '/tmp/live-events.jsonl',
        },
      })
      reporter.onEvent?.({
        sessionId: 'harness-live',
        timestamp: '2026-04-11T00:00:05.000Z',
        type: 'stage_changed',
        stage: 'developing',
        summary: 'Running loop development stage.',
      })
      return {
        output: {
          summary: 'Harness approved after 1 cycle(s).',
          details: {
            id: 'harness-live',
            status: 'completed',
            currentStage: 'completed',
            artifacts: {
              harnessConfigPath: '/tmp/harness.config.yaml',
              roundsPath: '/tmp/rounds.json',
              providerSelectionPath: '/tmp/provider-selection.json',
              routingDecisionPath: '/tmp/routing-decision.json',
              eventsPath: '/tmp/live-events.jsonl',
            },
          },
        },
        result: { status: 'completed' },
      }
    })
    const { harnessCommand } = await import('../../src/cli/commands/harness.js')

    await harnessCommand.parseAsync(
      ['node', 'harness', 'submit', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('Session: harness-live')
    expect(logSpy).toHaveBeenCalledWith('2026-04-11T00:00:05.000Z stage_changed stage=developing Running loop development stage.')
    logSpy.mockRestore()
  })

  it('prints a detailed status view for a persisted harness session', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    loadWorkflowSessionsDetail()
    const { harnessCommand } = await import('../../src/cli/commands/harness.js')

    await harnessCommand.parseAsync(
      ['node', 'harness', 'status', 'harness-1'],
      { from: 'node' }
    )

    expect(loadWorkflowSession).toHaveBeenCalledWith(process.cwd(), 'harness', 'harness-1')
    expect(logSpy).toHaveBeenCalledWith('Status: in_progress')
    expect(logSpy).toHaveBeenCalledWith('Stage: reviewing')
    expect(logSpy).toHaveBeenCalledWith('Workspace: /tmp/.worktrees/sch/harness-1 (worktree)')
    expect(logSpy).toHaveBeenCalledWith('Host: tmux')
    expect(logSpy).toHaveBeenCalledWith('Tmux: session=magpie-harness-1 window=@1 pane=%1')
    expect(logSpy).toHaveBeenCalledWith('Events: /tmp/events.jsonl')
    expect(logSpy).toHaveBeenCalledWith('Loop stage: code_development')
    expect(logSpy).toHaveBeenCalledWith('Last activity: 2026-04-11T00:00:07.000Z')
    expect(logSpy).toHaveBeenCalledWith('Loop activity: 2026-04-11T00:00:07.000Z stage=code_development Codex 正在执行命令。')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Knowledge: '))
    logSpy.mockRestore()
  })

  it('prints a knowledge-focused inspect view for a persisted harness session', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    loadWorkflowSessionsDetail()
    const { harnessCommand } = await import('../../src/cli/commands/harness.js')

    await harnessCommand.parseAsync(
      ['node', 'harness', 'inspect', 'harness-1'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('Goal: Ship checkout v2')
    expect(logSpy).toHaveBeenCalledWith('State: reviewing | next: Run adjudication for cycle 1. | blocker: Waiting for review cycle result.')
    expect(logSpy).toHaveBeenCalledWith('Latest summary: Latest stage summary')
    expect(logSpy).toHaveBeenCalledWith('Open issues: Missing migration rollback drill')
    expect(logSpy).toHaveBeenCalledWith('Candidates: decision:Prefer staged rollout')
    logSpy.mockRestore()
  })

  it('lists persisted harness sessions in updated order', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    listWorkflowSessions.mockResolvedValue([
      {
        id: 'harness-2',
        status: 'completed',
        currentStage: 'completed',
        updatedAt: new Date('2026-04-10T10:00:00.000Z'),
        title: 'Checkout',
      },
      {
        id: 'harness-1',
        status: 'in_progress',
        currentStage: 'reviewing',
        updatedAt: new Date('2026-04-10T09:00:00.000Z'),
        title: 'Payments',
      },
    ])

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')

    await harnessCommand.parseAsync(
      ['node', 'harness', 'list'],
      { from: 'node' }
    )

    expect(listWorkflowSessions).toHaveBeenCalledWith(process.cwd(), 'harness')
    expect(logSpy).toHaveBeenCalledWith('harness-2\tcompleted\tcompleted\t2026-04-10T10:00:00.000Z\tCheckout')
    expect(logSpy).toHaveBeenCalledWith('harness-1\tin_progress\treviewing\t2026-04-10T09:00:00.000Z\tPayments')
    logSpy.mockRestore()
  })

  it('sets a failing exit code when submit returns failed status', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = 0
    runCapability.mockResolvedValue({
      output: {
        summary: 'Harness failed after 1 cycle(s) without approval.',
      },
      result: { status: 'failed' },
    })

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')
    await harnessCommand.parseAsync(
      ['node', 'harness', 'submit', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
      { from: 'node' }
    )

    expect(process.exitCode).toBe(1)
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('stops the progress reporter when submit throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    runCapability.mockRejectedValue(new Error('boom'))

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')
    await harnessCommand.parseAsync(
      ['node', 'harness', 'submit', 'Ship checkout v2', '--prd', '/tmp/prd.md'],
      { from: 'node' }
    )

    expect(progressReporterMocks.start).toHaveBeenCalled()
    expect(progressReporterMocks.stop).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('prints a deterministic error when status session is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    loadWorkflowSession.mockResolvedValue(null)
    process.exitCode = 0

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')
    await harnessCommand.parseAsync(
      ['node', 'harness', 'status', 'missing-session'],
      { from: 'node' }
    )

    expect(process.exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('Harness session not found: missing-session')
    errorSpy.mockRestore()
  })

  it('prints persisted events during attach once', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-events-'))
    const eventsPath = join(dir, 'events.jsonl')
    writeFileSync(eventsPath, [
      JSON.stringify({
        timestamp: '2026-04-10T09:00:00.000Z',
        type: 'workflow_started',
        stage: 'queued',
        summary: 'Harness workflow started.',
      }),
      JSON.stringify({
        timestamp: '2026-04-10T09:01:00.000Z',
        type: 'cycle_completed',
        stage: 'reviewing',
        cycle: 1,
        summary: 'Cycle 1 requested more changes.',
      }),
    ].join('\n'), 'utf-8')
    loadWorkflowSession.mockResolvedValue({
      id: 'harness-3',
      capability: 'harness',
      title: 'Attach flow',
      createdAt: new Date('2026-04-10T08:00:00.000Z'),
      updatedAt: new Date('2026-04-10T09:30:00.000Z'),
      status: 'in_progress',
      currentStage: 'reviewing',
      summary: 'Running review cycle 1.',
      artifacts: {
        eventsPath,
      },
    })

    try {
      const { harnessCommand } = await import('../../src/cli/commands/harness.js')
      await harnessCommand.parseAsync(
        ['node', 'harness', 'attach', 'harness-3', '--once'],
        { from: 'node' }
      )

      expect(logSpy).toHaveBeenCalledWith('2026-04-10T09:00:00.000Z workflow_started stage=queued Harness workflow started.')
      expect(logSpy).toHaveBeenCalledWith('2026-04-10T09:01:00.000Z cycle_completed stage=reviewing cycle=1 Cycle 1 requested more changes.')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      logSpy.mockRestore()
    }
  })

  it('prints a friendly message when attach has no event stream', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    loadWorkflowSession.mockResolvedValue({
      id: 'harness-4',
      capability: 'harness',
      title: 'Empty events',
      createdAt: new Date('2026-04-10T08:00:00.000Z'),
      updatedAt: new Date('2026-04-10T09:30:00.000Z'),
      status: 'in_progress',
      summary: 'Running review cycle 1.',
      artifacts: {},
    })

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')
    await harnessCommand.parseAsync(
      ['node', 'harness', 'attach', 'harness-4', '--once'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('No persisted event stream for this session.')
    logSpy.mockRestore()
  })

  it('ignores a truncated trailing event line during attach', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const dir = mkdtempSync(join(tmpdir(), 'magpie-harness-events-bad-'))
    const eventsPath = join(dir, 'events.jsonl')
    writeFileSync(eventsPath, [
      JSON.stringify({
        timestamp: '2026-04-10T09:00:00.000Z',
        type: 'workflow_started',
        stage: 'queued',
        summary: 'Harness workflow started.',
      }),
      '{"timestamp":"2026-04-10T09:01:00.000Z"',
    ].join('\n'), 'utf-8')
    loadWorkflowSession.mockResolvedValue({
      id: 'harness-5',
      capability: 'harness',
      title: 'Broken events',
      createdAt: new Date('2026-04-10T08:00:00.000Z'),
      updatedAt: new Date('2026-04-10T09:30:00.000Z'),
      status: 'in_progress',
      currentStage: 'reviewing',
      summary: 'Running review cycle 1.',
      artifacts: {
        eventsPath,
      },
    })

    try {
      const { harnessCommand } = await import('../../src/cli/commands/harness.js')
      await harnessCommand.parseAsync(
        ['node', 'harness', 'attach', 'harness-5', '--once'],
        { from: 'node' }
      )

      expect(logSpy).toHaveBeenCalledWith('2026-04-10T09:00:00.000Z workflow_started stage=queued Harness workflow started.')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      logSpy.mockRestore()
    }
  })

  it('prints a friendly message when no harness sessions exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    listWorkflowSessions.mockResolvedValue([])

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')
    await harnessCommand.parseAsync(
      ['node', 'harness', 'list'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('No harness sessions found.')
    logSpy.mockRestore()
  })
})

function loadWorkflowSessionsDetail(): void {
  const knowledgeDir = mkdtempSync(join(tmpdir(), 'magpie-harness-knowledge-'))
  const summaryDir = join(knowledgeDir, 'summaries')
  const loopEventsPath = join(knowledgeDir, 'loop-events.jsonl')
  mkdirSync(summaryDir, { recursive: true })
  writeFileSync(join(knowledgeDir, 'SCHEMA.md'), '# schema', 'utf-8')
  writeFileSync(join(knowledgeDir, 'index.md'), '# index', 'utf-8')
  writeFileSync(join(knowledgeDir, 'log.md'), '# log', 'utf-8')
  writeFileSync(loopEventsPath, `${JSON.stringify({
    ts: '2026-04-11T00:00:07.000Z',
    event: 'provider_progress',
    stage: 'code_development',
    provider: 'codex',
    progressType: 'item.started',
    summary: 'shell command started.',
  })}\n`, 'utf-8')
  writeFileSync(join(knowledgeDir, 'state.json'), JSON.stringify({
    currentStage: 'reviewing',
    lastReliableResult: 'Loop stage completed.',
    nextAction: 'Run adjudication for cycle 1.',
    currentBlocker: 'Waiting for review cycle result.',
    updatedAt: '2026-04-11T00:05:00.000Z',
  }, null, 2), 'utf-8')
  writeFileSync(join(summaryDir, 'goal.md'), '# Goal\n\nShip checkout v2', 'utf-8')
  writeFileSync(join(summaryDir, 'open-issues.md'), '- Missing migration rollback drill', 'utf-8')
  writeFileSync(join(summaryDir, 'evidence.md'), '- /tmp/review.json', 'utf-8')
  writeFileSync(join(summaryDir, 'stage-cycle-1.md'), 'Latest stage summary', 'utf-8')
  writeFileSync(join(knowledgeDir, 'candidates.json'), JSON.stringify([
    {
      type: 'decision',
      title: 'Prefer staged rollout',
      summary: 'Use canary before full release.',
      sourceSessionId: 'harness-1',
      evidencePath: '/tmp/review.json',
      status: 'candidate',
    },
  ], null, 2), 'utf-8')

  loadWorkflowSession.mockResolvedValue({
    id: 'harness-1',
    capability: 'harness',
    title: 'Ship checkout v2',
    createdAt: new Date('2026-04-10T08:00:00.000Z'),
    updatedAt: new Date('2026-04-10T09:30:00.000Z'),
    status: 'in_progress',
    currentStage: 'reviewing',
    summary: 'Running review cycle 1.',
      artifacts: {
        harnessConfigPath: '/tmp/harness.config.yaml',
        roundsPath: '/tmp/rounds.json',
        providerSelectionPath: '/tmp/provider-selection.json',
        routingDecisionPath: '/tmp/routing-decision.json',
        eventsPath: '/tmp/events.jsonl',
        workspaceMode: 'worktree',
        workspacePath: '/tmp/.worktrees/sch/harness-1',
        executionHost: 'tmux',
        tmuxSession: 'magpie-harness-1',
        tmuxWindow: '@1',
        tmuxPane: '%1',
        knowledgeSchemaPath: join(knowledgeDir, 'SCHEMA.md'),
        knowledgeIndexPath: join(knowledgeDir, 'index.md'),
        knowledgeLogPath: join(knowledgeDir, 'log.md'),
        knowledgeStatePath: join(knowledgeDir, 'state.json'),
      knowledgeSummaryDir: summaryDir,
      knowledgeCandidatesPath: join(knowledgeDir, 'candidates.json'),
      loopSessionId: 'loop-1',
      loopEventsPath,
    },
  })
}
