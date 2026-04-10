import type { ComplexityTier, MagpieConfigV2, RoutingDecision } from '../../platform/config/types.js'

export interface DiscussCapabilityInput {
  topic: string
  options?: DiscussOptions
  config?: string
  rounds?: string
  interactive?: boolean
  output?: string
  format?: string
  converge?: boolean
  reviewers?: string
  all?: boolean
  devilAdvocate?: boolean
  list?: boolean
  resume?: string
  export?: string
  conclusion?: boolean
  planReport?: boolean
  complexity?: ComplexityTier
}

export interface DiscussOptions extends Record<string, unknown> {
  config?: string
  rounds?: string
  interactive?: boolean
  output?: string
  format?: string
  converge?: boolean
  reviewers?: string
  all?: boolean
  devilAdvocate?: boolean
  list?: boolean
  resume?: string
  export?: string
  conclusion?: boolean
  planReport?: boolean
  complexity?: ComplexityTier
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

export interface DiscussPreparedInput extends Omit<DiscussCapabilityInput, 'config'> {
  options: DiscussOptions
  preparedAt: Date
  config: MagpieConfigV2
  routingDecision?: RoutingDecision
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
