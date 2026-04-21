import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runCapability = vi.fn()
const runtimeMocks = vi.hoisted(() => {
  const execFileSync = vi.fn()
  const loadConfig = vi.fn()
  const createOperationsProviders = vi.fn()
  const launchCommand = vi.fn()

  class MockTmuxOperationsProvider {
    readonly id: string

    constructor(id: string) {
      this.id = id
    }

    async launchCommand(input: unknown): Promise<unknown> {
      return launchCommand(input)
    }
  }

  return {
    execFileSync,
    loadConfig,
    createOperationsProviders,
    launchCommand,
    MockTmuxOperationsProvider,
  }
})

vi.mock('../../../src/core/capability/runner.js', () => ({
  runCapability,
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFileSync: runtimeMocks.execFileSync,
  }
})

vi.mock('../../../src/platform/config/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/platform/config/loader.js')>()
  return {
    ...actual,
    loadConfig: runtimeMocks.loadConfig,
  }
})

vi.mock('../../../src/platform/integrations/operations/factory.js', () => ({
  createOperationsProviders: runtimeMocks.createOperationsProviders,
}))

vi.mock('../../../src/platform/integrations/operations/providers/tmux.js', () => ({
  TmuxOperationsProvider: runtimeMocks.MockTmuxOperationsProvider,
}))

