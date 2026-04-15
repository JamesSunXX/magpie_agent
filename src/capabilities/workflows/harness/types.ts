import type { ComplexityTier } from '../../../config/types.js'
import type { WorkflowSession } from '../shared/runtime.js'
import type { ExecutionHost } from '../../../platform/integrations/operations/types.js'
import type { RoleFinalAction } from '../../../core/roles/index.js'
import type { MagpieConfigV2 } from '../../../platform/config/types.js'

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
  modelsExplicit?: boolean
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
  config?: MagpieConfigV2
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
  roleRoundPath?: string
  roleOpenIssuesPath?: string
  roleNextRoundPath?: string
  finalAction?: RoleFinalAction
  nextRoundBrief?: string
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
      roleRosterPath?: string
      roleMessagesPath?: string
      roleRoundsDir?: string
      workspaceMode?: 'current' | 'worktree'
      workspacePath?: string
      worktreeBranch?: string
      executionHost?: ExecutionHost
      tmuxSession?: string
      tmuxWindow?: string
      tmuxPane?: string
      failureLogDir?: string
      failureIndexPath?: string
      lastFailurePath?: string
      repoRootPath?: string
      knowledgeSchemaPath?: string
      knowledgeIndexPath?: string
      knowledgeLogPath?: string
      knowledgeStatePath?: string
      knowledgeSummaryDir?: string
      knowledgeCandidatesPath?: string
      documentPlanPath?: string
      loopSessionId?: string
      loopEventsPath?: string
    }
  }
}

export interface HarnessSummary {
  summary: string
  details?: HarnessResult['session']
}
