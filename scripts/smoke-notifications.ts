import { createNotificationRouter } from '../src/platform/integrations/notifications/factory.js'
import type { NotificationEventType } from '../src/config/types.js'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required env: ${name}`)
  }
  return value
}

function parseEventType(input: string | undefined): NotificationEventType {
  const candidate = (input || 'human_confirmation_required').trim() as NotificationEventType
  const allowed: NotificationEventType[] = [
    'human_confirmation_required',
    'loop_failed',
    'loop_completed',
    'loop_paused',
    'loop_resumed',
  ]
  if (!allowed.includes(candidate)) {
    throw new Error(`Unsupported event type "${candidate}". Use one of: ${allowed.join(', ')}`)
  }
  return candidate
}

async function main(): Promise<void> {
  const eventType = parseEventType(process.argv[2])
  const bluebubblesServerUrl = requiredEnv('BLUEBUBBLES_SERVER_URL')
  const bluebubblesPassword = requiredEnv('BLUEBUBBLES_PASSWORD')
  const bluebubblesChatGuid = requiredEnv('BLUEBUBBLES_CHAT_GUID')
  const feishuWebhookUrl = requiredEnv('FEISHU_WEBHOOK_URL')
  const feishuWebhookSecret = requiredEnv('FEISHU_WEBHOOK_SECRET')

  const router = createNotificationRouter({
    enabled: true,
    default_timeout_ms: Number(process.env.SMOKE_TIMEOUT_MS || 8000),
    routes: {
      [eventType]: ['bluebubbles_smoke', 'feishu_smoke'],
    },
    providers: {
      bluebubbles_smoke: {
        type: 'imessage',
        transport: 'bluebubbles',
        server_url: bluebubblesServerUrl,
        password: bluebubblesPassword,
        targets: [
          `chat_guid:${bluebubblesChatGuid}`,
        ],
      },
      feishu_smoke: {
        type: 'feishu-webhook',
        webhook_url: feishuWebhookUrl,
        secret: feishuWebhookSecret,
        msg_type: 'post',
      },
    },
  })

  const sessionId = `smoke-${Date.now()}`
  const result = await router.dispatch({
    type: eventType,
    sessionId,
    title: `[SMOKE] ${eventType}`,
    message: `Smoke notification from magpie. session=${sessionId}`,
    severity: eventType === 'loop_failed' ? 'error' : 'warning',
    metadata: {
      smoke: true,
      ts: new Date().toISOString(),
    },
  })

  console.log(JSON.stringify(result, null, 2))

  if (result.attempted < 2) {
    throw new Error(`Expected 2 provider attempts, got ${result.attempted}`)
  }
  if (result.delivered < 2) {
    const failed = result.results.filter((item) => !item.success)
      .map((item) => `${item.providerId}: ${item.error || 'unknown error'}`)
      .join('; ')
    throw new Error(`Smoke test failed: ${failed}`)
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[smoke-notifications] ${message}`)
  process.exit(1)
})
