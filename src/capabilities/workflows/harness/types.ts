import type { ComplexityTier } from '../../../config/types.js'
import type { WorkflowSession } from '../shared/runtime.js'

export type HarnessStage =
  | 'queued'
  | 'developing'
  | 'reviewing'
  | 'completed'
  | 'failed'

export interface HarnessInput {
  goal: string
  prdPath: string
  maxCycles?: number
  reviewRounds?: number
  testCommand?: string
  models?: string[]
  complexity?: ComplexityTier
}

export interface HarnessPreparedInput extends HarnessInput {
  preparedAt: Date
  maxCycles: number
  reviewRounds: number
  models: string[]
  modelsExplicit: boolean
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
    currentStage?: HarnessStage
    artifacts: WorkflowSession['artifacts'] & {
      harnessConfigPath: string
      roundsPath: string
      providerSelectionPath: string
      routingDecisionPath: string
      eventsPath: string
      repoRootPath?: string
      knowledgeSchemaPath?: string
      knowledgeIndexPath?: string
      knowledgeLogPath?: string
      knowledgeSummaryDir?: string
      knowledgeCandidatesPath?: string
      loopSessionId?: string
    }
  }
}

export interface HarnessSummary {
  summary: string
  details?: HarnessResult['session']
}
