export type FailureCategory =
  | 'transient'
  | 'environment'
  | 'quality'
  | 'prompt_or_parse'
  | 'workflow_defect'
  | 'unknown'

export type RecoveryAction =
  | 'retry_same_step'
  | 'retry_with_backoff'
  | 'run_diagnostics'
  | 'degrade_path'
  | 'spawn_self_repair_candidate'
  | 'block_for_human'

export interface FailureFactInput {
  sessionId?: string
  capability: 'loop' | 'harness' | 'harness-server'
  stage: string
  reason: string
  rawError?: string
  retryableHint?: boolean
  lastReliablePoint?: string
  evidencePaths: string[]
  metadata?: Record<string, unknown>
}

export interface FailureRecord {
  id: string
  sessionId?: string
  capability: FailureFactInput['capability']
  stage: string
  timestamp: string
  signature: string
  category: FailureCategory
  reason: string
  retryable: boolean
  selfHealCandidate: boolean
  lastReliablePoint?: string
  evidencePaths: string[]
  metadata: Record<string, unknown>
  recoveryAction?: RecoveryAction
}

export interface FailureIndexEntry {
  signature: string
  category: FailureCategory
  categories: FailureCategory[]
  count: number
  firstSeenAt: string
  lastSeenAt: string
  lastSessionId?: string
  recentSessionIds: string[]
  capabilities: Partial<Record<FailureFactInput['capability'], number>>
  latestReason: string
  latestEvidencePaths: string[]
  recentEvidencePaths: string[]
  selfHealCandidateCount: number
  candidateForSelfRepair: boolean
  lastRecoveryAction?: RecoveryAction
}

export interface FailureIndex {
  version: 1
  updatedAt: string
  entries: FailureIndexEntry[]
}

export interface RecoveryDecision {
  action: RecoveryAction
  retryable: boolean
  candidateForSelfRepair: boolean
  reason: string
  diagnosticChecks: string[]
}
