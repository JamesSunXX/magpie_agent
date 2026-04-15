import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/providers/configured-provider.js', () => ({
  createConfiguredProvider: vi.fn(),
}))

import { createConfiguredProvider } from '../../../src/providers/configured-provider.js'
import { summarizeStageNotification } from '../../../src/platform/integrations/notifications/stage-ai.js'

afterEach(() => {
  vi.resetAllMocks()
  vi.useRealTimers()
})

describe('summarizeStageNotification', () => {
  it('uses AI output when configured and valid json is returned', async () => {
    vi.mocked(createConfiguredProvider).mockReturnValue({
      name: 'mock',
      chat: vi.fn().mockResolvedValue('```json\n{"title":"AI title","body":"AI body"}\n```'),
      chatStream: vi.fn(),
      setCwd: vi.fn(),
    })

    const result = await summarizeStageNotification({
      config: {
        providers: {},
        defaults: { max_rounds: 3, output_format: 'markdown', check_convergence: true },
        reviewers: {},
        summarizer: { model: 'mock', prompt: 'summarize' },
        analyzer: { model: 'mock', prompt: 'analyze' },
        capabilities: {},
        integrations: {
          notifications: {
            enabled: true,
            stage_ai: {
              enabled: true,
              provider: 'codex',
            },
          },
        },
      } as never,
      cwd: '/tmp/project',
      input: {
        eventType: 'stage_entered',
        sessionId: 'loop-1',
        capability: 'loop',
        runTitle: 'Deliver feature',
        stage: 'code_development',
        occurrence: 1,
        summary: 'Running code changes.',
        nextAction: 'Edit files.',
        aiRoster: [{ id: 'codex', role: 'main execution' }],
      },
    })

    expect(result.title).toBe('AI title')
    expect(result.body).toBe('AI body')
  })

  it('falls back when AI output is invalid', async () => {
    vi.mocked(createConfiguredProvider).mockReturnValue({
      name: 'mock',
      chat: vi.fn().mockResolvedValue('not-json'),
      chatStream: vi.fn(),
    })

    const result = await summarizeStageNotification({
      config: {
        providers: {},
        defaults: { max_rounds: 3, output_format: 'markdown', check_convergence: true },
        reviewers: {},
        summarizer: { model: 'mock', prompt: 'summarize' },
        analyzer: { model: 'mock', prompt: 'analyze' },
        capabilities: {},
        integrations: {
          notifications: {
            enabled: true,
            stage_ai: {
              enabled: true,
              provider: 'codex',
            },
          },
        },
      } as never,
      cwd: '/tmp/project',
      input: {
        eventType: 'stage_failed',
        sessionId: 'loop-1',
        capability: 'loop',
        runTitle: 'Deliver feature',
        stage: 'code_development',
        occurrence: 1,
        summary: 'Stage failed.',
        nextAction: 'Inspect output.',
        blocker: 'tests failed',
        aiRoster: [{ id: 'codex', role: 'main execution' }],
      },
    })

    expect(result.title).toContain('loop-1')
    expect(result.body).toContain('tests failed')
    expect(result.body).toContain('Inspect output.')
  })

  it('falls back quickly when the AI summarizer hangs', async () => {
    vi.useFakeTimers()

    const chat = vi.fn(() => new Promise<string>(() => {}))
    vi.mocked(createConfiguredProvider).mockReturnValue({
      name: 'mock',
      chat,
      chatStream: vi.fn(),
      setCwd: vi.fn(),
    })

    const resultPromise = summarizeStageNotification({
      config: {
        providers: {},
        defaults: { max_rounds: 3, output_format: 'markdown', check_convergence: true },
        reviewers: {},
        summarizer: { model: 'mock', prompt: 'summarize' },
        analyzer: { model: 'mock', prompt: 'analyze' },
        capabilities: {},
        integrations: {
          notifications: {
            enabled: true,
            stage_ai: {
              enabled: true,
              provider: 'codex',
              timeout_ms: 25,
            },
          },
        },
      } as never,
      cwd: '/tmp/project',
      input: {
        eventType: 'stage_entered',
        sessionId: 'loop-1',
        capability: 'loop',
        runTitle: 'Deliver feature',
        stage: 'prd_review',
        occurrence: 1,
        summary: 'Running review.',
        nextAction: 'Keep going.',
        aiRoster: [{ id: 'codex', role: 'main execution' }],
      },
    })

    await vi.advanceTimersByTimeAsync(25)
    const result = await resultPromise

    expect(chat).toHaveBeenCalledOnce()
    expect(vi.mocked(createConfiguredProvider)).toHaveBeenCalledWith(expect.objectContaining({
      logicalName: 'integrations.notifications.stage_ai',
      tool: 'codex',
      timeoutMs: 25,
    }), expect.anything())
    expect(result.title).toContain('loop-1')
    expect(result.body).toContain('Keep going.')
  })
})
