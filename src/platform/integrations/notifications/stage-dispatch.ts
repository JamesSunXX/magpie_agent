import { readFile } from 'fs/promises'
import type { MagpieConfig } from '../../../config/types.js'
import type { DispatchResult, NotificationSeverity } from './types.js'
import type { NotificationRouter } from './router.js'
import { summarizeStageNotification } from './stage-ai.js'
import type { StageNotificationEventType, StageNotificationSummaryInput } from './stage-summary.js'

interface DispatchStageNotificationArgs {
  config: MagpieConfig
  cwd: string
  eventsPath: string
  router: NotificationRouter
  input: Omit<StageNotificationSummaryInput, 'occurrence'>
  severity?: NotificationSeverity
  metadata?: Record<string, unknown>
  actionUrl?: string
  dedupeKey?: string
}

export function shouldSendStageNotifications(
  config: MagpieConfig,
  capability: 'loop' | 'harness'
): boolean {
  const notifications = config.integrations.notifications
  const stageAi = notifications?.stage_ai
  if (notifications?.enabled !== true || stageAi?.enabled !== true) {
    return false
  }

  if (capability === 'loop') {
    return stageAi.include_loop !== false
  }

  return stageAi.include_harness !== false
}

export async function countStageNotificationOccurrence(
  eventsPath: string,
  eventType: StageNotificationEventType,
  stage: string
): Promise<number> {
  try {
    const content = await readFile(eventsPath, 'utf-8')
    return content
      .split('\n')
      .filter(Boolean)
      .reduce((count, line) => {
        try {
          const parsed = JSON.parse(line) as { event?: string; type?: string; stage?: string }
          return (parsed.stage === stage && (parsed.event === eventType || parsed.type === eventType))
            ? count + 1
            : count
        } catch {
          return count
        }
      }, 0) + 1
  } catch {
    return 1
  }
}

export async function dispatchStageNotification(
  args: DispatchStageNotificationArgs
): Promise<{ occurrence: number; dispatch?: DispatchResult }> {
  const occurrence = await countStageNotificationOccurrence(
    args.eventsPath,
    args.input.eventType,
    args.input.stage
  )
  if (!shouldSendStageNotifications(args.config, args.input.capability)) {
    return { occurrence }
  }

  const message = await summarizeStageNotification({
    config: args.config,
    cwd: args.cwd,
    input: {
      ...args.input,
      occurrence,
    },
  })

  const dispatch = await args.router.dispatch({
    type: args.input.eventType,
    sessionId: args.input.sessionId,
    title: message.title,
    message: message.body,
    severity: args.severity || 'info',
    actionUrl: args.actionUrl,
    metadata: args.metadata,
    dedupeKey: args.dedupeKey,
  })

  return { occurrence, dispatch }
}
