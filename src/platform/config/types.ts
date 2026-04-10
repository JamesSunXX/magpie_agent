export interface ProviderConfig {
  api_key: string
  base_url?: string
}

export interface ReviewerConfig {
  tool?: string
  model?: string
  prompt: string
  agent?: string
}

export type ComplexityTier = 'simple' | 'standard' | 'complex'

export interface ModelRouteBinding {
  tool?: string
  model?: string
  agent?: string
}

export interface RoutingSignalBreakdown {
  textLengthScore: number
  taskCountScore: number
  dependencyScore: number
  stageScore: number
  keywordScore: number
  subsystemScore: number
  rolloutScore: number
}

export interface StageRoutePolicy {
  planning?: Partial<Record<ComplexityTier, ModelRouteBinding>>
  execution?: Partial<Record<ComplexityTier, ModelRouteBinding>>
}

export interface ReviewerPoolPolicy extends Partial<Record<ComplexityTier, string[]>> {}

export interface RoutingFallbackChain {
  planning?: Partial<Record<ComplexityTier, ModelRouteBinding[]>>
  execution?: Partial<Record<ComplexityTier, ModelRouteBinding[]>>
}

export interface RoutingThresholds {
  simple_max?: number
  standard_max?: number
  complex_min?: number
}

export interface RoutingConfig {
  enabled?: boolean
  strategy?: 'rules_first'
  default_tier?: ComplexityTier
  allow_runtime_escalation?: boolean
  fallback_chain?: RoutingFallbackChain
  thresholds?: RoutingThresholds
  stage_policies?: StageRoutePolicy
  reviewer_pools?: ReviewerPoolPolicy
  high_risk_keywords?: string[]
}

export interface RoutingDecision {
  schemaVersion: number
  tier: ComplexityTier
  score: number
  reasons: string[]
  signals: RoutingSignalBreakdown
  planning: ModelRouteBinding
  execution: ModelRouteBinding
  reviewerIds: string[]
  escalationTrail: string[]
  fallbackTrail: string[]
}

export interface DefaultsConfig {
  max_rounds: number
  output_format: 'markdown' | 'json'
  check_convergence: boolean
  language?: string
  diff_exclude?: string[]
}

export interface ContextGathererConfigOptions {
  enabled: boolean
  agent?: string
  callChain?: {
    maxDepth?: number
    maxFilesToAnalyze?: number
  }
  history?: {
    maxDays?: number
    maxPRs?: number
  }
  docs?: {
    patterns?: string[]
    maxSize?: number
  }
  model?: string
}

export interface TrdConfig {
  default_reviewers?: string[]
  max_rounds?: number
  language?: string
  include_project_context?: boolean
  include_traceability?: boolean
  output?: {
    same_dir_as_prd?: boolean
    trd_suffix?: string
    open_questions_suffix?: string
  }
  preprocess?: {
    chunk_chars?: number
    max_chars?: number
  }
  domain?: {
    require_human_confirmation?: boolean
    overview_required?: boolean
  }
}

export type LoopStageName =
  | 'prd_review'
  | 'domain_partition'
  | 'trd_generation'
  | 'code_development'
  | 'unit_mock_test'
  | 'integration_test'

export interface LoopCommandsConfig {
  unit_test?: string
  mock_test?: string
  integration_test?: string
}

export interface LoopHumanConfirmationConfig {
  file?: string
  gate_policy?: 'exception_or_low_confidence' | 'always' | 'manual_only'
  poll_interval_sec?: number
}

export interface LoopConfig {
  enabled?: boolean
  planner_tool?: string
  planner_model?: string
  planner_agent?: string
  executor_tool?: string
  executor_model?: string
  executor_agent?: string
  stages?: LoopStageName[]
  confidence_threshold?: number
  retries_per_stage?: number
  max_iterations?: number
  auto_commit?: boolean
  reuse_current_branch?: boolean
  auto_branch_prefix?: string
  human_confirmation?: LoopHumanConfirmationConfig
  commands?: LoopCommandsConfig
}

export type NotificationEventType =
  | 'human_confirmation_required'
  | 'loop_paused'
  | 'loop_resumed'
  | 'loop_failed'
  | 'loop_completed'

export interface MacosNotificationProviderConfig {
  type: 'macos'
  enabled?: boolean
  click_target?: 'vscode' | 'file'
  terminal_notifier_bin?: string
  fallback_osascript?: boolean
}

export interface FeishuWebhookNotificationProviderConfig {
  type: 'feishu-webhook'
  enabled?: boolean
  webhook_url: string
  secret?: string
  msg_type?: 'text' | 'post'
}

