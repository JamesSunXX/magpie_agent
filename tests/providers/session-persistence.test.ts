import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIProvider } from '../../src/providers/types.js'
import {
  withProviderSessionPersistence,
  withProviderSessionScope,
} from '../../src/providers/session-persistence.js'

function createResumableProvider(name = 'codex'): AIProvider & {
  startSession: ReturnType<typeof vi.fn>
  restoreSession: ReturnType<typeof vi.fn>
} {
  let provider: AIProvider & {
    startSession: ReturnType<typeof vi.fn>
    restoreSession: ReturnType<typeof vi.fn>
  }

  provider = {
    name,
    supportsPreciseSessionRestore: true,
    sessionId: undefined,
    startSession: vi.fn((sessionName?: string) => {
      provider.sessionId = `${name}-started:${sessionName || 'default'}`
    }),
    restoreSession: vi.fn((sessionId: string) => {
      provider.sessionId = sessionId
    }),
    endSession: vi.fn(() => {
      provider.sessionId = undefined
    }),
    chat: vi.fn(async () => {
      provider.sessionId ||= `${name}-generated`
      return `${name}-ok`
    }),
    chatStream: vi.fn(async function * () {
      yield `${name}-stream`
    }),
  }

  return provider
}

function createLocalOnlySessionProvider(name = 'kiro'): AIProvider & {
  startSession: ReturnType<typeof vi.fn>
  restoreSession: ReturnType<typeof vi.fn>
} {
  let provider: AIProvider & {
    startSession: ReturnType<typeof vi.fn>
    restoreSession: ReturnType<typeof vi.fn>
  }

  provider = {
    name,
    supportsPreciseSessionRestore: false,
    sessionId: undefined,
    startSession: vi.fn((sessionName?: string) => {
      provider.sessionId = `${name}-started:${sessionName || 'default'}`
    }),
    restoreSession: vi.fn((sessionId: string) => {
      provider.sessionId = sessionId
    }),
    chat: vi.fn(async () => {
      provider.sessionId ||= `${name}-local`
      return `${name}-ok`
    }),
    chatStream: vi.fn(async function * () {
      yield `${name}-stream`
    }),
  }

  return provider
}

function createStatelessProvider(name = 'mock'): AIProvider {
  return {
    name,
    chat: vi.fn(async () => `${name}-ok`),
    chatStream: vi.fn(async function * () {
      yield `${name}-stream`
    }),
  }
}

