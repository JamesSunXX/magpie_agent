import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFeishuCallbackServer } from '../../../src/platform/integrations/im/feishu/server.js'

async function startServer() {
  return await new Promise<{
    server: ReturnType<typeof createFeishuCallbackServer>
    baseUrl: string
  }>((resolve) => {
    const onEvent = vi.fn().mockResolvedValue(undefined)
    const server = createFeishuCallbackServer({
      path: '/callbacks/feishu',
      verificationToken: 'verify-token',
      onEvent,
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected an ephemeral port address.')
      }

      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      })
    })
  })
}

describe('createFeishuCallbackServer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the verification challenge for a valid handshake', async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined)
    const server = createFeishuCallbackServer({
      path: '/callbacks/feishu',
      verificationToken: 'verify-token',
      onEvent,
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral port address.')
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/callbacks/feishu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'verify-token',
        challenge: 'challenge-1',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      challenge: 'challenge-1',
    })
    expect(onEvent).not.toHaveBeenCalled()

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('passes confirmation callbacks to the event handler', async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined)
    const server = createFeishuCallbackServer({
      path: '/callbacks/feishu',
      verificationToken: 'verify-token',
      onEvent,
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral port address.')
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/callbacks/feishu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        header: {
          event_id: 'evt-1',
          event_type: 'im.message.action.trigger',
        },
        event: {
          operator: { open_id: 'ou_operator' },
          action: {
            value: {
              action: 'approve_confirmation',
              session_id: 'loop-123',
              confirmation_id: 'confirm-1',
            },
          },
          context: {
            open_message_id: 'om_root',
            open_chat_id: 'oc_chat',
          },
        },
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(onEvent).toHaveBeenCalledWith({
      kind: 'confirmation_action',
      eventId: 'evt-1',
      action: 'approve_confirmation',
      actorOpenId: 'ou_operator',
      sessionId: 'loop-123',
      confirmationId: 'confirm-1',
      threadKey: 'om_root',
      chatId: 'oc_chat',
      rejectionReason: undefined,
      extraInstruction: undefined,
    })

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('returns a 400 response when the payload is invalid', async () => {
    const { server, baseUrl } = await startServer()

    const response = await fetch(`${baseUrl}/callbacks/feishu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        header: {
          event_type: 'im.message.action.trigger',
        },
        event: {
          operator: { open_id: 'ou_operator' },
          action: {
            value: {
              action: 'not-supported',
            },
          },
          context: {
            open_message_id: 'om_root',
            open_chat_id: 'oc_chat',
          },
        },
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid Feishu callback payload: unsupported action not-supported',
    })

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })
})
