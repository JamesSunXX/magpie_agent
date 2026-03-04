export interface ReviewCapabilityInput {
  target?: string
  options?: Record<string, unknown>
}

export interface ReviewPreparedInput extends ReviewCapabilityInput {
  preparedAt: Date
}

export interface ReviewExecutionResult {
  status: 'delegated' | 'completed'
  payload?: unknown
}

export interface ReviewSummaryOutput {
  summary: string
  details?: unknown
}
