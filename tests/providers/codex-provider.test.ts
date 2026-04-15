import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexCliProvider } from '../../src/providers/codex.js'

interface SpawnScenario {
  onStart?: (child: MockChild, args: string[]) => void
  onStdinEnd?: (child: MockChild, args: string[], prompt: string) => void
}

interface SpawnCallRecord {
  cmd: string
  args: string[]
  cwd?: string
  prompt: string
}

type MockChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: (chunk: string) => void; end: () => void }
  kill: ReturnType<typeof vi.fn>
}

const scenarios: SpawnScenario[] = []
const spawnCalls: SpawnCallRecord[] = []
const killSpies: Array<ReturnType<typeof vi.fn>> = []
let originalTimeoutEnv: string | undefined

vi.mock('child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[], opts?: { cwd?: string }) => {
    const scenario = scenarios.shift()
    if (!scenario) {
      throw new Error('No spawn scenario configured for test')
    }

    const child = new EventEmitter() as MockChild
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const killSpy = vi.fn(() => true)
    child.kill = killSpy
    killSpies.push(killSpy)

    const call: SpawnCallRecord = {
      cmd,
      args: [...args],
      cwd: opts?.cwd,
      prompt: '',
    }
    spawnCalls.push(call)

    child.stdin = {
      write: (chunk: string) => {
        call.prompt += chunk
      },
      end: () => {
        scenario.onStdinEnd?.(child, args, call.prompt)
      },
    }

    scenario.onStart?.(child, args)
    return child
  }),
}))

beforeEach(() => {
  originalTimeoutEnv = process.env.MAGPIE_CODEX_TIMEOUT_MS
  scenarios.length = 0
  spawnCalls.length = 0
  killSpies.length = 0
})

afterEach(() => {
  if (typeof originalTimeoutEnv === 'undefined') {
    delete process.env.MAGPIE_CODEX_TIMEOUT_MS
  } else {
    process.env.MAGPIE_CODEX_TIMEOUT_MS = originalTimeoutEnv
  }
  vi.useRealTimers()
})

