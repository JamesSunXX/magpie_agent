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
}
