import type { MagpieConfigV2 } from '../../platform/config/types.js'

export interface DiscussCapabilityInput {
  topic: string
  options?: DiscussOptions
}

export interface DiscussOptions extends Record<string, unknown> {
  config?: string
  rounds: string
  interactive?: boolean
  output?: string
  format: string
  converge?: boolean
  reviewers?: string
  all?: boolean
  devilAdvocate?: boolean
  list?: boolean
  resume?: string
}

export interface RunDiscussFlowInput {
  topic?: string
  options: DiscussOptions
  cwd?: string
}

export interface DiscussFlowResult {
  exitCode: number
  summary: string
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
