import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { randomBytes } from 'crypto'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createCapabilityContext } from '../../../core/capability/context.js'
import { runCapability } from '../../../core/capability/runner.js'
import { harnessCapability } from '../harness/index.js'
import type { HarnessInput, HarnessPriority, HarnessResult } from '../harness/types.js'
import { loadConfig } from '../../../platform/config/loader.js'
import { getRepoMagpieDir } from '../../../platform/paths.js'
import { createOperationsProviders } from '../../../platform/integrations/operations/factory.js'
import { TmuxOperationsProvider } from '../../../platform/integrations/operations/providers/tmux.js'
import {
  loadHarnessGraphArtifact,
  persistHarnessGraphArtifact,
  reconcileHarnessGraphArtifact,
  summarizeHarnessGraphReadiness,
  type HarnessGraphArtifact,
} from './graph.js'
import {
  appendWorkflowFailure,
  appendWorkflowEvent,
  generateWorkflowId,
  listWorkflowSessions,
  loadWorkflowSession,
  loadWorkflowObservabilitySummary,
  buildCommandSafetyConfig,
  enforceToolPermission,
  persistWorkflowSession,
  resolveWorkflowFailureArtifacts,
  type WorkflowSession,
  type WorkflowObservabilityEvent,
  type WorkflowFailureObservation,
  type WorkflowObservabilitySummary,
} from '../shared/runtime.js'
import { runFailureDiagnostics } from '../../../core/failures/diagnostics.js'
import { getFailureOccurrenceCount } from '../../../core/failures/ledger.js'
import type { ResourceGuardConfig } from '../../../platform/config/types.js'

export interface HarnessServerState {
  serverId: string
  status: 'running' | 'stopped'
  startedAt: string
  updatedAt: string
  executionHost: 'foreground' | 'tmux'
  processId?: number
  tmuxSession?: string
  currentSessionId?: string
}

interface QueuedHarnessEvidence {
  input: HarnessInput
  configPath?: string
  runtime: {
    retryCount: number
    nextRetryAt?: string
    lastError?: string
    lastReliablePoint: string
  }
}

interface QueueSummary {
  queued: number
  running: number
  waitingRetry: number
  waitingNextCycle: number
  blocked: number
}

interface HarnessServerObservabilitySummary {
  currentSession?: WorkflowObservabilitySummary
  nextRetry?: {
    sessionId: string
    nextRetryAt: string
    retryCount: number
    lastError?: string
  }
  recentFailures: WorkflowFailureObservation[]
  recentEvents: WorkflowObservabilityEvent[]
}

interface FailureBudgetDecision {
  exhausted: boolean
  reason?: string
}

const PRIORITY_ORDER: Record<HarnessPriority, number> = {
  interactive: 0,
  high: 1,
  normal: 2,
  background: 3,
}

function getHarnessServerDir(cwd: string): string {
  return join(getRepoMagpieDir(cwd), 'harness-server')
}

function getHarnessServerStatePath(cwd: string): string {
  return join(getHarnessServerDir(cwd), 'state.json')
}