describe('CodexCliProvider behavior', () => {
  it('omits the codex provider alias from CLI model args', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from(
          '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n'
        ))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const provider = new CodexCliProvider({ model: 'codex' })
    const result = await provider.chat([{ role: 'user', content: 'default alias prompt' }])

    expect(result).toBe('ok')
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].args).toEqual([
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '-',
    ])
  })

  it('passes through explicit Codex model names', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from(
          '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n'
        ))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const provider = new CodexCliProvider({ model: 'gpt-5-codex' })
    const result = await provider.chat([{ role: 'user', content: 'custom model prompt' }])

    expect(result).toBe('ok')
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].args).toEqual([
      'exec',
      '-m',
      'gpt-5-codex',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '-',
    ])
  })

  it('uses session resume args after first response returns thread id', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from(
          '{"type":"thread.started","thread_id":"thread-42"}\n' +
          '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}\n'
        ))
        setImmediate(() => child.emit('close', 0))
      }
    })
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from(
          'not-json\n' +
          '{"type":"item.completed","item":{"type":"agent_message","text":"second"}}\n'
        ))
        setImmediate(() => child.emit('close', 0))
      }
    })
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from(
          '{"type":"item.completed","item":{"type":"agent_message","text":"third"}}\n'
        ))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const provider = new CodexCliProvider()
    provider.setCwd('/tmp/codex-cwd')
    provider.startSession('unit-test-session')

    const first = await provider.chat([{ role: 'user', content: 'first prompt' }], 'system-prompt')
    const second = await provider.chat([{ role: 'user', content: 'second prompt' }])
    expect(provider.sessionId).toBe('thread-42')
    provider.endSession()
    const third = await provider.chat([{ role: 'user', content: 'third prompt' }])

    expect(first).toBe('first')
    expect(second).toBe('second')
    expect(third).toBe('third')

    expect(spawnCalls).toHaveLength(3)
    expect(spawnCalls[0].cmd).toBe('codex')
    expect(spawnCalls[0].cwd).toBe('/tmp/codex-cwd')
    expect(spawnCalls[0].args.slice(0, 2)).toEqual(['exec', '--json'])
    expect(spawnCalls[1].args.slice(0, 3)).toEqual(['exec', 'resume', 'thread-42'])
    expect(spawnCalls[2].args.slice(0, 2)).toEqual(['exec', '--json'])
  })

  it('returns codex exit error for non-zero close codes', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stderr.emit('data', Buffer.from('fatal'))
        setImmediate(() => child.emit('close', 2))
      }
    })

    const provider = new CodexCliProvider()
    await expect(provider.chat([{ role: 'user', content: 'should fail' }]))
      .rejects.toThrow('Codex CLI exited with code 2: fatal')
  })

  it('returns spawn error for process start failure', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        setImmediate(() => child.emit('error', new Error('spawn failed')))
      }
    })

    const provider = new CodexCliProvider()
    await expect(provider.chat([{ role: 'user', content: 'spawn fail' }]))
      .rejects.toThrow('Failed to run codex CLI: spawn failed')
  })

  it('streams agent messages and handles buffered tail JSON line', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from(
          '{"type":"thread.started","thread_id":"thread-stream"}\n' +
          '{"type":"item.completed","item":{"type":"agent_message","text":"A"}}\n' +
          'not-json\n'
        ))
        child.stdout.emit('data', Buffer.from(
          '{"type":"item.completed","item":{"type":"agent_message","text":"B"}}'
        ))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const provider = new CodexCliProvider()
    provider.startSession('stream')
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'stream me' }])) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['A', 'B'])
    expect(provider.sessionId).toBe('thread-stream')
  })

  it('throws stream close errors with stderr payload', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stderr.emit('data', Buffer.from('stream-fail'))
        setImmediate(() => child.emit('close', 3))
      }
    })

    const provider = new CodexCliProvider()
    await expect((async () => {
      for await (const _chunk of provider.chatStream([{ role: 'user', content: 'stream fail' }])) {
        // consume
      }
    })()).rejects.toThrow('Codex CLI exited with code 3: stream-fail')
  })

  it('throws stream spawn errors', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        setImmediate(() => child.emit('error', new Error('stream spawn failed')))
      }
    })

    const provider = new CodexCliProvider()
    await expect((async () => {
      for await (const _chunk of provider.chatStream([{ role: 'user', content: 'stream error' }])) {
        // consume
      }
    })()).rejects.toThrow('Failed to run codex CLI: stream spawn failed')
  })

  it('emits normalized progress events while parsing codex JSONL output', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from(
          '{"type":"thread.started","thread_id":"thread-progress"}\n' +
          '{"type":"turn.started"}\n' +
          '{"type":"item.started","item":{"type":"exec_command"}}\n' +
          '{"type":"error","message":"Reconnecting..."}\n' +
          '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n'
        ))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const progress = vi.fn()
    const provider = new CodexCliProvider()
    provider.startSession('progress')

    const result = await provider.chat(
      [{ role: 'user', content: 'show progress' }],
      undefined,
      { onProgress: progress }
    )

    expect(result).toBe('done')
    expect(provider.sessionId).toBe('thread-progress')
    expect(progress.mock.calls.map(([event]) => event)).toEqual([
      { provider: 'codex', kind: 'thread.started', summary: 'Codex session started.' },
      { provider: 'codex', kind: 'turn.started', summary: 'Codex turn started.' },
      {
        provider: 'codex',
        kind: 'item.started',
        summary: 'exec_command started.',
        details: { itemType: 'exec_command' },
      },
      { provider: 'codex', kind: 'error', summary: 'Reconnecting...' },
    ])
  })

  it('accepts timeout=0 to disable timeout checks', async () => {
    process.env.MAGPIE_CODEX_TIMEOUT_MS = '0'
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from(
          '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n'
        ))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const provider = new CodexCliProvider()
    const result = await provider.chat([{ role: 'user', content: 'no timeout' }])
    expect(result).toBe('ok')
    expect(killSpies.some((spy) => spy.mock.calls.length > 0)).toBe(false)
  })

  it('resolves shortly after turn completion even if codex never exits cleanly', async () => {
    vi.useFakeTimers()
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from(
          '{"type":"thread.started","thread_id":"thread-stuck"}\n' +
          '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n' +
          '{"type":"turn.completed"}\n'
        ))
      }
    })

    const provider = new CodexCliProvider({ timeoutMs: 60000 })
    const promise = provider.chat([{ role: 'user', content: 'stuck after complete' }])

    await vi.advanceTimersByTimeAsync(5000)

    await expect(promise).resolves.toBe('done')
    expect(killSpies[0]).toHaveBeenCalledWith('SIGTERM')
  })

  it('keeps the grace window when timeout=0 so trailing output can flush', async () => {
    vi.useFakeTimers()
    process.env.MAGPIE_CODEX_TIMEOUT_MS = '0'
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from(
          '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n' +
          '{"type":"turn.completed"}\n'
        ))
        setTimeout(() => {
          child.stdout.emit('data', Buffer.from(
            '{"type":"item.completed","item":{"type":"agent_message","text":" later"}}\n'
          ))
          child.emit('close', 0)
        }, 1000)
      }
    })

    const provider = new CodexCliProvider()
    const promise = provider.chat([{ role: 'user', content: 'flush trailing output' }])
    let settled = false
    promise.finally(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toBe('done later')
    expect(killSpies[0]).not.toHaveBeenCalled()
  })
})
