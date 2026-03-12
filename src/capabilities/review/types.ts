import type { MagpieConfigV2 } from '../../platform/config/types.js'

export interface ReviewCapabilityInput {
  target?: string
  options?: Record<string, unknown>
}

export interface ReviewPreparedInput extends ReviewCapabilityInput {
  preparedAt: Date
  config: MagpieConfigV2
}

export interface ReviewExecutionResult {
  status: 'completed' | 'failed'
  payload?: {
    exitCode: number
    summary: string
  }
}

export interface ReviewSummaryOutput {
  summary: string
  details?: unknown
}
