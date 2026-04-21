import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { closeSync, openSync, readSync, writeSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { randomBytes } from 'crypto'
import {
  getRepoCapabilitySessionsDir,
  getRepoMagpieDir,
  getRepoSessionDir,
  getRepoSessionScopedDir,
} from '../../../platform/paths.js'
import type { SafetyConfig } from '../../../platform/config/types.js'
import type { LoopReliablePoint } from '../../../state/types.js'
import { appendFailureRecord, getFailureOccurrenceCount } from '../../../core/failures/ledger.js'
import { buildFailureSignature, classifyFailureCategory, normalizeFailureSignature } from '../../../core/failures/classifier.js'
import { decideRecovery } from '../../../core/failures/recovery-policy.js'
import type { FailureFactInput, FailureRecord } from '../../../core/failures/types.js'

export type WorkflowCapability =
  | 'loop'
  | 'issue-fix'
  | 'docs-sync'
  | 'post-merge-regression'
  | 'harness'

export type WorkflowSessionStatus =
  | 'queued'
  | 'in_progress'
  | 'waiting_retry'
  | 'waiting_next_cycle'
  | 'blocked'
  | 'completed'
  | 'failed'

export interface WorkflowSession {
  id: string
  capability: WorkflowCapability
  title: string
  createdAt: Date
  updatedAt: Date
  status: WorkflowSessionStatus
  currentStage?: string
  summary: string
  artifacts: Record<string, string> & {
    sessionDir?: string
    sessionWorkspaceDir?: string
    sessionUploadsDir?: string
    sessionOutputsDir?: string
    sessionTempDir?: string
    failureLogDir?: string
    failureIndexPath?: string
    lastFailurePath?: string
    knowledgeSchemaPath?: string
    knowledgeIndexPath?: string
    knowledgeLogPath?: string
    knowledgeStatePath?: string
    knowledgeSummaryDir?: string
    knowledgeCandidatesPath?: string
    providerSessionsPath?: string
  }
  evidence?: unknown
}

export interface WorkflowEvent {
  timestamp: Date
  type: string
  stage?: string
  cycle?: number
  summary?: string
  details?: Record<string, unknown>
}

export interface CommandRunResult {
  passed: boolean
  output: string
  blocked?: boolean
}

export interface ResolvedCommandSafetyConfig {
  dangerousPatterns: string[]
  allowDangerousCommands: boolean
  requireConfirmationForDangerous: boolean
}

export interface CommandExecutionOptions {
  safety?: ResolvedCommandSafetyConfig
  interactive?: boolean
}

export interface SessionScopedDirectories {
  workspaceDir: string
  uploadsDir: string
  outputsDir: string
  tempDir: string
}

type RecoverableLoopSessionLike = {
  status?: string
  currentStage?: string
  currentStageIndex?: number
  stages?: string[]
  currentLoopState?: string
  lastReliablePoint?: string
  lastFailureReason?: string
  artifacts?: Record<string, string> & {
    workspacePath?: string
    nextRoundInputPath?: string
    redTestResultPath?: string
    greenTestResultPath?: string
    repairEvidencePath?: string
    repairOpenIssuesPath?: string
  }
  stageResults?: Array<{
    stage?: string
    artifacts?: string[]
  }>
}

const DEFAULT_DANGEROUS_COMMAND_PATTERNS = [
  'rm -rf',
  'git push --force',
  'git push -f',
  'git reset --hard',
  'git clean -fd',
  'git clean -xdf',
]

// These checkpoints correspond to artifacts we know how to reuse safely after a
// failed loop run. Anything earlier can leave the session without enough context.
const RECOVERABLE_LOOP_POINTS = new Set<LoopReliablePoint>([
  'constraints_validated',
  'red_test_confirmed',
  'implementation_generated',
  'test_result_recorded',
  'development_result_recorded',
  'test_result_recorded',
  'review_results_recorded',
  'arbitration_recorded',
  'next_round_brief_recorded',
  'completed',
])

const RECOVERABLE_LOOP_STAGES = new Set([
  'code_development',
  'implementation',
  'unit_mock_test',
  'integration_test',
])

function resolveLoopStage(session: RecoverableLoopSessionLike): string | null {
  if (typeof session.currentStage === 'string' && session.currentStage.length > 0) {
    return session.currentStage
  }
  if (!Array.isArray(session.stages)) {
    return null
  }
  const index = Number.isInteger(session.currentStageIndex) ? Number(session.currentStageIndex) : 0
  return session.stages[index] || null
}

function hasLoopFailureArtifacts(session: RecoverableLoopSessionLike, stage: string | null): boolean {
  if (session.artifacts?.redTestResultPath
    || session.artifacts?.greenTestResultPath
    || session.artifacts?.repairEvidencePath
    || session.artifacts?.repairOpenIssuesPath) {
    return true
  }

  if (!stage || !Array.isArray(session.stageResults)) {
    return false
  }

  return session.stageResults.some((result) =>
    result.stage === stage
    && Array.isArray(result.artifacts)
    && result.artifacts.length > 0
  )
}

function hasLoopContinuationHint(session: RecoverableLoopSessionLike): boolean {
  return Boolean(
    session.artifacts?.nextRoundInputPath
    || session.lastFailureReason
    || session.currentLoopState
  )
}

/**
 * A loop session is recoverable when it stopped in a stage we know how to rerun
 * safely and it left behind both a workspace snapshot and enough artifacts to
 * explain what should happen next.
 */
export function isRecoverableLoopSession(session: RecoverableLoopSessionLike | null | undefined): boolean {
  if (!session) {
    return false
  }

  const stage = resolveLoopStage(session)
  if (!stage || !RECOVERABLE_LOOP_STAGES.has(stage)) {
    return false
  }

  if (!session.artifacts?.workspacePath) {
    return false
  }

  if (!hasLoopFailureArtifacts(session, stage) || !hasLoopContinuationHint(session)) {
    return false
  }

  if (session.lastReliablePoint && !RECOVERABLE_LOOP_POINTS.has(session.lastReliablePoint as LoopReliablePoint)) {
    return false
  }

  if (session.lastReliablePoint === 'red_test_confirmed' && !session.artifacts?.redTestResultPath) {
    return false
  }

  if (session.lastReliablePoint === 'test_result_recorded' && !session.artifacts?.greenTestResultPath) {
    return false
  }

  return true
}

/**
 * Harness recovery is broader than loop recovery for queued or waiting states, but
 * failed development sessions still need loop-specific evidence before resuming.
 */
export function isRecoverableHarnessSession(
  session: WorkflowSession,
  loopSession?: RecoverableLoopSessionLike | null
): boolean {
  if (session.status === 'blocked' || session.status === 'waiting_next_cycle' || session.status === 'waiting_retry') {
    return true
  }

  if (session.status !== 'failed') {
    return false
  }

  if (session.currentStage === 'developing') {
    return isRecoverableLoopSession(loopSession)
  }

  return false
}

export function generateWorkflowId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`
}

export function sessionDirFor(cwd: string, capability: WorkflowCapability, id: string): string {
  return getRepoSessionDir(cwd, capability, id)
}

export function resolveSessionScopedDirectories(
  cwd: string,
  capability: WorkflowCapability,
  sessionId: string
): SessionScopedDirectories {
  return {
    workspaceDir: getRepoSessionScopedDir(cwd, capability, sessionId, 'workspace'),
    uploadsDir: getRepoSessionScopedDir(cwd, capability, sessionId, 'uploads'),
    outputsDir: getRepoSessionScopedDir(cwd, capability, sessionId, 'outputs'),
    tempDir: getRepoSessionScopedDir(cwd, capability, sessionId, 'temp'),
  }
}

/**
 * Session-scoped workspace paths isolate transient inputs and outputs by session.
 * Cleanup intentionally touches only tempDir so evidence and generated artifacts
 * stay intact across resumes.
 */
export async function ensureSessionScopedDirectories(
  cwd: string,
  capability: WorkflowCapability,
  sessionId: string,
  options: { clearTemp?: boolean } = {}
): Promise<SessionScopedDirectories> {
  const dirs = resolveSessionScopedDirectories(cwd, capability, sessionId)
  await Promise.all([
    mkdir(dirs.workspaceDir, { recursive: true }),
    mkdir(dirs.uploadsDir, { recursive: true }),
    mkdir(dirs.outputsDir, { recursive: true }),
  ])
  if (options.clearTemp) {
    await rm(dirs.tempDir, { recursive: true, force: true })
  }
  await mkdir(dirs.tempDir, { recursive: true })
  return dirs
}

export function resolveWorkflowFailureArtifacts(
  cwd: string,
  capability: FailureFactInput['capability'],
  sessionId?: string
): {
  sessionDir?: string
  failureLogDir: string
  failureIndexPath: string
} {
  const repoMagpieDir = getRepoMagpieDir(cwd)
  const sessionCapability = capability === 'harness-server' ? 'harness' : capability
  const sessionDir = sessionId ? getRepoSessionDir(cwd, sessionCapability, sessionId) : undefined
  return {
    ...(sessionDir ? { sessionDir } : {}),
    failureLogDir: sessionDir
      ? join(sessionDir, 'failures')
      : join(repoMagpieDir, 'harness-server', 'failures'),
    failureIndexPath: join(repoMagpieDir, 'failure-index.json'),
  }
}

export async function persistWorkflowSession(cwd: string, session: WorkflowSession): Promise<void> {
  const dir = sessionDirFor(cwd, session.capability, session.id)
  const sessionPath = join(dir, 'session.json')
  await mkdir(dir, { recursive: true })
  try {
    const existingRaw = await readFile(sessionPath, 'utf-8')
    const existing = JSON.parse(existingRaw) as { artifacts?: Record<string, string> }
    // Multiple stages add artifacts incrementally; preserve older paths unless the
    // current write is intentionally replacing the same key.
    session.artifacts = {
      ...(existing.artifacts || {}),
      ...session.artifacts,
    }
  } catch {
    // Nothing persisted yet, so there is nothing to merge.
  }
  await writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8')
}

function reviveWorkflowSession(content: string): WorkflowSession {
  const data = JSON.parse(content) as WorkflowSession & {
    createdAt: string
    updatedAt: string
  }

  return {
    ...data,
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
  }
}

export async function loadWorkflowSession(
  cwd: string,
  capability: WorkflowCapability,
  id: string
): Promise<WorkflowSession | null> {
  try {
    const content = await readFile(join(sessionDirFor(cwd, capability, id), 'session.json'), 'utf-8')
    return reviveWorkflowSession(content)
  } catch {
    return null
  }
}

export async function listWorkflowSessions(cwd: string, capability: WorkflowCapability): Promise<WorkflowSession[]> {
  const baseDir = getRepoCapabilitySessionsDir(cwd, capability)

  try {
    const ids = await readdir(baseDir)
    const sessions = (await Promise.all(
      ids.map(async (id) => loadWorkflowSession(cwd, capability, id))
    )).filter((session): session is WorkflowSession => session !== null)

    sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    return sessions
  } catch {
    return []
  }
}

export async function appendWorkflowEvent(
  cwd: string,
  capability: WorkflowCapability,
  id: string,
  event: WorkflowEvent
): Promise<string> {
  const dir = sessionDirFor(cwd, capability, id)
  const eventsPath = join(dir, 'events.jsonl')
  await mkdir(dir, { recursive: true })
  await appendFile(eventsPath, `${JSON.stringify(event)}\n`, 'utf-8')
  return eventsPath
}

/**
 * Parse commands into argv without invoking a shell so workflow actions cannot
 * smuggle pipelines, redirects, or command substitution through config.
 */
export async function appendWorkflowFailure(
  cwd: string,
  fact: FailureFactInput
): Promise<{
  record: FailureRecord
  recordPath: string
  indexPath: string
}> {
  const metadata = fact.metadata ? { ...fact.metadata } : undefined
  if (typeof metadata?.sourceFailureSignature === 'string') {
    metadata.sourceFailureSignature = normalizeFailureSignature(metadata.sourceFailureSignature)
  }
  const category = classifyFailureCategory(fact)
  const signature = typeof metadata?.sourceFailureSignature === 'string'
    ? metadata.sourceFailureSignature
    : buildFailureSignature({
      capability: fact.capability,
      stage: fact.stage,
      category,
      reason: fact.reason,
      rawError: fact.rawError,
    })
  const occurrenceCount = await getFailureOccurrenceCount(cwd, signature) + 1
  const decision = decideRecovery({
    category,
    occurrenceCount,
    retryableHint: fact.retryableHint,
  })
  const record: FailureRecord = {
    id: randomBytes(6).toString('hex'),
    sessionId: fact.sessionId,
    capability: fact.capability,
    stage: fact.stage,
    timestamp: new Date().toISOString(),
    signature,
    category,
    reason: fact.reason,
    retryable: decision.retryable,
    selfHealCandidate: decision.candidateForSelfRepair,
    lastReliablePoint: fact.lastReliablePoint,
    evidencePaths: fact.evidencePaths,
    metadata: metadata || {},
    recoveryAction: decision.action,
  }
  const paths = resolveWorkflowFailureArtifacts(cwd, fact.capability, fact.sessionId)
  const persisted = await appendFailureRecord({
    repoRoot: cwd,
    record,
    sessionDir: paths.sessionDir,
    serverFailureDir: fact.sessionId ? undefined : paths.failureLogDir,
  })
  return {
    record,
    recordPath: persisted.recordPath,
    indexPath: persisted.indexPath,
  }
}

export function parseCommandArgs(command: string): string[] {
  const trimmed = command.trim()
  if (!trimmed) {
    throw new Error('Command must not be empty')
  }
  // execFileSync executes a single program directly; reject shell metacharacters so
  // callers cannot assume unsupported shell behavior or bypass safety review.
  if (/[|&;<>`$]/.test(trimmed)) {
    throw new Error('Unsupported shell metacharacters in command')
  }

  const args: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaped = false

  for (const ch of trimmed) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === '\\' && quote !== '\'') {
      escaped = true
      continue
    }

    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"' || ch === '\'') {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (escaped || quote) {
    throw new Error('Unterminated command quoting')
  }

  if (current) {
    args.push(current)
  }

  if (args.length === 0) {
    throw new Error('Command must not be empty')
  }

  return args
}

