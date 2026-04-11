import { appendFile, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { getMagpieHomeDir } from '../../../platform/paths.js'

export type WorkflowCapability =
  | 'issue-fix'
  | 'docs-sync'
  | 'post-merge-regression'
  | 'harness'

export type WorkflowSessionStatus =
  | 'queued'
  | 'in_progress'
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
}

export function generateWorkflowId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`
}

export function sessionDirFor(capability: WorkflowCapability, id: string): string {
  return join(getMagpieHomeDir(), 'workflow-sessions', capability, id)
}

export async function persistWorkflowSession(session: WorkflowSession): Promise<void> {
  const dir = sessionDirFor(session.capability, session.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.json'), JSON.stringify(session, null, 2), 'utf-8')
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
  capability: WorkflowCapability,
  id: string
): Promise<WorkflowSession | null> {
  try {
    const content = await readFile(join(sessionDirFor(capability, id), 'session.json'), 'utf-8')
    return reviveWorkflowSession(content)
  } catch {
    return null
  }
}

export async function listWorkflowSessions(capability: WorkflowCapability): Promise<WorkflowSession[]> {
  const baseDir = join(getMagpieHomeDir(), 'workflow-sessions', capability)

  try {
    const ids = await readdir(baseDir)
    const sessions = (await Promise.all(
      ids.map(async (id) => loadWorkflowSession(capability, id))
    )).filter((session): session is WorkflowSession => session !== null)

    sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    return sessions
  } catch {
    return []
  }
}

export async function appendWorkflowEvent(
  capability: WorkflowCapability,
  id: string,
  event: WorkflowEvent
): Promise<string> {
  const dir = sessionDirFor(capability, id)
  const eventsPath = join(dir, 'events.jsonl')
  await mkdir(dir, { recursive: true })
  await appendFile(eventsPath, `${JSON.stringify(event)}\n`, 'utf-8')
  return eventsPath
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

export function runSafeCommand(cwd: string, command: string): CommandRunResult {
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
