import { readFile } from 'fs/promises'
import type { WorkflowSession } from '../../capabilities/workflows/shared/runtime.js'
import type { HarnessRuntimeEvent } from '../../capabilities/workflows/harness/progress.js'

export interface HarnessProgressReporterOptions {
  log?: (line: string) => void
  heartbeatMs?: number
  now?: () => Date
}

export interface FollowHarnessEventStreamOptions {
  sessionId: string
  initialSession: WorkflowSession
  log?: (line: string) => void
  loadSession: (sessionId: string) => Promise<WorkflowSession | null>
  pollIntervalMs?: number
  idleHeartbeatMs?: number
  once?: boolean
}

export function formatHarnessEventLine(event: Pick<HarnessRuntimeEvent, 'timestamp' | 'type' | 'stage' | 'cycle' | 'summary'>): string {
  const parts = [String(event.timestamp || '').trim(), event.type]
  if (event.stage) {
    parts.push(`stage=${event.stage}`)
  }
  if (Number.isFinite(event.cycle)) {
    parts.push(`cycle=${event.cycle}`)
  }
  if (event.summary) {
    parts.push(event.summary)
  }
  return parts.filter(Boolean).join(' ')
}

export function createHarnessProgressReporter(options: HarnessProgressReporterOptions = {}) {
  const log = options.log || console.log
  const heartbeatMs = options.heartbeatMs ?? 30_000
  const now = options.now || (() => new Date())

  let timer: NodeJS.Timeout | null = null
  let activeSessionId: string | null = null
  let currentStage: string | undefined
  let lastActivityAt = 0
  let announcedSession = false
  let eventsPath: string | undefined
  let loopSessionId: string | undefined

  const touch = () => {
    lastActivityAt = now().getTime()
  }

  return {
    start(): void {
      if (timer) return
      timer = setInterval(() => {
        if (!activeSessionId || lastActivityAt === 0) return
        if (now().getTime() - lastActivityAt < heartbeatMs) return
        const stagePart = currentStage ? ` stage=${currentStage}` : ''
        log(`Heartbeat: session ${activeSessionId}${stagePart} still running.`)
        touch()
      }, heartbeatMs)
    },
    stop(): void {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    hasAnnouncedSession(): boolean {
      return announcedSession
    },
    onSessionUpdate(session: WorkflowSession): void {
      activeSessionId = session.id
      currentStage = session.currentStage || currentStage
      touch()

      if (!announcedSession) {
        log(`Session: ${session.id}`)
        log(`Status: ${session.status}`)
        if (session.currentStage) {
          log(`Stage: ${session.currentStage}`)
        }
        announcedSession = true
      }

      const nextEventsPath = typeof session.artifacts.eventsPath === 'string'
        ? session.artifacts.eventsPath
        : undefined
      if (nextEventsPath && nextEventsPath !== eventsPath) {
        eventsPath = nextEventsPath
        log(`Events: ${nextEventsPath}`)
      }

      const nextLoopSessionId = typeof session.artifacts.loopSessionId === 'string'
        ? session.artifacts.loopSessionId
        : undefined
      if (nextLoopSessionId && nextLoopSessionId !== loopSessionId) {
        loopSessionId = nextLoopSessionId
        log(`Loop session: ${nextLoopSessionId}`)
      }
    },
    onEvent(event: HarnessRuntimeEvent): void {
      activeSessionId = event.sessionId
      currentStage = event.stage || currentStage
      touch()
      log(formatHarnessEventLine(event))
    },
  }
}

export async function followHarnessEventStream(options: FollowHarnessEventStreamOptions): Promise<void> {
  const log = options.log || console.log
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const idleHeartbeatMs = options.idleHeartbeatMs ?? 30_000

  let session = options.initialSession
  let eventsPath = session.artifacts.eventsPath
  if (!eventsPath) {
    log('No persisted event stream for this session.')
    return
  }

  log(`Watching ${options.sessionId} for new events. Press Ctrl+C to stop.`)

  let processedLines = 0
  let lastOutputAt = Date.now()

  while (true) {
    const content = await readFile(eventsPath, 'utf-8').catch(() => '')
    const { consumedLines, printed } = consumeHarnessEventLines(content, processedLines, log)
    if (printed > 0) {
      lastOutputAt = Date.now()
    }
    processedLines = consumedLines

    if (options.once) {
      return
    }

    if (session.status !== 'in_progress') {
      return
    }

    await wait(pollIntervalMs)
    const nextSession = await options.loadSession(options.sessionId)
    if (nextSession) {
      session = nextSession
      if (nextSession.artifacts.eventsPath) {
        eventsPath = nextSession.artifacts.eventsPath
      }
    }

    if (Date.now() - lastOutputAt >= idleHeartbeatMs) {
      const stagePart = session.currentStage ? ` stage=${session.currentStage}` : ''
      log(`Heartbeat: waiting for new events for ${options.sessionId}${stagePart}.`)
      lastOutputAt = Date.now()
    }
  }
}

function consumeHarnessEventLines(
  content: string,
  processedLines: number,
  log: (line: string) => void
): { consumedLines: number; printed: number } {
  const lines = content.split('\n')
  const hasTrailingNewline = content.endsWith('\n')
  let nextProcessed = processedLines
  let printed = 0

  for (let index = processedLines; index < lines.length; index++) {
    const line = lines[index]
    const isLast = index === lines.length - 1
    if (!line) {
      if (isLast) break
      nextProcessed++
      continue
    }

    try {
      const event = JSON.parse(line) as HarnessRuntimeEvent
      log(formatHarnessEventLine(event))
      nextProcessed++
      printed++
    } catch {
      if (isLast && !hasTrailingNewline) {
        break
      }
      nextProcessed++
    }
  }

  return {
    consumedLines: nextProcessed,
    printed,
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
