import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeishuImClient } from '../../../src/platform/integrations/im/feishu/client.js'

describe('FeishuImClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends a root text message through the Feishu IM API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tenant_access_token: 'token-1',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { message_id: 'om_root' },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new FeishuImClient({
      appId: 'app-id',
      appSecret: 'app-secret',
    })

    const result = await client.sendRootTextMessage('oc_chat', 'hello')
    expect(result.messageId).toBe('om_root')

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(requestBody.receive_id).toBe('oc_chat')
    expect(requestBody.msg_type).toBe('text')
    expect(requestBody.content).toContain('hello')
  })

  it('replies with a text message in the existing thread', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tenant_access_token: 'token-1',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { message_id: 'om_reply' },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new FeishuImClient({
      appId: 'app-id',
      appSecret: 'app-secret',
    })

    const result = await client.replyTextMessage('om_root', 'approved')
    expect(result.messageId).toBe('om_reply')

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(requestBody.reply_in_thread).toBe(true)
    expect(requestBody.content).toContain('approved')
  })

  it('replies with an interactive card in the existing thread', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tenant_access_token: 'token-1',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { message_id: 'om_reply_card' },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new FeishuImClient({
      appId: 'app-id',
      appSecret: 'app-secret',
    })

    const result = await client.replyInteractiveCard('om_root', {
      type: 'template',
      data: {
        template_id: 'template-1',
      },
    })

    expect(result.messageId).toBe('om_reply_card')
    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(requestBody.msg_type).toBe('interactive')
    expect(requestBody.reply_in_thread).toBe(true)
    expect(requestBody.content).toContain('template-1')
  })

  it('fails fast when tenant access token is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))

    const client = new FeishuImClient({
      appId: 'app-id',
      appSecret: 'app-secret',
    })

    await expect(client.sendRootTextMessage('oc_chat', 'hello')).rejects.toThrow('missing tenant_access_token')
  })

  it('surfaces non-200 reply failures from the Feishu API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tenant_access_token: 'token-1',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new FeishuImClient({
      appId: 'app-id',
      appSecret: 'app-secret',
    })

    await expect(client.replyTextMessage('om_root', 'approved')).rejects.toThrow('HTTP 500')
  })
})
