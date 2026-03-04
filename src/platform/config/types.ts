import type {
  ContextGathererConfigOptions,
  DefaultsConfig,
  MagpieConfig as LegacyMagpieConfig,
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

export interface QualityConfig {
  unitTestEval?: UnitTestEvalConfig
}

export interface CapabilitiesConfig {
  review?: ReviewConfig
  discuss?: DiscussConfig
  trd?: TrdConfig
  quality?: QualityConfig
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
}

export type {
  LegacyMagpieConfig,
  DefaultsConfig,
  ProviderConfig,
  ReviewerConfig,
  TrdConfig,
}