describe('provider session persistence', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
    vi.restoreAllMocks()
  })

  it('persists and restores loop provider sessions per role', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-provider-sessions-'))
    tempDirs.push(dir)
    const sessionsPath = join(dir, 'provider-sessions.json')

    await withProviderSessionScope({
      sessionsPath,
      workflowSessionId: 'loop-1',
      namespace: 'loop',
    }, async () => {
      const planner = withProviderSessionPersistence(
        createResumableProvider('planner-provider'),
        'capabilities.loop.planner'
      )
      await planner.chat([{ role: 'user', content: 'plan' }])

      const executor = withProviderSessionPersistence(
        createResumableProvider('executor-provider'),
        'capabilities.loop.executor'
      )
      await executor.chat([{ role: 'user', content: 'execute' }])
    })

    const persisted = JSON.parse(readFileSync(sessionsPath, 'utf-8')) as Record<string, {
      provider: string
      sessionId: string
      workflowSessionId: string
      roleId: string
    }>
    expect(Object.keys(persisted).sort()).toEqual(['loop.executor', 'loop.planner'])
    expect(persisted['loop.planner']?.workflowSessionId).toBe('loop-1')
    expect(persisted['loop.executor']?.workflowSessionId).toBe('loop-1')
    expect(persisted['loop.planner']?.sessionId).not.toBe(persisted['loop.executor']?.sessionId)

    const restoredPlanner = createResumableProvider('planner-provider')
    await withProviderSessionScope({
      sessionsPath,
      workflowSessionId: 'loop-1',
      namespace: 'loop',
    }, async () => {
      const provider = withProviderSessionPersistence(restoredPlanner, 'capabilities.loop.planner')
      await provider.chat([{ role: 'user', content: 'continue planning' }])
    })

    expect(restoredPlanner.restoreSession).toHaveBeenCalledWith(
      persisted['loop.planner']?.sessionId,
      'loop.planner'
    )
  })

  it('maps harness reviewer and arbitrator sessions to distinct role keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-provider-harness-'))
    tempDirs.push(dir)
    const sessionsPath = join(dir, 'provider-sessions.json')

    await withProviderSessionScope({
      sessionsPath,
      workflowSessionId: 'harness-1',
      namespace: 'harness.review',
    }, async () => {
      const reviewer = withProviderSessionPersistence(
        createResumableProvider('reviewer-provider'),
        'reviewers.alpha'
      )
      await reviewer.chat([{ role: 'user', content: 'review' }])
    })

    await withProviderSessionScope({
      sessionsPath,
      workflowSessionId: 'harness-1',
      namespace: 'harness.arbitration',
    }, async () => {
      const arbitrator = withProviderSessionPersistence(
        createResumableProvider('arbitrator-provider'),
        'summarizer'
      )
      await arbitrator.chat([{ role: 'user', content: 'decide' }])
    })

    const persisted = JSON.parse(readFileSync(sessionsPath, 'utf-8')) as Record<string, { roleId: string }>
    expect(Object.keys(persisted).sort()).toEqual(['harness.arbitrator', 'harness.reviewer.alpha'])
  })

  it('degrades gracefully for providers without remote session restore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-provider-stateless-'))
    tempDirs.push(dir)
    const sessionsPath = join(dir, 'provider-sessions.json')

    const provider = createStatelessProvider('mock')
    await withProviderSessionScope({
      sessionsPath,
      workflowSessionId: 'loop-2',
      namespace: 'loop',
    }, async () => {
      const bound = withProviderSessionPersistence(provider, 'capabilities.loop.planner')
      await expect(bound.chat([{ role: 'user', content: 'plan' }])).resolves.toBe('mock-ok')
    })

    expect(() => readFileSync(sessionsPath, 'utf-8')).toThrow()
  })

  it('does not persist providers that only support local resume semantics', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-provider-local-only-'))
    tempDirs.push(dir)
    const sessionsPath = join(dir, 'provider-sessions.json')

    const provider = createLocalOnlySessionProvider('kiro')
    await withProviderSessionScope({
      sessionsPath,
      workflowSessionId: 'loop-3',
      namespace: 'loop',
    }, async () => {
      const bound = withProviderSessionPersistence(provider, 'capabilities.loop.planner')
      await expect(bound.chat([{ role: 'user', content: 'plan' }])).resolves.toBe('kiro-ok')
    })

    expect(provider.startSession).toHaveBeenCalledWith('loop.planner')
    expect(provider.restoreSession).not.toHaveBeenCalled()
    expect(() => readFileSync(sessionsPath, 'utf-8')).toThrow()
  })

  it('switches to the fallback provider when the saved role provider no longer matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-provider-fallback-'))
    tempDirs.push(dir)
    const sessionsPath = join(dir, 'provider-sessions.json')

    await withProviderSessionScope({
      sessionsPath,
      workflowSessionId: 'loop-4',
      namespace: 'loop',
    }, async () => {
      const original = withProviderSessionPersistence(
        createResumableProvider('codex'),
        'capabilities.loop.executor'
      )
      await original.chat([{ role: 'user', content: 'ship it' }])
    })

    const current = createResumableProvider('gemini-cli')
    const fallback = createLocalOnlySessionProvider('kiro')
    await withProviderSessionScope({
      sessionsPath,
      workflowSessionId: 'loop-4',
      namespace: 'loop',
    }, async () => {
      const provider = withProviderSessionPersistence(
        current,
        'capabilities.loop.executor',
        {
          fallbackFactory: () => fallback,
        }
      )
      await expect(provider.chat([{ role: 'user', content: 'continue' }])).resolves.toBe('kiro-ok')
    })

    expect(current.restoreSession).not.toHaveBeenCalled()
    expect(current.startSession).not.toHaveBeenCalled()
    expect(fallback.startSession).toHaveBeenCalledWith('loop.executor')
  })
})
