import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCodeProvider } from '../../src/providers/claude-code.js'

let killSpy: ReturnType<typeof vi.fn> | null = null
let originalTimeoutEnv: string | undefined

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: { write: (chunk: string) => void; end: () => void }
      kill: ReturnType<typeof vi.fn>
    }

    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    killSpy = vi.fn(() => true)
    child.kill = killSpy
    child.stdin = {
      write: () => {},
      end: () => {},
    }

    return child
  }),
}))

beforeEach(() => {
  originalTimeoutEnv = process.env.MAGPIE_CLAUDE_TIMEOUT_MS
})

afterEach(() => {
  if (typeof originalTimeoutEnv === 'undefined') {
    delete process.env.MAGPIE_CLAUDE_TIMEOUT_MS
  } else {
    process.env.MAGPIE_CLAUDE_TIMEOUT_MS = originalTimeoutEnv
  }
  killSpy = null
})

describe('ClaudeCodeProvider timeout', () => {
  it('times out non-stream chat when claude hangs', async () => {
    process.env.MAGPIE_CLAUDE_TIMEOUT_MS = '80'
    const provider = new ClaudeCodeProvider()
    const promise = provider.chat([{ role: 'user', content: 'timeout-check' }])

    await expect(promise).rejects.toThrow('Claude CLI timed out')
    expect(killSpy).toHaveBeenCalledWith('SIGTERM')
  })

  it('falls back to default timeout when env value is negative', () => {
    process.env.MAGPIE_CLAUDE_TIMEOUT_MS = '-1'
    const provider = new ClaudeCodeProvider() as unknown as { timeout: number }

    expect(provider.timeout).toBe(15 * 60 * 1000)
  })
})
