import type { MagpieConfigV2 } from '../../platform/config/types.js'

export interface ReviewCapabilityInput {
  target?: string
  options?: ReviewCommandOptions
}

export interface ReviewCommandOptions extends Record<string, unknown> {
  config?: string
  rounds: string
  interactive?: boolean
  output?: string
  format: string
  converge?: boolean
  local?: boolean
  branch?: string | boolean
  commit?: string
  files?: string[]
  gitRemote?: string
  reviewers?: string
  all?: boolean
  repo?: boolean
  path?: string
  ignore?: string[]
  quick?: boolean
  deep?: boolean
  planOnly?: boolean
  reanalyze?: boolean
  listSessions?: boolean
  session?: string
  export?: string
  skipContext?: boolean
  post?: boolean
}

export interface RunReviewFlowInput {
  target?: string
  options: ReviewCommandOptions
  cwd?: string
}

export interface ReviewFlowResult {
  exitCode: number
  summary: string
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
