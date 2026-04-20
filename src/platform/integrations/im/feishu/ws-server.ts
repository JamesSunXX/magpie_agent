import * as Lark from '@larksuiteoapi/node-sdk'
import { parseFeishuEvent } from './events.js'
import type { ImInboundEvent } from '../types.js'

/**
 * Start a Feishu long-connection (WebSocket) server using the official Lark SDK.
 *
 * The SDK delivers the event body directly (without the { header, event }
 * wrapper). We reconstruct the envelope so parseFeishuEvent can be reused.
 *
 * Note: long-connection mode only supports event subscriptions (e.g.
 * im.message.receive_v1). Card action callbacks still require the HTTP
 * callback server.
 */
export function startFeishuWsServer(options: {
  appId: string
  appSecret: string
  encryptKey?: string
  onEvent: (event: ImInboundEvent) => Promise<void>
}): Lark.WSClient {
  const eventDispatcher = new Lark.EventDispatcher({
    encryptKey: options.encryptKey,
  })

  eventDispatcher.register({
    'im.message.receive_v1': async (data) => {
      // Reconstruct the full payload envelope that parseFeishuEvent expects.
      const payload = {
        header: {
          event_id: data.event_id,
          event_type: 'im.message.receive_v1',
        },
        event: data,
      }
      await options.onEvent(parseFeishuEvent(payload))
    },
  })

  // Card action events (confirmation buttons, task form submissions).
  // The SDK routes by event_type string internally; cast to bypass strict IHandles typing.
  ;(eventDispatcher as any).register({
    'card.action.trigger': async (data: any) => {
      const payload = {
        header: {
          event_id: data.event_id,
          event_type: 'im.message.action.trigger',
        },
        event: data,
      }
      await options.onEvent(parseFeishuEvent(payload))
    },
  })

  const wsClient = new Lark.WSClient({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel: Lark.LoggerLevel.info,
  })

  wsClient.start({ eventDispatcher })

  return wsClient
}
