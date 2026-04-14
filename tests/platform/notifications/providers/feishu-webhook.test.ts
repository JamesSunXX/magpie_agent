import { createHmac } from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeishuWebhookNotificationProvider } from '../../../../src/platform/integrations/notifications/providers/feishu-webhook.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const event = {
  type: 'human_confirmation_required' as const,
  sessionId: 'session-1',
  title: 'Need review',
  message: 'Please approve stage output',
  severity: 'warning' as const,
  actionUrl: 'vscode://file/tmp/human_confirmation.md:10',
}

describe('FeishuWebhookNotificationProvider', () => {
  it('sends an interactive card and adds timestamp/sign when secret is configured', async () => {
    const timestamp = '1700000000'
    vi.spyOn(Date, 'now').mockReturnValue(Number(timestamp) * 1000)

    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new FeishuWebhookNotificationProvider('feishu_team', {
      type: 'feishu-webhook',
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo',
      secret: 'signing-secret',
    })

    const result = await provider.send(event, { timeoutMs: 1500 })
    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    const stringToSign = `${timestamp}\n${'signing-secret'}`
    const expected = createHmac('sha256', stringToSign).digest('base64')

    expect(body.timestamp).toBe(timestamp)
    expect(body.sign).toBe(expected)
    expect(body.msg_type).toBe('interactive')
    expect(body.card.header.title.content).toContain('Need review')
    expect(JSON.stringify(body.card)).toContain('Please approve stage output')
    expect(JSON.stringify(body.card)).toContain('vscode://file/tmp/human_confirmation.md:10')
  })
})
