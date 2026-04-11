import type { CapabilityContext } from '../../core/capability/context.js'
import type { LoopSession } from '../../core/state/index.js'

export interface LoopRuntimeEvent {
  sessionId: string
  ts: string
  event: string
  stage?: string
  summary?: string
  reason?: string
  provider?: string
  progressType?: string
  cycle?: number
}

export interface LoopProgressObserver {
  onSessionUpdate?: (session: LoopSession) => void
  onEvent?: (event: LoopRuntimeEvent) => void
}

export function getLoopProgressObserver(ctx: CapabilityContext): LoopProgressObserver | undefined {
  const candidate = ctx.metadata?.loopProgress
  if (!candidate || typeof candidate !== 'object') {
    return undefined
  }

  const observer = candidate as LoopProgressObserver
  const hasSessionUpdate = typeof observer.onSessionUpdate === 'function'
  const hasEvent = typeof observer.onEvent === 'function'
  return hasSessionUpdate || hasEvent ? observer : undefined
}
