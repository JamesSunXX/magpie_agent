import { createHmac } from 'crypto'
import type {
  NotificationContext,
  NotificationEvent,
  NotificationProvider,
  NotificationResult,
} from '../types.js'

export interface FeishuWebhookNotificationProviderConfig {
  type: 'feishu-webhook'
  enabled?: boolean
  webhook_url: string
  secret?: string
  msg_type?: 'text' | 'post' | 'interactive'
}

function buildFeishuSign(secret: string, timestamp: string): string {
  const stringToSign = `${timestamp}\n${secret}`
  return createHmac('sha256', stringToSign).digest('base64')
}

function renderCardMarkdown(message: string): string {
  return message
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':')
      if (separator <= 0) return line
      const label = line.slice(0, separator).trim()
      const value = line.slice(separator + 1).trim()
      return `**${label}**: ${value || '-'}`
    })
    .join('\n')
}

function cardTemplateFor(event: NotificationEvent): 'blue' | 'orange' | 'red' {
  switch (event.severity) {
    case 'warning':
      return 'orange'
    case 'error':
      return 'red'
    default:
      return 'blue'
  }
}

function buildPayload(event: NotificationEvent, msgType: 'text' | 'post' | 'interactive') {
  if (msgType === 'text') {
    return {
      msg_type: 'text',
      content: {
        text: `[${event.type}] ${event.title}\n${event.message}${event.actionUrl ? `\n${event.actionUrl}` : ''}`,
      },
    }
  }

  if (msgType === 'interactive') {
    return {
      msg_type: 'interactive',
      card: {
        header: {
          title: {
            tag: 'plain_text',
            content: `[${event.type}] ${event.title}`,
          },
          template: cardTemplateFor(event),
        },
        elements: [
          {
            tag: 'markdown',
            content: renderCardMarkdown(event.message),
          },
          ...(event.actionUrl ? [{
            tag: 'action',
            actions: [{
              tag: 'button',
              type: 'primary',
              text: {
                tag: 'plain_text',
                content: '打开处理入口',
              },
              url: event.actionUrl,
            }],
          }] : []),
        ],
      },
    }
  }

  const lines = [event.message]
  if (event.actionUrl) {
    lines.push(`查看处理入口: ${event.actionUrl}`)
  }

  return {
    msg_type: 'post',
    content: {
      post: {
        zh_cn: {
          title: `[${event.type}] ${event.title}`,
          content: [
            lines.map((line) => ({ tag: 'text', text: line })),
          ],
        },
      },
    },
  }
}

export class FeishuWebhookNotificationProvider implements NotificationProvider {
  readonly id: string
  private readonly config: FeishuWebhookNotificationProviderConfig

  constructor(id: string, config: FeishuWebhookNotificationProviderConfig) {
    this.id = id
    this.config = config
  }

  async send(event: NotificationEvent, ctx: NotificationContext): Promise<NotificationResult> {
    if (!this.config.webhook_url) {
      return {
        providerId: this.id,
        success: false,
        error: 'webhook_url is required',
      }
    }

    try {
      const msgType = this.config.msg_type || 'interactive'
      const payload = buildPayload(event, msgType)

      const timestamp = Math.floor(Date.now() / 1000).toString()
      const signedPayload = this.config.secret
        ? {
            ...payload,
            timestamp,
            sign: buildFeishuSign(this.config.secret, timestamp),
          }
        : payload

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs)

      const response = await fetch(this.config.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(signedPayload),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))

      if (!response.ok) {
        return {
          providerId: this.id,
          success: false,
          error: `HTTP ${response.status}`,
          raw: await response.text(),
        }
      }

      return {
        providerId: this.id,
        success: true,
        deliveredAt: new Date(),
        raw: await response.text(),
      }
    } catch (error) {
      return {
        providerId: this.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
