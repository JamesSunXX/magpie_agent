import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCodeProvider } from '../../src/providers/claude-code.js'
import { ClawProvider } from '../../src/providers/claw.js'
import { CodexCliProvider } from '../../src/providers/codex.js'
import { GeminiCliProvider } from '../../src/providers/gemini-cli.js'
import { KiroProvider } from '../../src/providers/kiro.js'
import { QwenCodeProvider } from '../../src/providers/qwen-code.js'

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

vi.mock('child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[], opts?: { cwd?: string }) => {
    const scenario = scenarios.shift()
    if (!scenario) {
      throw new Error('No spawn scenario configured for test')
    }

    const child = new EventEmitter() as MockChild
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn(() => true)

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

describe('CLI provider invocation smoke tests', () => {
  beforeEach(() => {
    scenarios.length = 0
    spawnCalls.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('invokes codex with expected command, args, cwd, and prompt', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from(
          '{"type":"item.completed","item":{"type":"agent_message","text":"codex ok"}}\n'
        ))
        setImmediate(() => child.emit('close', 0))
      },
    })

    const provider = new CodexCliProvider({ model: 'gpt-5.4', apiKey: '' })
    provider.setCwd('/repo/codex')

    await expect(provider.chat(
      [{ role: 'user', content: 'check codex' }],
      'system codex'
    )).resolves.toBe('codex ok')

    expect(spawnCalls[0]).toMatchObject({
      cmd: 'codex',
      cwd: '/repo/codex',
    })
    expect(spawnCalls[0]?.args).toEqual([
      'exec',
      '-m',
      'gpt-5.4',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '-',
    ])
    expect(spawnCalls[0]?.prompt).toContain('System: system codex')
    expect(spawnCalls[0]?.prompt).toContain('user: check codex')
  })

  it('invokes kiro with expected command, args, cwd, and prompt', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from('kiro ok'))
          child.emit('close', 0)
        })
      },
    })

    const provider = new KiroProvider({ model: 'claude-sonnet-4-6', apiKey: '', agent: 'architect' }) as KiroProvider & {
      resolveAgent: () => Promise<string>
    }
    provider.setCwd('/repo/kiro')
    provider.resolveAgent = vi.fn().mockResolvedValue('architect')

    await expect(provider.chat(
      [{ role: 'user', content: 'check kiro' }],
      'system kiro'
    )).resolves.toBe('kiro ok')

    expect(spawnCalls[0]).toMatchObject({
      cmd: 'kiro-cli',
      cwd: '/repo/kiro',
    })
    expect(spawnCalls[0]?.args).toEqual([
      'chat',
      '--no-interactive',
      '--trust-all-tools',
      '--model',
      'claude-sonnet-4-6',
      '--agent',
      'architect',
    ])
    expect(spawnCalls[0]?.prompt).toContain('System: system kiro')
    expect(spawnCalls[0]?.prompt).toContain('user: check kiro')
  })

  it('omits the kiro provider alias from kiro-cli model args', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from('kiro default ok'))
          child.emit('close', 0)
        })
      },
    })

    const provider = new KiroProvider({ model: 'kiro', apiKey: '', agent: 'architect' }) as KiroProvider & {
      resolveAgent: () => Promise<string>
    }
    provider.setCwd('/repo/kiro-default')
    provider.resolveAgent = vi.fn().mockResolvedValue('architect')

    await expect(provider.chat(
      [{ role: 'user', content: 'check default kiro' }],
      'system kiro default'
    )).resolves.toBe('kiro default ok')

    expect(spawnCalls[0]).toMatchObject({
      cmd: 'kiro-cli',
      cwd: '/repo/kiro-default',
    })
    expect(spawnCalls[0]?.args).toEqual([
      'chat',
      '--no-interactive',
      '--trust-all-tools',
      '--agent',
      'architect',
    ])
    expect(spawnCalls[0]?.prompt).toContain('System: system kiro default')
    expect(spawnCalls[0]?.prompt).toContain('user: check default kiro')
  })

  it('omits the kiro provider alias from kiro-cli stream args', async () => {
    scenarios.push({
      onStart: (child) => {
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from('kiro stream ok'))
          child.emit('close', 0)
        })
      },
    })

    const provider = new KiroProvider({ model: 'kiro', apiKey: '', agent: 'architect' }) as KiroProvider & {
      resolveAgent: () => Promise<string>
    }
    provider.setCwd('/repo/kiro-stream-default')
    provider.resolveAgent = vi.fn().mockResolvedValue('architect')

    const chunks: string[] = []
    for await (const chunk of provider.chatStream(
      [{ role: 'user', content: 'stream default kiro' }],
      'system kiro stream'
    )) {
      chunks.push(chunk)
    }

    expect(chunks.join('')).toBe('kiro stream ok')
    expect(spawnCalls[0]).toMatchObject({
      cmd: 'kiro-cli',
      cwd: '/repo/kiro-stream-default',
    })
    expect(spawnCalls[0]?.args).toEqual([
      'chat',
      '--no-interactive',
      '--trust-all-tools',
      '--agent',
      'architect',
    ])
    expect(spawnCalls[0]?.prompt).toContain('System: system kiro stream')
    expect(spawnCalls[0]?.prompt).toContain('user: stream default kiro')
  })

  it('invokes gemini-cli with expected command, args, cwd, and prompt', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from(
            '{"type":"message","role":"assistant","content":"gemini ok"}\n'
          ))
          child.emit('close', 0)
        })
      },
    })

    const provider = new GeminiCliProvider({ model: 'gemini-2.5-pro', apiKey: '' })
    provider.setCwd('/repo/gemini')

    await expect(provider.chat(
      [{ role: 'user', content: 'check gemini' }],
      'system gemini'
    )).resolves.toBe('gemini ok')

    expect(spawnCalls[0]).toMatchObject({
      cmd: 'gemini',
      cwd: '/repo/gemini',
    })
    expect(spawnCalls[0]?.args).toEqual([
      '-y',
      '-e',
      '',
      '-m',
      'gemini-2.5-pro',
      '-o',
      'stream-json',
      '-p',
      '-',
    ])
    expect(spawnCalls[0]?.prompt).toContain('System: system gemini')
    expect(spawnCalls[0]?.prompt).toContain('user: check gemini')
  })

  it('omits the gemini-cli provider alias from gemini model args', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from(
            '{"type":"message","role":"assistant","content":"gemini default ok"}\n'
          ))
          child.emit('close', 0)
        })
      },
    })

    const provider = new GeminiCliProvider({ model: 'gemini-cli', apiKey: '' })
    provider.setCwd('/repo/gemini-default')

    await expect(provider.chat(
      [{ role: 'user', content: 'check default gemini' }],
      'system gemini default'
    )).resolves.toBe('gemini default ok')

    expect(spawnCalls[0]).toMatchObject({
      cmd: 'gemini',
      cwd: '/repo/gemini-default',
    })
    expect(spawnCalls[0]?.args).toEqual([
      '-y',
      '-e',
      '',
      '-o',
      'stream-json',
      '-p',
      '-',
    ])
  })

  it('omits the gemini-cli provider alias from gemini stream args', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from(
            '{"type":"message","role":"assistant","content":"gemini stream ok"}\n'
          ))
          child.emit('close', 0)
        })
      },
    })

    const provider = new GeminiCliProvider({ model: 'gemini-cli', apiKey: '' })
    provider.setCwd('/repo/gemini-stream-default')

    const chunks: string[] = []
    for await (const chunk of provider.chatStream(
      [{ role: 'user', content: 'stream default gemini' }],
      'system gemini stream'
    )) {
      chunks.push(chunk)
    }

    expect(chunks.join('')).toBe('gemini stream ok')
    expect(spawnCalls[0]).toMatchObject({
      cmd: 'gemini',
      cwd: '/repo/gemini-stream-default',
    })
    expect(spawnCalls[0]?.args).toEqual([
      '-y',
      '-e',
      '',
      '-o',
      'stream-json',
      '-p',
      '-',
    ])
  })

  it('times out gemini non-stream execution when no activity arrives', async () => {
    vi.useFakeTimers()
    scenarios.push({
      onStdinEnd: () => {
        // Leave the process idle so the timeout checker must terminate it.
      },
    })

    const provider = new GeminiCliProvider({ model: 'gemini-cli', apiKey: '', timeoutMs: 50 })
    provider.setCwd('/repo/gemini-timeout')

    const chatPromise = provider.chat(
      [{ role: 'user', content: 'hang gemini' }],
      'system gemini timeout'
    )
    const rejection = expect(chatPromise).rejects.toThrow('Gemini CLI timed out after 0.05s of inactivity')

    await vi.advanceTimersByTimeAsync(250)

    await rejection
    expect(spawnCalls[0]).toMatchObject({
      cmd: 'gemini',
      cwd: '/repo/gemini-timeout',
    })
  })

  it('times out qwen non-stream execution when no activity arrives', async () => {
    vi.useFakeTimers()
    scenarios.push({
      onStdinEnd: () => {
        // Leave the process idle so the timeout checker must terminate it.
      },
    })

    const provider = new QwenCodeProvider({ apiKey: '', timeoutMs: 50 })
    provider.setCwd('/repo/qwen-timeout')

    const chatPromise = provider.chat(
      [{ role: 'user', content: 'hang qwen' }],
      'system qwen timeout'
    )
    const rejection = expect(chatPromise).rejects.toThrow('Qwen CLI timed out after 0.05s of inactivity')

    await vi.advanceTimersByTimeAsync(250)

    await rejection
    expect(spawnCalls[0]).toMatchObject({
      cmd: 'qwen',
      cwd: '/repo/qwen-timeout',
    })
  })

  it('invokes claude with expected command, args, cwd, and prompt', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from('claude ok'))
        setImmediate(() => child.emit('close', 0))
      },
    })

    const provider = new ClaudeCodeProvider({ model: 'claude-sonnet-4-6', apiKey: '' })
    provider.setCwd('/repo/claude')

    await expect(provider.chat(
      [{ role: 'user', content: 'check claude' }],
      'system claude',
      { disableTools: true }
    )).resolves.toBe('claude ok')

    expect(spawnCalls[0]).toMatchObject({
      cmd: 'claude',
      cwd: '/repo/claude',
    })
    expect(spawnCalls[0]?.args).toEqual([
      '-p',
      '-',
      '--dangerously-skip-permissions',
      '--model',
      'claude-sonnet-4-6',
      '--tools',
      '',
    ])
    expect(spawnCalls[0]?.prompt).toContain('System: system claude')
    expect(spawnCalls[0]?.prompt).toContain('user: check claude')
  })

  it('omits the claude-code provider alias from claude model args', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from('claude default ok'))
        setImmediate(() => child.emit('close', 0))
      },
    })

    const provider = new ClaudeCodeProvider({ model: 'claude-code', apiKey: '' })
    provider.setCwd('/repo/claude-default')

    await expect(provider.chat(
      [{ role: 'user', content: 'check default claude' }],
      'system claude default',
      { disableTools: true }
    )).resolves.toBe('claude default ok')

    expect(spawnCalls[0]).toMatchObject({
      cmd: 'claude',
      cwd: '/repo/claude-default',
    })
    expect(spawnCalls[0]?.args).toEqual([
      '-p',
      '-',
      '--dangerously-skip-permissions',
      '--tools',
      '',
    ])
  })

  it('omits the claude-code provider alias from claude stream args', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from('claude stream ok'))
        setImmediate(() => child.emit('close', 0))
      },
    })

    const provider = new ClaudeCodeProvider({ model: 'claude-code', apiKey: '' })
    provider.setCwd('/repo/claude-stream-default')

    const chunks: string[] = []
    for await (const chunk of provider.chatStream(
      [{ role: 'user', content: 'stream default claude' }],
      'system claude stream'
    )) {
      chunks.push(chunk)
    }

    expect(chunks.join('')).toBe('claude stream ok')
    expect(spawnCalls[0]).toMatchObject({
      cmd: 'claude',
      cwd: '/repo/claude-stream-default',
    })
    expect(spawnCalls[0]?.args).toEqual([
      '-p',
      '-',
      '--dangerously-skip-permissions',
    ])
  })

  it('invokes claw with expected command, args, cwd, and prompt', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from('{"message":"claw ok"}'))
        setImmediate(() => child.emit('close', 0))
      },
    })

    const provider = new ClawProvider({ model: 'openai/gpt-5.4', apiKey: '' })
    provider.setCwd('/repo/claw')

    await expect(provider.chat(
      [{ role: 'user', content: 'check claw' }],
      'system claw'
    )).resolves.toBe('claw ok')

    expect(spawnCalls[0]).toMatchObject({
      cmd: 'claw',
      cwd: '/repo/claw',
    })
    expect(spawnCalls[0]?.args).toEqual([
      '--model',
      'openai/gpt-5.4',
      '--output-format',
      'json',
      '-p',
      '-',
    ])
    expect(spawnCalls[0]?.prompt).toContain('System: system claw')
    expect(spawnCalls[0]?.prompt).toContain('user: check claw')
  })
})
