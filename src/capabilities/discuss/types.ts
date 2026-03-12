export interface DiscussCapabilityInput {
  topic: string
  options?: Record<string, unknown>
}

export interface DiscussPreparedInput extends DiscussCapabilityInput {
  preparedAt: Date
}

export interface DiscussExecutionResult {
  status: 'completed' | 'failed'
  payload?: {
    exitCode: number
    stdout: string
    stderr: string
  }
}

export interface DiscussSummaryOutput {
  summary: string
  details?: unknown
}
