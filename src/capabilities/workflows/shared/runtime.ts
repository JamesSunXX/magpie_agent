import { mkdir, writeFile } from 'fs/promises'
import { execFileSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

export interface WorkflowSession {
  id: string
  capability: 'issue-fix' | 'docs-sync' | 'post-merge-regression'
  title: string
  createdAt: Date
  updatedAt: Date
  status: 'completed' | 'failed'
  summary: string
  artifacts: Record<string, string>
}

export interface CommandRunResult {
  passed: boolean
  output: string
}

export function generateWorkflowId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`
}

export function sessionDirFor(capability: WorkflowSession['capability'], id: string): string {
  return join(homedir(), '.magpie', 'workflow-sessions', capability, id)
}

export async function persistWorkflowSession(session: WorkflowSession): Promise<void> {
  const dir = sessionDirFor(session.capability, session.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.json'), JSON.stringify(session, null, 2), 'utf-8')
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
