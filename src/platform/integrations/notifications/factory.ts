import type { NotificationsIntegrationConfig } from '../../../config/types.js'
import { FeishuWebhookNotificationProvider } from './providers/feishu-webhook.js'
import { ImessageNotificationProvider } from './providers/imessage/index.js'
import { MacosNotificationProvider } from './providers/macos.js'
import { NotificationRouter } from './router.js'
import type { NotificationProvider } from './types.js'

const DEFAULT_TIMEOUT_MS = 5000

function createProviders(config: NotificationsIntegrationConfig | undefined): Record<string, NotificationProvider> {
  const output: Record<string, NotificationProvider> = {}
  const providers = config?.providers || {}

  for (const [id, providerConfig] of Object.entries(providers)) {
    if (providerConfig.enabled === false) continue

    if (providerConfig.type === 'macos') {
      output[id] = new MacosNotificationProvider(id, providerConfig)
      continue
    }

    if (providerConfig.type === 'feishu-webhook') {
      output[id] = new FeishuWebhookNotificationProvider(id, providerConfig)
      continue
    }

    if (providerConfig.type === 'imessage') {
      output[id] = new ImessageNotificationProvider(id, providerConfig)
      continue
    }
  }

  return output
}

export function createNotificationRouter(config: NotificationsIntegrationConfig | undefined): NotificationRouter {
  const providers = createProviders(config)

  return new NotificationRouter({
    enabled: config?.enabled === true,
    defaultTimeoutMs: config?.default_timeout_ms || DEFAULT_TIMEOUT_MS,
    routes: config?.routes || {},
    providers,
  })
}
