import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNotificationRouter } from '../../../src/platform/integrations/notifications/factory.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('createNotificationRouter', () => {
  it('creates disabled router by default', async () => {
    const router = createNotificationRouter(undefined)

    const result = await router.dispatch({
      type: 'loop_completed',
      sessionId: 's1',
      title: 'Done',
      message: 'Completed',
      severity: 'info',
    })

    expect(result.success).toBe(false)
    expect(result.attempted).toBe(0)
  })

  it('ignores disabled providers from config', async () => {
    const router = createNotificationRouter({
      enabled: true,
      default_timeout_ms: 1000,
      routes: {
        loop_completed: ['feishu_team'],
      },
      providers: {
        feishu_team: {
          type: 'feishu-webhook',
          enabled: false,
          webhook_url: 'https://example.com/webhook',
        },
      },
    })

    const result = await router.dispatch({
      type: 'loop_completed',
      sessionId: 's1',
      title: 'Done',
      message: 'Completed',
      severity: 'info',
    })

    expect(result.attempted).toBe(0)
    expect(result.delivered).toBe(0)
    expect(result.success).toBe(false)
  })

  it('creates an iMessage provider via the notification factory', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const router = createNotificationRouter({
      enabled: true,
      default_timeout_ms: 1000,
      routes: {
        loop_completed: ['imessage_ops'],
      },
      providers: {
        imessage_ops: {
          type: 'imessage',
          server_url: 'https://bluebubbles.example.com',
          password: 'secret-guid',
          targets: ['chat_guid:iMessage;-;+8613800138000'],
        },
      },
    })

    const result = await router.dispatch({
      type: 'loop_completed',
      sessionId: 's1',
      title: 'Done',
      message: 'Completed',
      severity: 'info',
    })

    expect(result.attempted).toBe(1)
    expect(result.delivered).toBe(1)
    expect(result.success).toBe(true)
  })

  it('accepts stage-aware notification routes', async () => {
    const router = createNotificationRouter({
      enabled: true,
      default_timeout_ms: 1000,
      routes: {
        stage_entered: ['feishu_team'],
        stage_completed: ['feishu_team'],
        stage_failed: ['feishu_team'],
        stage_paused: ['feishu_team'],
        stage_resumed: ['feishu_team'],
      },
      providers: {
        feishu_team: {
          type: 'feishu-webhook',
          webhook_url: 'https://example.com/webhook',
        },
      },
    })

    expect(router).toBeDefined()
  })
})
