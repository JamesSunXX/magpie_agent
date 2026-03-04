export interface CommandResult<T = unknown> {
  success: boolean
  data?: T
  message?: string
}

export interface EvaluationScore {
  name: string
  score: number
  reason?: string
}