export function buildCommandSafetyConfig(config?: SafetyConfig): ResolvedCommandSafetyConfig {
  return {
    dangerousPatterns: [
      ...DEFAULT_DANGEROUS_COMMAND_PATTERNS,
      ...(config?.dangerous_patterns || []),
    ],
    allowDangerousCommands: config?.allow_dangerous_commands === true,
    requireConfirmationForDangerous: config?.require_confirmation_for_dangerous !== false,
  }
}

export function classifyDangerousCommand(
  command: string,
  config: ResolvedCommandSafetyConfig = buildCommandSafetyConfig()
): string | null {
  const normalized = command.toLowerCase()
  const matchedPattern = config.dangerousPatterns.find((pattern) => normalized.includes(pattern.toLowerCase())) || null
  if (!matchedPattern) {
    return null
  }

  if (config.allowDangerousCommands && config.requireConfirmationForDangerous === false) {
    return null
  }

  return matchedPattern
}

function promptDangerousCommandConfirmation(command: string, matchedPattern: string): boolean {
  try {
    // Prompt against the controlling TTY so confirmation still works even when the
    // workflow command captures stdio for logs or runs under a spinner.
    const inputFd = openSync('/dev/tty', 'rs')
    const outputFd = openSync('/dev/tty', 'w')
    try {
      writeSync(outputFd, `Dangerous command detected (${matchedPattern}). Type "yes" to continue:\n${command}\n> `)
      const buffer = Buffer.alloc(256)
      const bytesRead = readSync(inputFd, buffer, 0, buffer.length, null)
      const answer = buffer.toString('utf-8', 0, bytesRead).trim().toLowerCase()
      writeSync(outputFd, '\n')
      return answer === 'yes'
    } finally {
      closeSync(inputFd)
      closeSync(outputFd)
    }
  } catch {
    return false
  }
}

