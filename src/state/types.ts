// src/state/types.ts
import type { ReviewFocus } from '../orchestrator/repo-orchestrator.js'
import type { ReviewIssue } from '../reporter/types.js'
import type { DomainBoundary } from '../trd/types.js'

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
  }
  rounds: TrdSessionRound[]
}

export interface ReviewSession {
  id: string
  startedAt: Date
  updatedAt: Date
  status: SessionStatus

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
