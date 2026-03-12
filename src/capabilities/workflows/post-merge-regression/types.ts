import type { WorkflowSession } from '../shared/runtime.js'

export interface PostMergeRegressionInput {
  commands?: string[]
}

export interface PostMergeRegressionPreparedInput extends PostMergeRegressionInput {
  preparedAt: Date
}

export interface PostMergeRegressionResult {
  status: 'completed' | 'failed'
  session?: WorkflowSession & {
    artifacts: WorkflowSession['artifacts'] & {
      reportPath: string
    }
  }
}

export interface PostMergeRegressionSummary {
  summary: string
  details?: PostMergeRegressionResult['session']
}
