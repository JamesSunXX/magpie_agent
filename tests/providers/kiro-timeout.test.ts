import { EventEmitter } from 'events'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { KiroProvider } from '../../src/providers/kiro.js'

let killSpy: ReturnType<typeof vi.fn> | null = null
let originalTimeoutEnv: string | undefined

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: ReturnType<typeof vi.fn>
    }

    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    killSpy = vi.fn(() => true)
    child.kill = killSpy

    return child
  }),
}))

beforeEach(() => {
  originalTimeoutEnv = process.env.MAGPIE_KIRO_TIMEOUT_MS
})

afterEach(() => {
  if (typeof originalTimeoutEnv === 'undefined') {
    delete process.env.MAGPIE_KIRO_TIMEOUT_MS
  } else {
    process.env.MAGPIE_KIRO_TIMEOUT_MS = originalTimeoutEnv
  }
  killSpy = null
})

describe('KiroProvider timeout', () => {
  it('times out non-stream chat when kiro-cli hangs', async () => {
    process.env.MAGPIE_KIRO_TIMEOUT_MS = '80'
    const provider = new KiroProvider() as unknown as { chat: KiroProvider['chat']; resolveAgent: () => Promise<string> }
    provider.resolveAgent = vi.fn().mockResolvedValue('kiro_default')
    const promise = provider.chat([{ role: 'user', content: 'timeout-check' }])

    await expect(promise).rejects.toThrow('kiro-cli timed out')
    expect(killSpy).toHaveBeenCalledWith('SIGTERM')
    expect(provider.resolveAgent).toHaveBeenCalled()
  })

  it('falls back to default timeout when env value is negative', () => {
    process.env.MAGPIE_KIRO_TIMEOUT_MS = '-1'
    const provider = new KiroProvider() as unknown as { timeout: number }

    expect(provider.timeout).toBe(15 * 60 * 1000)
  })

  it('falls back to kiro_default when requested agent is unavailable', async () => {
    process.env.MAGPIE_KIRO_TIMEOUT_MS = '80'
    const provider = new KiroProvider({
      apiKey: '',
      model: 'kiro',
      logicalName: 'reviewers.unknown',
      agent: 'missing-agent',
    }) as unknown as { resolveAgent: () => Promise<string>; chat: KiroProvider['chat'] }

    provider.resolveAgent = vi.fn().mockResolvedValue('kiro_default')
    await expect(provider.chat([{ role: 'user', content: 'fallback-check' }])).rejects.toThrow('kiro-cli timed out')

    expect(provider.resolveAgent).toHaveBeenCalled()
  })
})