describe('harness server runtime', () => {
  let cwd: string
  let configPath: string

  beforeEach(() => {
    vi.clearAllMocks()
    cwd = mkdtempSync(join(tmpdir(), 'magpie-harness-server-'))
    configPath = join(cwd, 'config.yaml')
    mkdirSync(join(cwd, 'docs'), { recursive: true })
    writeFileSync(join(cwd, 'docs', 'prd.md'), '# PRD', 'utf-8')
    writeFileSync(configPath, `providers:
  mock:
    enabled: true
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  baseline:
    model: mock
    prompt: baseline review
summarizer:
  model: mock
  prompt: summarize
analyzer:
  model: mock
  prompt: analyze
capabilities:
  loop:
    enabled: true
    planner_model: mock
    executor_model: mock
  issue_fix:
    enabled: true
    planner_model: mock
    executor_model: mock
integrations:
  notifications:
    enabled: false
`, 'utf-8')
    runtimeMocks.loadConfig.mockReturnValue({
      integrations: {
        operations: {
          default_provider: 'tmux',
        },
      },
    })
    runtimeMocks.createOperationsProviders.mockReturnValue({
      tmux: new runtimeMocks.MockTmuxOperationsProvider('tmux'),
    })
    runtimeMocks.launchCommand.mockResolvedValue({
      sessionName: 'magpie-harness-server-test',
      windowId: '@1',
      paneId: '%1',
    })
    runtimeMocks.execFileSync.mockReturnValue('')
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('enqueues a harness session with queued status and persisted input', async () => {
    const { enqueueHarnessSession, loadHarnessServerState } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    const queued = await enqueueHarnessSession(cwd, {
      goal: 'Ship checkout v2',
      prdPath: join(cwd, 'docs', 'prd.md'),
    }, {
      configPath: '/tmp/custom.yaml',
    })

    expect(queued.status).toBe('queued')
    expect(queued.summary).toContain('Queued')
    expect(queued.evidence).toMatchObject({
      input: {
        goal: 'Ship checkout v2',
        prdPath: join(cwd, 'docs', 'prd.md'),
        priority: 'normal',
      },
      configPath: '/tmp/custom.yaml',
      runtime: {
        retryCount: 0,
        lastReliablePoint: 'queued',
      },
    })
    expect(loadHarnessServerState(cwd)).resolves.toBeNull()
  })

  it('rejects enqueue when the resource guard queue limit is reached', async () => {
    const { enqueueHarnessSession } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')
    runtimeMocks.loadConfig.mockReturnValue({
      capabilities: {
        resource_guard: {
          enabled: true,
          max_queue_size: 1,
        },
      },
      integrations: {
        operations: {
          default_provider: 'tmux',
        },
      },
    })

    await enqueueHarnessSession(cwd, {
      goal: 'First queued task',
      prdPath: join(cwd, 'docs', 'prd.md'),
    }, {
      configPath,
    })

    await expect(enqueueHarnessSession(cwd, {
      goal: 'Second queued task',
      prdPath: join(cwd, 'docs', 'prd.md'),
    }, {
      configPath,
    })).rejects.toThrow('Harness queue limit reached')
  })

  it('uses the default config when enforcing the resource guard queue limit', async () => {
    const { enqueueHarnessSession } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')
    runtimeMocks.loadConfig.mockReturnValue({
      capabilities: {
        resource_guard: {
          enabled: true,
          max_queue_size: 1,
        },
      },
      integrations: {
        operations: {
          default_provider: 'tmux',
        },
      },
    })

    await enqueueHarnessSession(cwd, {
      goal: 'First queued task',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })

    await expect(enqueueHarnessSession(cwd, {
      goal: 'Second queued task',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })).rejects.toThrow('Harness queue limit reached')
    expect(runtimeMocks.loadConfig).toHaveBeenCalledWith(undefined)
  })

  it('fails a harness task that exceeds the resource guard runtime limit', async () => {
    const {
      enqueueHarnessSession,
      runHarnessServerOnce,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')
    const { loadWorkflowSession } = await import('../../../src/capabilities/workflows/shared/runtime.js')
    runtimeMocks.loadConfig.mockReturnValue({
      capabilities: {
        resource_guard: {
          enabled: true,
          max_task_runtime_ms: 25,
        },
      },
      integrations: {
        operations: {
          default_provider: 'tmux',
        },
      },
    })
    runCapability.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return {
        result: {
          status: 'completed',
        },
        output: {
          summary: 'Completed too late.',
        },
      }
    })

    const queued = await enqueueHarnessSession(cwd, {
      goal: 'Slow task',
      prdPath: join(cwd, 'docs', 'prd.md'),
    }, {
      configPath,
    })

    const result = await runHarnessServerOnce({ cwd, configPath })
    const updated = await loadWorkflowSession(cwd, 'harness', queued.id)

    expect(result.status).not.toBe('completed')
    expect(updated?.evidence).toMatchObject({
      runtime: {
        lastError: expect.stringContaining('exceeded max task runtime'),
      },
    })
  })

  it('persists a graph artifact alongside a queued harness session when provided', async () => {
    const { createHarnessGraphArtifact, loadHarnessGraphArtifact } = await import('../../../src/capabilities/workflows/harness-server/graph.js')
    const { enqueueHarnessSession } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    const queued = await enqueueHarnessSession(cwd, {
      goal: 'Ship checkout v2',
      prdPath: join(cwd, 'docs', 'prd.md'),
    }, {
      graph: createHarnessGraphArtifact({
        graphId: 'checkout-v2',
        title: 'Checkout V2',
        goal: 'Ship checkout v2',
        nodes: [
          { id: 'node-a', title: 'Design API', goal: 'Design API', type: 'feature' },
          { id: 'node-b', title: 'Build UI', goal: 'Build UI', type: 'feature', dependencies: ['node-a'] },
        ],
      }),
    })

    const graph = await loadHarnessGraphArtifact(cwd, queued.id)

    expect(queued.artifacts.graphPath).toBeTruthy()
    expect(graph).toMatchObject({
      graphId: 'checkout-v2',
      rollup: {
        total: 2,
        pending: 2,
      },
    })
  })

  it('summarizes queue state across runnable, retrying, and blocked sessions', async () => {
    const {
      enqueueHarnessSession,
      saveHarnessServerState,
      summarizeHarnessServer,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    const queued = await enqueueHarnessSession(cwd, {
      goal: 'Queued task',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })
    const waitingNextCycle = await enqueueHarnessSession(cwd, {
      goal: 'Waiting next cycle',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })
    const waitingRetry = await enqueueHarnessSession(cwd, {
      goal: 'Waiting retry',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })
    const blocked = await enqueueHarnessSession(cwd, {
      goal: 'Blocked task',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })
    const running = await enqueueHarnessSession(cwd, {
      goal: 'Running task',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })

    for (const [sessionId, status] of [
      [waitingNextCycle.id, 'waiting_next_cycle'],
      [waitingRetry.id, 'waiting_retry'],
      [blocked.id, 'blocked'],
      [running.id, 'in_progress'],
    ] as const) {
      const sessionPath = join(cwd, '.magpie', 'sessions', 'harness', sessionId, 'session.json')
      const raw = JSON.parse(readFileSync(sessionPath, 'utf-8')) as Record<string, unknown>
      raw.status = status
      writeFileSync(sessionPath, JSON.stringify(raw, null, 2), 'utf-8')
    }

    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })

    const summary = await summarizeHarnessServer(cwd)

    expect(summary.state?.status).toBe('running')
    expect(summary.queue).toEqual({
      queued: 1,
      running: 1,
      waitingRetry: 1,
      waitingNextCycle: 1,
      blocked: 1,
    })
    expect(queued.status).toBe('queued')
  })

  it('summarizes recent observability signals across harness sessions', async () => {
    const {
      enqueueHarnessSession,
      saveHarnessServerState,
      summarizeHarnessServer,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')
    const { appendWorkflowEvent, appendWorkflowFailure } = await import('../../../src/capabilities/workflows/shared/runtime.js')

    const retrying = await enqueueHarnessSession(cwd, {
      goal: 'Retryable task',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })
    const running = await enqueueHarnessSession(cwd, {
      goal: 'Running task',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })
    const toolManifestPath = join(cwd, '.magpie', 'sessions', 'harness', running.id, 'tool-manifest.json')
    writeFileSync(toolManifestPath, JSON.stringify({
      schemaVersion: 1,
      capabilityId: 'harness',
      enabled: true,
      tools: ['kiro', 'codex'],
      requiredTools: ['kiro', 'codex'],
      optionalTools: [],
      disabledTools: [],
      blockedTools: [],
      missingRequiredTools: [],
      ready: true,
    }, null, 2), 'utf-8')

    for (const patch of [
      {
        id: retrying.id,
        status: 'waiting_retry',
        currentStage: 'reviewing',
        evidence: {
          ...retrying.evidence as Record<string, unknown>,
          runtime: {
            retryCount: 2,
            nextRetryAt: '2026-04-12T10:05:00.000Z',
            lastError: 'Codex timed out',
            lastReliablePoint: 'waiting_retry',
          },
        },
      },
      {
        id: running.id,
        status: 'in_progress',
        currentStage: 'developing',
        artifacts: {
          ...running.artifacts,
          toolManifestPath,
          executionIsolationMode: 'worktree',
        },
      },
    ]) {
      const sessionPath = join(cwd, '.magpie', 'sessions', 'harness', patch.id, 'session.json')
      const raw = JSON.parse(readFileSync(sessionPath, 'utf-8')) as Record<string, unknown>
      writeFileSync(sessionPath, JSON.stringify({ ...raw, ...patch }, null, 2), 'utf-8')
    }

    const failure = await appendWorkflowFailure(cwd, {
      capability: 'harness-server',
      sessionId: retrying.id,
      stage: 'reviewing',
      reason: 'Codex timed out',
      rawError: 'Codex timed out',
      evidencePaths: [retrying.artifacts.eventsPath],
      lastReliablePoint: 'waiting_retry',
      metadata: {
        retryCount: 2,
      },
    })
    const retryingPath = join(cwd, '.magpie', 'sessions', 'harness', retrying.id, 'session.json')
    const retryingRaw = JSON.parse(readFileSync(retryingPath, 'utf-8')) as Record<string, any>
    retryingRaw.artifacts.lastFailurePath = failure.recordPath
    retryingRaw.artifacts.failureIndexPath = failure.indexPath
    writeFileSync(retryingPath, JSON.stringify(retryingRaw, null, 2), 'utf-8')

    await appendWorkflowEvent(cwd, 'harness', running.id, {
      timestamp: new Date('2026-04-12T10:00:00.000Z'),
      type: 'stage_changed',
      stage: 'developing',
      summary: 'Started development.',
    })
    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: '2026-04-12T09:55:00.000Z',
      updatedAt: '2026-04-12T10:01:00.000Z',
      executionHost: 'foreground',
      currentSessionId: running.id,
    })

    const summary = await summarizeHarnessServer(cwd)

    expect(summary.observability.currentSession).toMatchObject({
      sessionId: running.id,
      status: 'in_progress',
      stage: 'developing',
      executionIsolationMode: 'worktree',
      tools: ['kiro', 'codex'],
    })
    expect(summary.observability.nextRetry).toMatchObject({
      sessionId: retrying.id,
      nextRetryAt: '2026-04-12T10:05:00.000Z',
      retryCount: 2,
      lastError: 'Codex timed out',
    })
    expect(summary.observability.recentFailures[0]).toMatchObject({
      sessionId: retrying.id,
      reason: 'Codex timed out',
      recordPath: failure.recordPath,
    })
    expect(summary.observability.recentEvents).toContainEqual(expect.objectContaining({
      sessionId: running.id,
      type: 'stage_changed',
      stage: 'developing',
      summary: 'Started development.',
    }))
  })

  it('reports whether a server is alive for foreground and tmux hosts', async () => {
    const {
      isHarnessServerRunning,
      saveHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    expect(await isHarnessServerRunning(cwd)).toBe(false)

    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })
    expect(await isHarnessServerRunning(cwd)).toBe(false)

    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
      processId: process.pid,
    })
    expect(await isHarnessServerRunning(cwd)).toBe(true)

    await saveHarnessServerState(cwd, {
      serverId: 'server-2',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'tmux',
      tmuxSession: 'magpie-harness-server-test',
    })
    expect(await isHarnessServerRunning(cwd)).toBe(true)

    runtimeMocks.execFileSync.mockImplementation(() => {
      throw new Error('missing session')
    })
    expect(await isHarnessServerRunning(cwd)).toBe(false)
  })

  it('processes higher-priority queued sessions first', async () => {
    const {
      enqueueHarnessSession,
      runHarnessServerOnce,
      saveHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    await enqueueHarnessSession(cwd, {
      goal: 'Background cleanup',
      prdPath: join(cwd, 'docs', 'prd.md'),
      priority: 'background',
    })
    const urgent = await enqueueHarnessSession(cwd, {
      goal: 'Urgent checkout fix',
      prdPath: join(cwd, 'docs', 'prd.md'),
      priority: 'interactive',
    })
    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })

    runCapability.mockResolvedValue({
      prepared: {} as never,
      result: {
        status: 'completed',
        session: {
          id: urgent.id,
          capability: 'harness',
          title: urgent.title,
          createdAt: urgent.createdAt,
          updatedAt: urgent.updatedAt,
          status: 'completed',
          currentStage: 'completed',
          summary: 'Harness approved after 1 cycle(s).',
          artifacts: urgent.artifacts,
        },
      },
      output: {
        summary: 'Harness approved after 1 cycle(s).',
      },
    })

    const outcome = await runHarnessServerOnce({ cwd, configPath })

    expect(outcome.sessionId).toBe(urgent.id)
  })

  it('skips graph-backed sessions that still have no runnable nodes', async () => {
    const {
      createHarnessGraphArtifact,
      loadHarnessGraphArtifact,
    } = await import('../../../src/capabilities/workflows/harness-server/graph.js')
    const {
      enqueueHarnessSession,
      runHarnessServerOnce,
      saveHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    const blockedGraphSession = await enqueueHarnessSession(cwd, {
      goal: 'Blocked graph',
      prdPath: join(cwd, 'docs', 'prd.md'),
      priority: 'interactive',
    }, {
      graph: createHarnessGraphArtifact({
        graphId: 'blocked-graph',
        title: 'Blocked graph',
        goal: 'Wait for dependencies',
        approvalGates: [
          {
            gateId: 'confirm-graph',
            label: 'Confirm graph',
            scope: 'graph_confirmation',
            status: 'pending',
          },
        ],
        nodes: [
          { id: 'node-a', title: 'Node A', goal: 'Node A', type: 'feature', state: 'pending' },
          { id: 'node-b', title: 'Node B', goal: 'Node B', type: 'feature', dependencies: ['node-a'], state: 'pending' },
        ],
      }),
    })
    const runnable = await enqueueHarnessSession(cwd, {
      goal: 'Plain queued task',
      prdPath: join(cwd, 'docs', 'prd.md'),
      priority: 'normal',
    })
    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })

    runCapability.mockResolvedValue({
      prepared: {} as never,
      result: {
        status: 'completed',
        session: {
          ...runnable,
          status: 'completed',
          currentStage: 'completed',
          summary: 'Harness approved after 1 cycle(s).',
        },
      },
      output: {
        summary: 'Harness approved after 1 cycle(s).',
      },
    })

    const outcome = await runHarnessServerOnce({ cwd, configPath })
    const graph = await loadHarnessGraphArtifact(cwd, blockedGraphSession.id)

    expect(outcome.sessionId).toBe(runnable.id)
    expect(runCapability).toHaveBeenCalledTimes(1)
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'node-a', state: 'waiting_approval' }),
      expect.objectContaining({ id: 'node-b', state: 'waiting_approval' }),
    ]))
  })

  it('does not rerun completed graph sessions even when they have higher priority', async () => {
    const {
      createHarnessGraphArtifact,
    } = await import('../../../src/capabilities/workflows/harness-server/graph.js')
    const {
      enqueueHarnessSession,
      runHarnessServerOnce,
      saveHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    await enqueueHarnessSession(cwd, {
      goal: 'Completed graph',
      prdPath: join(cwd, 'docs', 'prd.md'),
      priority: 'interactive',
    }, {
      graph: createHarnessGraphArtifact({
        graphId: 'completed-graph',
        title: 'Completed graph',
        goal: 'Already done',
        nodes: [
          { id: 'node-a', title: 'Node A', goal: 'Node A', type: 'feature', state: 'completed' },
        ],
      }),
    })
    const queued = await enqueueHarnessSession(cwd, {
      goal: 'Queued task',
      prdPath: join(cwd, 'docs', 'prd.md'),
      priority: 'normal',
    })
    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })

    runCapability.mockResolvedValue({
      prepared: {} as never,
      result: {
        status: 'completed',
        session: {
          ...queued,
          status: 'completed',
          currentStage: 'completed',
          summary: 'Harness approved after 1 cycle(s).',
        },
      },
      output: {
        summary: 'Harness approved after 1 cycle(s).',
      },
    })

    const outcome = await runHarnessServerOnce({ cwd, configPath })

    expect(outcome.sessionId).toBe(queued.id)
    expect(runCapability).toHaveBeenCalledTimes(1)
  })

  it('processes the next queued session and clears the active pointer', async () => {
    const {
      enqueueHarnessSession,
      runHarnessServerOnce,
      saveHarnessServerState,
      loadHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    const queued = await enqueueHarnessSession(cwd, {
      goal: 'Ship checkout v2',
      prdPath: join(cwd, 'docs', 'prd.md'),
    }, {
      configPath: '/tmp/custom.yaml',
    })
    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })

    runCapability.mockResolvedValue({
      prepared: {} as never,
      result: {
        status: 'completed',
        session: {
          ...queued,
          status: 'completed',
          currentStage: 'completed',
          summary: 'Harness approved after 1 cycle(s).',
        },
      },
      output: {
        summary: 'Harness approved after 1 cycle(s).',
        details: {
          ...queued,
          status: 'completed',
          currentStage: 'completed',
          summary: 'Harness approved after 1 cycle(s).',
        },
      },
    })

    const outcome = await runHarnessServerOnce({ cwd, configPath })

    expect(outcome).toMatchObject({
      processed: true,
      sessionId: queued.id,
      status: 'completed',
    })
    expect(runCapability).toHaveBeenCalled()
    expect(runCapability.mock.calls[0]?.[2]).toMatchObject({
      configPath: '/tmp/custom.yaml',
    })
    const state = await loadHarnessServerState(cwd)
    expect(state?.currentSessionId).toBeUndefined()
  })

  it('returns processed=false when no runnable session is available', async () => {
    const {
      runHarnessServerOnce,
      saveHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })

    const outcome = await runHarnessServerOnce({ cwd, configPath })

    expect(outcome).toEqual({ processed: false })
  })

  it('blocks malformed queued sessions that are missing persisted input', async () => {
    const {
      enqueueHarnessSession,
      runHarnessServerOnce,
      saveHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')
    const { loadWorkflowSession } = await import('../../../src/capabilities/workflows/shared/runtime.js')

    const queued = await enqueueHarnessSession(cwd, {
      goal: 'Malformed queued session',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })
    const sessionPath = join(cwd, '.magpie', 'sessions', 'harness', queued.id, 'session.json')
    const raw = JSON.parse(readFileSync(sessionPath, 'utf-8')) as Record<string, unknown>
    delete raw.evidence
    writeFileSync(sessionPath, JSON.stringify(raw, null, 2), 'utf-8')

    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })

    const outcome = await runHarnessServerOnce({ cwd, configPath })
    const blocked = await loadWorkflowSession(cwd, 'harness', queued.id)

    expect(outcome).toMatchObject({
      processed: true,
      sessionId: queued.id,
      status: 'failed',
    })
    expect(blocked?.status).toBe('blocked')
    expect(blocked?.summary).toContain('missing queued input metadata')
    const failureIndex = JSON.parse(readFileSync(join(cwd, '.magpie', 'failure-index.json'), 'utf-8')) as {
      entries: Array<{ category: string }>
    }
    expect(failureIndex.entries[0]?.category).toBe('workflow_defect')
  })

  it('moves retryable execution failures into waiting_retry', async () => {
    const {
      enqueueHarnessSession,
      runHarnessServerOnce,
      saveHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')
    const { loadWorkflowSession } = await import('../../../src/capabilities/workflows/shared/runtime.js')

    const queued = await enqueueHarnessSession(cwd, {
      goal: 'Retryable failure',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })
    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })
    runCapability.mockRejectedValue(new Error('Codex CLI timed out after 900s'))

    const outcome = await runHarnessServerOnce({ cwd, configPath })
    const updated = await loadWorkflowSession(cwd, 'harness', queued.id)

    expect(outcome).toMatchObject({
      processed: true,
      sessionId: queued.id,
      status: 'waiting_retry',
    })
    expect(updated?.status).toBe('waiting_retry')
    expect(updated?.summary).toContain('waiting to retry')
    expect(updated?.evidence).toMatchObject({
      runtime: {
        retryCount: 1,
        lastError: 'Codex CLI timed out after 900s',
        lastReliablePoint: 'waiting_retry',
      },
    })
    const failureIndex = JSON.parse(readFileSync(join(cwd, '.magpie', 'failure-index.json'), 'utf-8')) as {
      entries: Array<{ lastRecoveryAction: string }>
    }
    expect(failureIndex.entries[0]?.lastRecoveryAction).toBe('retry_with_backoff')
  })

  it('blocks retryable execution failures when the failure budget is exhausted', async () => {
    const {
      enqueueHarnessSession,
      runHarnessServerOnce,
      saveHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')
    const { loadWorkflowSession } = await import('../../../src/capabilities/workflows/shared/runtime.js')
    runtimeMocks.loadConfig.mockReturnValue({
      capabilities: {
        resource_guard: {
          enabled: true,
          failure_budget: {
            max_task_failures: 1,
            max_same_signature_failures: 1,
          },
        },
      },
      integrations: {
        operations: {
          default_provider: 'tmux',
        },
      },
    })

    const queued = await enqueueHarnessSession(cwd, {
      goal: 'Budgeted retryable failure',
      prdPath: join(cwd, 'docs', 'prd.md'),
    }, {
      configPath,
    })
    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })
    runCapability.mockRejectedValue(new Error('Codex CLI timed out after 900s'))

    const outcome = await runHarnessServerOnce({ cwd, configPath })
    const updated = await loadWorkflowSession(cwd, 'harness', queued.id)

    expect(outcome).toMatchObject({
      processed: true,
      sessionId: queued.id,
      status: 'failed',
    })
    expect(updated?.status).toBe('blocked')
    expect(updated?.summary).toContain('failure budget')
    expect(updated?.evidence).toMatchObject({
      runtime: {
        retryCount: 1,
        lastReliablePoint: 'failed',
      },
    })
    const failureIndex = JSON.parse(readFileSync(join(cwd, '.magpie', 'failure-index.json'), 'utf-8')) as {
      entries: Array<{ category: string; lastRecoveryAction: string }>
    }
    expect(failureIndex.entries.some((entry) => entry.category === 'failure_budget_exhausted')).toBe(true)
  })

  it('marks non-retryable execution failures as failed', async () => {
    const {
      enqueueHarnessSession,
      runHarnessServerOnce,
      saveHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')
    const { loadWorkflowSession } = await import('../../../src/capabilities/workflows/shared/runtime.js')

    const queued = await enqueueHarnessSession(cwd, {
      goal: 'Non-retryable failure',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })
    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })
    runCapability.mockRejectedValue(new Error('Permission denied'))

    const outcome = await runHarnessServerOnce({ cwd, configPath })
    const updated = await loadWorkflowSession(cwd, 'harness', queued.id)

    expect(outcome).toMatchObject({
      processed: true,
      sessionId: queued.id,
      status: 'failed',
    })
    expect(updated?.status).toBe('failed')
    expect(updated?.summary).toContain('Permission denied')
  })

  it('requeues stale in-progress sessions so the server can resume them', async () => {
    const {
      enqueueHarnessSession,
      recoverInterruptedHarnessSessions,
      saveHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')
    const { loadWorkflowSession } = await import('../../../src/capabilities/workflows/shared/runtime.js')

    const queued = await enqueueHarnessSession(cwd, {
      goal: 'Ship checkout v2',
      prdPath: join(cwd, 'docs', 'prd.md'),
    })
    const sessionPath = join(cwd, '.magpie', 'sessions', 'harness', queued.id, 'session.json')
    const raw = JSON.parse(readFileSync(sessionPath, 'utf-8')) as Record<string, unknown>
    raw.status = 'in_progress'
    raw.summary = 'Running review cycle 1.'
    raw.currentStage = 'reviewing'
    raw.evidence = {
      ...(raw.evidence as Record<string, unknown>),
      runtime: {
        retryCount: 0,
        lastReliablePoint: 'cycle_completed',
      },
    }
    writeFileSync(sessionPath, JSON.stringify(raw, null, 2), 'utf-8')

    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'foreground',
    })

    await recoverInterruptedHarnessSessions(cwd)
    const recovered = await loadWorkflowSession(cwd, 'harness', queued.id)

    expect(recovered?.status).toBe('waiting_next_cycle')
    expect(recovered?.summary).toContain('queued to resume')
    expect(() => readFileSync(join(cwd, '.magpie', 'failure-index.json'), 'utf-8')).toThrow()
  })

  it('launches the server in tmux and persists the running state', async () => {
    const {
      launchHarnessServerInTmux,
      loadHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    const launch = await launchHarnessServerInTmux({ cwd, configPath })
    const state = await loadHarnessServerState(cwd)

    expect(runtimeMocks.launchCommand).toHaveBeenCalledWith(expect.objectContaining({
      cwd,
      sessionName: expect.stringMatching(/^magpie-harness-server-/),
    }))
    expect(launch.tmuxSession).toBe('magpie-harness-server-test')
    expect(state?.status).toBe('running')
    expect(state?.executionHost).toBe('tmux')
    expect(state?.tmuxSession).toBe('magpie-harness-server-test')
  })

  it('blocks tmux launch when the operations tool category is denied', async () => {
    const { launchHarnessServerInTmux } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')
    runtimeMocks.loadConfig.mockReturnValue({
      capabilities: {
        safety: {
          permission_policy: {
            tool_categories: {
              operations: 'deny',
            },
          },
        },
      },
      integrations: {
        operations: {
          default_provider: 'tmux',
        },
      },
    })

    await expect(launchHarnessServerInTmux({ cwd, configPath }))
      .rejects.toThrow('Tool blocked by permission policy')
    expect(runtimeMocks.launchCommand).not.toHaveBeenCalled()
  })

  it('stops a running tmux-backed server and clears the active pointer', async () => {
    const {
      saveHarnessServerState,
      stopHarnessServer,
      loadHarnessServerState,
    } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    await saveHarnessServerState(cwd, {
      serverId: 'server-1',
      status: 'running',
      startedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-04-12T00:00:00.000Z').toISOString(),
      executionHost: 'tmux',
      tmuxSession: 'magpie-harness-server-test',
      currentSessionId: 'harness-123',
    })

    const stopped = await stopHarnessServer(cwd)
    const state = await loadHarnessServerState(cwd)

    expect(stopped).toBe(true)
    expect(runtimeMocks.execFileSync).toHaveBeenCalledWith('tmux', ['kill-session', '-t', 'magpie-harness-server-test'], { stdio: 'pipe' })
    expect(state?.status).toBe('stopped')
    expect(state?.currentSessionId).toBeUndefined()
  })

  it('returns false when stopping a server that is not running', async () => {
    const { stopHarnessServer } = await import('../../../src/capabilities/workflows/harness-server/runtime.js')

    expect(await stopHarnessServer(cwd)).toBe(false)
  })
})
