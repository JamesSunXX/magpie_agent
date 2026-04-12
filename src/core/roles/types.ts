export type RoleType =
  | 'architect'
  | 'developer'
  | 'tester'
  | 'reviewer'
  | 'arbitrator'

export interface RoleBinding {
  tool?: string
  model?: string
  agent?: string
}

export interface RoleInstance {
  roleId: string
  roleType: RoleType
  displayName: string
  binding: RoleBinding
  responsibility: string
  capabilities: string[]
}

export interface RoleArtifactRef {
  path: string
  label?: string
}

export type RoleMessageKind =
  | 'plan_request'
  | 'implementation_result'
  | 'test_result'
  | 'review_result'
  | 'arbitration_result'
  | 'next_round_input'
  | 'blocked_for_human'

export interface RoleMessage {
  messageId: string
  sessionId: string
  roundId: string
  fromRole: string
  toRole: string
  kind: RoleMessageKind
  summary: string
  artifactRefs: RoleArtifactRef[]
  createdAt: Date
}

export type RoleFinalAction = 'approved' | 'revise' | 'requeue_or_blocked'

export interface RoleStepResult {
  summary: string
  artifactRefs: RoleArtifactRef[]
}

export interface RoleTestResult extends RoleStepResult {
  status: 'passed' | 'failed' | 'blocked'
}

export interface RoleReviewResult extends RoleStepResult {
  reviewerRoleId: string
  passed: boolean
}

export interface RoleArbitrationResult extends RoleStepResult {
  action: RoleFinalAction
}

export interface RoleOpenIssue {
  id: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  sourceRole: string
  category: string
  evidencePath: string
  requiredAction: string
  status: 'open' | 'resolved' | 'blocked'
}

export interface RoleRoundResult {
  roundId: string
  roles: RoleInstance[]
  developmentResult?: RoleStepResult
  testResult?: RoleTestResult
  reviewResults: RoleReviewResult[]
  arbitrationResult?: RoleArbitrationResult
  openIssues: RoleOpenIssue[]
  nextRoundBrief: string
  finalAction: RoleFinalAction
}

export type RoleReliablePoint =
  | 'development_result_recorded'
  | 'test_result_recorded'
  | 'review_results_recorded'
  | 'arbitration_recorded'
  | 'next_round_brief_recorded'
  | 'completed'