function buildHarnessServerId(): string {
  return `harness-server-${randomBytes(4).toString('hex')}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveFn) => setTimeout(resolveFn, ms))
}

function toQueuedEvidence(session: WorkflowSession): QueuedHarnessEvidence | null {
  const evidence = session.evidence as Partial<QueuedHarnessEvidence> | undefined
  if (!evidence?.input || !evidence.runtime) {
    return null
  }
  return {
    input: evidence.input,
    configPath: typeof evidence.configPath === 'string' ? evidence.configPath : undefined,
    runtime: {
      retryCount: Number.isFinite(evidence.runtime.retryCount) ? Number(evidence.runtime.retryCount) : 0,
      nextRetryAt: evidence.runtime.nextRetryAt,
      lastError: evidence.runtime.lastError,
      lastReliablePoint: evidence.runtime.lastReliablePoint || 'queued',
    },
  }
}

function makeQueuedEvidence(input: HarnessInput, configPath?: string): QueuedHarnessEvidence {
  return {
    input,
    ...(configPath ? { configPath } : {}),
    runtime: {
      retryCount: 0,
      lastReliablePoint: 'queued',
    },
  }
}

function loadResourceGuard(configPath?: string): ResourceGuardConfig | undefined {
  try {
    return loadConfig(configPath).capabilities?.resource_guard
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Config file not found:')) {
      return undefined
    }
    throw error
  }
}

function isResourceGuardEnabled(config: ResourceGuardConfig | undefined): boolean {
  return config?.enabled === true
}

function countGuardedHarnessSessions(sessions: WorkflowSession[]): number {
  return sessions.filter((session) => (
    session.status === 'queued'
    || session.status === 'waiting_next_cycle'
    || session.status === 'waiting_retry'
    || session.status === 'in_progress'
  )).length
}

function evaluateFailureBudget(input: {
  guard: ResourceGuardConfig | undefined
  retryCount: number
  sameSignatureFailures: number
}): FailureBudgetDecision {
  if (!isResourceGuardEnabled(input.guard)) {
    return { exhausted: false }
  }
  const budget = input.guard?.failure_budget
  if (!budget) {
    return { exhausted: false }
  }
  if (budget.max_task_failures !== undefined && input.retryCount >= budget.max_task_failures) {
    return {
      exhausted: true,
      reason: `failure budget exhausted: task failures reached ${input.retryCount}/${budget.max_task_failures}`,
    }
  }
  if (budget.max_stage_retries !== undefined && input.retryCount > budget.max_stage_retries) {
    return {
      exhausted: true,
      reason: `failure budget exhausted: stage retries exceeded ${budget.max_stage_retries}`,
    }
  }
  if (
    budget.max_same_signature_failures !== undefined
    && input.sameSignatureFailures >= budget.max_same_signature_failures
  ) {
    return {
      exhausted: true,
      reason: `failure budget exhausted: repeated failure signature reached ${input.sameSignatureFailures}/${budget.max_same_signature_failures}`,
    }
  }
  return { exhausted: false }
}

function normalizeHarnessPriority(priority: HarnessPriority | undefined): HarnessPriority {
  return priority || 'normal'
}

interface EnqueueHarnessSessionOptions {
  configPath?: string
  graph?: HarnessGraphArtifact
}

function sessionPriority(session: WorkflowSession): HarnessPriority {
  return normalizeHarnessPriority(toQueuedEvidence(session)?.input.priority)
}

function nextRetryAt(delayMs = 15_000): string {
  return new Date(Date.now() + delayMs).toISOString()
}

async function withResourceGuardTaskTimeout<T>(
  promise: Promise<T>,
  guard: ResourceGuardConfig | undefined
): Promise<T> {
  if (!isResourceGuardEnabled(guard) || !guard?.max_task_runtime_ms) {
    return promise
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Harness task exceeded max task runtime (${guard.max_task_runtime_ms}ms).`))
        }, guard.max_task_runtime_ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function loadHarnessServerState(cwd: string): Promise<HarnessServerState | null> {
  const raw = await readFile(getHarnessServerStatePath(cwd), 'utf-8').catch(() => '')
  if (!raw) return null
  return parseJson<HarnessServerState>(raw)
}

export async function saveHarnessServerState(cwd: string, state: HarnessServerState): Promise<void> {
  const path = getHarnessServerStatePath(cwd)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state, null, 2), 'utf-8')
}

function queueSummaryFromSessions(sessions: WorkflowSession[]): QueueSummary {
  return sessions.reduce<QueueSummary>((acc, session) => {
    if (session.status === 'queued') {
      acc.queued += 1
    } else if (session.status === 'waiting_next_cycle') {
      acc.waitingNextCycle += 1
    } else if (session.status === 'in_progress') {
      acc.running += 1
    } else if (session.status === 'waiting_retry') {
      acc.waitingRetry += 1
    } else if (session.status === 'blocked') {
      acc.blocked += 1
    }
    return acc
  }, {
    queued: 0,
    running: 0,
    waitingRetry: 0,
    waitingNextCycle: 0,
    blocked: 0,
  })
}

function selectCurrentObservation(
  state: HarnessServerState | null,
  sessions: WorkflowSession[],
  observations: WorkflowObservabilitySummary[]
): WorkflowObservabilitySummary | undefined {
  if (state?.currentSessionId) {
    const current = observations.find((observation) => observation.sessionId === state.currentSessionId)
    if (current) return current
  }
  const running = sessions.find((session) => session.status === 'in_progress')
  return running ? observations.find((observation) => observation.sessionId === running.id) : undefined
}

