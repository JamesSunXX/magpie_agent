import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveThreadMapping } from '../../../src/platform/integrations/im/thread-mapping.js'
import { persistWorkflowSession } from '../../../src/capabilities/workflows/shared/runtime.js'
import {
  publishFeishuTaskStatusFromConfig,
  replyFeishuTaskStatusForThread,
} from '../../../src/platform/integrations/im/feishu/task-status.js'

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

  it('replies with a structured harness status summary for the current thread', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'magpie-feishu-task-status-'))
    dirs.push(cwd)

    await persistWorkflowSession(cwd, {
      id: 'harness-123',
      capability: 'harness',
      title: 'Deliver checkout v2',
      createdAt: new Date('2026-04-16T00:00:00.000Z'),
      updatedAt: new Date('2026-04-16T00:05:00.000Z'),
      status: 'waiting_retry',
      currentStage: 'reviewing',
      summary: 'Harness execution failed with a retryable error; waiting to retry.',
      artifacts: {
        eventsPath: join(cwd, '.magpie', 'sessions', 'harness', 'harness-123', 'events.jsonl'),
      },
      evidence: {
        runtime: {
          retryCount: 2,
          nextRetryAt: '2026-04-16T00:10:00.000Z',
          lastError: 'Codex CLI timed out after 900s',
        },
      },
    })
    await saveThreadMapping(cwd, {
      threadId: 'om_task_root',
      rootMessageId: 'om_task_root',
      chatId: 'oc_chat',
      capability: 'harness',
      sessionId: 'harness-123',
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

    const result = await replyFeishuTaskStatusForThread(cwd, {
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
    } as never, 'om_task_root')

    expect(result).toBe(true)
    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(requestBody.content).toContain('Status: waiting_retry')
    expect(requestBody.content).toContain('Stage: reviewing')
    expect(requestBody.content).toContain('Reason: Codex CLI timed out after 900s')
    expect(requestBody.content).toContain('Next: wait for retry at 2026-04-16T00:10:00.000Z')
    expect(requestBody.content).toContain('Inspect: magpie harness inspect harness-123')
  })

  it('returns false instead of throwing when a Feishu reply fails', async () => {
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

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 })))

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
      status: 'failed',
      title: 'Fix login timeout',
      summary: 'Loop failed.',
    })

    expect(result).toBe(false)
  })
})
