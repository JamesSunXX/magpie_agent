import { writeFileSync, mkdirSync, existsSync, renameSync } from 'fs'
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

export interface InitNotificationsOptions {
  feishuWebhookUrl?: string
  feishuWebhookSecret?: string
  imessageAppleScriptTargets?: string[]
  imessageBluebubblesServerUrl?: string
  imessageBluebubblesPassword?: string
  imessageBluebubblesChatGuid?: string
}

export type InitPlanningProviderId = 'jira_main' | 'feishu_project'
export type InitJiraAuthMode = 'cloud' | 'basic'

export interface InitPlanningOptions {
  enabled?: boolean
  defaultProvider?: InitPlanningProviderId
  jiraBaseUrl?: string
  jiraProjectKey?: string
  jiraAuthMode?: InitJiraAuthMode
  jiraEmail?: string
  jiraApiToken?: string
  jiraUsername?: string
  jiraPassword?: string
  feishuBaseUrl?: string
  feishuProjectKey?: string
  feishuAppId?: string
  feishuAppSecret?: string
}

export interface InitOperationsOptions {
  enabled?: boolean
  defaultProvider?: string
  timeoutMs?: number
  maxBufferBytes?: number
}

export interface InitConfigOptions {
  notifications?: InitNotificationsOptions
  planning?: InitPlanningOptions
  operations?: InitOperationsOptions
}

export interface InitConfigResult {
  configPath: string
  backupPath?: string
}

