import { beforeEach, describe, expect, it, vi } from 'vitest'

const runCapability = vi.fn()
const getTypedCapability = vi.fn()
const createDefaultCapabilityRegistry = vi.fn()
const launchMagpieInTmux = vi.fn()
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

vi.mock('../../src/cli/commands/tmux-launch.js', () => ({
  launchMagpieInTmux,
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

describe('capability runtime CLI commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createDefaultCapabilityRegistry.mockReturnValue({ registry: true })
    launchMagpieInTmux.mockResolvedValue({
      sessionId: 'workflow-harness-tmux-1',
      tmuxSession: 'magpie-workflow-harness-tmux-1',
      tmuxWindow: '@1',
      tmuxPane: '%1',
    })
    runCapability.mockResolvedValue({
      output: { summary: 'done' },
      result: { payload: { exitCode: 0 } },
    })
  })

  it('prints provider selection artifact for workflow harness', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    getTypedCapability.mockReturnValue({ name: 'harness' })
    runCapability.mockResolvedValue({
      output: {
        summary: 'done',
        details: {
          id: 'harness-1',
          artifacts: {
            harnessConfigPath: '/tmp/harness.config.yaml',
            roundsPath: '/tmp/rounds.json',
            providerSelectionPath: '/tmp/provider-selection.json',
            routingDecisionPath: '/tmp/routing-decision.json',
            loopSessionId: 'loop-1',
          },
        },
      },
      result: { status: 'completed' },
    })

    const { workflowCommand } = await import('../../src/cli/commands/workflow.js')

    await workflowCommand.parseAsync(
      ['node', 'workflow', 'harness', 'Deliver checkout v2', '--prd', '/tmp/prd.md'],
      { from: 'node' }
    )

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'harness')
    expect(logSpy).toHaveBeenCalledWith('Provider selection: /tmp/provider-selection.json')
    expect(logSpy).toHaveBeenCalledWith('Routing: /tmp/routing-decision.json')
    logSpy.mockRestore()
  })

  it('forwards host overrides through workflow harness', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    getTypedCapability.mockReturnValue({ name: 'harness' })

    const { workflowCommand } = await import('../../src/cli/commands/workflow.js')

    await workflowCommand.parseAsync(
      ['node', 'workflow', 'harness', 'Deliver checkout v2', '--prd', '/tmp/prd.md', '--host', 'tmux'],
      { from: 'node' }
    )

    expect(runCapability).toHaveBeenCalledWith(
      { name: 'harness' },
      expect.objectContaining({
        host: 'tmux',
      }),
      expect.any(Object)
    )
    logSpy.mockRestore()
  })

  it('launches workflow harness in tmux when requested outside the test host', async () => {
    const previousVitest = process.env.VITEST
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    getTypedCapability.mockReturnValue({ name: 'harness' })
    process.env.VITEST = ''

    try {
      const { workflowCommand } = await import('../../src/cli/commands/workflow.js')

      await workflowCommand.parseAsync(
        ['node', 'workflow', 'harness', 'Deliver checkout v2', '--prd', '/tmp/prd.md', '--host', 'tmux', '--review-rounds', '2'],
        { from: 'node' }
      )

      expect(launchMagpieInTmux).toHaveBeenCalledWith({
        capability: 'harness',
        cwd: process.cwd(),
        configPath: undefined,
        argv: [
          'workflow',
          'harness',
          'Deliver checkout v2',
          '--prd',
          '/tmp/prd.md',
          '--host',
          'foreground',
          '--review-rounds',
          '2',
        ],
      })
      expect(runCapability).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith('Session: workflow-harness-tmux-1')
      expect(logSpy).toHaveBeenCalledWith('Host: tmux')
      expect(logSpy).toHaveBeenCalledWith('Tmux: session=magpie-workflow-harness-tmux-1 window=@1 pane=%1')
    } finally {
      process.env.VITEST = previousVitest
      logSpy.mockRestore()
    }
  })

  it('streams workflow harness progress updates before completion', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    getTypedCapability.mockReturnValue({ name: 'harness' })
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
          summary: 'done',
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

    const { workflowCommand } = await import('../../src/cli/commands/workflow.js')

    await workflowCommand.parseAsync(
      ['node', 'workflow', 'harness', 'Deliver checkout v2', '--prd', '/tmp/prd.md'],
      { from: 'node' }
    )

    expect(logSpy).toHaveBeenCalledWith('Session: harness-live')
    expect(logSpy).toHaveBeenCalledWith('2026-04-11T00:00:05.000Z stage_changed stage=developing Running loop development stage.')
    logSpy.mockRestore()
  })

  it('sets a failing exit code when workflow harness returns failed status', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.exitCode = 0
    getTypedCapability.mockReturnValue({ name: 'harness' })
    runCapability.mockResolvedValue({
      output: {
        summary: 'Harness workflow failed.',
        details: {
          id: 'harness-2',
          artifacts: {
            harnessConfigPath: '/tmp/harness.config.yaml',
            roundsPath: '/tmp/rounds.json',
            providerSelectionPath: '/tmp/provider-selection.json',
            routingDecisionPath: '/tmp/routing-decision.json',
            loopSessionId: 'loop-2',
          },
        },
      },
      result: { status: 'failed' },
    })

    const { workflowCommand } = await import('../../src/cli/commands/workflow.js')

    await workflowCommand.parseAsync(
      ['node', 'workflow', 'harness', 'Deliver checkout v2', '--prd', '/tmp/prd.md'],
      { from: 'node' }
    )

    expect(process.exitCode).toBe(1)
    expect(logSpy).toHaveBeenCalledWith('Harness workflow failed.')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Harness failed:'))
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('stops workflow harness progress reporter when execution throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getTypedCapability.mockReturnValue({ name: 'harness' })
    runCapability.mockRejectedValue(new Error('boom'))

    const { workflowCommand } = await import('../../src/cli/commands/workflow.js')

    await workflowCommand.parseAsync(
      ['node', 'workflow', 'harness', 'Deliver checkout v2', '--prd', '/tmp/prd.md'],
      { from: 'node' }
    )

    expect(progressReporterMocks.start).toHaveBeenCalled()
    expect(progressReporterMocks.stop).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('dispatches workflow issue-fix through capability runtime', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    getTypedCapability.mockReturnValue({ name: 'issue-fix' })
    runCapability.mockResolvedValue({
      output: {
        summary: 'issue-fix done',
        details: {
          id: 'issue-fix-1',
          artifacts: {
            planPath: '/tmp/plan.md',
            executionPath: '/tmp/execution.md',
            routingDecisionPath: '/tmp/routing.json',
          },
        },
      },
      result: { status: 'completed' },
    })

    const { workflowCommand } = await import('../../src/cli/commands/workflow.js')

    await workflowCommand.parseAsync(
      ['node', 'workflow', 'issue-fix', 'broken loop', '--apply', '--verify-command', 'npm run test:run'],
      { from: 'node' }
    )

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'issue-fix')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'issue-fix' },
      expect.objectContaining({
        issue: 'broken loop',
        apply: true,
        verifyCommand: 'npm run test:run',
      }),
      expect.any(Object)
    )
    expect(logSpy).toHaveBeenCalledWith('Plan: /tmp/plan.md')
    expect(logSpy).toHaveBeenCalledWith('Execution: /tmp/execution.md')
    expect(logSpy).toHaveBeenCalledWith('Routing: /tmp/routing.json')
    logSpy.mockRestore()
  })

  it('forwards explicit complexity overrides to workflow and discuss capabilities', async () => {
    getTypedCapability.mockReturnValue({ name: 'issue-fix' })
    const { workflowCommand } = await import('../../src/cli/commands/workflow.js')

    await workflowCommand.parseAsync(
      ['node', 'workflow', 'issue-fix', 'broken loop', '--complexity', 'complex'],
      { from: 'node' }
    )

    expect(runCapability).toHaveBeenCalledWith(
      { name: 'issue-fix' },
      expect.objectContaining({ complexity: 'complex' }),
      expect.any(Object)
    )

    vi.clearAllMocks()
    createDefaultCapabilityRegistry.mockReturnValue({ registry: true })
    runCapability.mockResolvedValue({
      output: { summary: 'done' },
      result: { payload: { exitCode: 0 } },
    })
    getTypedCapability.mockReturnValue({ name: 'discuss' })

    const { discussCommand } = await import('../../src/cli/commands/discuss.js')
    await discussCommand.parseAsync(
      ['node', 'discuss', 'topic', '--complexity', 'standard'],
      { from: 'node' }
    )

    expect(runCapability).toHaveBeenCalledWith(
      { name: 'discuss' },
      expect.objectContaining({
        options: expect.objectContaining({ complexity: 'standard' }),
      }),
      expect.any(Object)
    )
  })

  it('dispatches workflow docs-sync through capability runtime', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    getTypedCapability.mockReturnValue({ name: 'docs-sync' })
    runCapability.mockResolvedValue({
      output: {
        summary: 'docs-sync done',
        details: {
          id: 'docs-sync-1',
          artifacts: {
            reportPath: '/tmp/docs-report.md',
          },
        },
      },
      result: { status: 'completed' },
    })

    const { workflowCommand } = await import('../../src/cli/commands/workflow.js')

    await workflowCommand.parseAsync(
      ['node', 'workflow', 'docs-sync', '--apply'],
      { from: 'node' }
    )

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'docs-sync')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'docs-sync' },
      { apply: true },
      expect.any(Object)
    )
    expect(logSpy).toHaveBeenCalledWith('Report: /tmp/docs-report.md')
    logSpy.mockRestore()
  })

  it('dispatches workflow post-merge-regression through capability runtime', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    getTypedCapability.mockReturnValue({ name: 'post-merge-regression' })
    runCapability.mockResolvedValue({
      output: {
        summary: 'post-merge done',
        details: {
          id: 'post-merge-1',
          artifacts: {
            reportPath: '/tmp/regression-report.md',
          },
        },
      },
      result: { status: 'completed' },
    })

    const { workflowCommand } = await import('../../src/cli/commands/workflow.js')

    await workflowCommand.parseAsync(
      ['node', 'workflow', 'post-merge-regression', '--command', 'npm run test:run', 'npm run build'],
      { from: 'node' }
    )

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'post-merge-regression')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'post-merge-regression' },
      { commands: ['npm run test:run', 'npm run build'] },
      expect.any(Object)
    )
    expect(logSpy).toHaveBeenCalledWith('Report: /tmp/regression-report.md')
    logSpy.mockRestore()
  })

  it('dispatches review through capability runtime', async () => {
    getTypedCapability.mockReturnValue({ name: 'review' })
    const { reviewCommand } = await import('../../src/cli/commands/review.js')

    await reviewCommand.parseAsync(['node', 'review', '123', '--format', 'json', '--reviewers', 'claude'], {
      from: 'node',
    })

    expect(createDefaultCapabilityRegistry).toHaveBeenCalled()
    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'review')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'review' },
      expect.objectContaining({
        target: '123',
        options: expect.objectContaining({
          format: 'json',
          reviewers: 'claude',
        }),
      }),
      expect.any(Object)
    )
  })

  it('dispatches discuss through capability runtime', async () => {
    getTypedCapability.mockReturnValue({ name: 'discuss' })
    const { discussCommand } = await import('../../src/cli/commands/discuss.js')

    await discussCommand.parseAsync(['node', 'discuss', 'topic', '--rounds', '2', '--reviewers', 'claude', '--plan-report'], {
      from: 'node',
    })

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'discuss')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'discuss' },
      expect.objectContaining({
        topic: 'topic',
        options: expect.objectContaining({
          rounds: '2',
          reviewers: 'claude',
          planReport: true,
        }),
      }),
      expect.any(Object)
    )
  })

  it('dispatches trd through capability runtime', async () => {
    getTypedCapability.mockReturnValue({ name: 'trd' })
    const { trdCommand } = await import('../../src/cli/commands/trd.js')

    await trdCommand.parseAsync(
      ['node', 'trd', '/tmp/prd.md', '--reviewers', 'claude', '--auto-accept-domains'],
      { from: 'node' }
    )

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'trd')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'trd' },
      expect.objectContaining({
        prdPath: '/tmp/prd.md',
        options: expect.objectContaining({
          reviewers: 'claude',
          autoAcceptDomains: true,
        }),
      }),
      expect.any(Object)
    )
  })

  it('dispatches stats through capability runtime', async () => {
    getTypedCapability.mockReturnValue({ name: 'stats' })
    const { statsCommand } = await import('../../src/cli/commands/stats.js')

    await statsCommand.parseAsync(['node', 'stats', '--since', '14', '--format', 'json'], {
      from: 'node',
    })

    expect(getTypedCapability).toHaveBeenCalledWith({ registry: true }, 'stats')
    expect(runCapability).toHaveBeenCalledWith(
      { name: 'stats' },
      {
        since: 14,
        format: 'json',
      },
      expect.any(Object)
    )
  })
})
