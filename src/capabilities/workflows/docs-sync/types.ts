import type { WorkflowSession } from '../shared/runtime.js'

export interface DocsSyncInput {
  apply?: boolean
}

export interface DocsSyncPreparedInput extends DocsSyncInput {
  preparedAt: Date
}

export interface DocsSyncResult {
  status: 'completed' | 'failed'
  session?: WorkflowSession & {
    artifacts: WorkflowSession['artifacts'] & {
      reportPath: string
    }
  }
}

export interface DocsSyncSummary {
  summary: string
  details?: DocsSyncResult['session']
}
