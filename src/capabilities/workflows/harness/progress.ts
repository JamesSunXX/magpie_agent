import type { CapabilityContext } from '../../../core/capability/context.js'
import type { WorkflowEvent } from '../shared/runtime.js'
import type { HarnessResult } from './types.js'

export interface HarnessRuntimeEvent extends WorkflowEvent {
  sessionId: string
}

export interface HarnessProgressObserver {
  onSessionUpdate?: (session: NonNullable<HarnessResult['session']>) => void
  onEvent?: (event: HarnessRuntimeEvent) => void
}

export function getHarnessProgressObserver(ctx: CapabilityContext): HarnessProgressObserver | undefined {
  const candidate = ctx.metadata?.harnessProgress
  if (!candidate || typeof candidate !== 'object') {
    return undefined
  }

  const observer = candidate as HarnessProgressObserver
  const hasSessionUpdate = typeof observer.onSessionUpdate === 'function'
  const hasEvent = typeof observer.onEvent === 'function'
  return hasSessionUpdate || hasEvent ? observer : undefined
}
