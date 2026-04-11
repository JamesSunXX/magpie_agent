import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KiroProvider } from '../../src/providers/kiro.js'

type MockChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

const mockSpawn = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}))

function createChild(): MockChild {
  const child = new EventEmitter() as MockChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => true)
  return child
}

let originalTimeoutEnv: string | undefined

describe('KiroProvider runtime behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    originalTimeoutEnv = process.env.MAGPIE_KIRO_TIMEOUT_MS
    delete process.env.MAGPIE_KIRO_TIMEOUT_MS
  })

  afterEach(() => {
    if (typeof originalTimeoutEnv === 'undefined') {
      delete process.env.MAGPIE_KIRO_TIMEOUT_MS
    } else {
      process.env.MAGPIE_KIRO_TIMEOUT_MS = originalTimeoutEnv
    }
  })

  it('reuses the session on later chats and strips ansi output', async () => {
    const first = createChild()
    const second = createChild()
    mockSpawn
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)

    const provider = new KiroProvider() as unknown as KiroProvider & {
      resolveAgent: () => Promise<string>
    }
    provider.setCwd('/repo')
    provider.startSession('review')
    provider.resolveAgent = vi.fn().mockResolvedValue('architect')

    const firstPromise = provider.chat([{ role: 'user', content: 'first round' }])
    setImmediate(() => {
      first.stdout.emit('data', Buffer.from('First response'))
      first.emit('close', 0)
    })
    await expect(firstPromise).resolves.toBe('First response')
    expect(provider.sessionId).toBeTruthy()

    const secondPromise = provider.chat([{ role: 'user', content: 'second round' }])
    setImmediate(() => {
      second.stdout.emit('data', Buffer.from('\u001b[32mSecond response\u001b[0m'))
      second.emit('close', 0)
    })

    await expect(secondPromise).resolves.toBe('Second response')
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      'kiro-cli',
      expect.arrayContaining(['--agent', 'architect', '--resume']),
      expect.objectContaining({ cwd: '/repo' })
    )

    provider.endSession()
    expect(provider.sessionId).toBeUndefined()
  })

  it('rejects chat when kiro exits with a stderr error', async () => {
    const child = createChild()
    mockSpawn.mockReturnValue(child)

    const provider = new KiroProvider() as unknown as KiroProvider & {
      resolveAgent: () => Promise<string>
    }
    provider.resolveAgent = vi.fn().mockResolvedValue('architect')

    const promise = provider.chat([{ role: 'user', content: 'break it' }])
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('missing agent'))
      child.emit('close', 1)
    })

    await expect(promise).rejects.toThrow('kiro-cli exited with code 1: missing agent')
  })

  it('retries chat when kiro hits a transient dispatch failure', async () => {
    mockSpawn
      .mockImplementationOnce(() => {
        const child = createChild()
        setImmediate(() => {
          child.stderr.emit('data', Buffer.from(
            'Kiro is having trouble responding right now:\n'
            + '  0: Failed to send the request: An unknown error occurred: dispatch failure\n'
            + '  1: dispatch failure (other): an unknown error occurred: error sending request for url (https://q.us-east-1.amazonaws.com/)\n'
          ))
          child.emit('close', 1)
        })
        return child
      })
      .mockImplementationOnce(() => {
        const child = createChild()
        setTimeout(() => {
          child.stdout.emit('data', Buffer.from('Recovered response'))
          child.emit('close', 0)
        }, 5)
        return child
      })

    const provider = new KiroProvider() as unknown as KiroProvider & {
      resolveAgent: () => Promise<string>
    }
    provider.resolveAgent = vi.fn().mockResolvedValue('architect')

    await expect(provider.chat([{ role: 'user', content: 'retry dispatch failure' }])).resolves.toBe('Recovered response')
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('rejects chat when spawn itself errors', async () => {
    const child = createChild()
    mockSpawn.mockReturnValue(child)

    const provider = new KiroProvider() as unknown as KiroProvider & {
      resolveAgent: () => Promise<string>
    }
    provider.resolveAgent = vi.fn().mockResolvedValue('architect')

    const promise = provider.chat([{ role: 'user', content: 'boom' }])
    setImmediate(() => {
      child.emit('error', new Error('spawn failed'))
    })

    await expect(promise).rejects.toThrow('Failed to run kiro-cli: spawn failed')
  })

  it('streams output chunks and strips ansi codes', async () => {
    const child = createChild()
    mockSpawn.mockReturnValue(child)

    const provider = new KiroProvider() as unknown as KiroProvider & {
      resolveAgent: () => Promise<string>
    }
    provider.resolveAgent = vi.fn().mockResolvedValue('architect')

    const chunksPromise = (async () => {
      const chunks: string[] = []
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'stream it' }])) {
        chunks.push(chunk)
      }
      return chunks
    })()

    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('Alpha '))
      child.stdout.emit('data', Buffer.from('\u001b[31mBeta\u001b[0m'))
      child.emit('close', 0)
    })

    await expect(chunksPromise).resolves.toEqual(['Alpha ', 'Beta'])
  })

  it('throws from chatStream when kiro exits non-zero', async () => {
    const child = createChild()
    mockSpawn.mockReturnValue(child)

    const provider = new KiroProvider() as unknown as KiroProvider & {
      resolveAgent: () => Promise<string>
    }
    provider.resolveAgent = vi.fn().mockResolvedValue('architect')

    const streamPromise = (async () => {
      const chunks: string[] = []
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'stream fail' }])) {
        chunks.push(chunk)
      }
      return chunks
    })()

    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('missing agent'))
      child.emit('close', 1)
    })

    await expect(streamPromise).rejects.toThrow('kiro-cli exited with code 1: missing agent')
  })

  it('retries chatStream when kiro fails before yielding any output', async () => {
    mockSpawn
      .mockImplementationOnce(() => {
        const child = createChild()
        setImmediate(() => {
          child.stderr.emit('data', Buffer.from(
            'Kiro is having trouble responding right now:\n'
            + '  0: Failed to send the request: An unknown error occurred: dispatch failure\n'
          ))
          child.emit('close', 1)
        })
        return child
      })
      .mockImplementationOnce(() => {
        const child = createChild()
        setTimeout(() => {
          child.stdout.emit('data', Buffer.from('stream recovered'))
          child.emit('close', 0)
        }, 5)
        return child
      })

    const provider = new KiroProvider() as unknown as KiroProvider & {
      resolveAgent: () => Promise<string>
    }
    provider.resolveAgent = vi.fn().mockResolvedValue('architect')

    const streamPromise = (async () => {
      const chunks: string[] = []
      for await (const chunk of provider.chatStream([{ role: 'user', content: 'retry stream dispatch failure' }])) {
        chunks.push(chunk)
      }
      return chunks
    })()

    await expect(streamPromise).resolves.toEqual(['stream recovered'])
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })
})