export const AVAILABLE_REVIEWERS: ReviewerOption[] = [
  { id: 'claude-code', name: 'Claude Code', model: 'claude-code', description: 'Uses your Claude Code subscription (no API key needed)', needsApiKey: false },
  { id: 'codex', name: 'Codex CLI', model: 'codex', description: 'Uses your OpenAI Codex CLI subscription (no API key needed)', needsApiKey: false },
  { id: 'claw', name: 'Claw CLI', model: 'claw', description: 'Uses your Claw CLI subscription (no API key needed)', needsApiKey: false },
  { id: 'gemini-cli', name: 'Gemini CLI', model: 'gemini-cli', description: 'Uses your Gemini CLI (Google account, no API key needed)', needsApiKey: false },
  { id: 'kiro', name: 'Kiro CLI', model: 'kiro', description: 'Uses your Kiro CLI subscription (AWS, no API key needed)', needsApiKey: false },
  { id: 'claude-api', name: 'Claude Sonnet 4.5', model: 'claude-sonnet-4-5-20250514', description: 'Uses Anthropic API (requires ANTHROPIC_API_KEY)', needsApiKey: true, provider: 'anthropic' },
  { id: 'gpt', name: 'GPT-5.2', model: 'gpt-5.2', description: 'Uses OpenAI API (requires OPENAI_API_KEY)', needsApiKey: true, provider: 'openai' },
  { id: 'gemini', name: 'Gemini 3 Pro', model: 'gemini-3-pro', description: 'Uses Google AI API (requires GOOGLE_API_KEY)', needsApiKey: true, provider: 'google' },
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

const ROUTE_GEMINI_PROMPT = `You are the fast-path reviewer used for automatic routing.

Focus on:
- local correctness
- obvious omissions
- simple rollback and validation gaps

Be concise and flag only the most actionable issues.`

const ROUTE_CODEX_PROMPT = `You are the implementation-focused reviewer used for automatic routing.

Focus on:
- business logic and edge cases
- tests and verification gaps
- concrete failure modes in the current plan

Prefer specific, code-adjacent criticism over broad strategy.`

const ROUTE_ARCHITECT_PROMPT = `You are the architecture reviewer used for automatic routing.

Focus on:
- architecture and trade-offs
- module boundaries and long-term maintainability
- rollout, compatibility, security, and performance risk

Call out system-level consequences, not low-level nits.`

function indentBlock(text: string, spaces = 6): string {
  const prefix = ' '.repeat(spaces)
  return text.split('\n').map(line => `${prefix}${line}`).join('\n')
}

function yamlDoubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function yamlStringOrEnvRef(value: string): string {
  return value.startsWith('${') && value.endsWith('}') ? value : yamlDoubleQuoted(value)
}

function normalizeBluebubblesTarget(target: string): string {
  return target.startsWith('chat_guid:') ? target : `chat_guid:${target}`
}

function resolveNotificationsOptions(options?: InitConfigOptions) {
  const notifications = options?.notifications
  const feishuWebhookUrl = notifications?.feishuWebhookUrl?.trim() || '${FEISHU_WEBHOOK_URL}'
  const feishuWebhookSecret = notifications?.feishuWebhookSecret?.trim() || '${FEISHU_WEBHOOK_SECRET}'
  const imessageBluebubblesServerUrl = notifications?.imessageBluebubblesServerUrl?.trim() || '${BLUEBUBBLES_SERVER_URL}'
  const imessageBluebubblesPassword = notifications?.imessageBluebubblesPassword?.trim() || '${BLUEBUBBLES_PASSWORD}'
  const imessageBluebubblesTarget = normalizeBluebubblesTarget(
    notifications?.imessageBluebubblesChatGuid?.trim() || '${BLUEBUBBLES_CHAT_GUID}'
  )
  const imessageAppleScriptTargets = notifications?.imessageAppleScriptTargets?.map(target => target.trim()).filter(Boolean)

  return {
    feishuWebhookUrl,
    feishuWebhookSecret,
    imessageAppleScriptTargets: imessageAppleScriptTargets?.length ? imessageAppleScriptTargets : ['handle:+8613800138000'],
    imessageBluebubblesServerUrl,
    imessageBluebubblesPassword,
    imessageBluebubblesTarget,
  }
}

function resolvePlanningOptions(options?: InitConfigOptions) {
  const planning = options?.planning
  const jiraAuthMode = planning?.jiraAuthMode === 'basic' ? 'basic' : 'cloud'

  return {
    enabled: planning?.enabled ?? false,
    defaultProvider: planning?.defaultProvider || 'jira_main',
    jiraBaseUrl: planning?.jiraBaseUrl?.trim() || 'https://your-company.atlassian.net',
    jiraProjectKey: planning?.jiraProjectKey?.trim() || 'ENG',
    jiraAuthMode,
    jiraEmail: planning?.jiraEmail?.trim() || '${JIRA_EMAIL}',
    jiraApiToken: planning?.jiraApiToken?.trim() || '${JIRA_API_TOKEN}',
    jiraUsername: planning?.jiraUsername?.trim() || '${JIRA_USERNAME}',
    jiraPassword: planning?.jiraPassword?.trim() || '${JIRA_PASSWORD}',
    feishuBaseUrl: planning?.feishuBaseUrl?.trim() || 'https://project.feishu.cn',
    feishuProjectKey: planning?.feishuProjectKey?.trim() || 'ENG',
    feishuAppId: planning?.feishuAppId?.trim() || '${FEISHU_PROJECT_APP_ID}',
    feishuAppSecret: planning?.feishuAppSecret?.trim() || '${FEISHU_PROJECT_APP_SECRET}',
  }
}

function resolveOperationsOptions(options?: InitConfigOptions) {
  const operations = options?.operations

  return {
    enabled: operations?.enabled ?? false,
    defaultProvider: operations?.defaultProvider?.trim() || 'local_main',
    timeoutMs: operations?.timeoutMs ?? 600000,
    maxBufferBytes: operations?.maxBufferBytes ?? 10485760,
  }
}

export function generateConfig(selectedReviewerIds: string[], options?: InitConfigOptions): string {
  const selectedReviewers = AVAILABLE_REVIEWERS.filter(r => selectedReviewerIds.includes(r.id))
  const needsAnthropic = selectedReviewers.some(r => r.provider === 'anthropic')
  const needsOpenai = selectedReviewers.some(r => r.provider === 'openai')
  const needsGoogle = selectedReviewers.some(r => r.provider === 'google')

  let providersSection = '# AI Provider API Keys (use environment variables)\nproviders:'
  if (needsAnthropic) providersSection += `\n  anthropic:\n    api_key: \${ANTHROPIC_API_KEY}`
  if (needsOpenai) providersSection += `\n  openai:\n    api_key: \${OPENAI_API_KEY}`
  if (needsGoogle) providersSection += `\n  google:\n    api_key: \${GOOGLE_API_KEY}`
  if (!needsAnthropic && !needsOpenai && !needsGoogle) providersSection += ' {}'

  let reviewersSection = '# Reviewer configurations\nreviewers:'
  for (const reviewer of selectedReviewers) {
    const reviewerAgentLine = reviewer.model === 'kiro'
      ? `\n    # agent: ${reviewer.id}`
      : ''
    reviewersSection += `\n  ${reviewer.id}:\n    model: ${reviewer.model}${reviewerAgentLine}\n    prompt: |\n${indentBlock(REVIEW_PROMPT)}`
  }

  reviewersSection += `\n  route-gemini:\n    model: gemini-cli\n    prompt: |\n${indentBlock(ROUTE_GEMINI_PROMPT)}`
  reviewersSection += `\n  route-codex:\n    model: codex\n    prompt: |\n${indentBlock(ROUTE_CODEX_PROMPT)}`
  reviewersSection += `\n  route-architect:\n    model: kiro\n    agent: architect\n    prompt: |\n${indentBlock(ROUTE_ARCHITECT_PROMPT)}`

  const analyzerModel = selectedReviewers[0]?.model || 'claude-code'
  const defaultReviewers = selectedReviewers.slice(0, 2).map(r => r.id)
  if (defaultReviewers.length === 0) defaultReviewers.push('claude-code', 'codex')
  if (defaultReviewers.length === 1) defaultReviewers.push(defaultReviewers[0])

  const notifications = resolveNotificationsOptions(options)
  const planning = resolvePlanningOptions(options)
  const operations = resolveOperationsOptions(options)
  const jiraCredentialLines = planning.jiraAuthMode === 'basic'
    ? `        username: ${yamlStringOrEnvRef(planning.jiraUsername)}
        password: ${yamlStringOrEnvRef(planning.jiraPassword)}`
    : `        email: ${yamlStringOrEnvRef(planning.jiraEmail)}
        api_token: ${yamlStringOrEnvRef(planning.jiraApiToken)}`
  const appleScriptTargetsYaml = notifications.imessageAppleScriptTargets
    .map(target => `          - ${yamlDoubleQuoted(target)}`)
    .join('\n')

  return `# Magpie Configuration

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
  default_reviewers: [${defaultReviewers.join(', ')}]
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
  domain:
    require_human_confirmation: true
    overview_required: true

# Capability-oriented settings
capabilities:
  review:
    enabled: true
    max_rounds: 5
    check_convergence: true
    reviewers: [${defaultReviewers.join(', ')}]
    skip_context: false
  discuss:
    enabled: true
    max_rounds: 5
    check_convergence: true
    reviewers: [${defaultReviewers.join(', ')}]
  trd:
    default_reviewers: [${defaultReviewers.join(', ')}]
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
    domain:
      require_human_confirmation: true
      overview_required: true
  quality:
    unitTestEval:
      enabled: true
      provider: ${analyzerModel}
      max_files: 50
      min_coverage: 0.8
      output_format: markdown
  issue_fix:
    enabled: true
    planner_model: ${analyzerModel}
    executor_model: codex
    verify_command: "npm run test:run"
    auto_commit: false
  routing:
    enabled: true
    strategy: "rules_first"
    default_tier: "standard"
    allow_runtime_escalation: true
    thresholds:
      simple_max: 2
      standard_max: 5
      complex_min: 6
    reviewer_pools:
      simple: [route-gemini, route-codex]
      standard: [route-codex, route-architect]
      complex: [route-gemini, route-codex, route-architect]
    stage_policies:
      planning:
        simple:
          model: gemini-cli
        standard:
          model: codex
        complex:
          model: kiro
          agent: architect
      execution:
        simple:
          model: gemini-cli
        standard:
          model: codex
        complex:
          model: kiro
          agent: dev
    fallback_chain:
      planning:
        simple:
          - model: codex
        standard:
          - model: gemini-cli
        complex:
          - model: codex
          - model: gemini-cli
      execution:
        simple:
          - model: codex
        standard:
          - model: gemini-cli
        complex:
          - model: codex
          - model: gemini-cli
  docs_sync:
    enabled: true
    reviewer_model: ${analyzerModel}
    docs_patterns: ["README.md", "docs"]
  post_merge_regression:
    enabled: true
    evaluator_model: ${analyzerModel}
    commands: ["npm run test:run", "npm run build"]
  loop:
    enabled: true
    planner_model: ${analyzerModel}
    executor_model: codex
    stages: [prd_review, domain_partition, trd_generation, code_development, unit_mock_test, integration_test]
    confidence_threshold: 0.78
    retries_per_stage: 2
    max_iterations: 30
    auto_commit: true
    reuse_current_branch: false
    auto_branch_prefix: "sch/"
    human_confirmation:
      file: "human_confirmation.md"
      gate_policy: "exception_or_low_confidence"
      poll_interval_sec: 8
    commands:
      unit_test: "npm run test:run"
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
        webhook_url: ${yamlDoubleQuoted(notifications.feishuWebhookUrl)}
        secret: ${yamlDoubleQuoted(notifications.feishuWebhookSecret)}
        msg_type: "post"
      imessage_local:
        type: "imessage"
        transport: "messages-applescript"
        service: "iMessage"
        targets:
${appleScriptTargetsYaml}
      imessage_remote:
        type: "imessage"
        transport: "bluebubbles"
        server_url: ${yamlDoubleQuoted(notifications.imessageBluebubblesServerUrl)}
        password: ${yamlDoubleQuoted(notifications.imessageBluebubblesPassword)}
        targets:
          - ${yamlDoubleQuoted(notifications.imessageBluebubblesTarget)}
        method: "private-api"
  planning:
    enabled: ${planning.enabled ? 'true' : 'false'}
    default_provider: ${yamlDoubleQuoted(planning.defaultProvider)}
    providers:
      jira_main:
        type: "jira"
        base_url: ${yamlDoubleQuoted(planning.jiraBaseUrl)}
        project_key: ${yamlDoubleQuoted(planning.jiraProjectKey)}
        auth_mode: ${yamlDoubleQuoted(planning.jiraAuthMode)}
${jiraCredentialLines}
      feishu_project:
        type: "feishu-project"
        base_url: ${yamlDoubleQuoted(planning.feishuBaseUrl)}
        project_key: ${yamlDoubleQuoted(planning.feishuProjectKey)}
        app_id: ${yamlStringOrEnvRef(planning.feishuAppId)}
        app_secret: ${yamlStringOrEnvRef(planning.feishuAppSecret)}
  operations:
    enabled: ${operations.enabled ? 'true' : 'false'}
    default_provider: ${yamlDoubleQuoted(operations.defaultProvider)}
    providers:
      ${operations.defaultProvider}:
        type: "local-commands"
        timeout_ms: ${operations.timeoutMs}
        max_buffer_bytes: ${operations.maxBufferBytes}
`
}

export const DEFAULT_CONFIG = generateConfig(['claude-code', 'codex'])

function buildBackupPath(configPath: string): string {
  const timestamp = Date.now()
  let backupPath = `${configPath}.bak-${timestamp}`
  let suffix = 1

  while (existsSync(backupPath)) {
    backupPath = `${configPath}.bak-${timestamp}-${suffix}`
    suffix += 1
  }

  return backupPath
}

export function initConfigWithResult(baseDir?: string, selectedReviewers?: string[], options?: InitConfigOptions): InitConfigResult {
  const base = baseDir || homedir()
  const magpieDir = join(base, '.magpie')
  const configPath = join(magpieDir, 'config.yaml')
  let backupPath: string | undefined

  mkdirSync(magpieDir, { recursive: true })

  if (existsSync(configPath)) {
    backupPath = buildBackupPath(configPath)
    renameSync(configPath, backupPath)
  }

  const reviewerIds = selectedReviewers?.length ? selectedReviewers : ['claude-code', 'codex']
  writeFileSync(configPath, generateConfig(reviewerIds, options), 'utf-8')

  return { configPath, backupPath }
}

export function initConfig(baseDir?: string, selectedReviewers?: string[], options?: InitConfigOptions): string {
  return initConfigWithResult(baseDir, selectedReviewers, options).configPath
}
