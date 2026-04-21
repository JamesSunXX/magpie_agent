export type TaskId = 'change-review' | 'pr-review' | 'trd-generation' | 'loop-run' | 'issue-fix'

export type ReviewMode = 'local' | 'branch' | 'files' | 'repo'

export type FieldType = 'text' | 'select' | 'toggle'

export type TaskFieldId =
  | 'mode'
  | 'branchBase'
  | 'files'
  | 'path'
  | 'ignore'
  | 'reviewers'
  | 'all'
  | 'quick'
  | 'deep'
  | 'format'
  | 'output'
  | 'pr'
  | 'prdPath'
  | 'questionsOutput'
  | 'autoAcceptDomains'
  | 'domainOverviewOnly'
  | 'domainsFile'
  | 'goal'
  | 'planningItem'
  | 'waitHuman'
  | 'dryRun'
  | 'maxIterations'
  | 'issue'
  | 'apply'
  | 'verifyCommand'

export type TaskValue = string | boolean | undefined

export type TaskValues = Partial<Record<TaskFieldId, TaskValue>>

export interface FieldOption {
  label: string
  value: string
}

export interface TaskField<TId extends TaskFieldId = TaskFieldId> {
  id: TId
  label: string
  type: FieldType
  description?: string
  required?: boolean
  advanced?: boolean
  placeholder?: string
  options?: FieldOption[]
  visibleWhen?: (values: TaskValues) => boolean
}

export interface BuiltCommand {
  argv: string[]
  display: string
  summary: string
}

export interface TaskDefinition {
  id: TaskId
  title: string
  description: string
  fields: TaskField[]
  defaults: TaskValues
  buildCommand: (values: TaskValues) => BuiltCommand
}

export interface TaskDraft {
  taskId: TaskId
  values: TaskValues
  showAdvanced: boolean
}

export interface SessionCard {
  id: string
  capability: 'review' | 'discuss' | 'trd' | 'loop' | 'issue-fix' | 'docs-sync' | 'post-merge-regression' | 'harness'
  title: string
  detail?: string
  graphPath?: string
  selectedDetail?: {
    participants?: string
    reviewerSummaries: string[]
    arbitration?: string
    nextStep?: string
    graphSummary?: string
    attention?: string[]
    readyNow?: string
    recommendedAction?: string
    recommendedCommand?: string
  }
  status: string
  updatedAt: Date
  resumeCommand?: string[]
  artifactPaths: string[]
}

export interface GraphWorkbenchNodeSummary {
  id: string
  title: string
  type: string
  state: string
  statusReason?: string
  approvalPending: boolean
}

export interface GraphWorkbenchLinkedExecution {
  capability: 'loop' | 'harness'
  sessionId: string
  status: string
  summary: string
  nextStep?: string
  command: string[]
}

export interface GraphWorkbenchNodeDetail {
  id: string
  title: string
  type: string
  state: string
  stageDocumentPath?: string
  statusReason?: string
  dependencies: string[]
  approvalPending: boolean
  latestSummary?: string
  nextStep?: string
  reviewerSummaries: string[]
  arbitrationSummary?: string
  unresolvedIssues: string[]
  linkedExecution?: GraphWorkbenchLinkedExecution
}

export interface GraphWorkbenchAction {
  id: string
  kind: 'approve' | 'reject' | 'jump'
  label: string
  description: string
  command: string[]
  requiresConfirmation: boolean
}

export interface GraphWorkbenchEventItem {
  id: string
  timestamp: string
  summary: string
}

export interface GraphWorkbenchData {
  graph: {
    sessionId: string
    graphId: string
    title: string
    status: string
    rollup: {
      total: number
      ready: number
      running: number
      waitingApproval: number
      waitingRetry: number
      blocked: number
      completed: number
      failed: number
    }
  }
  nodes: GraphWorkbenchNodeSummary[]
  selectedNodeId?: string
  selectedNode?: GraphWorkbenchNodeDetail
  actions: GraphWorkbenchAction[]
  attention: string[]
  events: GraphWorkbenchEventItem[]
  observability?: {
    sessionId: string
    status: string
    stage?: string
    executionIsolationMode?: string
    tools: string[]
    retryCount: number
    nextRetryAt?: string
    lastError?: string
    recentFailure?: {
      stage?: string
      reason: string
      timestamp?: string
      recordPath?: string
    }
  }
  error?: string
}

export interface GraphWorkbenchState {
  sessionId: string
  selectedNodeId?: string
  focusedPanel: 'overview' | 'actions' | 'events'
  selectedActionIndex: number
  data?: GraphWorkbenchData
  message?: string
  pendingConfirmationActionId?: string
}

export interface DashboardSessions {
  continue: SessionCard[]
  recent: SessionCard[]
}

export interface HealthSignal {
  key: 'config' | 'git' | 'workspace' | 'providers'
  label: string
  status: 'ok' | 'warning' | 'unknown'
  detail: string
}

export interface EnvironmentHealth {
  items: HealthSignal[]
}

export interface RunState {
  command: BuiltCommand
  display: string
  logs: string[]
  status: 'running' | 'completed' | 'failed'
  exitCode?: number
  sessionId?: string
  artifacts: Record<string, string>
  statusText?: string
}

export interface AppState {
  route: 'dashboard' | 'wizard' | 'preview' | 'run' | 'graph-workbench'
  selectedIndex: number
  activeTaskId?: TaskId
  draft?: TaskDraft
  command?: BuiltCommand
  run?: RunState
  graphWorkbench?: GraphWorkbenchState
  sessions: DashboardSessions
  health?: EnvironmentHealth
}

export const CONTINUABLE_STATUSES = ['planning', 'paused', 'in_progress', 'active', 'running', 'paused_for_human', 'blocked'] as const

export type AppAction =
  | { type: 'task:selected'; taskId: TaskId }
  | { type: 'graph:opened'; sessionId: string; selectedNodeId?: string }
  | { type: 'preview:opened'; command: BuiltCommand }
  | { type: 'wizard:submitted'; command: BuiltCommand }
  | { type: 'execution:started' }
  | { type: 'execution:updated'; run: RunState }
  | { type: 'run:closed' }
  | { type: 'dashboard:data-loaded'; sessions: DashboardSessions; health: EnvironmentHealth }
