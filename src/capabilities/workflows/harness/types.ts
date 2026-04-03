import type { WorkflowSession } from '../shared/runtime.js'

export interface HarnessInput {
  goal: string
  prdPath: string
  maxCycles?: number
  reviewRounds?: number
  testCommand?: string
  models?: string[]
}

export interface HarnessPreparedInput extends HarnessInput {
  preparedAt: Date
  maxCycles: number
  reviewRounds: number
  models: string[]
}

export interface HarnessCycle {
  cycle: number
  reviewOutputPath: string
  adjudicationOutputPath: string
  unitTestEvalPath: string
  issueCount: number
  blockingIssueCount: number
  testsPassed: boolean
  modelDecision: 'approved' | 'revise' | 'unknown'
  modelRationale: string
  issueFixSessionId?: string
}

export interface HarnessResult {
  status: 'completed' | 'failed'
  session?: WorkflowSession & {
    artifacts: WorkflowSession['artifacts'] & {
      harnessConfigPath: string
      roundsPath: string
      loopSessionId?: string
    }
  }
}

export interface HarnessSummary {
  summary: string
  details?: HarnessResult['session']
}

