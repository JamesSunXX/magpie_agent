import { beforeEach, describe, expect, it, vi } from 'vitest'

const runCapability = vi.fn()
const getTypedCapability = vi.fn()
const createDefaultCapabilityRegistry = vi.fn()

vi.mock('../../src/core/capability/runner.js', () => ({
  runCapability,
}))

vi.mock('../../src/core/capability/registry.js', () => ({
  getTypedCapability,
}))

vi.mock('../../src/capabilities/index.js', () => ({
  createDefaultCapabilityRegistry,
}))

describe('capability runtime CLI commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createDefaultCapabilityRegistry.mockReturnValue({ registry: true })
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
    logSpy.mockRestore()
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
    logSpy.mockRestore()
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
