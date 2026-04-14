// src/state/types.ts
import type { ReviewFocus } from '../orchestrator/repo-orchestrator.js'
import type { ReviewIssue } from '../reporter/types.js'
import type { DomainBoundary } from '../trd/types.js'
import type { LoopStageName, ComplexityTier } from '../config/types.js'
import type { ExecutionHost } from '../platform/integrations/operations/types.js'
import type { RoleInstance, RoleReliablePoint } from '../core/roles/types.js'

export type SessionStatus = 'planning' | 'in_progress' | 'completed' | 'paused'

export interface Feature {
  id: string
  name: string
  description: string
  entryPoints: string[]
  files: Array<{ path: string; relativePath: string; language: string; lines: number; size: number }>
  estimatedTokens: number
}

export interface FeatureAnalysis {
  features: Feature[]
  uncategorized: Array<{ path: string; relativePath: string; language: string; lines: number; size: number }>
  analyzedAt: Date
  codebaseHash: string
}

export interface FeatureReviewResult {
  featureId: string
  issues: ReviewIssue[]
  summary: string
  reviewedAt: Date
}

export type ReviewRoundOrigin = 'live' | 'recovered_from_session'

export interface ReviewRoundReviewerOutput {
  reviewerId: string
  provider: string
  startedAt: Date
  completedAt: Date
  output: string
  issuesParsed: number
}

export interface ReviewRoundCheckpoint {
  schemaVersion: 1
  sessionId: string
  roundNumber: number
  featureId: string
  featureName: string
  status: 'completed'
  origin: ReviewRoundOrigin
  focusAreas: ReviewFocus[]
  filePaths: string[]
  reviewerOutputs: ReviewRoundReviewerOutput[]
  result: FeatureReviewResult
  completedAt: Date
}

// Discuss session types
export interface DiscussRound {
  roundNumber: number
  topic: string
  analysis: string
  messages: Array<{ reviewerId: string; content: string; timestamp: Date }>
  summaries: Array<{ reviewerId: string; summary: string }>
  conclusion: string
  convergedAtRound?: number
  tokenUsage: Array<{ reviewerId: string; inputTokens: number; outputTokens: number; estimatedCost?: number }>
  timestamp: Date
}

export interface DiscussSession {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
  status: 'active' | 'completed'
  reviewerIds: string[]
  rounds: DiscussRound[]
}

export type TrdSessionStage =
  | 'overview_drafted'
  | 'boundaries_confirmed'
  | 'domain_trd_generated'
  | 'integration_generated'
  | 'completed'

export interface TrdSessionRound {
  roundNumber: number
  prompt: string
  summary: string
  timestamp: Date
}

export interface TrdSession {
  id: string
  title: string
  prdPath: string
  createdAt: Date
  updatedAt: Date
  stage: TrdSessionStage
  reviewerIds: string[]
  domains: DomainBoundary[]
  artifacts: {
    domainOverviewPath: string
    draftDomainsPath: string
    confirmedDomainsPath: string
    trdPath: string
    openQuestionsPath: string
    partialDir: string
    constraintsPath?: string
  }
  rounds: TrdSessionRound[]
}

export interface ReviewSession {
  id: string
  startedAt: Date
  updatedAt: Date
  status: SessionStatus
  checkpointing?: {
    stateDir: string
    totalRounds: number
    lastCompletedRound: number
    lastVerifiedRound: number
    finalSummaryVerifiedAt?: Date
  }

  config: {
    focusAreas: ReviewFocus[]
    selectedFeatures: string[]
  }

  plan: {
    features: Feature[]
    totalFeatures: number
    selectedCount: number
  }

  progress: {
    currentFeatureIndex: number
    completedFeatures: string[]
    featureResults: Record<string, FeatureReviewResult>
  }
}

export interface LoopTask {
  id: string
  stage: LoopStageName
  title: string
  description: string
  dependencies: string[]
  successCriteria: string[]
}

export interface LoopStageResult {
  stage: LoopStageName
  success: boolean
  confidence: number
  summary: string
  risks: string[]
  retryCount: number
  artifacts: string[]
  timestamp: Date
}

export interface HumanConfirmationItem {
  id: string
  sessionId: string
  stage: LoopStageName
  status: 'pending' | 'approved' | 'rejected' | 'revise'
  decision: 'pending' | 'approved' | 'rejected' | 'revise'
  rationale?: string
  reason: string
  artifacts: string[]
  nextAction: string
  createdAt: Date
  updatedAt: Date
}

export type LoopReliablePoint =
  | 'constraints_validated'
  | 'red_test_confirmed'
  | 'implementation_generated'
  | 'test_result_recorded'
  | RoleReliablePoint
  | 'completed'

export interface LoopSession {
  id: string
  title: string
  goal: string
  prdPath: string
  createdAt: Date
  updatedAt: Date
  status: 'running' | 'paused_for_human' | 'completed' | 'failed'
  currentStageIndex: number
  stages: LoopStageName[]
  plan: LoopTask[]
  stageResults: LoopStageResult[]
  humanConfirmations: HumanConfirmationItem[]
  roles?: RoleInstance[]
  constraintsValidated?: boolean
  constraintCheckStatus?: 'pass' | 'needs_revision' | 'blocked'
  tddEligible?: boolean
  redTestConfirmed?: boolean
  currentLoopState?: 'revising' | 'retrying_execution' | 'blocked_for_human' | 'completed'
  repairAttemptCount?: number
  executionRetryCount?: number
  lastReliablePoint?: LoopReliablePoint
  lastFailureReason?: string
  branchName?: string
  routingTier?: ComplexityTier
  selectedComplexity?: ComplexityTier
  artifacts: {
    sessionDir: string
    eventsPath: string
    planPath: string
    humanConfirmationPath: string
    routingDecisionPath?: string
    repoRootPath?: string
    workspaceMode?: 'current' | 'worktree'
    workspacePath?: string
    worktreeBranch?: string
    executionHost?: ExecutionHost
    tmuxSession?: string
    tmuxWindow?: string
    tmuxPane?: string
    roleRosterPath?: string
    roleMessagesPath?: string
    roleRoundsDir?: string
    constraintsSnapshotPath?: string
    tddTargetPath?: string
    redTestResultPath?: string
    greenTestResultPath?: string
    repairOpenIssuesPath?: string
    repairEvidencePath?: string
    nextRoundInputPath?: string
    mrResultPath?: string
    knowledgeSchemaPath?: string
    knowledgeIndexPath?: string
    knowledgeLogPath?: string
    knowledgeStatePath?: string
    knowledgeSummaryDir?: string
    knowledgeCandidatesPath?: string
    documentPlanPath?: string
    providerSessionsPath?: string
  }
}
