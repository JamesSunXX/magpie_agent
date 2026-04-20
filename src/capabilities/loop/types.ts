import type { ComplexityTier, LoopStageName } from '../../config/types.js'
import type { LoopSession } from '../../core/state/index.js'
import type { ExecutionHost } from '../../platform/integrations/operations/types.js'

export type LoopMode = 'run' | 'resume' | 'list'
export type LoopStageResultType = 'passed' | 'rework' | 'blocked'

export interface LoopStageHandoffCard {
  stage: LoopStageName
  goal: string
  work_done: string
  result: LoopStageResultType
  next_stage?: LoopStageName
  next_input_minimum: string[]
  open_risks: string[]
  evidence_refs: string[]
}

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
  host?: ExecutionHost
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
