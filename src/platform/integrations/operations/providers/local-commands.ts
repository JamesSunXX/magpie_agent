import { execFileSync } from 'child_process'
import type {
  LocalCommandsOperationsProviderConfig,
  OperationsCollectionInput,
  OperationsEvidence,
  OperationsEvidenceRun,
  OperationsProvider,
} from '../types.js'

function parseCommandArgs(command: string): string[] {
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

  return args
}

function runCommand(cwd: string, command: string, config: LocalCommandsOperationsProviderConfig): OperationsEvidenceRun {
  try {
    const [file, ...args] = parseCommandArgs(command)
    const output = execFileSync(file, args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: config.timeout_ms,
      maxBuffer: config.max_buffer_bytes || 10 * 1024 * 1024,
    })

    return { command, passed: true, output }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string }
    return {
      command,
      passed: false,
      output: [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim(),
    }
  }
}

export class LocalCommandsOperationsProvider implements OperationsProvider {
  readonly id: string
  private readonly config: LocalCommandsOperationsProviderConfig

  constructor(id: string, config: LocalCommandsOperationsProviderConfig) {
    this.id = id
    this.config = config
  }

  async collectEvidence(input: OperationsCollectionInput): Promise<OperationsEvidence> {
    const runs = input.commands.map(command => runCommand(input.cwd, command, this.config))
    const summary = runs
      .map(run => `${run.passed ? 'PASS' : 'FAIL'} ${run.command}`)
      .join('\n')

    return {
      providerId: this.id,
      runs,
      summary,
    }
  }
}