/**
 * Stop obviously destructive commands before execution unless an interactive user
 * explicitly confirms them on the TTY.
 */
export function enforceCommandSafety(
  command: string,
  options: CommandExecutionOptions = {}
): CommandRunResult | null {
  const safety = options.safety || buildCommandSafetyConfig()
  const matchedPattern = classifyDangerousCommand(command, safety)

  if (!matchedPattern) {
    return null
  }

  if (!safety.allowDangerousCommands) {
    return {
      passed: false,
      blocked: true,
      output: `Dangerous command blocked: ${command}\nMatched rule: ${matchedPattern}\nHow to enable: set capabilities.safety.allow_dangerous_commands: true\nRisk: this may permanently change files, branches, or git history.`,
    }
  }

  const interactive = options.interactive === true
  const confirmed = interactive && promptDangerousCommandConfirmation(command, matchedPattern)
  if (confirmed) {
    return null
  }

  return {
    passed: false,
    blocked: true,
    output: `Dangerous command blocked: ${command}\nMatched rule: ${matchedPattern}`,
  }
}

/**
 * Execute workflow commands through execFileSync so the stored command string maps
 * directly to argv parsing, safety checks, and captured output.
 */
export function runSafeCommand(
  cwd: string,
  command: string,
  options: CommandExecutionOptions = {}
): CommandRunResult {
  const blocked = enforceCommandSafety(command, options)
  if (blocked) {
    return blocked
  }

  try {
    const [file, ...args] = parseCommandArgs(command)
    const output = execFileSync(file, args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
    return {
      passed: true,
      output,
    }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string }
    return {
      passed: false,
      output: [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim(),
    }
  }
}
