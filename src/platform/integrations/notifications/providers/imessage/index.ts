import type {
  NotificationContext,
  NotificationEvent,
  NotificationProvider,
  NotificationResult,
} from '../../types.js'
import type { ImessageNotificationProviderConfig } from './types.js'
import { dispatchAppleScriptNotification } from './apple-script.js'
import { dispatchBlueBubblesNotification } from './bluebubbles.js'

function isAppleScriptTransport(
  config: ImessageNotificationProviderConfig,
): config is Extract<ImessageNotificationProviderConfig, { transport: 'messages-applescript' }> {
  return config.transport === 'messages-applescript'
}

export class ImessageNotificationProvider implements NotificationProvider {
  readonly id: string
  private readonly config: ImessageNotificationProviderConfig

  constructor(id: string, config: ImessageNotificationProviderConfig) {
    this.id = id
    this.config = config
  }

  async send(event: NotificationEvent, ctx: NotificationContext): Promise<NotificationResult> {
    if (!Array.isArray(this.config.targets) || this.config.targets.length === 0) {
      return {
        providerId: this.id,
        success: false,
        error: 'at least one target is required',
      }
    }

    if (isAppleScriptTransport(this.config)) {
      const dispatch = await dispatchAppleScriptNotification(event, ctx, this.config)
      return {
        providerId: this.id,
        success: dispatch.delivered > 0,
        deliveredAt: dispatch.delivered > 0 ? new Date() : undefined,
        error: dispatch.delivered > 0 ? undefined : 'failed to deliver to every configured iMessage target',
        raw: dispatch,
      }
    }

    const blueBubblesConfig = this.config

    if (!blueBubblesConfig.server_url) {
      return {
        providerId: this.id,
        success: false,
        error: 'server_url is required for bluebubbles transport',
      }
    }

    if (!blueBubblesConfig.password) {
      return {
        providerId: this.id,
        success: false,
        error: 'password is required for bluebubbles transport',
      }
    }

    const dispatch = await dispatchBlueBubblesNotification(event, ctx, blueBubblesConfig)

    return {
      providerId: this.id,
      success: dispatch.delivered > 0,
      deliveredAt: dispatch.delivered > 0 ? new Date() : undefined,
      error: dispatch.delivered > 0 ? undefined : 'failed to deliver to every configured iMessage target',
      raw: dispatch,
    }
  }
}

export * from './types.js'
