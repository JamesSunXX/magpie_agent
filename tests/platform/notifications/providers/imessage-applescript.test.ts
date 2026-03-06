import { describe, expect, it, vi } from 'vitest'
import { dispatchAppleScriptNotification } from '../../../../src/platform/integrations/notifications/providers/imessage/apple-script.js'

const event = {
  type: 'human_confirmation_required' as const,
  sessionId: 'session-1',
  title: 'Need review',
  message: 'Please approve stage output',
  severity: 'warning' as const,
  actionUrl: 'vscode://file/tmp/human_confirmation.md:10',
}

describe('dispatchAppleScriptNotification', () => {
  it('sends message through osascript for handle targets', async () => {
    const exec = vi.fn((_file, _args, _options, cb: (error: Error | null) => void) => {
      cb(null)
    }) as unknown as Parameters<typeof dispatchAppleScriptNotification>[3]

    const result = await dispatchAppleScriptNotification(
      event,
      { timeoutMs: 1500 },
      {
        type: 'imessage',
        transport: 'messages-applescript',
        targets: ['handle:+8613800138000'],
      },
      exec,
    )

    expect(result.attempted).toBe(1)
    expect(result.delivered).toBe(1)
    expect(result.results[0]).toMatchObject({
      target: '+8613800138000',
      success: true,
    })
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('rejects chat_guid targets for messages-applescript transport', async () => {
    const exec = vi.fn() as unknown as Parameters<typeof dispatchAppleScriptNotification>[3]

    const result = await dispatchAppleScriptNotification(
      event,
      { timeoutMs: 1500 },
      {
        type: 'imessage',
        transport: 'messages-applescript',
        targets: ['chat_guid:iMessage;-;+8613800138000'],
      },
      exec,
    )

    expect(result.attempted).toBe(1)
    expect(result.delivered).toBe(0)
    expect(result.results[0]?.success).toBe(false)
    expect(exec).not.toHaveBeenCalled()
  })

  it('captures osascript execution failures', async () => {
    const exec = vi.fn((_file, _args, _options, cb: (error: Error | null) => void) => {
      cb(new Error('osascript failed'))
    }) as unknown as Parameters<typeof dispatchAppleScriptNotification>[3]

    const result = await dispatchAppleScriptNotification(
      event,
      { timeoutMs: 1500 },
      {
        type: 'imessage',
        transport: 'messages-applescript',
        targets: ['handle:+8613800138000'],
      },
      exec,
    )

    expect(result.attempted).toBe(1)
    expect(result.delivered).toBe(0)
    expect(result.results[0]).toMatchObject({
      target: '+8613800138000',
      success: false,
      error: 'osascript failed',
    })
  })
})
