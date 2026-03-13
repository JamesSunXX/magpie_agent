import type { MagpieConfigV2 } from '../../platform/config/types.js'

export interface TrdCapabilityInput {
  prdPath: string
  options?: TrdOptions
}

export interface TrdOptions extends Record<string, unknown> {
  config?: string
  rounds?: string
  interactive?: boolean
  output?: string
  questionsOutput?: string
  converge?: boolean
  reviewers?: string
  all?: boolean
  list?: boolean
  resume?: string
  domainOverviewOnly?: boolean
  domainsFile?: string
  autoAcceptDomains?: boolean
}

export interface RunTrdFlowInput {
  prdPath?: string
  options: TrdOptions
  cwd?: string
}

export interface TrdFlowResult {
  exitCode: number
  summary: string
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
