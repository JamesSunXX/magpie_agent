import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexCliProvider } from '../../src/providers/codex.js'

let killSpy: ReturnType<typeof vi.fn> | null = null
let originalTimeoutEnv: string | undefined
let emitStderrHeartbeat = false

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
    let heartbeat: NodeJS.Timeout | null = null
    killSpy = vi.fn(() => {
      if (heartbeat) {
        clearInterval(heartbeat)
      }
      return true
    })
    child.kill = killSpy
    child.stdin = {
      write: () => {},
      end: () => {},
    }
    if (emitStderrHeartbeat) {
      heartbeat = setInterval(() => {
        child.stderr.emit('data', Buffer.from('retrying'))
      }, 20)
    }

    return child
  }),
}))

beforeEach(() => {
  originalTimeoutEnv = process.env.MAGPIE_CODEX_TIMEOUT_MS
})

afterEach(() => {
  if (typeof originalTimeoutEnv === 'undefined') {
    delete process.env.MAGPIE_CODEX_TIMEOUT_MS
  } else {
    process.env.MAGPIE_CODEX_TIMEOUT_MS = originalTimeoutEnv
  }
  emitStderrHeartbeat = false
  killSpy = null
})

describe('CodexCliProvider timeout', () => {
  it('times out non-stream chat when codex hangs', async () => {
    process.env.MAGPIE_CODEX_TIMEOUT_MS = '80'
    const provider = new CodexCliProvider()
    const promise = provider.chat([{ role: 'user', content: 'timeout-check' }])

    await expect(promise).rejects.toThrow('Codex CLI timed out')
    expect(killSpy).toHaveBeenCalledWith('SIGTERM')
  })

  it('falls back to default timeout when env value is negative', () => {
    process.env.MAGPIE_CODEX_TIMEOUT_MS = '-1'
    const provider = new CodexCliProvider() as unknown as { timeout: number }

    expect(provider.timeout).toBe(15 * 60 * 1000)
  })

  it('still times out when codex keeps writing stderr heartbeat logs', async () => {
    process.env.MAGPIE_CODEX_TIMEOUT_MS = '120'
    emitStderrHeartbeat = true
    const provider = new CodexCliProvider()
    const promise = provider.chat([{ role: 'user', content: 'timeout-with-heartbeat' }])

    await expect(promise).rejects.toThrow('Codex CLI timed out')
    expect(killSpy).toHaveBeenCalledWith('SIGTERM')
  })
})
