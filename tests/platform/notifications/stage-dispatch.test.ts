import { describe, expect, it, vi } from 'vitest'
import { dispatchStageNotification } from '../../../src/platform/integrations/notifications/stage-dispatch.js'

describe('dispatchStageNotification', () => {
  it('injects project name and path from cwd into the notification content', async () => {
    const router = {
      dispatch: vi.fn().mockResolvedValue({
        success: true,
        attempted: 1,
        delivered: 1,
        results: [],
      }),
    }

    await dispatchStageNotification({
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
            },
          },
        },
      } as never,
      cwd: '/tmp/sample-repo',
      eventsPath: '/tmp/missing-events.jsonl',
      router: router as never,
      input: {
        eventType: 'stage_entered',
        sessionId: 'loop-1',
        capability: 'loop',
        runTitle: 'Deliver feature',
        stage: 'code_development',
        summary: 'Running code changes.',
        nextAction: 'Edit files.',
        aiRoster: [{ id: 'codex', role: 'main execution' }],
      },
    })

    expect(router.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('sample-repo'),
      message: expect.stringContaining('项目: sample-repo'),
    }))
    expect(router.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('路径: /tmp/sample-repo'),
    }))
  })
})
