// src/config/types.ts
export interface ProviderConfig {
  api_key: string
  base_url?: string
}

export interface ReviewerConfig {
  model: string
  prompt: string
}

export interface DefaultsConfig {
  max_rounds: number
  output_format: 'markdown' | 'json'
  check_convergence: boolean
  language?: string  // Output language (e.g., 'zh', 'en', 'ja')
  diff_exclude?: string[]  // Glob patterns for files to exclude from diff (e.g., '*.pb.go', '*generated*')
}

export interface ContextGathererConfigOptions {
  enabled: boolean
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
  model?: string  // Model to use for context analysis
}

export interface TrdImageReaderConfig {
  enabled?: boolean
  command?: string
  timeout_ms?: number
  retries?: number
  skip_example_images?: boolean
  example_keywords?: string[]
  on_failure?: 'continue_with_open_question' | 'fail'
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
    image_reader?: TrdImageReaderConfig
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
  planner_model?: string
  executor_model?: string
  stages?: LoopStageName[]
  confidence_threshold?: number
  retries_per_stage?: number
  max_iterations?: number
  auto_commit?: boolean
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

export interface ImessageNotificationProviderConfig {
  type: 'imessage'
  enabled?: boolean
  transport?: 'bluebubbles'
  server_url: string
  password: string
  targets: string[]
  method?: 'private-api' | 'apple-script'
}

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

export interface IntegrationsConfig {
  notifications?: NotificationsIntegrationConfig
}

export interface LegacyCapabilitiesConfig {
  review?: unknown
  discuss?: unknown
  trd?: TrdConfig
  quality?: unknown
  loop?: LoopConfig
}

export interface MagpieConfig {
  providers: {
    anthropic?: ProviderConfig
    openai?: ProviderConfig
    google?: ProviderConfig
    'claude-code'?: { enabled: boolean }
    'codex-cli'?: { enabled: boolean }
    'qwen-code'?: { enabled: boolean }
    'kiro'?: { enabled: boolean }
    minimax?: ProviderConfig
  }
  mock?: boolean
  defaults: DefaultsConfig
  reviewers: Record<string, ReviewerConfig>
  summarizer: ReviewerConfig
  analyzer: ReviewerConfig
  contextGatherer?: ContextGathererConfigOptions
  trd?: TrdConfig
  capabilities?: LegacyCapabilitiesConfig
  integrations?: IntegrationsConfig
}
