export interface ReviewCapabilityInput {
  target?: string
  options?: Record<string, unknown>
}

export interface ReviewPreparedInput extends ReviewCapabilityInput {
  preparedAt: Date
}

export interface ReviewExecutionResult {
  status: 'completed' | 'failed'
  payload?: {
    exitCode: number
    stdout: string
    stderr: string
  }
}

export interface ReviewSummaryOutput {
  summary: string
  details?: unknown
}
