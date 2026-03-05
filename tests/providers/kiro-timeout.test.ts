import { EventEmitter } from 'events'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { KiroProvider } from '../../src/providers/kiro.js'

let lastKill: ReturnType<typeof vi.fn> | null = null

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: ReturnType<typeof vi.fn>
    }

    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    lastKill = vi.fn(() => true)
    child.kill = lastKill

    return child
  }),
}))

afterEach(() => {
  vi.useRealTimers()
  lastKill = null
})

describe('KiroProvider timeout', () => {
  it('times out non-stream chat when kiro-cli hangs', async () => {
    vi.useFakeTimers()
    const provider = new KiroProvider()
    ;(provider as unknown as { timeout: number }).timeout = 50

    const promise = provider.chat([{ role: 'user', content: 'test timeout' }])
    await vi.advanceTimersByTimeAsync(60)

    await expect(promise).rejects.toThrow('kiro-cli timed out')
    expect(lastKill).toHaveBeenCalledWith('SIGTERM')
  })
})
