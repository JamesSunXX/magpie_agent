export interface TrdCapabilityInput {
  prdPath: string
  options?: Record<string, unknown>
}

export interface TrdPreparedInput extends TrdCapabilityInput {
  preparedAt: Date
}

export interface TrdExecutionResult {
  status: 'delegated' | 'completed'
  payload?: unknown
}

export interface TrdSummaryOutput {
  summary: string
  details?: unknown
}
