import type { MagpieConfigV2 } from '../../platform/config/types.js'

export interface DiscussCapabilityInput {
  topic: string
  options?: Record<string, unknown>
}

export interface DiscussPreparedInput extends DiscussCapabilityInput {
  preparedAt: Date
  config: MagpieConfigV2
}

export interface DiscussExecutionResult {
  status: 'completed' | 'failed'
  payload?: {
    exitCode: number
    summary: string
  }
}

export interface DiscussSummaryOutput {
  summary: string
  details?: unknown
}
