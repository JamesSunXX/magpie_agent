import type { ComplexityTier } from '../../config/types.js'
import type { LoopSession } from '../../core/state/index.js'

export type LoopMode = 'run' | 'resume' | 'list'

export interface LoopCapabilityInput {
  mode: LoopMode
  goal?: string
  prdPath?: string
  sessionId?: string
  planningItemKey?: string
  planningProjectKey?: string
  waitHuman?: boolean
  dryRun?: boolean
  maxIterations?: number
  complexity?: ComplexityTier
}

export interface LoopPreparedInput extends LoopCapabilityInput {
  preparedAt: Date
}

export interface LoopExecutionResult {
  status: 'completed' | 'paused' | 'failed' | 'listed'
  summary: string
  session?: LoopSession
  sessions?: LoopSession[]
}

export interface LoopSummaryOutput {
  summary: string
  details?: LoopSession | LoopSession[]
}
