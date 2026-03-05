import { describe, expect, it } from 'vitest'
import { createNotificationRouter } from '../../../src/platform/integrations/notifications/factory.js'

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
})
