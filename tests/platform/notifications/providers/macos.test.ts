import { execFile } from 'child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MacosNotificationProvider } from '../../../../src/platform/integrations/notifications/providers/macos.js'

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

const execFileMock = vi.mocked(execFile)

const event = {
  type: 'human_confirmation_required' as const,
  sessionId: 'session-1',
  title: 'Need review',
  message: 'Please approve stage output',
  severity: 'warning' as const,
  actionUrl: 'vscode://file/tmp/human_confirmation.md:10',
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function mockExecFile(
  handler: (file: string, args: string[]) => {
    error?: Error
    stdout?: string
    stderr?: string
  }
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    const file = String(args[0] || '')
    const argv = Array.isArray(args[1]) ? args[1] as string[] : []
    const optionsOrCallback = args[2]
    const maybeCallback = args[3]
    const callback = (typeof optionsOrCallback === 'function'
      ? optionsOrCallback
      : maybeCallback) as ((error: Error | null, stdout?: string, stderr?: string) => void) | undefined

    if (!callback) {
      throw new Error('execFile callback is required in test mock')
    }

    const result = handler(file, argv)
    if (result.error) {
      callback(result.error, result.stdout || '', result.stderr || '')
      return {}
    }

    callback(null, result.stdout || '', result.stderr || '')
    return {}
  }
}

describe('MacosNotificationProvider', () => {
  it('uses terminal-notifier when available', async () => {
    execFileMock.mockImplementation(mockExecFile((file, args) => {
      if (file === 'which') {
        expect(args).toEqual(['terminal-notifier'])
        return { stdout: '/usr/local/bin/terminal-notifier\n' }
      }

      if (file === 'terminal-notifier') {
        expect(args).toContain('-title')
        expect(args).toContain('Need review')
        expect(args).toContain('-open')
        expect(args).toContain('vscode://file/tmp/human_confirmation.md:10')
        return { stdout: '' }
      }

      return { error: new Error(`unexpected command: ${file}`) }
    }) as typeof execFile)

    const provider = new MacosNotificationProvider('macos_local', {
      type: 'macos',
      terminal_notifier_bin: 'terminal-notifier',
      fallback_osascript: true,
    })

    const result = await provider.send(event, { timeoutMs: 1500 })

    expect(result.success).toBe(true)
    expect(result.raw).toMatchObject({ mode: 'terminal-notifier' })
    expect(execFileMock.mock.calls.map(call => call[0])).toEqual(['which', 'terminal-notifier'])
  })

  it('falls back to osascript when terminal-notifier is unavailable', async () => {
    execFileMock.mockImplementation(mockExecFile((file, args) => {
      if (file === 'which') {
        return { error: new Error('not found') }
      }

      if (file === 'osascript') {
        expect(args[0]).toBe('-e')
        expect(args[1]).toContain('display notification')
        expect(args[1]).toContain('Need review')
        return { stdout: '' }
      }

      return { error: new Error(`unexpected command: ${file}`) }
    }) as typeof execFile)

    const provider = new MacosNotificationProvider('macos_local', {
      type: 'macos',
      terminal_notifier_bin: 'terminal-notifier',
      fallback_osascript: true,
    })

    const result = await provider.send(event, { timeoutMs: 1500 })

    expect(result.success).toBe(true)
    expect(result.raw).toMatchObject({ mode: 'osascript' })
    expect(execFileMock.mock.calls.map(call => call[0])).toEqual(['which', 'osascript'])
  })

  it('returns failure when fallback is disabled and terminal-notifier is missing', async () => {
    execFileMock.mockImplementation(mockExecFile((file) => {
      if (file === 'which') {
        return { error: new Error('not found') }
      }

      return { error: new Error(`unexpected command: ${file}`) }
    }) as typeof execFile)

    const provider = new MacosNotificationProvider('macos_local', {
      type: 'macos',
      terminal_notifier_bin: 'terminal-notifier',
      fallback_osascript: false,
    })

    const result = await provider.send(event, { timeoutMs: 1500 })

    expect(result.success).toBe(false)
    expect(result.error).toContain('terminal-notifier not found and fallback disabled')
    expect(execFileMock.mock.calls.map(call => call[0])).toEqual(['which'])
  })
})
