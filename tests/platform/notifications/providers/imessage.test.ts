import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImessageNotificationProvider } from '../../../../src/platform/integrations/notifications/providers/imessage/index.js'

const event = {
  type: 'human_confirmation_required' as const,
  sessionId: 'session-1',
  title: 'Need review',
  message: 'Please approve stage output',
  severity: 'warning' as const,
  actionUrl: 'vscode://file/tmp/human_confirmation.md:10',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ImessageNotificationProvider', () => {
  it('sends BlueBubbles notifications to configured chat guid targets', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('ok-1', { status: 200 }))
      .mockResolvedValueOnce(new Response('ok-2', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new ImessageNotificationProvider('imessage_ops', {
      type: 'imessage',
      transport: 'bluebubbles',
      server_url: 'https://bluebubbles.example.com/',
      password: 'secret-guid',
      targets: [
        'chat_guid:iMessage;-;+8613800138000',
        'iMessage;-;+8613900139000',
      ],
      method: 'private-api',
    })

    const result = await provider.send(event, { timeoutMs: 1500 })

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://bluebubbles.example.com/api/v1/message/text?guid=secret-guid')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const firstPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(firstPayload).toMatchObject({
      chatGuid: 'iMessage;-;+8613800138000',
      method: 'private-api',
    })
    expect(firstPayload.text).toContain('Need review')
    expect(firstPayload.text).toContain('Session: session-1')
  })

  it('fails fast for unsupported direct-handle targets', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const provider = new ImessageNotificationProvider('imessage_ops', {
      type: 'imessage',
      server_url: 'https://bluebubbles.example.com',
      password: 'secret-guid',
      targets: ['+8613800138000'],
    })

    const result = await provider.send(event, { timeoutMs: 1500 })

    expect(result.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.error).toContain('failed to deliver')
    expect(result.raw).toMatchObject({
      attempted: 1,
      delivered: 0,
      results: [
        {
          target: '+8613800138000',
          success: false,
        },
      ],
    })
  })

  it('treats partial delivery as provider success and exposes per-target results', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('downstream error', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new ImessageNotificationProvider('imessage_ops', {
      type: 'imessage',
      server_url: 'https://bluebubbles.example.com',
      password: 'secret-guid',
      targets: [
        'chat_guid:iMessage;-;+8613800138000',
        'chat_guid:iMessage;-;+8613900139000',
      ],
    })

    const result = await provider.send(event, { timeoutMs: 1500 })

    expect(result.success).toBe(true)
    expect(result.raw).toMatchObject({
      attempted: 2,
      delivered: 1,
      results: [
        {
          target: 'iMessage;-;+8613800138000',
          success: true,
        },
        {
          target: 'iMessage;-;+8613900139000',
          success: false,
          status: 503,
        },
      ],
    })
  })
})
