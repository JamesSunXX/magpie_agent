import { createNotificationRouter } from '../src/platform/integrations/notifications/factory.js'
import type { NotificationEventType } from '../src/config/types.js'
import type { NotificationEvent } from '../src/platform/integrations/notifications/types.js'

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

export interface SmokeNotificationEnv {
  bluebubblesServerUrl: string
  bluebubblesPassword: string
  bluebubblesChatGuid: string
  feishuWebhookUrl: string
  feishuWebhookSecret: string
}

export function loadSmokeNotificationEnv(): SmokeNotificationEnv {
  return {
    bluebubblesServerUrl: requiredEnv('BLUEBUBBLES_SERVER_URL'),
    bluebubblesPassword: requiredEnv('BLUEBUBBLES_PASSWORD'),
    bluebubblesChatGuid: requiredEnv('BLUEBUBBLES_CHAT_GUID'),
    feishuWebhookUrl: requiredEnv('FEISHU_WEBHOOK_URL'),
    feishuWebhookSecret: requiredEnv('FEISHU_WEBHOOK_SECRET'),
  }
}

export function buildSmokeNotificationConfig(
  eventType: NotificationEventType,
  env: SmokeNotificationEnv
) {
  return {
    enabled: true,
    default_timeout_ms: Number(process.env.SMOKE_TIMEOUT_MS || 8000),
    routes: {
      [eventType]: ['bluebubbles_smoke', 'feishu_smoke'],
    },
    providers: {
      bluebubbles_smoke: {
        type: 'imessage',
        transport: 'bluebubbles',
        server_url: env.bluebubblesServerUrl,
        password: env.bluebubblesPassword,
        targets: [
          `chat_guid:${env.bluebubblesChatGuid}`,
        ],
      },
      feishu_smoke: {
        type: 'feishu-webhook',
        webhook_url: env.feishuWebhookUrl,
        secret: env.feishuWebhookSecret,
        msg_type: 'interactive',
      },
    },
  } as const
}

export function buildSmokeNotificationEvent(
  eventType: NotificationEventType,
  sessionId: string
): NotificationEvent {
  return {
    type: eventType,
    sessionId,
    title: `[SMOKE] ${eventType}`,
    message: [
      '任务: Smoke notification from magpie',
      `事件: ${eventType}`,
      '目标: bluebubbles_smoke, feishu_smoke',
      `会话: ${sessionId}`,
    ].join('\n'),
    severity: eventType === 'loop_failed' ? 'error' : 'warning',
    metadata: {
      smoke: true,
      ts: new Date().toISOString(),
    },
  }
}

async function main(): Promise<void> {
  const eventType = parseEventType(process.argv[2])
  const env = loadSmokeNotificationEnv()
  const router = createNotificationRouter(buildSmokeNotificationConfig(eventType, env))

  const sessionId = `smoke-${Date.now()}`
  const result = await router.dispatch(buildSmokeNotificationEvent(eventType, sessionId))

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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[smoke-notifications] ${message}`)
    process.exit(1)
  })
}
