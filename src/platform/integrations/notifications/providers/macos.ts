import { execFile } from 'child_process'
import { promisify } from 'util'
import type {
  NotificationContext,
  NotificationEvent,
  NotificationProvider,
  NotificationResult,
} from '../types.js'

const execFileAsync = promisify(execFile)

export interface MacosNotificationProviderConfig {
  type: 'macos'
  enabled?: boolean
  click_target?: 'vscode' | 'file'
  terminal_notifier_bin?: string
  fallback_osascript?: boolean
}

function quoteForAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function commandExists(cmd: string, timeoutMs: number): Promise<boolean> {
  try {
    await execFileAsync('which', [cmd], { timeout: timeoutMs })
    return true
  } catch {
    return false
  }
}

export class MacosNotificationProvider implements NotificationProvider {
  readonly id: string
  private readonly config: MacosNotificationProviderConfig

  constructor(id: string, config: MacosNotificationProviderConfig) {
    this.id = id
    this.config = config
  }

  async send(event: NotificationEvent, ctx: NotificationContext): Promise<NotificationResult> {
    const terminalNotifierBin = this.config.terminal_notifier_bin || 'terminal-notifier'
    const useFallback = this.config.fallback_osascript !== false

    try {
      if (await commandExists(terminalNotifierBin, ctx.timeoutMs)) {
        const args = ['-title', event.title, '-message', event.message]
        if (event.actionUrl) {
          args.push('-open', event.actionUrl)
        }
        await execFileAsync(terminalNotifierBin, args, { timeout: ctx.timeoutMs })
        return {
          providerId: this.id,
          success: true,
          deliveredAt: new Date(),
          raw: { mode: 'terminal-notifier' },
        }
      }

      if (!useFallback) {
        return {
          providerId: this.id,
          success: false,
          error: `${terminalNotifierBin} not found and fallback disabled`,
        }
      }

      const script = `display notification "${quoteForAppleScript(event.message)}" with title "${quoteForAppleScript(event.title)}"`
      await execFileAsync('osascript', ['-e', script], { timeout: ctx.timeoutMs })
      return {
        providerId: this.id,
        success: true,
        deliveredAt: new Date(),
        raw: { mode: 'osascript' },
      }
    } catch (error) {
      return {
        providerId: this.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
