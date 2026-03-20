import { spawn } from 'child_process'
import type { BuiltCommand, RunState } from './types.js'

export interface CliRuntimeOptions {
  cwd: string
  cliArgv0?: string
  configPath?: string
  execArgv?: string[]
  execPath?: string
}

export interface SpawnedProcessLike {
  stdout?: NodeJS.ReadableStream | null
  stderr?: NodeJS.ReadableStream | null
  on(event: 'close', listener: (code: number | null) => void): this
  on(event: 'error', listener: (error: Error) => void): this
}

export type SpawnLike = (
  file: string,
  args: string[],
  options: { cwd: string; stdio: ['ignore', 'pipe', 'pipe'] }
) => SpawnedProcessLike

export interface RunUpdateHandlers {
  onUpdate?: (state: RunState) => void
  onError?: (error: Error) => void
}

export interface ParsedRunOutput {
  type: 'session' | 'status' | 'artifact'
  key: string
  value: string
}

function createInitialRunState(command: BuiltCommand): RunState {
  return {
    command,
    display: command.display,
    logs: [],
    artifacts: {},
    status: 'running',
  }
}

function emitUpdate(state: RunState, handlers?: RunUpdateHandlers): void {
  handlers?.onUpdate?.({
    ...state,
    logs: [...state.logs],
    artifacts: { ...state.artifacts },
  })
}

function appendChunk(state: RunState, chunk: string): RunState {
  const next: RunState = {
    ...state,
    logs: [...state.logs, chunk],
    artifacts: { ...state.artifacts },
  }

  for (const line of chunk.split(/\r?\n/)) {
    const parsed = parseRunOutputLine(line)
    if (!parsed) {
      continue
    }

    if (parsed.type === 'session' && parsed.key === 'id') {
      next.sessionId = parsed.value
      continue
    }

    if (parsed.type === 'status') {
      next.statusText = parsed.value
      continue
    }

    if (parsed.type === 'artifact') {
      next.artifacts[parsed.key] = parsed.value
    }
  }

  return next
}

export function parseRunOutputLine(line: string): ParsedRunOutput | undefined {
  const match = /^([^:]+):\s+(.+)$/.exec(line.trim())
  if (!match) {
    return undefined
  }

  const rawKey = match[1].trim().toLowerCase()
  const value = match[2].trim()

  if (rawKey === 'session') {
    return {
      type: 'session',
      key: 'id',
      value,
    }
  }

  if (rawKey === 'status') {
    return {
      type: 'status',
      key: 'status',
      value,
    }
  }

  const artifactKeys: Record<string, string> = {
    plan: 'plan',
    execution: 'execution',
    report: 'report',
    branch: 'branch',
    'human confirmation file': 'humanConfirmation',
  }

  if (artifactKeys[rawKey]) {
    return {
      type: 'artifact',
      key: artifactKeys[rawKey],
      value,
    }
  }

  return undefined
}

export function startCommandRun(
  command: BuiltCommand,
  options: CliRuntimeOptions,
  handlers?: RunUpdateHandlers,
  dependencies?: { spawn?: SpawnLike }
): SpawnedProcessLike {
  const spawnImpl = dependencies?.spawn || (spawn as SpawnLike)
  const entrypoint = options.cliArgv0 || process.argv[1]
  if (!entrypoint) {
    throw new Error('Unable to resolve the current CLI entrypoint')
  }

  const args = [...(options.execArgv ?? process.execArgv), entrypoint, ...command.argv]
  if (options.configPath) {
    args.push('--config', options.configPath)
  }
  let state = createInitialRunState(command)

  emitUpdate(state, handlers)

  const child = spawnImpl(options.execPath || process.execPath, args, {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const onChunk = (chunk: string) => {
    state = appendChunk(state, chunk)
    emitUpdate(state, handlers)
  }

  child.stdout?.on('data', (chunk) => {
    onChunk(chunk.toString())
  })

  child.stderr?.on('data', (chunk) => {
    onChunk(chunk.toString())
  })

  child.on('error', (error) => {
    handlers?.onError?.(error)
  })

  child.on('close', (code) => {
    state = {
      ...state,
      status: code === 0 ? 'completed' : 'failed',
      exitCode: code ?? 1,
    }
    emitUpdate(state, handlers)
  })

  return child
}

export function createRunController() {
  return {
    run(command: BuiltCommand, options: CliRuntimeOptions, handlers?: RunUpdateHandlers): SpawnedProcessLike {
      return startCommandRun(command, options, handlers)
    },
  }
}
