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
  appendWorkflowFailure,
  appendWorkflowEvent,
  generateWorkflowId,
  listWorkflowSessions,
  loadWorkflowSession,
  persistWorkflowSession,
  resolveWorkflowFailureArtifacts,
  type WorkflowSession,
} from '../shared/runtime.js'
import { runFailureDiagnostics } from '../../../core/failures/diagnostics.js'

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

function normalizeHarnessPriority(priority: HarnessPriority | undefined): HarnessPriority {
  return priority || 'normal'
}

function sessionPriority(session: WorkflowSession): HarnessPriority {
  return normalizeHarnessPriority(toQueuedEvidence(session)?.input.priority)
}

function nextRetryAt(delayMs = 15_000): string {
  return new Date(Date.now() + delayMs).toISOString()
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

export async function summarizeHarnessServer(cwd: string): Promise<{ state: HarnessServerState | null; queue: QueueSummary }> {
  const [state, sessions] = await Promise.all([
    loadHarnessServerState(cwd),
    listWorkflowSessions(cwd, 'harness'),
  ])

  return {
    state,
    queue: queueSummaryFromSessions(sessions),
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

export async function enqueueHarnessSession(cwd: string, input: HarnessInput, options?: { configPath?: string }): Promise<WorkflowSession> {
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

  await persistWorkflowSession(cwd, session)
  await appendWorkflowEvent(cwd, 'harness', id, {
    timestamp: new Date(),
    type: 'workflow_queued',
    stage: 'queued',
    summary: session.summary,
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

function selectNextRunnableSession(sessions: WorkflowSession[]): WorkflowSession | null {
  const now = Date.now()
  const candidates = sessions.filter((session) => {
    if (session.status === 'queued' || session.status === 'waiting_next_cycle') {
      return true
    }
    if (session.status !== 'waiting_retry') {
      return false
    }
    const queued = toQueuedEvidence(session)
    if (!queued?.runtime.nextRetryAt) {
      return true
    }
    return new Date(queued.runtime.nextRetryAt).getTime() <= now
  })

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
  const next = selectNextRunnableSession(sessions)
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

  const previousSessionId = process.env.MAGPIE_SESSION_ID
  try {
    process.env.MAGPIE_SESSION_ID = next.id
    const ctx = createCapabilityContext({
      cwd: input.cwd,
      configPath: queued.configPath || input.configPath,
    })
    const execution = await runCapability(harnessCapability, queued.input, ctx)
    if (execution.result.session) {
      await persistWorkflowSession(input.cwd, execution.result.session)
    }
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
    const updatedRetryCount = queued.runtime.retryCount + 1
    await persistWorkflowSession(input.cwd, {
      ...next,
      status,
      updatedAt: new Date(),
      summary: status === 'waiting_retry'
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
          lastReliablePoint: status === 'waiting_retry' ? 'waiting_retry' : 'failed',
          ...(status === 'waiting_retry' ? { nextRetryAt: nextRetryAt() } : {}),
        },
      },
      artifacts: {
        ...next.artifacts,
        failureLogDir: resolveWorkflowFailureArtifacts(input.cwd, 'harness', next.id).failureLogDir,
        failureIndexPath: failure.indexPath,
        lastFailurePath: failure.recordPath,
      },
    })
    await appendWorkflowEvent(input.cwd, 'harness', next.id, {
      timestamp: new Date(),
      type: status === 'waiting_retry' ? 'waiting_retry' : 'workflow_failed',
      stage: next.currentStage,
      summary: status === 'waiting_retry'
        ? 'Harness execution failed and is waiting to retry.'
        : status === 'blocked'
          ? 'Harness execution failed and is blocked.'
          : 'Harness execution failed.',
      details: {
        error: error instanceof Error ? error.message : String(error),
        recoveryAction: action,
        ...(diagnostics ? { diagnostics } : {}),
      },
    })
    await updateServerHeartbeat(input.cwd, { currentSessionId: undefined, status: 'running' })
    return {
      processed: true,
      sessionId: next.id,
      status: status === 'waiting_retry' ? 'waiting_retry' : status === 'blocked' ? 'failed' : 'failed',
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
