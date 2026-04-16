import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveThreadMapping } from '../../../src/platform/integrations/im/thread-mapping.js'
import { publishFeishuTaskStatusFromConfig } from '../../../src/platform/integrations/im/feishu/task-status.js'

describe('publishFeishuTaskStatusFromConfig', () => {
  const dirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('replies to the mapped thread when a loop task completes', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-feishu-task-status-'))
    dirs.push(cwd)

    await saveThreadMapping(cwd, {
      threadId: 'om_task_root',
      rootMessageId: 'om_task_root',
      chatId: 'oc_chat',
      capability: 'loop',
      sessionId: 'loop-123',
      status: 'running',
    })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tenant_access_token: 'token-1',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { message_id: 'om_reply' },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await publishFeishuTaskStatusFromConfig(cwd, {
      integrations: {
        im: {
          enabled: true,
          default_provider: 'feishu_main',
          providers: {
            feishu_main: {
              type: 'feishu-app',
              app_id: 'app-id',
              app_secret: 'app-secret',
              verification_token: 'verify-token',
              default_chat_id: 'oc_chat',
              approval_whitelist_open_ids: ['ou_operator'],
            },
          },
        },
      },
    } as never, {
      capability: 'loop',
      sessionId: 'loop-123',
      status: 'completed',
      title: 'Fix login timeout',
      summary: 'Loop completed successfully.',
    })

    expect(result).toBe(true)
    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(requestBody.content).toContain('Loop completed successfully.')
    expect(requestBody.content).toContain('Fix login timeout')
  })
})
