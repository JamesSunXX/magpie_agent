// src/config/init.ts
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface ReviewerOption {
  id: string
  name: string
  model: string
  description: string
  needsApiKey: boolean
  provider?: 'anthropic' | 'openai' | 'google'
}

export const AVAILABLE_REVIEWERS: ReviewerOption[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    model: 'claude-code',
    description: 'Uses your Claude Code subscription (no API key needed)',
    needsApiKey: false
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    model: 'codex-cli',
    description: 'Uses your OpenAI Codex CLI subscription (no API key needed)',
    needsApiKey: false
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    model: 'gemini-cli',
    description: 'Uses your Gemini CLI (Google account, no API key needed)',
    needsApiKey: false
  },
  {
    id: 'kiro',
    name: 'Kiro CLI',
    model: 'kiro',
    description: 'Uses your Kiro CLI subscription (AWS, no API key needed)',
    needsApiKey: false
  },
  {
    id: 'claude-api',
    name: 'Claude Sonnet 4.5',
    model: 'claude-sonnet-4-5-20250514',
    description: 'Uses Anthropic API (requires ANTHROPIC_API_KEY)',
    needsApiKey: true,
    provider: 'anthropic'
  },
  {
    id: 'gpt',
    name: 'GPT-5.2',
    model: 'gpt-5.2',
    description: 'Uses OpenAI API (requires OPENAI_API_KEY)',
    needsApiKey: true,
    provider: 'openai'
  },
  {
    id: 'gemini',
    name: 'Gemini 3 Pro',
    model: 'gemini-3-pro',
    description: 'Uses Google AI API (requires GOOGLE_API_KEY)',
    needsApiKey: true,
    provider: 'google'
  }
]

const REVIEW_PROMPT = `You are a thorough code reviewer. Your job is to find ALL issues — not just the obvious ones.

      REVIEW METHOD:
      1. Use locally available sources to gather PR/MR details and diff (local git changes, existing review artifacts, or GitLab merge request pages)
      2. Go through EVERY changed file and EVERY changed function/block systematically
      3. For each change, evaluate: correctness, security, performance, error handling, edge cases, maintainability
      4. Do NOT stop after finding a few issues — exhaust every file and every change before concluding

      IMPORTANT: Do not skip any changed file. Do not gloss over any changed function.
      If a file has no issues, briefly note that you reviewed it and found nothing.

      After your analysis, output your findings as a structured JSON block:
      \`\`\`json
      {
        "issues": [
          {
            "severity": "critical|high|medium|low|nitpick",
            "category": "security|performance|error-handling|style|correctness|...",
            "file": "path/to/file.ts",
            "line": 42,
            "title": "One-line summary",
            "description": "Detailed explanation",
            "suggestedFix": "What to do about it"
          }
        ],
        "verdict": "approve|request_changes|comment",
        "summary": "Brief overall assessment"
      }
      \`\`\`
      You may include free-form discussion before the JSON block.`