function buildHarnessServerObservability(
  state: HarnessServerState | null,
  sessions: WorkflowSession[],
  observations: WorkflowObservabilitySummary[]
): HarnessServerObservabilitySummary {
  const retryCandidates = observations
    .filter((observation) => observation.nextRetryAt)
    .sort((left, right) => left.nextRetryAt!.localeCompare(right.nextRetryAt!))
  const nextRetry = retryCandidates[0]
  const recentFailures = observations
    .map((observation) => observation.recentFailure)
    .filter((failure): failure is WorkflowFailureObservation => Boolean(failure))
    .sort((left, right) => (right.timestamp || '').localeCompare(left.timestamp || ''))
    .slice(0, 3)
  const recentEvents = observations
    .flatMap((observation) => observation.recentEvents)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 5)

  return {
    ...(selectCurrentObservation(state, sessions, observations) ? { currentSession: selectCurrentObservation(state, sessions, observations) } : {}),
    ...(nextRetry?.nextRetryAt
      ? {
          nextRetry: {
            sessionId: nextRetry.sessionId,
            nextRetryAt: nextRetry.nextRetryAt,
            retryCount: nextRetry.retryCount,
            ...(nextRetry.lastError ? { lastError: nextRetry.lastError } : {}),
          },
        }
      : {}),
    recentFailures,
    recentEvents,
  }
}

export async function summarizeHarnessServer(cwd: string): Promise<{ state: HarnessServerState | null; queue: QueueSummary; observability: HarnessServerObservabilitySummary }> {
  const [state, sessions] = await Promise.all([
    loadHarnessServerState(cwd),
    listWorkflowSessions(cwd, 'harness'),
  ])
  const observations = (await Promise.all(
    sessions.map((session) => loadWorkflowObservabilitySummary(cwd, 'harness', session.id))
  )).filter((observation): observation is WorkflowObservabilitySummary => observation !== null)

  return {
    state,
    queue: queueSummaryFromSessions(sessions),
    observability: buildHarnessServerObservability(state, sessions, observations),
  }
}

