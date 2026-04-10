import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCodeProvider } from '../../src/providers/claude-code.js'
import { ClawProvider } from '../../src/providers/claw.js'
import { CodexCliProvider } from '../../src/providers/codex.js'
import { GeminiCliProvider } from '../../src/providers/gemini-cli.js'
import { KiroProvider } from '../../src/providers/kiro.js'

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
      onStart: (child) => {
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
      'System: system kiro\n\nuser: check kiro\n\n',
    ])
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

  it('invokes claw with expected command, args, cwd, and prompt', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from('claw ok'))
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
      '-p',
      '-',
    ])
    expect(spawnCalls[0]?.prompt).toContain('System: system claw')
    expect(spawnCalls[0]?.prompt).toContain('user: check claw')
  })
})
