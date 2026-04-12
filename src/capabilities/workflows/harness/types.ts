import type { ComplexityTier } from '../../../config/types.js'
import type { WorkflowSession } from '../shared/runtime.js'
import type { ExecutionHost } from '../../../platform/integrations/operations/types.js'

export type HarnessStage =
  | 'queued'
  | 'developing'
  | 'reviewing'
  | 'completed'
  | 'failed'

export type HarnessPriority =
  | 'interactive'
  | 'high'
  | 'normal'
  | 'background'

export interface HarnessInput {
  goal: string
  prdPath: string
  maxCycles?: number
  reviewRounds?: number
  testCommand?: string
  models?: string[]
  complexity?: ComplexityTier
  host?: ExecutionHost
  priority?: HarnessPriority
}

export interface HarnessPreparedInput extends HarnessInput {
  preparedAt: Date
  maxCycles: number
  reviewRounds: number
  models: string[]
  modelsExplicit: boolean
}

export interface HarnessValidatorCheckArtifact {
  id: string
  label: string
  tool?: string
  model?: string
  agent?: string
  outputPath: string
}

export interface HarnessCycle {
  cycle: number
  reviewOutputPath: string
  validatorChecks: HarnessValidatorCheckArtifact[]
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
  status: 'completed' | 'failed' | 'blocked'
  session?: WorkflowSession & {
    currentStage?: HarnessStage
    artifacts: WorkflowSession['artifacts'] & {
      harnessConfigPath: string
      roundsPath: string
      providerSelectionPath: string
      routingDecisionPath: string
      eventsPath: string
      workspaceMode?: 'current' | 'worktree'
      workspacePath?: string
      worktreeBranch?: string
      executionHost?: ExecutionHost
      tmuxSession?: string
      tmuxWindow?: string
      tmuxPane?: string
      repoRootPath?: string
      knowledgeSchemaPath?: string
      knowledgeIndexPath?: string
      knowledgeLogPath?: string
      knowledgeStatePath?: string
      knowledgeSummaryDir?: string
      knowledgeCandidatesPath?: string
      loopSessionId?: string
      loopEventsPath?: string
    }
  }
}

export interface HarnessSummary {
  summary: string
  details?: HarnessResult['session']
}