export async function isHarnessServerRunning(cwd: string): Promise<boolean> {
  const state = await loadHarnessServerState(cwd)
  if (!state || state.status !== 'running') return false
  if (!state.tmuxSession) {
    if (!Number.isInteger(state.processId)) {
      return false
    }
    try {
      process.kill(state.processId!, 0)
      return true
    } catch {
      return false
    }
  }

  try {
    execFileSync('tmux', ['has-session', '-t', state.tmuxSession], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export async function enqueueHarnessSession(
  cwd: string,
  input: HarnessInput,
  options?: EnqueueHarnessSessionOptions
): Promise<WorkflowSession> {
  const guard = loadResourceGuard(options?.configPath)
  if (isResourceGuardEnabled(guard) && guard?.max_queue_size !== undefined) {
    const sessions = await listWorkflowSessions(cwd, 'harness')
    const guardedCount = countGuardedHarnessSessions(sessions)
    if (guardedCount >= guard.max_queue_size) {
      throw new Error(`Harness queue limit reached (${guardedCount}/${guard.max_queue_size}); wait for an existing session to finish or raise capabilities.resource_guard.max_queue_size.`)
    }
  }

  const normalizedInput: HarnessInput = {
    ...input,
    priority: normalizeHarnessPriority(input.priority),
  }
  const id = generateWorkflowId('harness')
  const eventsPath = join(getRepoMagpieDir(cwd), 'sessions', 'harness', id, 'events.jsonl')
  const session: WorkflowSession = {
    id,
    capability: 'harness',
    title: normalizedInput.goal.slice(0, 80),
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'queued',
    currentStage: 'queued',
    summary: 'Queued for harness server execution.',
    artifacts: {
      repoRootPath: cwd,
      eventsPath,
      ...resolveWorkflowFailureArtifacts(cwd, 'harness', id),
    },
    evidence: makeQueuedEvidence(normalizedInput, options?.configPath),
  }

  if (options?.graph) {
    const graphPath = await persistHarnessGraphArtifact(cwd, id, options.graph)
    session.artifacts.graphPath = graphPath
  }

  await persistWorkflowSession(cwd, session)
  await appendWorkflowEvent(cwd, 'harness', id, {
    timestamp: new Date(),
    type: 'workflow_queued',
    stage: 'queued',
    summary: session.summary,
    details: {
      priority: normalizedInput.priority,
    },
  })
  return session
}

export async function recoverInterruptedHarnessSessions(cwd: string): Promise<void> {
  const sessions = await listWorkflowSessions(cwd, 'harness')
  for (const session of sessions) {
    if (session.status !== 'in_progress') {
      continue
    }
    const queued = toQueuedEvidence(session)
    if (!queued) {
      continue
    }
    await persistWorkflowSession(cwd, {
      ...session,
      status: 'waiting_next_cycle',
      updatedAt: new Date(),
      summary: 'Harness session was interrupted and has been queued to resume.',
      evidence: {
        ...queued,
        runtime: {
          ...queued.runtime,
          lastError: 'server_interrupted',
          lastReliablePoint: 'waiting_next_cycle',
        },
      },
    })
    await appendWorkflowEvent(cwd, 'harness', session.id, {
      timestamp: new Date(),
      type: 'session_requeued',
      stage: session.currentStage,
      summary: 'Harness session was interrupted and queued to resume.',
    })
  }
}

async function refreshGraphSessionReadiness(cwd: string, session: WorkflowSession): Promise<boolean> {
  if (!session.artifacts.graphPath) {
    return true
  }

  const graph = await loadHarnessGraphArtifact(cwd, session.id)
  if (!graph) {
    return true
  }

  const reconciled = reconcileHarnessGraphArtifact(graph)
  await persistHarnessGraphArtifact(cwd, session.id, reconciled)

  if (session.status === 'waiting_retry') {
    return true
  }

  const readiness = summarizeHarnessGraphReadiness(reconciled)
  return readiness.readyNodeIds.length > 0
}

async function selectNextRunnableSession(cwd: string, sessions: WorkflowSession[]): Promise<WorkflowSession | null> {
  const now = Date.now()
  const candidates: WorkflowSession[] = []

  for (const session of sessions) {
    if (session.status === 'queued' || session.status === 'waiting_next_cycle') {
      if (await refreshGraphSessionReadiness(cwd, session)) {
        candidates.push(session)
      }
      continue
    }
    if (session.status !== 'waiting_retry') {
      continue
    }
    const queued = toQueuedEvidence(session)
    if (!queued?.runtime.nextRetryAt) {
      candidates.push(session)
      continue
    }
    if (new Date(queued.runtime.nextRetryAt).getTime() <= now) {
      candidates.push(session)
    }
  }

  if (candidates.length === 0) {
    return null
  }

  candidates.sort((a, b) => {
    const priorityDelta = PRIORITY_ORDER[sessionPriority(a)] - PRIORITY_ORDER[sessionPriority(b)]
    if (priorityDelta !== 0) {
      return priorityDelta
    }
    return a.updatedAt.getTime() - b.updatedAt.getTime()
  })
  return candidates[0] || null
}

async function updateServerHeartbeat(cwd: string, patch: Partial<HarnessServerState>): Promise<HarnessServerState> {
  const current = await loadHarnessServerState(cwd)
  const state: HarnessServerState = {
    serverId: current?.serverId || buildHarnessServerId(),
    status: current?.status || 'running',
    startedAt: current?.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    executionHost: current?.executionHost || 'foreground',
    ...(Number.isInteger(current?.processId) ? { processId: current?.processId as number } : {}),
    ...(current?.tmuxSession ? { tmuxSession: current.tmuxSession } : {}),
    ...(current?.currentSessionId ? { currentSessionId: current.currentSessionId } : {}),
    ...patch,
  }
  await saveHarnessServerState(cwd, state)
  return state
}

export async function runHarnessServerOnce(input: {
  cwd: string
  configPath?: string
}): Promise<{
  processed: boolean
  sessionId?: string
  status?: HarnessResult['status'] | 'waiting_retry'
}> {
  await recoverInterruptedHarnessSessions(input.cwd)
  const sessions = await listWorkflowSessions(input.cwd, 'harness')
  const guard = loadResourceGuard(input.configPath)
  if (isResourceGuardEnabled(guard) && guard?.max_concurrent_harness !== undefined) {
    const runningCount = sessions.filter((session) => session.status === 'in_progress').length
    if (runningCount >= guard.max_concurrent_harness) {
      await updateServerHeartbeat(input.cwd, { currentSessionId: undefined, status: 'running' })
      return { processed: false }
    }
  }
  const next = await selectNextRunnableSession(input.cwd, sessions)
  if (!next) {
    await updateServerHeartbeat(input.cwd, { currentSessionId: undefined, status: 'running' })
    return { processed: false }
  }

  const queued = toQueuedEvidence(next)
  if (!queued) {
    const failure = await appendWorkflowFailure(input.cwd, {
      capability: 'harness-server',
      sessionId: next.id,
      stage: next.currentStage || 'queued',
      reason: 'Harness session is missing queued input metadata.',
      rawError: 'missing queued input metadata',
      evidencePaths: [next.artifacts.eventsPath].filter((path): path is string => Boolean(path)),
      lastReliablePoint: 'queued',
      metadata: {
        checkpointMissing: true,
      },
    })
    await persistWorkflowSession(input.cwd, {
      ...next,
      status: 'blocked',
      updatedAt: new Date(),
      summary: 'Harness session is missing queued input metadata.',
      artifacts: {
        ...next.artifacts,
        failureLogDir: resolveWorkflowFailureArtifacts(input.cwd, 'harness', next.id).failureLogDir,
        failureIndexPath: failure.indexPath,
        lastFailurePath: failure.recordPath,
      },
    })
    await updateServerHeartbeat(input.cwd, { currentSessionId: undefined, status: 'running' })
    return {
      processed: true,
      sessionId: next.id,
      status: 'failed',
    }
  }

  await updateServerHeartbeat(input.cwd, { currentSessionId: next.id, status: 'running' })
  await persistWorkflowSession(input.cwd, {
    ...next,
    status: 'in_progress',
    updatedAt: new Date(),
    summary: 'Harness server picked up queued session.',
    evidence: {
      ...queued,
      runtime: {
        ...queued.runtime,
        lastReliablePoint: 'server_claimed',
      },
    },
  })
  await appendWorkflowEvent(input.cwd, 'harness', next.id, {
    timestamp: new Date(),
    type: 'server_claimed',
    stage: next.currentStage,
    summary: 'Harness server picked up queued session.',
    details: {
      retryCount: queued.runtime.retryCount,
    },
  })

  const previousSessionId = process.env.MAGPIE_SESSION_ID
  try {
    process.env.MAGPIE_SESSION_ID = next.id
    const ctx = createCapabilityContext({
      cwd: input.cwd,
      configPath: queued.configPath || input.configPath,
    })
    const execution = await withResourceGuardTaskTimeout(
      runCapability(harnessCapability, queued.input, ctx),
      loadResourceGuard(queued.configPath || input.configPath)
    )
    if (execution.result.session) {
      await persistWorkflowSession(input.cwd, execution.result.session)
    }
    await appendWorkflowEvent(input.cwd, 'harness', next.id, {
      timestamp: new Date(),
      type: execution.result.status === 'completed' ? 'workflow_completed' : 'workflow_finished',
      stage: execution.result.session?.currentStage || 'completed',
      summary: execution.output?.summary || `Harness finished with status ${execution.result.status}.`,
      details: {
        status: execution.result.status,
      },
    })
    await updateServerHeartbeat(input.cwd, { currentSessionId: undefined, status: 'running' })
    return {
      processed: true,
      sessionId: next.id,
      status: execution.result.status,
    }
  } catch (error) {
    const failure = await appendWorkflowFailure(input.cwd, {
      capability: 'harness-server',
      sessionId: next.id,
      stage: next.currentStage || 'queued',
      reason: `Harness execution failed: ${error instanceof Error ? error.message : String(error)}`,
      rawError: error instanceof Error ? error.stack || error.message : String(error),
      evidencePaths: [next.artifacts.eventsPath].filter((path): path is string => Boolean(path)),
      lastReliablePoint: queued.runtime.lastReliablePoint,
      metadata: {
        retryCount: queued.runtime.retryCount + 1,
        sessionStage: next.currentStage,
      },
    })
    const updatedRetryCount = queued.runtime.retryCount + 1
    const sameSignatureFailures = await getFailureOccurrenceCount(input.cwd, failure.record.signature)
    const failureBudget = evaluateFailureBudget({
      guard: loadResourceGuard(queued.configPath || input.configPath),
      retryCount: updatedRetryCount,
      sameSignatureFailures,
    })
    const budgetFailure = failureBudget.exhausted
      ? await appendWorkflowFailure(input.cwd, {
        capability: 'harness-server',
        sessionId: next.id,
        stage: next.currentStage || 'queued',
        reason: failureBudget.reason || 'failure budget exhausted',
        rawError: failureBudget.reason || 'failure budget exhausted',
        evidencePaths: [next.artifacts.eventsPath, failure.recordPath].filter((path): path is string => Boolean(path)),
        lastReliablePoint: queued.runtime.lastReliablePoint,
        metadata: {
          failureKind: 'failure_budget_exhausted',
          retryCount: updatedRetryCount,
          sourceFailureSignature: failure.record.signature,
        },
      })
      : null
    const action = failure.record.recoveryAction || 'block_for_human'
    const diagnostics = action === 'run_diagnostics'
      ? await runFailureDiagnostics({
        configPath: queued.configPath || input.configPath,
        metadataPath: next.artifacts.eventsPath,
        requiredPaths: [input.cwd, queued.input.prdPath],
      })
      : null
    const status = action === 'retry_same_step' || action === 'retry_with_backoff'
      ? 'waiting_retry'
      : action === 'run_diagnostics'
        ? (diagnostics?.hasBlockingIssues ? 'blocked' : 'failed')
        : action === 'block_for_human'
          ? 'blocked'
          : 'failed'
    const finalStatus = failureBudget.exhausted ? 'blocked' : status
    await persistWorkflowSession(input.cwd, {
      ...next,
      status: finalStatus,
      updatedAt: new Date(),
      summary: failureBudget.exhausted
        ? `Harness execution failed and is blocked because the ${failureBudget.reason || 'failure budget is exhausted'}.`
        : status === 'waiting_retry'
        ? 'Harness execution failed with a retryable error; waiting to retry.'
        : status === 'blocked'
          ? `Harness execution failed and is blocked for inspection: ${error instanceof Error ? error.message : String(error)}`
          : `Harness execution failed: ${error instanceof Error ? error.message : String(error)}`,
      evidence: {
        ...queued,
        runtime: {
          ...queued.runtime,
          retryCount: updatedRetryCount,
          lastError: error instanceof Error ? error.message : String(error),
          lastReliablePoint: finalStatus === 'waiting_retry' ? 'waiting_retry' : 'failed',
          ...(finalStatus === 'waiting_retry' ? { nextRetryAt: nextRetryAt() } : {}),
        },
      },
      artifacts: {
        ...next.artifacts,
        failureLogDir: resolveWorkflowFailureArtifacts(input.cwd, 'harness', next.id).failureLogDir,
        failureIndexPath: budgetFailure?.indexPath || failure.indexPath,
        lastFailurePath: budgetFailure?.recordPath || failure.recordPath,
      },
    })
    await appendWorkflowEvent(input.cwd, 'harness', next.id, {
      timestamp: new Date(),
      type: finalStatus === 'waiting_retry'
        ? 'waiting_retry'
        : failureBudget.exhausted
          ? 'failure_budget_exhausted'
          : 'workflow_failed',
      stage: next.currentStage,
      summary: failureBudget.exhausted
        ? 'Harness execution failed and failure budget is exhausted.'
        : status === 'waiting_retry'
        ? 'Harness execution failed and is waiting to retry.'
        : status === 'blocked'
          ? 'Harness execution failed and is blocked.'
          : 'Harness execution failed.',
      details: {
        error: error instanceof Error ? error.message : String(error),
        recoveryAction: action,
        ...(failureBudget.exhausted ? { failureBudgetReason: failureBudget.reason } : {}),
        ...(diagnostics ? { diagnostics } : {}),
      },
    })
    await updateServerHeartbeat(input.cwd, { currentSessionId: undefined, status: 'running' })
    return {
      processed: true,
      sessionId: next.id,
      status: finalStatus === 'waiting_retry' ? 'waiting_retry' : 'failed',
    }
  } finally {
    if (previousSessionId === undefined) {
      delete process.env.MAGPIE_SESSION_ID
    } else {
      process.env.MAGPIE_SESSION_ID = previousSessionId
    }
  }
}

export async function runHarnessServerLoop(input: {
  cwd: string
  configPath?: string
  pollIntervalMs?: number
}): Promise<void> {
  await updateServerHeartbeat(input.cwd, {
    status: 'running',
    executionHost: 'foreground',
    processId: process.pid,
  })
  while (true) {
    await runHarnessServerOnce({ cwd: input.cwd, configPath: input.configPath })
    await sleep(input.pollIntervalMs ?? 1_000)
  }
}

function resolvePackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
}

function isTsxLoaderReference(value: string | undefined): boolean {
  if (!value) return false
  return value === 'tsx'
    || value.endsWith('/tsx')
    || value.endsWith('/tsx/dist/loader.mjs')
}

function resolveSourceLoader(packageRoot: string): string {
  for (let i = 0; i < process.execArgv.length; i += 1) {
    if (process.execArgv[i] === '--import' && isTsxLoaderReference(process.execArgv[i + 1])) {
      return process.execArgv[i + 1] === 'tsx'
        ? join(packageRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')
        : process.execArgv[i + 1]!
    }
  }

  const bundledLoader = join(packageRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')
  if (existsSync(bundledLoader)) {
    return bundledLoader
  }
  return 'tsx'
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function buildCliCommand(cwd: string, argv: string[], env: Record<string, string>): string {
  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ')
  const packageRoot = resolvePackageRoot()
  const distCli = join(packageRoot, 'dist', 'cli.js')
  const srcCli = join(packageRoot, 'src', 'cli.ts')
  const args = argv.map(shellQuote).join(' ')
  if (existsSync(distCli)) {
    return `${envPrefix} ${shellQuote(process.execPath)} ${shellQuote(distCli)} ${args}`.trim()
  }
  return `${envPrefix} ${shellQuote(process.execPath)} --import ${shellQuote(resolveSourceLoader(packageRoot))} ${shellQuote(srcCli)} ${args}`.trim()
}

function resolveTmuxProvider(configPath?: string): TmuxOperationsProvider {
  const config = loadConfig(configPath)
  const permission = enforceToolPermission('operations', {
    safety: buildCommandSafetyConfig(config.capabilities?.safety),
    interactive: process.stdin.isTTY && process.stdout.isTTY,
  })
  if (permission) {
    throw new Error(permission.output)
  }

  const operationsConfig = config.integrations.operations
  const providers = createOperationsProviders(operationsConfig)
  const defaultProviderId = operationsConfig?.default_provider
  const defaultProvider = defaultProviderId ? providers[defaultProviderId] : undefined

  if (defaultProvider instanceof TmuxOperationsProvider) {
    return defaultProvider
  }
  const provider = Object.values(providers).find((item) => item instanceof TmuxOperationsProvider)
  if (provider instanceof TmuxOperationsProvider) {
    return provider
  }
  throw new Error('tmux host requested but no enabled tmux operations provider is configured')
}

export async function launchHarnessServerInTmux(input: {
  cwd: string
  configPath?: string
}): Promise<{ tmuxSession: string }> {
  const provider = resolveTmuxProvider(input.configPath)
  const serverId = buildHarnessServerId()
  const sessionName = `magpie-${serverId}`
  const command = buildCliCommand(input.cwd, [
    'harness-server',
    'run',
    ...(input.configPath ? ['--config', input.configPath] : []),
  ], {
    MAGPIE_EXECUTION_HOST: 'tmux',
    MAGPIE_TMUX_SESSION: sessionName,
  })

  const launch = await provider.launchCommand({
    cwd: input.cwd,
    command,
    sessionName,
  })

  await saveHarnessServerState(input.cwd, {
    serverId,
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    executionHost: 'tmux',
    tmuxSession: launch.sessionName,
    processId: undefined,
  })

  return {
    tmuxSession: launch.sessionName,
  }
}

export async function stopHarnessServer(cwd: string): Promise<boolean> {
  const state = await loadHarnessServerState(cwd)
  if (!state) {
    return false
  }
  if (state.tmuxSession) {
    try {
      execFileSync('tmux', ['kill-session', '-t', state.tmuxSession], { stdio: 'pipe' })
    } catch {
      // Ignore: session may already be gone.
    }
  }
  await saveHarnessServerState(cwd, {
    ...state,
    status: 'stopped',
    updatedAt: new Date().toISOString(),
    currentSessionId: undefined,
    processId: undefined,
  })
  return true
}
