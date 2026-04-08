import { EventEmitter } from 'events'
import { homedir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClawProvider } from '../../src/providers/claw.js'

interface SpawnScenario {
  onStdinEnd?: (child: MockChild) => void
}

interface SpawnCallRecord {
  cmd: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  prompt: string
}

type MockChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: (chunk: string) => void; end: () => void }
}

const scenarios: SpawnScenario[] = []
const spawnCalls: SpawnCallRecord[] = []
let originalOpenaiApiKey: string | undefined
let originalOpenaiBaseUrl: string | undefined
let originalAnthropicModel: string | undefined
let originalClawModel: string | undefined
let originalPath: string | undefined

vi.mock('child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[], opts?: { cwd?: string, env?: NodeJS.ProcessEnv }) => {
    const scenario = scenarios.shift()
    if (!scenario) {
      throw new Error('No spawn scenario configured for test')
    }

    const child = new EventEmitter() as MockChild
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()

    const call: SpawnCallRecord = {
      cmd,
      args: [...args],
      cwd: opts?.cwd,
      env: opts?.env,
      prompt: '',
    }
    spawnCalls.push(call)

    child.stdin = {
      write: (chunk: string) => {
        call.prompt += chunk
      },
      end: () => {
        scenario.onStdinEnd?.(child)
      },
    }

    return child
  }),
}))

beforeEach(() => {
  originalOpenaiApiKey = process.env.OPENAI_API_KEY
  originalOpenaiBaseUrl = process.env.OPENAI_BASE_URL
  originalAnthropicModel = process.env.ANTHROPIC_MODEL
  originalClawModel = process.env.CLAW_MODEL
  originalPath = process.env.PATH

  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.ANTHROPIC_MODEL
  delete process.env.CLAW_MODEL

  scenarios.length = 0
  spawnCalls.length = 0
})

afterEach(() => {
  if (typeof originalOpenaiApiKey === 'undefined') {
    delete process.env.OPENAI_API_KEY
  } else {
    process.env.OPENAI_API_KEY = originalOpenaiApiKey
  }

  if (typeof originalOpenaiBaseUrl === 'undefined') {
    delete process.env.OPENAI_BASE_URL
  } else {
    process.env.OPENAI_BASE_URL = originalOpenaiBaseUrl
  }

  if (typeof originalAnthropicModel === 'undefined') {
    delete process.env.ANTHROPIC_MODEL
  } else {
    process.env.ANTHROPIC_MODEL = originalAnthropicModel
  }

  if (typeof originalClawModel === 'undefined') {
    delete process.env.CLAW_MODEL
  } else {
    process.env.CLAW_MODEL = originalClawModel
  }

  if (typeof originalPath === 'undefined') {
    delete process.env.PATH
  } else {
    process.env.PATH = originalPath
  }
})

describe('ClawProvider', () => {
  it('runs claw command with prompt over stdin and returns trimmed output', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from('review-ok\n'))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const provider = new ClawProvider()
    provider.setCwd('/tmp/claw-cwd')
    const result = await provider.chat(
      [{ role: 'user', content: '请做 code review' }],
      'system prompt'
    )

    expect(result).toBe('review-ok')
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].cmd).toBe('claw')
    expect(spawnCalls[0].args).toEqual(['--model', 'openai/gemma-4-26b-a4b', '-p', '-'])
    expect(spawnCalls[0].cwd).toBe('/tmp/claw-cwd')
    expect(spawnCalls[0].prompt).toContain('System: system prompt')
    expect(spawnCalls[0].prompt).toContain('user: 请做 code review')
  })

  it('applies alias-style env defaults for claw when not explicitly set', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from('ok'))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const provider = new ClawProvider()
    await provider.chat([{ role: 'user', content: 'hello' }])

    expect(spawnCalls[0].env?.OPENAI_API_KEY).toBe('lm-studio')
    expect(spawnCalls[0].env?.OPENAI_BASE_URL).toBe('http://localhost:1234/v1')
    expect(spawnCalls[0].env?.PATH).toContain(`${homedir()}/bin`)
  })

  it('keeps caller-provided env values when they already exist', async () => {
    process.env.OPENAI_API_KEY = 'custom-key'
    process.env.OPENAI_BASE_URL = 'http://custom-host:9000/v1'
    process.env.ANTHROPIC_MODEL = 'openai/custom-model'

    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from('ok'))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const provider = new ClawProvider()
    await provider.chat([{ role: 'user', content: 'hello' }])

    expect(spawnCalls[0].env?.OPENAI_API_KEY).toBe('custom-key')
    expect(spawnCalls[0].env?.OPENAI_BASE_URL).toBe('http://custom-host:9000/v1')
    expect(spawnCalls[0].args).toEqual(['--model', 'openai/custom-model', '-p', '-'])
  })

  it('prefers CLAW_MODEL when provided', async () => {
    process.env.CLAW_MODEL = 'openai/custom-model-v2'

    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from('ok'))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const provider = new ClawProvider()
    await provider.chat([{ role: 'user', content: 'hello' }])

    expect(spawnCalls[0].args).toEqual(['--model', 'openai/custom-model-v2', '-p', '-'])
  })

  it('injects image references into prompt when images are provided', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from('ok'))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const provider = new ClawProvider()
    await provider.chat(
      [{ role: 'user', content: '看图评审' }],
      undefined,
      {
        images: [
          { source: '/tmp/arch.png', label: '架构图' },
          { source: 'https://example.com/ui.png' },
        ],
      }
    )

    expect(spawnCalls[0].prompt).toContain('架构图: /tmp/arch.png')
    expect(spawnCalls[0].prompt).toContain('@{/tmp/arch.png}')
    expect(spawnCalls[0].prompt).toContain('@{https://example.com/ui.png}')
  })

  it('throws a close-code error when claw exits non-zero', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stderr.emit('data', Buffer.from('fatal error'))
        setImmediate(() => child.emit('close', 2))
      }
    })

    const provider = new ClawProvider()
    await expect(provider.chat([{ role: 'user', content: 'fail' }]))
      .rejects.toThrow('Claw CLI exited with code 2: fatal error')
  })

  it('throws a spawn error when process fails to start', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        setImmediate(() => child.emit('error', new Error('spawn failed')))
      }
    })

    const provider = new ClawProvider()
    await expect(provider.chat([{ role: 'user', content: 'fail' }]))
      .rejects.toThrow('Failed to run claw CLI: spawn failed')
  })

  it('streams stdout chunks from claw', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stdout.emit('data', Buffer.from('A'))
        child.stdout.emit('data', Buffer.from('B'))
        setImmediate(() => child.emit('close', 0))
      }
    })

    const provider = new ClawProvider()
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'stream me' }])) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['A', 'B'])
  })

  it('throws stream close errors with stderr payload', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        child.stderr.emit('data', Buffer.from('stream-fail'))
        setImmediate(() => child.emit('close', 3))
      }
    })

    const provider = new ClawProvider()
    await expect((async () => {
      for await (const _chunk of provider.chatStream([{ role: 'user', content: 'stream fail' }])) {
        // consume stream
      }
    })()).rejects.toThrow('Claw CLI exited with code 3: stream-fail')
  })

  it('throws stream spawn errors', async () => {
    scenarios.push({
      onStdinEnd: (child) => {
        setImmediate(() => child.emit('error', new Error('stream spawn failed')))
      }
    })

    const provider = new ClawProvider()
    await expect((async () => {
      for await (const _chunk of provider.chatStream([{ role: 'user', content: 'stream spawn fail' }])) {
        // consume stream
      }
    })()).rejects.toThrow('Failed to run claw CLI: stream spawn failed')
  })
})
