import type { MagpieConfigV2 } from '../../platform/config/types.js'

export interface TrdCapabilityInput {
  prdPath: string
  options?: Record<string, unknown>
}

export interface TrdPreparedInput extends TrdCapabilityInput {
  preparedAt: Date
  config: MagpieConfigV2
}

export interface TrdExecutionResult {
  status: 'completed' | 'failed'
  payload?: {
    exitCode: number
    summary: string
  }
}

export interface TrdSummaryOutput {
  summary: string
  details?: unknown
}
