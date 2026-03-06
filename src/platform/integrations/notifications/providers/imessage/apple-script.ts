import { execFile } from 'child_process'
import type { NotificationContext, NotificationEvent } from '../../types.js'
import type {
  AppleScriptMessageRequest,
  ImessageNotificationProviderConfig,
  ImessageTargetResult,
} from './types.js'
import { buildMessageText } from './bluebubbles.js'

type AppleScriptConfig = Extract<ImessageNotificationProviderConfig, {
  transport: 'messages-applescript'
}>

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { timeout?: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown

const HANDLE_PREFIX = 'handle:'
const CHAT_GUID_PREFIX = 'chat_guid:'

function resolveHandle(target: string): string | null {
  const value = target.trim()
  if (!value) return null

  if (value.startsWith(HANDLE_PREFIX)) {
    return value.slice(HANDLE_PREFIX.length).trim() || null
  }

  if (value.startsWith(CHAT_GUID_PREFIX) || value.includes(';-;')) {
    return null
  }

  return value
}

function runAppleScriptMessage(
  payload: AppleScriptMessageRequest,
  timeoutMs: number,
  exec: ExecFileLike = execFile,
): Promise<void> {
  const args = [
    '-e', 'on run argv',
    '-e', 'set targetHandle to item 1 of argv',
    '-e', 'set msgText to item 2 of argv',
    '-e', 'set serviceName to item 3 of argv',
    '-e', 'tell application "Messages"',
    '-e', 'if serviceName is "SMS" then',
    '-e', 'set targetService to first service whose service type = SMS',
    '-e', 'else',
    '-e', 'set targetService to first service whose service type = iMessage',
    '-e', 'end if',
    '-e', 'set targetBuddy to buddy targetHandle of targetService',
    '-e', 'send msgText to targetBuddy',
    '-e', 'end tell',
    '-e', 'end run',
    payload.handle,
    payload.text,
    payload.service,
  ]

  return new Promise((resolve, reject) => {
    exec('osascript', args, { timeout: timeoutMs }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export async function dispatchAppleScriptNotification(
  event: NotificationEvent,
  ctx: NotificationContext,
  config: AppleScriptConfig,
  exec: ExecFileLike = execFile,
): Promise<{
  delivered: number
  attempted: number
  results: ImessageTargetResult[]
}> {
  const service = config.service || 'iMessage'
  const text = buildMessageText(event)
  const results: ImessageTargetResult[] = []

  // Keep sequential delivery for AppleScript/Messages stability.
  for (const target of config.targets) {
    const handle = resolveHandle(target)
    if (!handle) {
      results.push({
        target,
        success: false,
        error: 'unsupported target; use handle:<phone-or-email> for messages-applescript transport',
      })
      continue
    }

    try {
      await runAppleScriptMessage(
        {
          handle,
          text,
          service,
        },
        ctx.timeoutMs,
        exec,
      )
      results.push({
        target: handle,
        success: true,
      })
    } catch (error) {
      results.push({
        target: handle,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    delivered: results.filter((item) => item.success).length,
    attempted: results.length,
    results,
  }
}
