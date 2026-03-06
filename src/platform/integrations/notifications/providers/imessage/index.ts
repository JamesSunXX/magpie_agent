import type {
  NotificationContext,
  NotificationEvent,
  NotificationProvider,
  NotificationResult,
} from '../../types.js'
import type { ImessageNotificationProviderConfig } from './types.js'
import { dispatchBlueBubblesNotification } from './bluebubbles.js'

export class ImessageNotificationProvider implements NotificationProvider {
  readonly id: string
  private readonly config: ImessageNotificationProviderConfig

  constructor(id: string, config: ImessageNotificationProviderConfig) {
    this.id = id
    this.config = config
  }

  async send(event: NotificationEvent, ctx: NotificationContext): Promise<NotificationResult> {
    if (!this.config.server_url) {
      return {
        providerId: this.id,
        success: false,
        error: 'server_url is required',
      }
    }

    if (!this.config.password) {
      return {
        providerId: this.id,
        success: false,
        error: 'password is required',
      }
    }

    if (!Array.isArray(this.config.targets) || this.config.targets.length === 0) {
      return {
        providerId: this.id,
        success: false,
        error: 'at least one target is required',
      }
    }

    if ((this.config.transport || 'bluebubbles') !== 'bluebubbles') {
      return {
        providerId: this.id,
        success: false,
        error: `unsupported imessage transport: ${this.config.transport}`,
      }
    }

    const dispatch = await dispatchBlueBubblesNotification(event, ctx, this.config)

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
