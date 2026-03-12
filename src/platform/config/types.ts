import type {
  ContextGathererConfigOptions,
  DefaultsConfig,
  IntegrationsConfig,
  MagpieConfig as LegacyMagpieConfig,
  LoopConfig,
  ProviderConfig,
  ReviewerConfig,
  TrdConfig,
} from '../../config/types.js'

export type ProviderConfigs = LegacyMagpieConfig['providers']

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
  max_files?: number
  min_coverage?: number
  output_format?: 'markdown' | 'json'
}

export interface IssueFixConfig {
  enabled?: boolean
  planner_model?: string
  executor_model?: string
  verify_command?: string
  auto_commit?: boolean
}

export interface DocsSyncConfig {
  enabled?: boolean
  reviewer_model?: string
  docs_patterns?: string[]
}

export interface PostMergeRegressionConfig {
  enabled?: boolean
  evaluator_model?: string
  commands?: string[]
}

export interface QualityConfig {
  unitTestEval?: UnitTestEvalConfig
}

export interface CapabilitiesConfig {
  review?: ReviewConfig
  discuss?: DiscussConfig
  trd?: TrdConfig
  issue_fix?: IssueFixConfig
  docs_sync?: DocsSyncConfig
  post_merge_regression?: PostMergeRegressionConfig
  quality?: QualityConfig
  loop?: LoopConfig
}

export interface MagpieConfigV2 {
  providers: ProviderConfigs
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

export type {
  LegacyMagpieConfig,
  DefaultsConfig,
  IntegrationsConfig,
  LoopConfig,
  ProviderConfig,
  ReviewerConfig,
  TrdConfig,
}
