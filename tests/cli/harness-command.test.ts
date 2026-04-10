import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const runCapability = vi.fn()
const getTypedCapability = vi.fn()
const createDefaultCapabilityRegistry = vi.fn()
const listWorkflowSessions = vi.fn()
const loadWorkflowSession = vi.fn()

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

describe('top-level harness CLI command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
    createDefaultCapabilityRegistry.mockReturnValue({ registry: true })
    getTypedCapability.mockReturnValue({ name: 'harness' })
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

  it('prints a detailed status view for a persisted harness session', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    loadWorkflowSessionsDetail()
    const { harnessCommand } = await import('../../src/cli/commands/harness.js')

    await harnessCommand.parseAsync(
      ['node', 'harness', 'status', 'harness-1'],
      { from: 'node' }
    )

    expect(loadWorkflowSession).toHaveBeenCalledWith('harness', 'harness-1')
    expect(logSpy).toHaveBeenCalledWith('Status: in_progress')
    expect(logSpy).toHaveBeenCalledWith('Stage: reviewing')
    expect(logSpy).toHaveBeenCalledWith('Events: /tmp/events.jsonl')
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

    expect(listWorkflowSessions).toHaveBeenCalledWith('harness')
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

  it('prints persisted events during attach', async () => {
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
        ['node', 'harness', 'attach', 'harness-3'],
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
      ['node', 'harness', 'attach', 'harness-4'],
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
        ['node', 'harness', 'attach', 'harness-5'],
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
      loopSessionId: 'loop-1',
    },
  })
}
