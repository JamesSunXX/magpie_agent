import { appendFile, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { closeSync, openSync, readSync, writeSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { getRepoCapabilitySessionsDir, getRepoMagpieDir, getRepoSessionDir } from '../../../platform/paths.js'
import type { SafetyConfig } from '../../../platform/config/types.js'
import { appendFailureRecord, getFailureOccurrenceCount } from '../../../core/failures/ledger.js'
import { buildFailureSignature, classifyFailureCategory } from '../../../core/failures/classifier.js'
import { decideRecovery } from '../../../core/failures/recovery-policy.js'
import type { FailureFactInput, FailureRecord } from '../../../core/failures/types.js'

export type WorkflowCapability =
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
    failureLogDir?: string
    failureIndexPath?: string
    lastFailurePath?: string
    knowledgeSchemaPath?: string
    knowledgeIndexPath?: string
    knowledgeLogPath?: string
    knowledgeStatePath?: string
    knowledgeSummaryDir?: string
    knowledgeCandidatesPath?: string
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
  requireConfirmationForDangerous: boolean
}

export interface CommandExecutionOptions {
  safety?: ResolvedCommandSafetyConfig
  interactive?: boolean
}

const DEFAULT_DANGEROUS_COMMAND_PATTERNS = [
  'rm -rf',
  'git push --force',
  'git push -f',
  'git reset --hard',
  'git clean -fd',
  'git clean -xdf',
]

export function generateWorkflowId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`
}

export function sessionDirFor(cwd: string, capability: WorkflowCapability, id: string): string {
  return getRepoSessionDir(cwd, capability, id)
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

export async function appendWorkflowFailure(
  cwd: string,
  fact: FailureFactInput
): Promise<{
  record: FailureRecord
  recordPath: string
  indexPath: string
}> {
  const category = classifyFailureCategory(fact)
  const signature = typeof fact.metadata?.sourceFailureSignature === 'string'
    ? fact.metadata.sourceFailureSignature
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
    metadata: fact.metadata || {},
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
    requireConfirmationForDangerous: config?.require_confirmation_for_dangerous !== false,
  }
}

export function classifyDangerousCommand(
  command: string,
  config: ResolvedCommandSafetyConfig = buildCommandSafetyConfig()
): string | null {
  if (config.requireConfirmationForDangerous === false) {
    return null
  }

  const normalized = command.toLowerCase()
  return config.dangerousPatterns.find((pattern) => normalized.includes(pattern.toLowerCase())) || null
}

function promptDangerousCommandConfirmation(command: string, matchedPattern: string): boolean {
  try {
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

export function enforceCommandSafety(
  command: string,
  options: CommandExecutionOptions = {}
): CommandRunResult | null {
  const safety = options.safety || buildCommandSafetyConfig()
  const matchedPattern = classifyDangerousCommand(command, safety)

  if (!matchedPattern) {
    return null
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
