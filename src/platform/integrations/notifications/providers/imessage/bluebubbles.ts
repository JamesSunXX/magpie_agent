import type { NotificationContext, NotificationEvent } from '../../types.js'
import type {
  BlueBubblesMessageRequest,
  ImessageNotificationProviderConfig,
  ImessageTargetResult,
} from './types.js'

const CHAT_GUID_PREFIX = 'chat_guid:'
type BlueBubblesConfig = Extract<ImessageNotificationProviderConfig, {
  transport?: 'bluebubbles'
}>

function normalizeBaseUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/g, '')
}

export function buildMessageText(event: NotificationEvent): string {
  const lines = [`[${event.severity.toUpperCase()}] ${event.title}`, event.message]
  if (event.actionUrl) {
    lines.push(`Open: ${event.actionUrl}`)
  }
  lines.push(`Session: ${event.sessionId}`)
  return lines.join('\n')
}

function resolveChatGuid(target: string): string | null {
  const value = target.trim()
  if (!value) return null
  if (value.startsWith(CHAT_GUID_PREFIX)) {
    return value.slice(CHAT_GUID_PREFIX.length).trim() || null
  }
  if (value.includes(';-;')) {
    return value
  }
  return null
}

async function sendBlueBubblesText(
  serverUrl: string,
  password: string,
  payload: BlueBubblesMessageRequest,
  timeoutMs: number,
): Promise<ImessageTargetResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const url = `${normalizeBaseUrl(serverUrl)}/api/v1/message/text?guid=${encodeURIComponent(password)}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const raw = await response.text()
    if (!response.ok) {
      return {
        target: payload.chatGuid,
        success: false,
        status: response.status,
        error: `HTTP ${response.status}`,
        raw,
      }
    }

    return {
      target: payload.chatGuid,
      success: true,
      status: response.status,
      raw,
    }
  } catch (error) {
    return {
      target: payload.chatGuid,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function dispatchBlueBubblesNotification(
  event: NotificationEvent,
  ctx: NotificationContext,
  config: BlueBubblesConfig,
): Promise<{
  delivered: number
  attempted: number
  results: ImessageTargetResult[]
}> {
  const method = config.method || 'private-api'
  const text = buildMessageText(event)
  const attempts = config.targets.map((target) => {
    const chatGuid = resolveChatGuid(target)
    if (!chatGuid) {
      return Promise.resolve({
        target,
        success: false,
        error: 'unsupported target; use chat_guid:<guid> or a raw BlueBubbles chat guid',
      } satisfies ImessageTargetResult)
    }

    return sendBlueBubblesText(
      config.server_url,
      config.password,
      {
        chatGuid,
        text,
        message: text,
        method,
      },
      ctx.timeoutMs,
    )
  })

  const results = await Promise.all(attempts)
  return {
    delivered: results.filter((item) => item.success).length,
    attempted: results.length,
    results,
  }
}