export interface ImessageBlueBubblesNotificationProviderConfig {
  type: 'imessage'
  enabled?: boolean
  transport?: 'bluebubbles'
  server_url: string
  password: string
  targets: string[]
  method?: 'private-api' | 'apple-script'
}

export interface ImessageAppleScriptNotificationProviderConfig {
  type: 'imessage'
  enabled?: boolean
  transport: 'messages-applescript'
  targets: string[]
  service?: 'iMessage' | 'SMS'
}

export type ImessageNotificationProviderConfig =
  | ImessageBlueBubblesNotificationProviderConfig
  | ImessageAppleScriptNotificationProviderConfig

export type NotificationProviderConfig =
  | MacosNotificationProviderConfig
  | FeishuWebhookNotificationProviderConfig
  | ImessageNotificationProviderConfig

export interface NotificationsIntegrationConfig {
  enabled?: boolean
  default_timeout_ms?: number
  routes?: Partial<Record<NotificationEventType, string[]>>
  providers?: Record<string, NotificationProviderConfig>
}

export interface FeishuProjectPlanningProviderConfig {
  type: 'feishu-project'
  enabled?: boolean
  base_url: string
  project_key?: string
  app_id: string
  app_secret: string
}

export interface JiraPlanningProviderConfig {
  type: 'jira'
  enabled?: boolean
  base_url: string
  project_key?: string
  auth_mode?: 'cloud' | 'basic'
  email?: string
  api_token?: string
  username?: string
  password?: string
}

export type PlanningProviderConfig =
  | FeishuProjectPlanningProviderConfig
  | JiraPlanningProviderConfig

export interface PlanningIntegrationConfig {
  enabled?: boolean
  default_provider?: string
  providers?: Record<string, PlanningProviderConfig>
}

export interface LocalCommandsOperationsProviderConfig {
  type: 'local-commands'
  enabled?: boolean
  timeout_ms?: number
  max_buffer_bytes?: number
}

export type OperationsProviderConfig = LocalCommandsOperationsProviderConfig

export interface OperationsIntegrationConfig {
  enabled?: boolean
  default_provider?: string
  providers?: Record<string, OperationsProviderConfig>
}

export interface IntegrationsConfig {
  notifications?: NotificationsIntegrationConfig
  planning?: PlanningIntegrationConfig
  operations?: OperationsIntegrationConfig
}

export interface ReviewConfig {
  enabled?: boolean
  max_rounds?: number
  check_convergence?: boolean
  reviewers?: string[]
  skip_context?: boolean
}

export interface DiscussConfig {
  enabled?: boolean
  max_rounds?: number
  check_convergence?: boolean
  reviewers?: string[]
}

export interface UnitTestEvalConfig {
  enabled?: boolean
  provider?: string
  provider_agent?: string
  max_files?: number
  min_coverage?: number
  output_format?: 'markdown' | 'json'
}

export interface IssueFixConfig {
  enabled?: boolean
  planner_tool?: string
  planner_model?: string
  planner_agent?: string
  executor_tool?: string
  executor_model?: string
  executor_agent?: string
  verify_command?: string
  auto_commit?: boolean
}

export interface DocsSyncConfig {
  enabled?: boolean
  reviewer_model?: string
  reviewer_agent?: string
  docs_patterns?: string[]
}

export interface PostMergeRegressionConfig {
  enabled?: boolean
  evaluator_model?: string
  evaluator_agent?: string
  commands?: string[]
}

export interface QualityConfig {
  unitTestEval?: UnitTestEvalConfig
}

export interface CapabilitiesConfig {
  review?: ReviewConfig
  discuss?: DiscussConfig
  trd?: TrdConfig
  routing?: RoutingConfig
  issue_fix?: IssueFixConfig
  docs_sync?: DocsSyncConfig
  post_merge_regression?: PostMergeRegressionConfig
  quality?: QualityConfig
  loop?: LoopConfig
}

export interface MagpieConfigV2 {
  providers: {
    anthropic?: ProviderConfig
    openai?: ProviderConfig
    google?: ProviderConfig
    'claude-code'?: { enabled: boolean }
    codex?: { enabled: boolean }
    claw?: { enabled: boolean }
    'gemini-cli'?: { enabled: boolean }
    'qwen-code'?: { enabled: boolean }
    kiro?: { enabled: boolean }
    minimax?: ProviderConfig
  }
  mock?: boolean
  defaults: DefaultsConfig
  reviewers: Record<string, ReviewerConfig>
  summarizer: ReviewerConfig
  analyzer: ReviewerConfig
  contextGatherer?: ContextGathererConfigOptions
  trd?: TrdConfig
  capabilities: CapabilitiesConfig
  integrations: IntegrationsConfig
}
