import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const runCapability = vi.fn()
const getTypedCapability = vi.fn()
const createDefaultCapabilityRegistry = vi.fn()
const listWorkflowSessions = vi.fn()
const loadWorkflowSession = vi.fn()
const persistWorkflowSession = vi.fn()
const appendWorkflowEvent = vi.fn()
const launchMagpieInTmux = vi.fn()
const enqueueHarnessSession = vi.fn()
const isHarnessServerRunning = vi.fn()
const loadHarnessGraphArtifact = vi.fn()
const persistHarnessGraphArtifact = vi.fn()
const recordHarnessGraphApprovalDecision = vi.fn()
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
  persistWorkflowSession,
  appendWorkflowEvent,
}))

vi.mock('../../src/cli/commands/tmux-launch.js', () => ({
  launchMagpieInTmux,
}))

vi.mock('../../src/capabilities/workflows/harness-server/runtime.js', () => ({
  enqueueHarnessSession,
  isHarnessServerRunning,
}))

vi.mock('../../src/capabilities/workflows/harness-server/graph.js', () => ({
  loadHarnessGraphArtifact,
  persistHarnessGraphArtifact,
  recordHarnessGraphApprovalDecision,
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
    loadHarnessGraphArtifact.mockResolvedValue(null)
    persistHarnessGraphArtifact.mockResolvedValue('/tmp/harness-graph.json')
    appendWorkflowEvent.mockResolvedValue('/tmp/events.jsonl')
    persistWorkflowSession.mockResolvedValue(undefined)
    recordHarnessGraphApprovalDecision.mockImplementation((graph, input) => ({
      ...graph,
      approvalDecision: input,
    }))
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

  it('resumes a blocked harness session using persisted input metadata', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const previousSessionId = process.env.MAGPIE_SESSION_ID
    loadWorkflowSession.mockResolvedValue({
      id: 'harness-blocked-1',
      capability: 'harness',
      title: 'Ship checkout v2',
      createdAt: new Date('2026-04-10T08:00:00.000Z'),
      updatedAt: new Date('2026-04-10T09:30:00.000Z'),
      status: 'blocked',
      currentStage: 'developing',
      summary: 'Harness paused during loop development stage for human intervention.',
      artifacts: {
        eventsPath: '/tmp/events.jsonl',
      },
      evidence: {
        input: {
          goal: 'Ship checkout v2',
          prdPath: '/tmp/prd.md',
          maxCycles: 2,
          complexity: 'standard',
        },
        configPath: '/tmp/persisted.yaml',
        runtime: {
          retryCount: 0,
          lastReliablePoint: 'blocked_for_human',
        },
      },
    })

    try {
      const { harnessCommand } = await import('../../src/cli/commands/harness.js')
      await harnessCommand.parseAsync(
        ['node', 'harness', 'resume', 'harness-blocked-1'],
        { from: 'node' }
      )

      expect(runCapability).toHaveBeenCalledWith(
        { name: 'harness' },
        expect.objectContaining({
          goal: 'Ship checkout v2',
          prdPath: '/tmp/prd.md',
          maxCycles: 2,
          complexity: 'standard',
        }),
        expect.objectContaining({
          configPath: '/tmp/persisted.yaml',
        })
      )
      expect(logSpy).toHaveBeenCalledWith('Session: harness-1')
      expect(process.env.MAGPIE_SESSION_ID).toBe(previousSessionId)
    } finally {
      if (previousSessionId === undefined) {
        delete process.env.MAGPIE_SESSION_ID
      } else {
        process.env.MAGPIE_SESSION_ID = previousSessionId
      }
      logSpy.mockRestore()
    }
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
    loadHarnessGraphArtifact.mockResolvedValue({
      graphId: 'checkout-v2',
      title: 'Checkout V2',
      goal: 'Ship checkout v2 as a graph',
      status: 'active',
      approvalGates: [],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:05:00.000Z',
      rollup: {
        total: 4,
        pending: 0,
        ready: 1,
        running: 1,
        waitingRetry: 0,
        waitingApproval: 1,
        blocked: 0,
        completed: 1,
        failed: 0,
      },
      nodes: [
        {
          id: 'design-api',
          title: 'Design API',
          goal: 'Lock the API contract',
          type: 'feature',
          dependencies: [],
          state: 'completed',
          riskMarkers: [],
          approvalGates: [],
        },
        {
          id: 'build-ui',
          title: 'Build UI',
          goal: 'Build checkout screens',
          type: 'feature',
          dependencies: ['design-api'],
          state: 'ready',
          conflictScope: 'src/checkout',
          riskMarkers: ['touches-checkout-ui'],
          approvalGates: [],
          statusReason: 'Ready to run.',
        },
        {
          id: 'qa-rollout',
          title: 'QA rollout',
          goal: 'Validate rollout',
          type: 'validation',
          dependencies: ['build-ui'],
          state: 'running',
          riskMarkers: [],
          approvalGates: [],
        },
        {
          id: 'release-approval',
          title: 'Release approval',
          goal: 'Approve release',
          type: 'approval',
          dependencies: ['qa-rollout'],
          state: 'waiting_approval',
          riskMarkers: [],
          approvalGates: [],
          statusReason: 'Waiting for node approval: Approve release',
        },
      ],
      version: 1,
    })
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
    expect(logSpy).toHaveBeenCalledWith('Graph: checkout-v2 | active | total=4 ready=1 running=1 waiting_approval=1 blocked=0 completed=1 failed=0')
    expect(logSpy).toHaveBeenCalledWith('Graph ready: build-ui')
    expect(logSpy).toHaveBeenCalledWith('Graph waiting approval: release-approval')
    expect(logSpy).toHaveBeenCalledWith('Rounds: 1=revise')
    expect(logSpy).toHaveBeenCalledWith('Latest round: revise | next: Fix rollback handling before rerun.')
    expect(logSpy).toHaveBeenCalledWith('Participants: developer=codex, reviewer-1=claude-code, arbitrator=codex')
    expect(logSpy).toHaveBeenCalledWith('Review notes: reviewer-1: Missing rollback handling.')
    expect(logSpy).toHaveBeenCalledWith('Decision note: Need another cycle after rollback fixes.')
    expect(logSpy).toHaveBeenCalledWith('Events: /tmp/events.jsonl')
    expect(logSpy).toHaveBeenCalledWith('Document mode: project_docs')
    expect(logSpy).toHaveBeenCalledWith('Formal docs root: /tmp/repo/docs/v2/checkout')
    expect(logSpy).toHaveBeenCalledWith('Loop status: completed')
    expect(logSpy).toHaveBeenCalledWith('Loop summary: Loop completed successfully. MR created: https://gitlab.example.com/team/project/-/merge_requests/42')
    expect(logSpy).toHaveBeenCalledWith('Loop MR: created https://gitlab.example.com/team/project/-/merge_requests/42')
    expect(logSpy).toHaveBeenCalledWith('Loop stage: code_development')
    expect(logSpy).toHaveBeenCalledWith('Last activity: 2026-04-11T00:00:07.000Z')
    expect(logSpy).toHaveBeenCalledWith('Loop activity: 2026-04-11T00:00:07.000Z stage=code_development Codex 正在执行命令。')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Knowledge: '))
    logSpy.mockRestore()
  })

  it('prints a selected persisted cycle for status and inspect', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    loadWorkflowSessionsDetail()
    const { harnessCommand } = await import('../../src/cli/commands/harness.js')

    await harnessCommand.parseAsync(
      ['node', 'harness', 'status', 'harness-1', '--cycle', '1'],
      { from: 'node' }
    )
    await harnessCommand.parseAsync(
      ['node', 'harness', 'inspect', 'harness-1', '--cycle', '1'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('Round 1: revise | next: Fix rollback handling before rerun.')
    expect(logSpy).toHaveBeenCalledWith('Participants: developer=codex, reviewer-1=claude-code, arbitrator=codex')
    expect(logSpy).toHaveBeenCalledWith('Decision note: Need another cycle after rollback fixes.')
    logSpy.mockRestore()
  })

  it('prints a selected graph node for status and inspect', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    loadWorkflowSessionsDetail()
    loadHarnessGraphArtifact.mockResolvedValue({
      graphId: 'checkout-v2',
      title: 'Checkout V2',
      goal: 'Ship checkout v2 as a graph',
      status: 'active',
      approvalGates: [],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:05:00.000Z',
      rollup: {
        total: 2,
        pending: 0,
        ready: 1,
        running: 0,
        waitingRetry: 0,
        waitingApproval: 0,
        blocked: 0,
        completed: 1,
        failed: 0,
      },
      nodes: [
        {
          id: 'design-api',
          title: 'Design API',
          goal: 'Lock the API contract',
          type: 'feature',
          dependencies: [],
          state: 'completed',
          riskMarkers: [],
          approvalGates: [],
        },
        {
          id: 'build-ui',
          title: 'Build UI',
          goal: 'Build checkout screens',
          type: 'feature',
          dependencies: ['design-api'],
          state: 'ready',
          conflictScope: 'src/checkout',
          riskMarkers: ['touches-checkout-ui'],
          approvalGates: [],
          statusReason: 'Ready to run.',
        },
      ],
      version: 1,
    })

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')

    await harnessCommand.parseAsync(
      ['node', 'harness', 'status', 'harness-1', '--node', 'build-ui'],
      { from: 'node' }
    )
    await harnessCommand.parseAsync(
      ['node', 'harness', 'inspect', 'harness-1', '--node', 'build-ui'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('Node: build-ui | ready | Build UI')
    expect(logSpy).toHaveBeenCalledWith('Node goal: Build checkout screens')
    expect(logSpy).toHaveBeenCalledWith('Node dependencies: design-api')
    expect(logSpy).toHaveBeenCalledWith('Node conflict scope: src/checkout')
    expect(logSpy).toHaveBeenCalledWith('Node risks: touches-checkout-ui')
    expect(logSpy).toHaveBeenCalledWith('Node reason: Ready to run.')
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
    expect(logSpy).toHaveBeenCalledWith('Document mode: project_docs')
    expect(logSpy).toHaveBeenCalledWith('Formal docs root: /tmp/repo/docs/v2/checkout')
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
        artifacts: {
          graphPath: '/tmp/harness-2/graph.json',
        },
      },
      {
        id: 'harness-1',
        status: 'in_progress',
        currentStage: 'reviewing',
        updatedAt: new Date('2026-04-10T09:00:00.000Z'),
        title: 'Payments',
        artifacts: {},
      },
    ])
    loadHarnessGraphArtifact.mockImplementation(async (_cwd, sessionId: string) => {
      if (sessionId !== 'harness-2') {
        return null
      }
      return {
        graphId: 'checkout-v2',
        title: 'Checkout V2',
        goal: 'Ship checkout v2 as a graph',
        status: 'active',
        approvalGates: [],
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:05:00.000Z',
        rollup: {
          total: 3,
          pending: 0,
          ready: 1,
          running: 1,
          waitingRetry: 0,
          waitingApproval: 0,
          blocked: 0,
          completed: 1,
          failed: 0,
        },
        nodes: [],
        version: 1,
      }
    })

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')

    await harnessCommand.parseAsync(
      ['node', 'harness', 'list'],
      { from: 'node' }
    )

    expect(listWorkflowSessions).toHaveBeenCalledWith(process.cwd(), 'harness')
    expect(logSpy).toHaveBeenCalledWith('harness-2\tcompleted\tcompleted\t2026-04-10T10:00:00.000Z\tCheckout\tgraph=checkout-v2:active:ready=1:running=1:waiting_approval=0:blocked=0')
    expect(logSpy).toHaveBeenCalledWith('harness-1\tin_progress\treviewing\t2026-04-10T09:00:00.000Z\tPayments')
    logSpy.mockRestore()
  })

  it('fails clearly when a requested graph node is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = 0
    loadWorkflowSessionsDetail()
    loadHarnessGraphArtifact.mockResolvedValue({
      graphId: 'checkout-v2',
      title: 'Checkout V2',
      goal: 'Ship checkout v2 as a graph',
      status: 'active',
      approvalGates: [],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:05:00.000Z',
      rollup: {
        total: 1,
        pending: 0,
        ready: 1,
        running: 0,
        waitingRetry: 0,
        waitingApproval: 0,
        blocked: 0,
        completed: 0,
        failed: 0,
      },
      nodes: [
        {
          id: 'build-ui',
          title: 'Build UI',
          goal: 'Build checkout screens',
          type: 'feature',
          dependencies: [],
          state: 'ready',
          riskMarkers: [],
          approvalGates: [],
        },
      ],
      version: 1,
    })

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')
    await harnessCommand.parseAsync(
      ['node', 'harness', 'status', 'harness-1', '--node', 'missing-node'],
      { from: 'node' }
    )

    expect(process.exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('Harness graph node not found: missing-node')
    errorSpy.mockRestore()
  })

  it('records an approval decision for a graph node', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    loadWorkflowSession.mockResolvedValue({
      id: 'harness-1',
      capability: 'harness',
      status: 'queued',
      currentStage: 'queued',
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
      updatedAt: new Date('2026-04-13T00:05:00.000Z'),
      title: 'Checkout',
      summary: 'Queued.',
      artifacts: {
        graphPath: '/tmp/harness-1/graph.json',
        eventsPath: '/tmp/harness-1/events.jsonl',
      },
    })
    loadHarnessGraphArtifact.mockResolvedValue({
      graphId: 'checkout-v2',
      title: 'Checkout V2',
      goal: 'Ship checkout v2 as a graph',
      status: 'active',
      approvalGates: [],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:05:00.000Z',
      rollup: {
        total: 1,
        pending: 0,
        ready: 0,
        running: 0,
        waitingRetry: 0,
        waitingApproval: 1,
        blocked: 0,
        completed: 0,
        failed: 0,
      },
      nodes: [
        {
          id: 'release-approval',
          title: 'Release approval',
          goal: 'Approve release',
          type: 'approval',
          dependencies: [],
          state: 'waiting_approval',
          riskMarkers: [],
          approvalGates: [
            {
              gateId: 'approve-release',
              label: 'Approve release',
              scope: 'before_dispatch',
              status: 'pending',
            },
          ],
          statusReason: 'Waiting for node approval: Approve release',
        },
      ],
      version: 1,
    })
    recordHarnessGraphApprovalDecision.mockReturnValue({
      graphId: 'checkout-v2',
      title: 'Checkout V2',
      goal: 'Ship checkout v2 as a graph',
      status: 'active',
      approvalGates: [],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:06:00.000Z',
      rollup: {
        total: 1,
        pending: 0,
        ready: 1,
        running: 0,
        waitingRetry: 0,
        waitingApproval: 0,
        blocked: 0,
        completed: 0,
        failed: 0,
      },
      nodes: [
        {
          id: 'release-approval',
          title: 'Release approval',
          goal: 'Approve release',
          type: 'approval',
          dependencies: [],
          state: 'ready',
          riskMarkers: [],
          approvalGates: [
            {
              gateId: 'approve-release',
              label: 'Approve release',
              scope: 'before_dispatch',
              status: 'approved',
              decidedBy: 'operator',
              note: 'Safe to proceed.',
            },
          ],
          statusReason: 'Ready to run.',
        },
      ],
      version: 1,
    })

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')
    await harnessCommand.parseAsync(
      ['node', 'harness', 'approve', 'harness-1', '--node', 'release-approval', '--by', 'operator', '--note', 'Safe to proceed.'],
      { from: 'node' }
    )

    expect(recordHarnessGraphApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({ graphId: 'checkout-v2' }),
      expect.objectContaining({
        nodeId: 'release-approval',
        decision: 'approved',
        decidedBy: 'operator',
        note: 'Safe to proceed.',
      }),
    )
    expect(persistHarnessGraphArtifact).toHaveBeenCalledWith(
      process.cwd(),
      'harness-1',
      expect.objectContaining({ graphId: 'checkout-v2' }),
    )
    expect(persistWorkflowSession).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({
        id: 'harness-1',
        summary: 'Approved graph node gate for release-approval.',
      }),
    )
    expect(appendWorkflowEvent).toHaveBeenCalledWith(
      process.cwd(),
      'harness',
      'harness-1',
      expect.objectContaining({
        type: 'graph_approval_recorded',
        summary: 'Approved graph node gate for release-approval.',
      }),
    )
    expect(logSpy).toHaveBeenCalledWith('Decision: approved')
    expect(logSpy).toHaveBeenCalledWith('Target: node release-approval')
    expect(logSpy).toHaveBeenCalledWith('Graph: checkout-v2 | active | total=1 ready=1 running=0 waiting_approval=0 blocked=0 completed=0 failed=0')
    logSpy.mockRestore()
  })

  it('records a rejection decision for the graph gate', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    loadWorkflowSession.mockResolvedValue({
      id: 'harness-1',
      capability: 'harness',
      status: 'queued',
      currentStage: 'queued',
      createdAt: new Date('2026-04-13T00:00:00.000Z'),
      updatedAt: new Date('2026-04-13T00:05:00.000Z'),
      title: 'Checkout',
      summary: 'Queued.',
      artifacts: {
        graphPath: '/tmp/harness-1/graph.json',
        eventsPath: '/tmp/harness-1/events.jsonl',
      },
    })
    loadHarnessGraphArtifact.mockResolvedValue({
      graphId: 'checkout-v2',
      title: 'Checkout V2',
      goal: 'Ship checkout v2 as a graph',
      status: 'active',
      approvalGates: [
        {
          gateId: 'confirm-graph',
          label: 'Confirm graph',
          scope: 'graph_confirmation',
          status: 'pending',
        },
      ],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:05:00.000Z',
      rollup: {
        total: 1,
        pending: 0,
        ready: 0,
        running: 0,
        waitingRetry: 0,
        waitingApproval: 1,
        blocked: 0,
        completed: 0,
        failed: 0,
      },
      nodes: [
        {
          id: 'build-ui',
          title: 'Build UI',
          goal: 'Build checkout screens',
          type: 'feature',
          dependencies: [],
          state: 'waiting_approval',
          riskMarkers: [],
          approvalGates: [],
          statusReason: 'Waiting for graph approval: Confirm graph',
        },
      ],
      version: 1,
    })
    recordHarnessGraphApprovalDecision.mockReturnValue({
      graphId: 'checkout-v2',
      title: 'Checkout V2',
      goal: 'Ship checkout v2 as a graph',
      status: 'blocked',
      approvalGates: [
        {
          gateId: 'confirm-graph',
          label: 'Confirm graph',
          scope: 'graph_confirmation',
          status: 'rejected',
          decidedBy: 'operator',
          note: 'Need a safer split.',
        },
      ],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:06:00.000Z',
      rollup: {
        total: 1,
        pending: 0,
        ready: 0,
        running: 0,
        waitingRetry: 0,
        waitingApproval: 0,
        blocked: 1,
        completed: 0,
        failed: 0,
      },
      nodes: [
        {
          id: 'build-ui',
          title: 'Build UI',
          goal: 'Build checkout screens',
          type: 'feature',
          dependencies: [],
          state: 'blocked',
          riskMarkers: [],
          approvalGates: [],
          statusReason: 'Graph approval rejected: Confirm graph',
        },
      ],
      version: 1,
    })

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')
    await harnessCommand.parseAsync(
      ['node', 'harness', 'reject', 'harness-1', '--by', 'operator', '--note', 'Need a safer split.'],
      { from: 'node' }
    )

    expect(recordHarnessGraphApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({ graphId: 'checkout-v2' }),
      expect.objectContaining({
        decision: 'rejected',
        decidedBy: 'operator',
        note: 'Need a safer split.',
      }),
    )
    expect(logSpy).toHaveBeenCalledWith('Decision: rejected')
    expect(logSpy).toHaveBeenCalledWith('Target: graph')
    expect(logSpy).toHaveBeenCalledWith('Graph: checkout-v2 | blocked | total=1 ready=0 running=0 waiting_approval=0 blocked=1 completed=0 failed=0')
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

  it('fails clearly when a requested cycle is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = 0
    loadWorkflowSessionsDetail()

    const { harnessCommand } = await import('../../src/cli/commands/harness.js')
    await harnessCommand.parseAsync(
      ['node', 'harness', 'status', 'harness-1', '--cycle', '3'],
      { from: 'node' }
    )

    expect(process.exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith('Harness cycle not found: 3')
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
  const documentPlanPath = join(knowledgeDir, 'document-plan.json')
  const loopSessionDir = mkdtempSync(join(tmpdir(), 'magpie-loop-session-'))
  const loopMrResultPath = join(loopSessionDir, 'mr-result.json')
  const roleRoundsDir = join(knowledgeDir, 'role-rounds')
  mkdirSync(summaryDir, { recursive: true })
  mkdirSync(roleRoundsDir, { recursive: true })
  writeFileSync(join(knowledgeDir, 'SCHEMA.md'), '# schema', 'utf-8')
  writeFileSync(join(knowledgeDir, 'index.md'), '# index', 'utf-8')
  writeFileSync(join(knowledgeDir, 'log.md'), '# log', 'utf-8')
  writeFileSync(documentPlanPath, JSON.stringify({
    mode: 'project_docs',
    formalDocsRoot: '/tmp/repo/docs/v2/checkout',
    formalDocTargets: {
      trd: '/tmp/repo/docs/v2/checkout/trd.md',
    },
    artifactPolicy: {
      processArtifactsRoot: '/tmp/repo/.magpie/sessions/harness/harness-1',
      fallbackFormalDocsRoot: '/tmp/repo/.magpie/project-docs/harness-1',
    },
    confidence: 0.86,
    reasoningSources: ['/tmp/repo/AGENTS.md'],
  }, null, 2), 'utf-8')
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
  writeFileSync(join(roleRoundsDir, 'cycle-1.json'), JSON.stringify({
    roundId: 'cycle-1',
    roles: [
      { roleId: 'developer', roleType: 'developer', displayName: 'developer', binding: { tool: 'codex' } },
      { roleId: 'reviewer-1', roleType: 'reviewer', displayName: 'reviewer-1', binding: { tool: 'claude-code' } },
      { roleId: 'arbitrator', roleType: 'arbitrator', displayName: 'arbitrator', binding: { tool: 'codex' } },
    ],
    reviewResults: [
      {
        reviewerRoleId: 'reviewer-1',
        summary: 'Missing rollback handling.',
      },
    ],
    arbitrationResult: {
      summary: 'Need another cycle after rollback fixes.',
    },
    finalAction: 'revise',
    nextRoundBrief: 'Fix rollback handling before rerun.',
  }, null, 2), 'utf-8')
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
  writeFileSync(loopMrResultPath, JSON.stringify({
    status: 'created',
    url: 'https://gitlab.example.com/team/project/-/merge_requests/42',
    branchName: 'sch/harness-1',
    needsHuman: false,
  }, null, 2), 'utf-8')

  loadWorkflowSession.mockImplementation(async (_cwd, capability, sessionId) => {
    if (capability === 'loop' && sessionId === 'loop-1') {
      return {
        id: 'loop-1',
        capability: 'loop',
        title: 'Ship checkout v2',
        createdAt: new Date('2026-04-10T08:00:00.000Z'),
        updatedAt: new Date('2026-04-10T09:20:00.000Z'),
        status: 'completed',
        summary: 'Loop completed successfully. MR created: https://gitlab.example.com/team/project/-/merge_requests/42',
        artifacts: {
          eventsPath: loopEventsPath,
          mrResultPath: loopMrResultPath,
        },
      }
    }

    if (capability !== 'harness' || sessionId !== 'harness-1') {
      return null
    }

    return {
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
        documentPlanPath,
        loopSessionId: 'loop-1',
        loopEventsPath,
        roleRoundsDir,
      },
    }
  })
}
