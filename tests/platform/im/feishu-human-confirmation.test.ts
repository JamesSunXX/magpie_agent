import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishFeishuHumanConfirmation } from '../../../src/platform/integrations/im/feishu/human-confirmation.js'

describe('publishFeishuHumanConfirmation', () => {
  const dirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('creates a root thread on first publish and reuses it on later publishes', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-feishu-human-'))
    dirs.push(cwd)

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tenant_access_token: 'token-1',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { message_id: 'om_root' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tenant_access_token: 'token-2',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { message_id: 'om_reply_1' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tenant_access_token: 'token-3',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { message_id: 'om_reply_2' },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await publishFeishuHumanConfirmation(cwd, {
      app_id: 'app-id',
      app_secret: 'app-secret',
      default_chat_id: 'oc_chat',
      capability: 'loop',
      sessionId: 'loop-123',
      title: 'Loop paused',
      summary: 'Need one final decision',
      confirmationId: 'confirm-1',
    })

    await publishFeishuHumanConfirmation(cwd, {
      app_id: 'app-id',
      app_secret: 'app-secret',
      default_chat_id: 'oc_chat',
      capability: 'loop',
      sessionId: 'loop-123',
      title: 'Loop paused again',
      summary: 'Need another decision',
      confirmationId: 'confirm-2',
    })

    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/open-apis/im/v1/messages?receive_id_type=chat_id')
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain('/open-apis/im/v1/messages/om_root/reply')
    expect(String(fetchMock.mock.calls[5]?.[0])).toContain('/open-apis/im/v1/messages/om_root/reply')

    const firstReplyBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))
    expect(firstReplyBody.msg_type).toBe('interactive')
    expect(firstReplyBody.content).toContain('confirm-1')
    expect(firstReplyBody.content).toContain('approve_confirmation')

    const secondReplyBody = JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))
    expect(secondReplyBody.content).toContain('confirm-2')
    expect(secondReplyBody.content).toContain('reject_confirmation')
  })
})
