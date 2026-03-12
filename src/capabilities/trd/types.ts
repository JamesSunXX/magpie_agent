export interface TrdCapabilityInput {
  prdPath: string
  options?: Record<string, unknown>
}

export interface TrdPreparedInput extends TrdCapabilityInput {
  preparedAt: Date
}

export interface TrdExecutionResult {
  status: 'completed' | 'failed'
  payload?: {
    exitCode: number
    stdout: string
    stderr: string
  }
}

export interface TrdSummaryOutput {
  summary: string
  details?: unknown
}
