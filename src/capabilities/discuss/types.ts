export interface DiscussCapabilityInput {
  topic: string
  options?: Record<string, unknown>
}

export interface DiscussPreparedInput extends DiscussCapabilityInput {
  preparedAt: Date
}

export interface DiscussExecutionResult {
  status: 'delegated' | 'completed'
  payload?: unknown
}

export interface DiscussSummaryOutput {
  summary: string
  details?: unknown
}
