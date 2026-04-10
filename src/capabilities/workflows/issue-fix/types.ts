import type { ComplexityTier } from '../../../config/types.js'
import type { WorkflowSession } from '../shared/runtime.js'

export interface IssueFixInput {
  issue: string
  apply?: boolean
  verifyCommand?: string
  planningItemKey?: string
  planningProjectKey?: string
  complexity?: ComplexityTier
}

export interface IssueFixPreparedInput extends IssueFixInput {
  preparedAt: Date
}

export interface IssueFixResult {
  status: 'completed' | 'failed'
  session?: WorkflowSession & {
    artifacts: WorkflowSession['artifacts'] & {
      planPath: string
      executionPath: string
      verificationPath?: string
      routingDecisionPath?: string
    }
  }
}

export interface IssueFixSummary {
  summary: string
  details?: IssueFixResult['session']
}
