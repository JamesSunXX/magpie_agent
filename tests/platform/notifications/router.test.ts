import { describe, expect, it } from 'vitest'
import { NotificationRouter } from '../../../src/platform/integrations/notifications/router.js'
import type { NotificationProvider } from '../../../src/platform/integrations/notifications/types.js'

const makeEvent = () => ({
  type: 'human_confirmation_required' as const,
  sessionId: 's1',
  title: 'Need human confirmation',
  message: 'Please review',
  severity: 'warning' as const,
})

describe('NotificationRouter', () => {
  it('succeeds when at least one provider succeeds', async () => {
    const providers: Record<string, NotificationProvider> = {
      ok: {
        id: 'ok',
        async send() {
          return { providerId: 'ok', success: true, deliveredAt: new Date() }
        },
      },
      bad: {
        id: 'bad',
        async send() {
          return { providerId: 'bad', success: false, error: 'boom' }
        },
      },
    }

    const router = new NotificationRouter({
      enabled: true,
      defaultTimeoutMs: 1000,
      routes: {
        human_confirmation_required: ['ok', 'bad'],
      },
      providers,
    })

    const result = await router.dispatch(makeEvent())
    expect(result.attempted).toBe(2)
    expect(result.delivered).toBe(1)
    expect(result.success).toBe(true)
  })

  it('returns no attempts when disabled', async () => {
    const router = new NotificationRouter({
      enabled: false,
      defaultTimeoutMs: 1000,
      routes: {
        human_confirmation_required: ['missing'],
      },
      providers: {},
    })

    const result = await router.dispatch(makeEvent())
    expect(result.attempted).toBe(0)
    expect(result.delivered).toBe(0)
    expect(result.success).toBe(false)
  })
})