export function generateConfig(selectedReviewerIds: string[]): string {
  const selectedReviewers = AVAILABLE_REVIEWERS.filter(r => selectedReviewerIds.includes(r.id))

  // Determine which providers need API keys
  const needsAnthropic = selectedReviewers.some(r => r.provider === 'anthropic')
  const needsOpenai = selectedReviewers.some(r => r.provider === 'openai')
  const needsGoogle = selectedReviewers.some(r => r.provider === 'google')

  // Build providers section
  let providersSection = '# AI Provider API Keys (use environment variables)\nproviders:'
  if (needsAnthropic) {
    providersSection += `
  anthropic:
    api_key: \${ANTHROPIC_API_KEY}`
  }
  if (needsOpenai) {
    providersSection += `
  openai:
    api_key: \${OPENAI_API_KEY}`
  }
  if (needsGoogle) {
    providersSection += `
  google:
    api_key: \${GOOGLE_API_KEY}`
  }
  if (!needsAnthropic && !needsOpenai && !needsGoogle) {
    providersSection += ' {}'  // Empty providers if only CLI tools are used
  }

  // Build reviewers section
  let reviewersSection = '# Reviewer configurations\nreviewers:'
  for (const reviewer of selectedReviewers) {
    reviewersSection += `
  ${reviewer.id}:
    model: ${reviewer.model}
    prompt: |
      ${REVIEW_PROMPT}`
  }

  // Determine analyzer model (prefer first selected reviewer)
  const analyzerModel = selectedReviewers[0]?.model || 'claude-code'
  const trdDefaultReviewers = selectedReviewers.slice(0, 2).map(r => r.id)
  if (trdDefaultReviewers.length === 0) {
    trdDefaultReviewers.push('claude-code', 'codex-cli')
  } else if (trdDefaultReviewers.length === 1) {
    trdDefaultReviewers.push(trdDefaultReviewers[0])
  }

  const config = `# Magpie Configuration

${providersSection}

# Default settings
defaults:
  max_rounds: 5
  output_format: markdown
  check_convergence: true  # Stop early when reviewers reach consensus

${reviewersSection}

# Analyzer configuration - runs before debate to provide context
analyzer:
  model: ${analyzerModel}
  prompt: |
    You are a senior engineer providing PR context analysis.
    Before the review debate begins, analyze this PR and provide:

    1. **What this PR does** - A clear summary of the changes
    2. **Architecture/Design** - Key architectural decisions and patterns used
    3. **Purpose** - What problem this solves or what feature it adds
    4. **Trade-offs** - Any trade-offs made and why
    5. **Things to note** - Important details reviewers should pay attention to
    6. **Suggested Review Focus** - List 2-4 key areas reviewers should focus on for THIS specific PR

    Use locally available sources to get PR/MR details and diff (local git changes, existing review artifacts, or GitLab merge request pages).
    Be concise but thorough. Start your response directly with the analysis — do NOT include any preamble, thinking, or meta-commentary like "Here's my analysis" or "Let me look at this".

# Summarizer configuration
summarizer:
  model: ${analyzerModel}
  prompt: |
    You are a neutral technical reviewer.
    Based on the anonymous reviewer summaries, provide:
    - Points of consensus
    - Points of disagreement with analysis
    - Recommended action items

# Context gatherer configuration (collects system-level context before review)
contextGatherer:
  enabled: true
  # model: ${analyzerModel}  # Optional: defaults to analyzer model
  callChain:
    maxDepth: 2
    maxFilesToAnalyze: 20
  history:
    maxDays: 30
    maxPRs: 10
  docs:
    patterns:
      - docs
      - README.md
      - ARCHITECTURE.md
      - DESIGN.md
    maxSize: 50000

# TRD generation configuration (PRD Markdown -> multi-role TRD)
trd:
  default_reviewers: [${trdDefaultReviewers.join(', ')}]
  max_rounds: 3
  language: zh
  include_project_context: true
  include_traceability: true
  output:
    same_dir_as_prd: true
    trd_suffix: ".trd.md"
    open_questions_suffix: ".open-questions.md"
  preprocess:
    chunk_chars: 6000
    max_chars: 120000
    image_reader:
      enabled: true
      command: "tesseract {image} stdout -l chi_sim+eng"
      timeout_ms: 20000
      retries: 1
      skip_example_images: true
      example_keywords: ["示例", "样例", "example", "sample", "demo", "mock"]
      on_failure: "continue_with_open_question"
  domain:
    require_human_confirmation: true
    overview_required: true

# Capability-oriented settings
capabilities:
  loop:
    enabled: true
    planner_model: ${analyzerModel}
    executor_model: codex-cli
    stages: [prd_review, domain_partition, trd_generation, code_development, unit_mock_test, integration_test]
    confidence_threshold: 0.78
    retries_per_stage: 2
    max_iterations: 30
    auto_commit: true
    auto_branch_prefix: "sch/"
    human_confirmation:
      file: "human_confirmation.md"
      gate_policy: "exception_or_low_confidence"
      poll_interval_sec: 8
    commands:
      unit_test: "npm run test:run"
      mock_test: "npm run test:run -- tests/mock"
      integration_test: "npm run test:run -- tests/integration"

# Integrations
integrations:
  notifications:
    enabled: false
    default_timeout_ms: 5000
    routes:
      human_confirmation_required: [macos_local, feishu_team]
      loop_failed: [feishu_team]
      loop_completed: [feishu_team]
    providers:
      macos_local:
        type: "macos"
        click_target: "vscode"
        terminal_notifier_bin: "terminal-notifier"
        fallback_osascript: true
      feishu_team:
        type: "feishu-webhook"
        webhook_url: "\${FEISHU_WEBHOOK_URL}"
        secret: "\${FEISHU_WEBHOOK_SECRET}"
        msg_type: "post"
`

  return config
}

// Legacy default config for backwards compatibility
export const DEFAULT_CONFIG = generateConfig(['claude-code', 'codex-cli'])

export function initConfig(baseDir?: string, selectedReviewers?: string[]): string {
  const base = baseDir || homedir()
  const magpieDir = join(base, '.magpie')
  const configPath = join(magpieDir, 'config.yaml')

  if (existsSync(configPath)) {
    throw new Error(`Config already exists: ${configPath}`)
  }

  const config = selectedReviewers
    ? generateConfig(selectedReviewers)
    : DEFAULT_CONFIG

  mkdirSync(magpieDir, { recursive: true })
  writeFileSync(configPath, config, 'utf-8')

  return configPath
}
